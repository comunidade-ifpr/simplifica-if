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
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type { UsoRevisaoIa } from "@simplifica-if/contratos-app";
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

/** Mensagens de limite de taxa e de cota dos três providers (em inglês, como chegam). */
const LIMITE =
  /rate.?limit|429|too many requests|usage limit|limit reached|hit your limit|quota|resource.?exhausted|overloaded|529|exceeded your|try again (at|in)/i;

export const ehLimite = (mensagem: string) => LIMITE.test(mensagem);

export function pausaDoErro(provider: Motor.Provider, mensagem: string): PausaRevisao {
  const nome = NOME_PROVIDER[provider];
  return ehLimite(mensagem)
    ? new PausaRevisao({
        limite: true,
        motivo: `O ${nome} avisou que o limite de uso do seu plano foi atingido por agora. O que já foi revisado está guardado; retome quando a janela do plano renovar.`,
      })
    : new PausaRevisao({
        limite: false,
        motivo: `O ${nome} parou de responder (${mensagem.slice(0, 160)}). O que já foi revisado está guardado; retome quando quiser.`,
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
}

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
  /** Mantém o cache de prompt (a conversa por pendência; o julgamento do lote não). */
  readonly manterCache?: boolean;
  /** Grava o uso assim que o turno acaba, em qualquer saída (sucesso, pausa, interrupção). */
  readonly registrarTentativa?: ((tentativa: TentativaIa) => Effect.Effect<void>) | undefined;
  readonly registrarTexto?: ((numero: number, texto: string) => Effect.Effect<void>) | undefined;
}

export type Turno = { texto: string; ferramentas: string[]; uso: UsoRevisaoIa; segundos: number };

/**
 * Um turno numa sessão nova, sem MCP e sem ferramentas, numa pasta vazia que some no fim: o julgamento
 * de um bloco e as ações da conversa por pendência (etapa 5b) passam por aqui. Ferramenta anunciada
 * ou pedido de aprovação vão em `ferramentas` (quem chama descarta a resposta); erro, limite e tempo
 * viram `PausaRevisao`.
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
          ? entrada.registrarTentativa({ numero: entrada.numero, uso: { ...uso }, segundos, ferramentas: [...ferramentas] })
          : Effect.void;
      }),
    );
  });
  const turno = Effect.gen(function* () {
    const pasta = yield* Effect.acquireRelease(
      Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "simplifica-julgamento-"))).pipe(
        Effect.flatMap((p) => Effect.promise(() => NodeFSP.realpath(p))),
      ),
      (p) => Effect.promise(() => NodeFSP.rm(p, { recursive: true, force: true })),
    );
    const sessao = yield* Effect.acquireRelease(
      motor
        .iniciarSessao({
          provider: entrada.provider,
          pastaTrabalho: pasta,
          servidoresMcp: [],
          instrucoes: entrada.instrucoes,
          semFerramentas: true,
          ...(entrada.manterCache === true ? { manterCache: true } : {}),
          ...(entrada.modelo ? { modelo: entrada.modelo } : {}),
        })
        .pipe(Effect.mapError((erro) => pausaDoErro(entrada.provider, erro.detalhe))),
      (id) => motor.encerrar(id).pipe(Effect.ignore),
    );
    const textos: string[] = [];
    const erros: string[] = [];
    yield* motor.enviarMensagem(sessao, entrada.texto).pipe(
      Stream.runForEach((evento) =>
        Effect.gen(function* () {
          switch (evento._tag) {
            case "TextoFinal":
              textos.push(evento.texto);
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
              erros.push(evento.mensagem);
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
        pausaDoErro(entrada.provider, erro._tag === "FalhaProvider" ? erro.detalhe : erro.message),
      ),
      Effect.timeoutOrElse({
        duration: entrada.tempoTurno,
        orElse: () =>
          Effect.fail(
            new PausaRevisao({
              limite: false,
              motivo: `O ${NOME_PROVIDER[entrada.provider]} demorou demais para responder. O que já foi revisado está guardado; tente de novo quando quiser.`,
            }),
          ),
      }),
    );
    if (erros.length && !ferramentas.length) return yield* pausaDoErro(entrada.provider, erros.join("; "));
    if (entrada.registrarTexto) yield* entrada.registrarTexto(entrada.numero, textos.join("\n"));
    return textos.join("\n");
  }).pipe(Effect.scoped);
  // O uso fica gravado em qualquer saída: sucesso, pausa, interrupção.
  const texto = yield* turno.pipe(Effect.onExit(() => registrar));
  return { texto, ferramentas: [...ferramentas], uso: { ...uso }, segundos } satisfies Turno;
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
  const tentativa = (texto: string) => {
    numero += 1;
    return turnoSemFerramentas({
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

  const r1 = yield* tentativa(entrada.pedido);
  if (r1.ferramentas.length) return yield* descartado(r1.ferramentas, 1);
  const primeira = conferir(r1.texto);
  let segunda: Conferencia | null = null;
  if (precisaNovaTentativa(primeira)) {
    const r2 = yield* tentativa(`${entrada.pedido}\n\n${pedidoDeCorrecao(primeira)}`);
    if (r2.ferramentas.length) return yield* descartado(r2.ferramentas, 2);
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
