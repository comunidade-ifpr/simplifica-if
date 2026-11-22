// @effect-diagnostics nodeBuiltinImport:off -- a pasta vazia de cada sessão de julgamento
/**
 * O julgamento de um bloco (M1.11, etapa 4): uma sessão curta do motor, sem MCP e sem ferramentas,
 * numa pasta vazia, com o pedido pronto; a resposta conferida em código; uma nova tentativa (numa
 * sessão nova) com os problemas; e, se falhar de novo, a ficha "a conferir" com o motivo.
 *
 * Segunda defesa contra ferramentas, nos três providers: a sessão de julgamento não tem ferramenta
 * (o motor as desliga), mas se o provider anunciar alguma (`FerramentaIniciada`), a resposta inteira é
 * descartada e as fichas do bloco saem "a conferir". O texto livre da resposta (justificativa,
 * lacunas) não é conferido contra o PPC; uma leitura do disco não pode chegar a ele.
 *
 * O uso de cada tentativa se registra ao fim dela (`registrarTentativa`), inclusive quando o bloco não
 * termina (pausa, limite, interrupção): o que se gastou não some.
 *
 * Limite de taxa, cota esgotada, provider caído ou turno longo demais viram `PausaRevisao` (a revisão
 * pausa e retoma depois), nunca um resultado: o bloco só se grava inteiro e conferido.
 */
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type { EtapaBlocoIa, UsoRevisaoIa } from "@simplifica-if/contratos-app";
import * as Motor from "@simplifica-if/motor";
import {
  alvoDosTrechos,
  type Conferencia,
  conferirResposta,
  motivoLegivel,
  pedidoDeCorrecao,
  type ResultadoIa,
} from "@simplifica-if/ppc/revisao-ia/conferencia";
import {
  conteudoDoPpcParaFicha,
  type CriterioInconclusivo,
  instrucoesJulgador,
  secaoDaFicha,
} from "@simplifica-if/ppc/revisao-ia/pedido";
import type { Bloco, FichaIa } from "@simplifica-if/ppc/revisao-ia/plano";
import type { ResultadoFichaIa } from "@simplifica-if/ppc/revisao-previa";

/** A revisão para; os blocos sem resultado voltam na retomada. */
export class PausaRevisao extends Schema.TaggedError<PausaRevisao>()("PausaRevisao", {
  motivo: Schema.String,
  /** Limite de taxa ou cota: a pessoa espera a janela e retoma. */
  limite: Schema.Boolean,
}) {}

/** O resultado gravado de um bloco (`blocos_ia.resultado`). */
export type ResultadoBloco = {
  resultados: ResultadoFichaIa[];
  resumo: string | null;
  tentativas: number;
  /** Os problemas da primeira resposta (por que houve nova tentativa), para o diagnóstico. */
  problemasPrimeira?: string[];
  /** Ferramentas que o provider tentou usar (a resposta foi descartada). */
  ferramentas?: string[];
};

/** O uso de uma tentativa, para gravar à parte (`tentativas_ia`). */
export type TentativaIa = { numero: number; uso: UsoRevisaoIa; segundos: number; ferramentas: string[] };

export const NOME_PROVIDER: Record<Motor.Provider, string> = {
  claude: "Claude",
  codex: "ChatGPT (Codex)",
  antigravity: "Gemini (Antigravity)",
};

/**
 * Os tipos de falha (do classificador do motor) em que a pessoa espera e retoma: a cota ou o limite de
 * taxa do plano e o serviço sobrecarregado.
 */
const ehLimite = (tipo: Motor.TipoFalha) => tipo === "cota" || tipo === "indisponivel";

/**
 * A pausa por uma falha do turno: o tipo decide se é limite e a frase (a cota é o plano; o serviço
 * sobrecarregado, esperar uns minutos); `descricao` é o texto técnico, já curto e saneado.
 */
export function pausaDoErro(provider: Motor.Provider, tipo: Motor.TipoFalha, descricao: string): PausaRevisao {
  const nome = NOME_PROVIDER[provider];
  if (tipo === "cota")
    return new PausaRevisao({
      limite: true,
      motivo: `O ${nome} avisou que o limite de uso do seu plano foi atingido por agora. O que já foi revisado está guardado; retome quando a janela do plano renovar.`,
    });
  return tipo === "indisponivel"
    ? new PausaRevisao({
        limite: true,
        motivo: `O serviço do ${nome} está sobrecarregado ou fora do ar. O que já foi revisado está guardado; retome em alguns minutos.`,
      })
    : new PausaRevisao({
        limite: false,
        motivo: `O ${nome} parou de responder (${descricao.slice(0, 160)}). O que já foi revisado está guardado; retome quando quiser.`,
      });
}

export interface EntradaJulgamento {
  readonly provider: Motor.Provider;
  readonly modelo: string | null;
  readonly nonce: string;
  readonly bloco: Bloco;
  readonly fichas: readonly FichaIa[];
  /** O pedido do bloco; o conteúdo do PPC entregue a cada ficha sai dele e é o alvo dos trechos. */
  readonly pedido: string;
  readonly fontes: ReadonlySet<string>;
  /**
   * O texto do PPC entregue, quando o pedido traz entre as marcas mais do que o PPC: nas
   * transversais, os resumos dos temas (escritos pela IA) vão junto, e o alvo dos trechos tem de ser
   * só as partes extraídas e os recortes. Sem ele, o alvo sai do pedido.
   */
  readonly conteudoPpc?: string;
  /** Tempo máximo de um turno. */
  readonly tempoTurno: Duration.Duration;
  /** Grava o uso de cada tentativa assim que ela acaba, mesmo que o bloco não termine. */
  readonly registrarTentativa?: (tentativa: TentativaIa) => Effect.Effect<void>;
  /** O critério do INCONCLUSIVO com que o pedido foi montado (padrão: `conservador`). */
  readonly criterio?: CriterioInconclusivo;
  /** A triagem achou texto dirigido a IA no PPC: a revisão humana é obrigatória (decisão do código). */
  readonly revisaoHumana?: boolean;
  /**
   * Recebe o texto bruto de cada tentativa, como a IA respondeu (só o script de avaliação usa, para
   * reavaliar a conferência sem nova chamada). O app não grava o texto bruto.
   */
  readonly registrarTexto?: (numero: number, texto: string) => Effect.Effect<void>;
  /**
   * Avisado quando o bloco muda de etapa (`aguardando`, `recebendo`, `conferindo`, `nova_tentativa`) e,
   * no `recebendo`, a cada sinal de vida da IA (no máximo um por `INTERVALO_ATIVIDADE`).
   */
  readonly aoEtapa?: (etapa: EtapaBlocoIa) => Effect.Effect<void>;
}

/** O intervalo mínimo entre dois avisos de texto recebido: o andamento na tela, sem um aviso por pedaço. */
export const INTERVALO_ATIVIDADE = Duration.seconds(5);

const usoVazio = (): { -readonly [K in keyof UsoRevisaoIa]: UsoRevisaoIa[K] } => ({
  entrada: 0,
  saida: 0,
  cacheLeitura: 0,
  cacheEscrita: 0,
  custoUsd: 0,
});

/** Converte o resultado conferido no do contrato da revisão prévia. */
const paraResultado = (r: ResultadoIa, revisaoHumana: boolean): ResultadoFichaIa => ({
  ficha: r.ficha_id,
  estado: r.estado,
  confianca: r.confianca,
  justificativa: r.justificativa,
  lacunas: [...r.lacunas],
  oQueFazer: r.o_que_fazer ?? "",
  trechos: r.evidencias.map((e) => e.trecho).filter((t) => t.trim().length > 0),
  fontes: [...(r.fontes ?? [])],
  revisaoHumana,
  ...(r.tipo_achado ? { tipoAchado: r.tipo_achado } : {}),
});

const falhou = (ficha: string, motivo: string): ResultadoFichaIa => ({
  ficha,
  estado: "FALHOU",
  confianca: 0,
  justificativa: "",
  lacunas: [],
  oQueFazer: "",
  trechos: [],
  fontes: [],
  revisaoHumana: true,
  motivoFalha: motivo,
});

export const MOTIVO_FERRAMENTA =
  "a IA tentou usar uma ferramenta, o que a revisão não permite, e a resposta foi descartada";

export { alvoDosTrechos };

export interface EntradaTurno {
  readonly provider: Motor.Provider;
  readonly modelo: string | null;
  /** As instruções da sessão (as do julgador ou as da conversa por pendência). */
  readonly instrucoes: string;
  readonly texto: string;
  readonly tempoTurno: Duration.Duration;
  /** O número da tentativa (para o registro do uso). */
  readonly numero: number;
  /** Grava o uso assim que o turno acaba, em qualquer saída (sucesso, pausa, interrupção). */
  readonly registrarTentativa?: ((tentativa: TentativaIa) => Effect.Effect<void>) | undefined;
  readonly registrarTexto?: ((numero: number, texto: string) => Effect.Effect<void>) | undefined;
  /** O que o turno avalia, para a frase do tempo esgotado ("o tema “Matriz curricular”"). */
  readonly assunto?: string | undefined;
  /** Avisado quando a IA manda texto (o primeiro pedaço e, depois, no máximo um por `INTERVALO_ATIVIDADE`). */
  readonly aoReceber?: (() => Effect.Effect<void>) | undefined;
}

/**
 * A pausa do tempo esgotado: o que estava sendo avaliado e se a IA chegou a responder em parte (os
 * drivers não repassam o raciocínio, então "não respondeu" pode ser a IA pensando demais).
 */
export function pausaDoTempo(
  provider: Motor.Provider,
  assunto: string | undefined,
  recebeuTexto: boolean,
): PausaRevisao {
  const sobre = assunto === undefined ? "" : ` sobre ${assunto}`;
  const parte = recebeuTexto
    ? "Ela chegou a responder em parte, mas não terminou a tempo."
    : "Ela não chegou a mandar resposta.";
  return new PausaRevisao({
    limite: false,
    motivo: `O ${NOME_PROVIDER[provider]} demorou demais para responder${sobre}. ${parte} O que já foi revisado está guardado; tente de novo quando quiser.`,
  });
}

/** Uma sessão sem MCP e sem ferramentas, numa pasta vazia que some com o escopo. */
const abrirSessaoSemFerramentas = Effect.fn("RevisaoIa.abrirSessao")(function* (
  entrada: Pick<EntradaTurno, "provider" | "modelo" | "instrucoes">,
) {
  const motor = yield* Motor.Motor;
  const fs = yield* FileSystem.FileSystem;
  // Uma falha ao criar a pasta temporária é defeito: não há o que a revisão possa fazer com ela.
  const pasta = yield* fs
    .makeTempDirectoryScoped({ prefix: "simplifica-julgamento-" })
    .pipe(Effect.flatMap(fs.realPath), Effect.orDie);
  return yield* Effect.acquireRelease(
    motor
      .iniciarSessao({
        provider: entrada.provider,
        pastaTrabalho: pasta,
        servidoresMcp: [],
        instrucoes: entrada.instrucoes,
        semFerramentas: true,
        ...(entrada.modelo ? { modelo: entrada.modelo } : {}),
      })
      .pipe(Effect.mapError((erro) => pausaDoErro(entrada.provider, erro.tipo, Motor.diagnosticoDaFalha(erro)))),
    (id) => motor.encerrar(id).pipe(Effect.ignore),
  );
});

/**
 * Um turno numa sessão nova, sem MCP e sem ferramentas, numa pasta vazia que some no fim: o julgamento
 * de um bloco e as ações da conversa por pendência (etapa 5b) passam por aqui. Ferramenta anunciada ou
 * pedido de aprovação vão em `ferramentas` (quem chama descarta a resposta); erro, limite e tempo
 * viram `PausaRevisao`.
 *
 * Sempre uma sessão nova, com o cache de prompt desligado (`semFerramentas`): na medição da etapa 5b,
 * o segundo turno de uma sessão do Claude gravou 170 mil tokens no cache e não leu nada, como o bloco
 * fixo de 158 mil da etapa 4; e uma sessão nova com uma mensagem só não tem ponto de leitura do cache.
 */
export const turnoSemFerramentas = Effect.fn("RevisaoIa.turno")(function* (entrada: EntradaTurno) {
  const motor = yield* Motor.Motor;
  const comeco = yield* Clock.currentTimeMillis;
  const uso = usoVazio();
  const ferramentas: string[] = [];
  // O `custoUsd` do Claude é o acumulado da sessão (o `total_cost_usd` do Agent SDK): vale o último.
  let custoDaSessao = 0;
  let segundos = 0;
  const registrar = Effect.suspend(() => {
    uso.custoUsd = custoDaSessao;
    return Clock.currentTimeMillis.pipe(
      Effect.flatMap((agora) => {
        segundos = Math.round((agora - comeco) / 100) / 10;
        return entrada.registrarTentativa
          ? entrada.registrarTentativa({
              numero: entrada.numero,
              uso: { ...uso },
              segundos,
              ferramentas: [...ferramentas],
            })
          : Effect.void;
      }),
    );
  });
  let recebeuTexto = false;
  let ultimoAviso = Number.NEGATIVE_INFINITY;
  const intervalo = Duration.toMillis(INTERVALO_ATIVIDADE);
  /** Um pedaço de texto chegou: avisa no primeiro e, depois, no máximo um por intervalo. */
  const sinalDeVida = Effect.fnUntraced(function* () {
    // Por evento de stream: o span é o do turno.
    recebeuTexto = true;
    if (entrada.aoReceber === undefined) return;
    const agora = yield* Clock.currentTimeMillis;
    if (agora - ultimoAviso < intervalo) return;
    ultimoAviso = agora;
    yield* entrada.aoReceber();
  });
  const turno = Effect.gen(function* () {
    const sessao = yield* abrirSessaoSemFerramentas(entrada);
    const textos: string[] = [];
    const erros: Motor.Erro[] = [];
    yield* motor.enviarMensagem(sessao, entrada.texto).pipe(
      Stream.runForEach((evento) =>
        Effect.gen(function* () {
          switch (evento._tag) {
            case "TextoParcial":
              yield* sinalDeVida();
              break;
            case "TextoFinal":
              textos.push(evento.texto);
              yield* sinalDeVida();
              break;
            case "UsoTokens":
              uso.entrada += evento.entrada;
              uso.saida += evento.saida;
              uso.cacheLeitura += evento.cacheLeitura ?? 0;
              uso.cacheEscrita += evento.cacheEscrita ?? 0;
              custoDaSessao = Math.max(custoDaSessao, evento.custoUsd ?? 0);
              break;
            case "FerramentaIniciada":
              ferramentas.push(evento.nome.slice(0, 80));
              break;
            case "Erro":
              erros.push(evento);
              break;
            case "PedidoAprovacao":
              // A política de julgamento já nega sem perguntar; se algo chegar, nega também.
              ferramentas.push(evento.ferramenta.slice(0, 80));
              yield* motor.responderAprovacao(sessao, evento.id, "negar").pipe(Effect.ignore);
              break;
          }
        }),
      ),
      Effect.mapError((erro) =>
        pausaDoErro(
          entrada.provider,
          erro._tag === "FalhaProvider" ? erro.tipo : "desconhecido",
          Motor.diagnosticoDaFalha(erro),
        ),
      ),
      Effect.timeoutOrElse({
        duration: entrada.tempoTurno,
        orElse: () => Effect.failSync(() => pausaDoTempo(entrada.provider, entrada.assunto, recebeuTexto)),
      }),
    );
    if (erros.length && !ferramentas.length) {
      const limite = erros.find((erro) => ehLimite(erro.tipo));
      return yield* pausaDoErro(
        entrada.provider,
        (limite ?? erros[0]!).tipo,
        erros.map((erro) => erro.mensagem).join("; "),
      );
    }
    if (entrada.registrarTexto) yield* entrada.registrarTexto(entrada.numero, textos.join("\n"));
    return textos.join("\n");
  }).pipe(Effect.scoped);
  // O uso fica gravado em qualquer saída: sucesso, pausa, interrupção.
  const texto = yield* turno.pipe(Effect.onExit(() => registrar));
  return { texto, ferramentas: [...ferramentas], uso: { ...uso }, segundos };
});

/** Julga um bloco. Devolve o resultado (uma entrada por ficha), o uso somado e os segundos. */
export const julgarBloco = Effect.fn("RevisaoIa.julgarBloco")(function* (entrada: EntradaJulgamento) {
  const inicio = yield* Clock.currentTimeMillis;
  const uso = usoVazio();
  let numero = 0;

  /**
   * Uma tentativa: uma sessão nova, numa pasta vazia, com um turno só. A nova tentativa não continua a
   * sessão: no teste real de 16/11/2026, o segundo turno de uma sessão do Claude levou um bloco fixo de
   * cerca de 158 mil tokens (lido ou gravado no cache); um pedido novo custa só o pedido.
   */
  const etapa = (e: EtapaBlocoIa) => (entrada.aoEtapa ? entrada.aoEtapa(e) : Effect.void);
  const assunto =
    entrada.bloco.tipo === "T" ? "os critérios transversais" : `o tema “${entrada.bloco.tema}” (${entrada.bloco.id})`;
  const tentativa = (texto: string) => {
    numero += 1;
    return turnoSemFerramentas({
      assunto,
      aoReceber: () => etapa("recebendo"),
      provider: entrada.provider,
      modelo: entrada.modelo,
      instrucoes: instrucoesJulgador(entrada.nonce),
      texto,
      tempoTurno: entrada.tempoTurno,
      numero,
      registrarTentativa: (t) => {
        for (const k of Object.keys(uso) as (keyof UsoRevisaoIa)[]) uso[k] += t.uso[k];
        return entrada.registrarTentativa ? entrada.registrarTentativa(t) : Effect.void;
      },
      registrarTexto: entrada.registrarTexto,
    });
  };

  const conferir = conferidorDoBloco(entrada);
  const fim = (resultado: ResultadoBloco) =>
    Clock.currentTimeMillis.pipe(
      Effect.map((agora) => ({ resultado, uso: { ...uso }, segundos: Math.round((agora - inicio) / 100) / 10 })),
    );
  const descartado = (ferramentas: string[], tentativas: number) =>
    fim({
      resultados: entrada.fichas.map((f) => falhou(f.id, MOTIVO_FERRAMENTA)),
      resumo: null,
      tentativas,
      ferramentas,
    });

  yield* etapa("aguardando");
  const r1 = yield* tentativa(entrada.pedido);
  if (r1.ferramentas.length) return yield* descartado(r1.ferramentas, 1);
  yield* etapa("conferindo");
  const primeira = conferir(r1.texto);
  let segunda: Conferencia | null = null;
  if (precisaNovaTentativa(primeira)) {
    yield* etapa("nova_tentativa");
    const r2 = yield* tentativa(`${entrada.pedido}\n\n${pedidoDeCorrecao(primeira)}`);
    if (r2.ferramentas.length) return yield* descartado(r2.ferramentas, 2);
    yield* etapa("conferindo");
    segunda = conferir(r2.texto);
  }
  return yield* fim(resultadoDoBloco(entrada.fichas, primeira, segunda, entrada.revisaoHumana ?? false));
});

/**
 * A conferência de uma resposta deste bloco: o alvo dos trechos de cada ficha é o conteúdo do PPC que
 * ela recebeu (sem os recortes das outras), e a prova de leitura de uma ausência, a seção dela.
 * Puro: o script de avaliação reconfere com ele as respostas gravadas.
 */
export function conferidorDoBloco(
  entrada: Pick<EntradaJulgamento, "bloco" | "fichas" | "pedido" | "fontes" | "conteudoPpc" | "criterio">,
): (texto: string) => Conferencia {
  // Nas transversais, o PPC entregue é o `conteudoPpc` (sem os resumos escritos pela IA).
  const pedido = { pedido: entrada.conteudoPpc === undefined ? entrada.pedido : "" };
  const reserva = entrada.conteudoPpc ?? "";
  const alvos = new Map(
    entrada.fichas.map((f) => [f.id, alvoDosTrechos(conteudoDoPpcParaFicha(pedido, f.id, reserva))]),
  );
  const secoes = new Map(
    entrada.fichas.map((f) => {
      const secao = secaoDaFicha(pedido, f.id, reserva);
      return [f.id, secao === null ? null : alvoDosTrechos(secao)];
    }),
  );
  return (texto) =>
    conferirResposta(texto, entrada.bloco, entrada.fichas, {
      alvoDaFicha: (id) => alvos.get(id) ?? "",
      secaoDaFicha: (id) => secoes.get(id) ?? null,
      fontes: entrada.fontes,
      criterio: entrada.criterio,
    });
}

/** Só o resumo do tema faltando não justifica pagar o pedido de novo: as transversais seguem sem ele. */
export const precisaNovaTentativa = (c: Conferencia) =>
  [...c.problemas.keys()].some((k) => k !== "*") || (c.problemas.has("*") && c.validos.size === 0);

/**
 * O resultado do bloco a partir das conferências (puro): a segunda resposta vale onde passou, o que só
 * passou na primeira continua valendo, e o resto sai "a conferir" com o motivo legível.
 */
export function resultadoDoBloco(
  fichas: readonly FichaIa[],
  primeira: Conferencia,
  segunda: Conferencia | null,
  revisaoHumana: boolean,
): ResultadoBloco {
  const validos = segunda ? new Map([...primeira.validos, ...segunda.validos]) : primeira.validos;
  const problemas = (segunda ?? primeira).problemas;
  const resultados: ResultadoFichaIa[] = fichas.map((ficha) => {
    const valido = validos.get(ficha.id);
    if (valido) return paraResultado(valido, revisaoHumana);
    return falhou(ficha.id, motivoLegivel(problemas.get(ficha.id) ?? problemas.get("*") ?? ["sem resultado"]));
  });
  return {
    resultados,
    resumo: segunda?.resumo ?? primeira.resumo,
    tentativas: segunda ? 2 : 1,
    problemasPrimeira: [...primeira.problemas].map(([ficha, erros]) => `${ficha}: ${erros.join("; ")}`),
  };
}
