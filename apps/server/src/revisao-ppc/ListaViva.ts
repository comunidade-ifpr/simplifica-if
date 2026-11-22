/**
 * `ListaViva`: a lista de pendências que a pessoa mantém (M1.11, etapa 5b), no servidor, e as ações
 * dentro de cada pendência.
 *
 * - **A lista** nasce de cada revisão (a pré-conferência, `revisar`, que avisa as etapas da leitura em
 *   stream; `criarLista`, de `criar-lista.ts`). A leitura com IA não cria outra: a `RevisaoIa` mescla cada
 *   bloco pronto nesta mesma lista, que guarda os resultados conferidos da IA (`resultados_ia`). Fica no
 *   `conversas.sqlite` (`Listas`), com o texto do PPC que as ações usam; sobrevive a fechar o app e à cota.
 *   A situação marcada passa para a lista nova do mesmo arquivo com o mesmo conteúdo (chave da pendência
 *   igual), e a lista nova substitui a anterior.
 * - **"Qual é o curso?"** (`trocarCurso`): a lista refeita com o curso escolhido, com os resultados da
 *   leitura com IA, se houve, como na cópia comentada.
 * - "Qual é o curso?" e "Enviar a versão corrigida" mudam o que a leitura com IA leu: recusam com ela em
 *   andamento (a pessoa pausa antes) e apagam a pausada, na mesma operação.
 * - **"Feito" e "Desfazer"** (`marcar`): só mudam a situação, sem IA.
 * - **"Enviar a versão corrigida"** (`revisarArquivoNovo`): o `.docx` novo é pré-conferido (só o código) e
 *   decide as pendências do código da lista inteira, casadas pelo critério (`arquivo-novo.ts`); as que só
 *   ele aponta entram abertas. A cópia comentada dele é gravada antes e, depois, numa transação, a lista
 *   passa ao arquivo novo: uma falha no meio não deixa a lista meio trocada.
 * - **"Já resolvi" com o arquivo novo, por pendência** (`revisarDeNovo`): o servidor converte e pré-confere o `.docx` novo
 *   e reconfere **só a ficha da pendência**: no código (fichas D e triagem) e, nas da IA, num lote de uma
 *   ficha conferido como no julgamento. A situação sai do resultado: `resolvida` só se a ficha não
 *   aponta mais nada; senão volta a `aberta`, com o que ainda falta.
 * - **"Discordo…"** (`contestar`) e **"Sugerir texto"** (`sugerir`): uma sessão sem ferramentas, com o
 *   pedido e a conferência do `conversa.ts` do `packages/ppc`. Quem decide é o código (ver lá).
 * - O uso de cada ação com IA fica em `acoes_ia` e soma ao uso da revisão com IA de onde a lista veio.
 *   Uma ação com IA por vez; a estimativa vem antes (`estimar`). "Enviar a versão corrigida" e "Qual é o
 *   curso?" trocam a lista inteira: também esperam que nenhuma ação com IA esteja em andamento.
 * - As escritas curtas (`marcar`, o fim de `contestar`, `sugerir` e `revisarDeNovo`, `gerarCopia`,
 *   `revisarArquivoNovo`, `trocarCurso`) e a mesclagem da leitura com IA esperam a vez umas das outras
 *   (`Listas.exclusivo`): a cópia comentada não sai de um estado que outra escrita já mudou.
 * - A cópia comentada é regravada só quando a lista mudou desde a última (`versao` e `versaoCopia` das
 *   `Listas`), e nunca por cima da cópia que a pessoa editou (`RevisorPpc`).
 * - As ações que mandam o PPC à IA (`contestar`, `sugerir`, `revisarDeNovo`) esperam o aviso de uso
 *   aceito (M1.8): sem ele, recusam com `AvisoNaoAceito`. As três abrem pelo mesmo preparo (`abrirAcao`,
 *   `prepararAcaoIa`) e terminam pelo mesmo registro (`concluirAcao`).
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import {
  type AvisoNaoAceito,
  type DocumentoRevisado,
  type EstimativaAcao,
  type EventoRevisaoPpc,
  FalhaRevisaoPpc,
  type ListaPendencias,
  type PendenciaViva,
  type Provider,
  type ResultadoArquivoNovo,
  type SituacaoPendencia,
} from "@simplifica-if/contratos-app";
import type * as FontesNormativas from "@simplifica-if/kb/FontesNormativas";
import type * as PacoteContexto from "@simplifica-if/kb/PacoteContexto";
import * as Motor from "@simplifica-if/motor";
import {
  conferirContestacao,
  MANTIDA_CODIGO,
  conferirSugestao,
  instrucoesConversa,
  pedidoContestacao,
  pedidoSugestao,
  prefixoConversa,
  type TurnoAnterior,
} from "@simplifica-if/ppc/revisao-ia/conversa";
import { documentoRevisado } from "./documento-revisado.ts";
import { estimarAcao } from "./estimativa.ts";
import { type PendenciaDaLista, planoArquivoNovo } from "./arquivo-novo.ts";
import { pedidoS } from "@simplifica-if/ppc/revisao-ia/pedido";
import { dobrar, retirarTextoParaIa, teveTextoParaIa } from "@simplifica-if/ppc/revisao-ia/plano";
import { MODELO_PADRAO } from "./modelos.ts";
import { chavePendencia, estadoDaIa, NOME_DA_FORMA, type ResultadoFichaIa } from "@simplifica-if/ppc/revisao-previa";
import * as Listas from "../persistencia/Listas.ts";
import * as Preferencias from "../persistencia/Preferencias.ts";
import * as Revisoes from "../persistencia/Revisoes.ts";
import * as RevisorPpc from "./RevisorPpc.ts";
import { cursoEscolhido, marcasDaCopia, regravarCopia as regravarCopiaDaLista } from "./copia-lista.ts";
import { criarLista, novoNonce } from "./criar-lista.ts";
import { julgarBloco, PausaRevisao, turnoSemFerramentas } from "./julgamento.ts";
import { contextoDaFicha } from "./preparo.ts";

export const TEMPO_ACAO = Duration.minutes(4);
export const LIMITE_MOTIVO = 1500;

export class ListaViva extends Context.Service<
  ListaViva,
  {
    /**
     * A pré-conferência (`RevisorPpc.revisarCompleto`) com a lista viva gravada: as etapas da leitura
     * quando cada uma começa e, no fim, o resultado, que traz o `lista`.
     */
    readonly revisar: (entrada: RevisorPpc.EntradaRevisao) => Stream.Stream<EventoRevisaoPpc, FalhaRevisaoPpc>;
    readonly lista: (id: string) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc>;
    readonly ultima: Effect.Effect<ListaPendencias | null>;
    /** A lista mais recente de um arquivo (para continuar uma leitura com IA sem revisar de novo). */
    readonly doArquivo: (arquivo: string) => Effect.Effect<ListaPendencias | null>;
    /** "Qual é o curso?": a lista refeita com o curso escolhido, com os resultados da IA, se houve. */
    readonly trocarCurso: (
      id: string,
      cnct: string,
      forma: string | undefined,
    ) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc>;
    readonly apagar: (id: string) => Effect.Effect<void>;
    /** As discordâncias contra pendências do código, em CSV, para a curadoria das regras. */
    readonly exportarDiscordancias: Effect.Effect<string>;
    readonly marcar: (
      id: string,
      chave: string,
      situacao: "aberta" | "resolvida",
    ) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc>;
    readonly estimar: (
      id: string,
      chave: string,
      acao: "contestar" | "sugerir" | "revisarDeNovo",
      provider?: Provider,
    ) => Effect.Effect<EstimativaAcao, FalhaRevisaoPpc>;
    readonly contestar: (
      id: string,
      chave: string,
      motivo: string,
      provider?: Provider,
    ) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc | AvisoNaoAceito>;
    readonly sugerir: (
      id: string,
      chave: string,
      provider?: Provider,
    ) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc | AvisoNaoAceito>;
    readonly revisarDeNovo: (
      id: string,
      chave: string,
      arquivo: string,
      provider?: Provider,
    ) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc | AvisoNaoAceito>;
    /** "Enviar a versão corrigida": a lista inteira reconferida em código contra o arquivo novo. */
    readonly revisarArquivoNovo: (id: string, arquivo: string) => Effect.Effect<ResultadoArquivoNovo, FalhaRevisaoPpc>;
    readonly gerarCopia: (id: string) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc>;
    /** O texto do PPC da lista, com as seções e os trechos das pendências, para o painel de leitura. */
    readonly documento: (id: string) => Effect.Effect<DocumentoRevisado, FalhaRevisaoPpc>;
  }
>()("@simplifica-if/server/revisao-ppc/ListaViva") {}

/** Títulos de seção (normalizados) de um Markdown convertido. */
const titulos = (markdown: string) =>
  new Set(
    markdown
      .split("\n")
      .filter((l) => /^#{1,6}\s/.test(l))
      .map((l) => dobrar(l.replace(/^#+\s*/, "").replace(/^[\d.\s]+/, "")))
      .filter((t) => t.length >= 4),
  );

/** Linhas com texto de um Markdown. */
const linhasComTexto = (markdown: string) => markdown.split("\n").filter((l) => l.trim()).length;

/**
 * O arquivo da nova revisão comparado com o revisado: a fração dos títulos de seção **do revisado** que
 * estão no novo, e o tamanho do novo (títulos e linhas com texto) em relação ao revisado. Um arquivo
 * quase vazio, com um título só do original, não passa: tem poucas seções e poucas linhas.
 */
export function comparacaoComOriginal(original: string, novo: string) {
  const to = titulos(original);
  const tn = titulos(novo);
  return {
    titulosEmComum: to.size ? [...to].filter((t) => tn.has(t)).length / to.size : 0,
    secoes: to.size ? tn.size / to.size : 0,
    linhas: linhasComTexto(original) ? linhasComTexto(novo) / linhasComTexto(original) : 0,
  };
}

/** O arquivo da nova revisão tem de ter ao menos esta fração dos títulos do revisado, das seções e das linhas. */
export const SEMELHANCA_MINIMA = 0.6;
export const TAMANHO_MINIMO = 0.7;

/** Dias sem uso que uma lista fica guardada (com o texto do PPC e os motivos). */
export const DIAS_LISTA = 30;

/* ============================================================ textos */

const ROTULO_ACAO: Record<"aberta" | "resolvida", string> = {
  aberta: "Reaberta por você.",
  resolvida: "Você marcou como feita (sem nova revisão do arquivo).",
};

/** Os turnos anteriores, em frases fixas do app: o texto da IA não volta fora das marcas. */
function turnosAnteriores(eventos: readonly { acao: string; situacao: SituacaoPendencia }[]): TurnoAnterior[] {
  return eventos.flatMap((e): TurnoAnterior[] => {
    if (e.acao === "contestar")
      return [
        {
          acao: "contestar",
          resumo:
            e.situacao === "contestada_aceita"
              ? "a pessoa discordou e a pendência foi retirada com evidência conferida"
              : "a pessoa discordou e a pendência foi mantida",
        },
      ];
    if (e.acao === "sugerir") return [{ acao: "sugerir", resumo: "uma redação foi sugerida à pessoa" }];
    return [];
  });
}

const ponto = (t: string) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);

/** Os dois lados nomeiam algo e diferem (um lado sem curso não é "outro curso"). */
const difere = (a: string | null, b: string | null) => a !== null && b !== null && a !== b;

/* ============================================================ serviço */

export interface OpcoesListaViva {
  readonly tempoAcao?: Duration.Duration;
  /** Recebe o texto bruto de cada ação com IA (só o script de medição usa; o app não grava). */
  readonly registrarTexto?: (acao: string, chave: string, texto: string) => Effect.Effect<void>;
}

export const make = Effect.fn("ListaViva.make")(function* (opcoes: OpcoesListaViva = {}) {
  const tempoAcao = opcoes.tempoAcao ?? TEMPO_ACAO;
  const listas = yield* Listas.Listas;
  const revisoes = yield* Revisoes.Revisoes;
  const revisor = yield* RevisorPpc.RevisorPpc;
  const { exigirAviso } = yield* Preferencias.Preferencias;
  const contextoKb = yield* Effect.context<FontesNormativas.FontesNormativas | PacoteContexto.PacoteContexto>();
  const contextoMotor = yield* Effect.context<Motor.Motor | FileSystem.FileSystem>();
  const contextoListas = yield* Effect.context<Listas.Listas | SecureRandom.SecureRandom>();
  const aleatorio = yield* SecureRandom.SecureRandom;
  const contextoCopia = yield* Effect.context<Listas.Listas | RevisorPpc.RevisorPpc | FileSystem.FileSystem>();
  // Uma ação com IA por vez: um clique duplo não paga duas vezes.
  const vez = yield* Semaphore.make(1);
  const EM_ANDAMENTO = "Já há uma ação com a IA em andamento nesta revisão. Espere ela terminar.";

  const falha = (arquivo: string, motivo: string) => new FalhaRevisaoPpc({ arquivo, motivo });

  const buscar = (id: string) =>
    listas.buscar(id).pipe(
      Effect.filterOrFail(
        (l): l is Listas.RegistroLista => l !== null,
        () => falha("", "Esta lista de pendências não existe mais. Revise o PPC de novo."),
      ),
    );

  const montar = Effect.fn("ListaViva.montar")(function* (registro: Listas.RegistroLista) {
    const pendencias = yield* listas.pendencias(registro.id);
    const eventos = yield* listas.eventos(registro.id);
    const uso = yield* listas.uso(registro.id);
    const vivas: PendenciaViva[] = pendencias.map((p) => ({
      chave: p.chave,
      pendencia: p.pendencia,
      situacao: p.situacao,
      resolvidaPor: p.resolvidaPor,
      historico: eventos.filter((e) => e.chave === p.chave).map(({ chave: _, ...e }) => e),
      sugestao: p.sugestao,
      aceitaIa: p.pendencia.ficha !== "TRIAGEM",
    }));
    return {
      id: registro.id,
      arquivoOriginal: registro.arquivo,
      sha256: registro.sha256,
      revisao: registro.revisao,
      provider: registro.provider,
      resultado: registro.resultado,
      pendencias: vivas,
      uso: { ...uso, custoUsd: Math.round(uso.custoUsd * 1000) / 1000 },
      criadaEm: registro.criadaEm,
      atualizadaEm: registro.atualizadaEm,
    } satisfies ListaPendencias;
  });

  const lista = (id: string) => buscar(id).pipe(Effect.flatMap(montar));

  const pendenciaDe = Effect.fn("ListaViva.pendencia")(function* (registro: Listas.RegistroLista, chave: string) {
    const p = (yield* listas.pendencias(registro.id)).find((x) => x.chave === chave);
    if (!p) return yield* falha(registro.arquivo, "Esta pendência não está mais na lista.");
    return p;
  });

  const provedor = (registro: Listas.RegistroLista, pedido?: Provider) => {
    const provider = pedido ?? registro.provider ?? "claude";
    const modelo = provider === registro.provider ? registro.modelo : (MODELO_PADRAO[provider] ?? null);
    return { provider, modelo };
  };

  const cursoEmTexto = (r: Listas.RegistroLista) => {
    const c = r.resultado.curso;
    return c.cnct
      ? `${c.cnct.denominacao}${c.forma ? `, forma de oferta ${NOME_DA_FORMA[c.forma] ?? c.forma}` : ", forma de oferta não identificada"}`
      : null;
  };

  const contextoPara = (
    registro: Listas.RegistroLista,
    ficha: string,
    markdown = registro.markdown,
    linhas = registro.linhasTextoParaIa,
  ) =>
    contextoDaFicha({
      markdown,
      linhasTextoParaIa: linhas,
      cnct: registro.cnct,
      curso: cursoEmTexto(registro),
      ficha,
    }).pipe(
      Effect.provideContext(contextoKb),
      Effect.tapError((erro) => Effect.logError("lista viva: contexto da ficha falhou", erro)),
      Effect.mapError(() =>
        falha(registro.arquivo, "Não foi possível montar o contexto deste critério. Reinicie o app e tente de novo."),
      ),
      Effect.filterOrFail(
        (c) => c !== null,
        () => falha(registro.arquivo, "Este apontamento não tem critério para a IA reavaliar."),
      ),
    );

  /** O começo de toda ação com IA: o aviso de uso aceito, a lista e a pendência. */
  const abrirAcao = Effect.fn("ListaViva.abrirAcao")(function* (id: string, chave: string) {
    yield* exigirAviso;
    const registro = yield* buscar(id);
    const p = yield* pendenciaDe(registro, chave);
    return { registro, p };
  });

  /**
   * O preparo de uma ação com IA sobre a pendência: o provider e o modelo, o contexto da ficha (do texto
   * revisado ou, na nova revisão, do arquivo novo) e um nonce novo.
   */
  const prepararAcaoIa = Effect.fn("ListaViva.prepararAcaoIa")(function* (
    registro: Listas.RegistroLista,
    p: Listas.RegistroPendencia,
    pedido: Provider | undefined,
    texto?: { readonly markdown: string; readonly linhasTextoParaIa: readonly number[] },
  ) {
    const { provider, modelo } = provedor(registro, pedido);
    const ctx = yield* contextoPara(registro, p.pendencia.ficha, texto?.markdown, texto?.linhasTextoParaIa);
    const nonce = yield* novoNonce(aleatorio);
    return { provider, modelo, ctx, nonce };
  });

  /** O preparo da conversa (contestar, sugerir): mais os turnos anteriores da pendência e o prefixo. */
  const prepararConversa = Effect.fn("ListaViva.prepararConversa")(function* (
    registro: Listas.RegistroLista,
    p: Listas.RegistroPendencia,
    pedido: Provider | undefined,
  ) {
    const preparo = yield* prepararAcaoIa(registro, p, pedido);
    const eventos = (yield* listas.eventos(registro.id)).filter((e) => e.chave === p.chave);
    const prefixo = prefixoConversa({ ...preparo.ctx, pendencia: p.pendencia, nonce: preparo.nonce });
    return { ...preparo, anteriores: turnosAnteriores(eventos), prefixo };
  });

  /** O fim de toda ação: a mudança da pendência e o evento no histórico, e a lista atualizada. */
  const concluirAcao = Effect.fn("ListaViva.concluirAcao")(function* (
    id: string,
    chave: string,
    mudanca: Parameters<Listas.Listas["Service"]["mudar"]>[2],
    evento: Listas.Evento,
  ) {
    yield* listas.exclusivo(listas.mudar(id, chave, mudanca, evento));
    return yield* lista(id);
  });

  /** Uma ação com IA por vez; a pausa do provider (limite, cota, queda) vira a frase para a pessoa. */
  const comIa = <A, R>(arquivo: string, efeito: Effect.Effect<A, FalhaRevisaoPpc | PausaRevisao | AvisoNaoAceito, R>) =>
    efeito.pipe(
      Effect.catchTags({ PausaRevisao: (pausa: PausaRevisao) => Effect.fail(falha(arquivo, pausa.motivo)) }),
      vez.withPermitsIfAvailable(1),
      Effect.flatMap((o) => (o._tag === "Some" ? Effect.succeed(o.value) : Effect.fail(falha(arquivo, EM_ANDAMENTO)))),
    );

  /* ------------------------------------------------------------ revisar, marcar */

  const revisarComEtapas = Effect.fn("ListaViva.revisar")(function* (
    entrada: RevisorPpc.EntradaRevisao,
    aoEtapa: RevisorPpc.AoEtapa,
  ) {
    const revisado = yield* revisor.revisarCompleto(entrada, aoEtapa);
    return yield* listas.exclusivo(
      Effect.gen(function* () {
        const curso = revisado.revisao.curso;
        const anteriorId = yield* listas.localizar({
          arquivo: entrada.arquivo,
          sha256: revisado.sha256,
          cnct: curso.cnct?.slug ?? null,
          forma: curso.forma,
        });
        const anterior = anteriorId === null ? null : yield* listas.buscar(anteriorId);
        if (anterior !== null && anterior.revisao !== null) {
          const rev = yield* revisoes.resumo(anterior.revisao);
          if (rev !== null && rev.situacao === "em_andamento")
            return yield* falha(
              entrada.arquivo,
              "A leitura com IA deste PPC está em andamento. Pause-a antes de revisar o arquivo de novo.",
            );
        }
        // Mesmo arquivo, conteúdo, curso e forma: preserva os resultados da IA que a lista anterior já tinha.
        const ia = anterior?.resultadosIa ?? null;
        const final =
          ia === null
            ? revisado
            : yield* revisor.revisarArquivo({
                arquivo: entrada.arquivo,
                gravar: true,
                sha256: revisado.sha256,
                ...(entrada.cnct === undefined ? {} : { cnct: entrada.cnct }),
                ...(entrada.forma === undefined ? {} : { forma: entrada.forma }),
                ia,
              });
        return yield* criarLista({
          arquivo: entrada.arquivo,
          revisado: final,
          revisao: anterior?.revisao ?? null,
          provider: anterior?.provider ?? null,
          modelo: anterior?.modelo ?? null,
          resultadosIa: ia,
        }).pipe(Effect.provideContext(contextoListas));
      }),
    );
  });

  const revisar = (entrada: RevisorPpc.EntradaRevisao) =>
    Stream.callback<EventoRevisaoPpc, FalhaRevisaoPpc>((fila) =>
      revisarComEtapas(entrada, (etapa) => {
        Queue.offerUnsafe(fila, { tipo: "etapa", etapa });
      }).pipe(
        Effect.flatMap((resultado) => Queue.offer(fila, { tipo: "pronto", resultado })),
        Effect.andThen(Queue.end(fila)),
      ),
    );

  const marcar = Effect.fn("ListaViva.marcar")(function* (id: string, chave: string, situacao: "aberta" | "resolvida") {
    const registro = yield* buscar(id);
    yield* pendenciaDe(registro, chave);
    return yield* concluirAcao(
      id,
      chave,
      { situacao, resolvidaPor: "pessoa" },
      { acao: "marcar", situacao, texto: ROTULO_ACAO[situacao] },
    );
  });

  /* ------------------------------------------------------------ estimar */

  const estimar = Effect.fn("ListaViva.estimar")(function* (
    id: string,
    chave: string,
    acao: "contestar" | "sugerir" | "revisarDeNovo",
    pedido?: Provider,
  ) {
    const registro = yield* buscar(id);
    const p = yield* pendenciaDe(registro, chave);
    const { provider } = provedor(registro, pedido);
    // A nova revisão de uma ficha do código não usa IA.
    if (acao === "revisarDeNovo" && p.pendencia.origem === "codigo")
      return { provider, tokensEntrada: 0, tokensSaida: 0, segundos: 5, custoUsd: 0 } satisfies EstimativaAcao;
    // A contestação de uma pendência do código não vai à IA.
    if (acao === "contestar" && p.pendencia.origem === "codigo")
      return { provider, tokensEntrada: 0, tokensSaida: 0, segundos: 1, custoUsd: 0 } satisfies EstimativaAcao;
    const ctx = yield* contextoPara(registro, p.pendencia.ficha);
    const prefixo = prefixoConversa({ ...ctx, pendencia: p.pendencia, nonce: registro.nonce });
    const texto =
      acao === "contestar"
        ? pedidoContestacao(prefixo, "x".repeat(400), [], registro.nonce)
        : acao === "sugerir"
          ? pedidoSugestao(prefixo, [])
          : pedidoS(
              {
                id: "revisarDeNovo",
                tipo: "S",
                tema: p.pendencia.tema,
                ordemTema: p.pendencia.ordemTema,
                fichas: [ctx.ficha.id],
              },
              [ctx.ficha],
              new Map([[ctx.ficha.id, ctx.proprio]]),
              ctx.contexto,
              registro.nonce,
              ctx.comum,
            );
    return estimarAcao(
      texto.length + instrucoesConversa(registro.nonce).length,
      acao,
      provider,
    ) satisfies EstimativaAcao;
  });

  /* ------------------------------------------------------------ conversa */

  /** Uma ação na conversa da pendência: uma sessão nova, sem ferramentas, com o pedido completo. */
  const conversar = (entrada: {
    registro: Listas.RegistroLista;
    chave: string;
    acao: "contestar" | "sugerir";
    provider: Provider;
    modelo: string | null;
    nonce: string;
    pedido: string;
  }) =>
    turnoSemFerramentas({
      provider: entrada.provider,
      modelo: entrada.modelo,
      instrucoes: instrucoesConversa(entrada.nonce),
      texto: entrada.pedido,
      tempoTurno: tempoAcao,
      numero: 1,
      registrarTentativa: (t) => listas.gravarAcao(entrada.registro.id, entrada.chave, { acao: entrada.acao, ...t }),
      ...(opcoes.registrarTexto
        ? { registrarTexto: (_: number, texto: string) => opcoes.registrarTexto!(entrada.acao, entrada.chave, texto) }
        : {}),
    }).pipe(Effect.provideContext(contextoMotor));

  /* ------------------------------------------------------------ contestar */

  const contestar = Effect.fn("ListaViva.contestar")(
    function* (id: string, chave: string, motivo: string, pedido?: Provider) {
      const { registro, p } = yield* abrirAcao(id, chave);
      if (!p.pendencia.ficha || p.pendencia.ficha === "TRIAGEM")
        return yield* falha(
          registro.arquivo,
          "Este apontamento é da triagem: remova o trecho ou marque como resolvido.",
        );
      const limpo = motivo.trim();
      if (!limpo)
        return yield* falha(registro.arquivo, "Escreva por que você discorda. Um trecho do PPC ou uma norma ajudam.");
      if (limpo.length > LIMITE_MOTIVO)
        return yield* falha(
          registro.arquivo,
          `Escreva o motivo em até ${LIMITE_MOTIVO.toLocaleString("pt-BR")} caracteres.`,
        );
      // A pendência do código não sai por contestação: a discordância fica registrada (para a
      // curadoria das regras) e a saída é "Já resolvi" com o arquivo corrigido. Sem IA, sem custo.
      if (p.pendencia.origem === "codigo")
        return yield* concluirAcao(
          id,
          chave,
          { situacao: "contestada_mantida" },
          { acao: "contestar", situacao: "contestada_mantida", texto: `Mantida: ${MANTIDA_CODIGO}`, motivo: limpo },
        );
      const { provider, modelo, ctx, nonce, anteriores, prefixo } = yield* prepararConversa(registro, p, pedido);
      const turno = yield* conversar({
        registro,
        chave,
        acao: "contestar",
        provider,
        modelo,
        nonce,
        pedido: pedidoContestacao(prefixo, limpo, anteriores, nonce),
      });
      const decisao = turno.ferramentas.length
        ? {
            estado: "contestada_mantida" as const,
            explicacao: "A IA tentou usar uma ferramenta, o que a revisão não permite, e a resposta foi descartada.",
            trechos: [],
            problemas: [],
            iaPediuRetirar: false,
          }
        : conferirContestacao(turno.texto, {
            ficha: ctx.ficha,
            origem: "ia",
            recorte: ctx.recorte,
            secao: ctx.proprio.texto,
            fontes: new Set(ctx.fontes),
            trechoApontado: p.pendencia.trecho,
          });
      const texto =
        decisao.estado === "contestada_aceita"
          ? `Contestada com evidência conferida (fica para conferir): ${ponto(decisao.explicacao)} Trecho conferido: “${decisao.trechos[0]}”.`
          : `Mantida: ${ponto(decisao.explicacao)}${decisao.iaPediuRetirar && decisao.problemas.length ? ` O app não retirou porque ${decisao.problemas.join("; ")}.` : ""}`;
      return yield* concluirAcao(
        id,
        chave,
        { situacao: decisao.estado },
        { acao: "contestar", situacao: decisao.estado, texto, motivo: limpo, uso: turno.uso },
      );
    },
    (e) => comIa("", e),
  );

  /* ------------------------------------------------------------ sugerir */

  const sugerir = Effect.fn("ListaViva.sugerir")(
    function* (id: string, chave: string, pedido?: Provider) {
      const { registro, p } = yield* abrirAcao(id, chave);
      if (p.pendencia.ficha === "TRIAGEM")
        return yield* falha(registro.arquivo, "Este apontamento é da triagem: o trecho sai do PPC, sem redação nova.");
      const { provider, modelo, ctx, nonce, anteriores, prefixo } = yield* prepararConversa(registro, p, pedido);
      const turno = yield* conversar({
        registro,
        chave,
        acao: "sugerir",
        provider,
        modelo,
        nonce,
        pedido: pedidoSugestao(prefixo, anteriores),
      });
      const sugestao = turno.ferramentas.length
        ? null
        : conferirSugestao(turno.texto, {
            recorte: ctx.recorte,
            contexto: ctx.contexto,
            fontes: new Set(ctx.fontes),
            pendencia: [p.pendencia.mensagem, p.pendencia.oQueFazer, p.pendencia.trecho ?? ""].join("\n"),
          });
      if (sugestao === null) {
        yield* listas.exclusivo(
          listas.mudar(
            id,
            chave,
            { situacao: p.situacao, resolvidaPor: p.resolvidaPor },
            {
              acao: "sugerir",
              situacao: p.situacao,
              texto: "A IA não devolveu uma redação que o app pudesse conferir.",
              uso: turno.uso,
            },
          ),
        );
        return yield* falha(
          registro.arquivo,
          "A IA não devolveu uma redação que o app pudesse conferir. Tente de novo.",
        );
      }
      const n = sugestao.naoConferidos.length;
      return yield* concluirAcao(
        id,
        chave,
        { situacao: p.situacao, resolvidaPor: p.resolvidaPor, sugestao },
        {
          acao: "sugerir",
          situacao: p.situacao,
          texto: `Redação sugerida pela IA, para você revisar${n ? `; ${n} ${n === 1 ? "fato não conferido" : "fatos não conferidos"} pelo app` : ""}.`,
          uso: turno.uso,
        },
      );
    },
    (e) => comIa("", e),
  );

  /* ------------------------------------------------------------ arquivo novo */

  /**
   * Converte e pré-confere (só o código, sem gravar a cópia) o `.docx` novo de uma lista, com o curso
   * que a pessoa escolheu (se escolheu), e recusa o mesmo arquivo e o que parece outro documento (outro
   * curso, poucos títulos de seção em comum, tamanho muito menor). `consequencia` completa a frase da recusa.
   */
  const lerArquivoNovo = Effect.fn("ListaViva.lerArquivoNovo")(function* (
    registro: Listas.RegistroLista,
    arquivo: string,
    consequencia: string,
  ) {
    const novo = yield* revisor.revisarArquivo({ arquivo, gravar: false, ...cursoEscolhido(registro) });
    if (novo.sha256 === registro.sha256)
      return yield* falha(
        arquivo,
        "É o mesmo arquivo revisado. Salve as mudanças no Word e escolha o arquivo atualizado.",
      );
    const nome = arquivo.split(/[\\/]/).at(-1) ?? arquivo;
    const antes = registro.resultado.curso;
    const depois = novo.revisao.curso;
    const comparacao = comparacaoComOriginal(registro.markdown, novo.revisao.markdown);
    // Sem o curso no revisado, o arquivo novo que o identifica é a correção que "Qual é o curso?" pede.
    const outroCurso = difere(antes.cnct?.slug ?? null, depois.cnct?.slug ?? null) || difere(antes.forma, depois.forma);
    const motivo = outroCurso
      ? "outro curso ou outra forma de oferta"
      : comparacao.titulosEmComum < SEMELHANCA_MINIMA
        ? `só ${Math.round(comparacao.titulosEmComum * 100)}% dos títulos de seção do revisado`
        : comparacao.secoes < TAMANHO_MINIMO || comparacao.linhas < TAMANHO_MINIMO
          ? `${Math.round(Math.min(comparacao.secoes, comparacao.linhas) * 100)}% do tamanho do revisado`
          : null;
    if (motivo !== null)
      return yield* falha(
        arquivo,
        `${nome} parece outro documento ou uma versão incompleta (${motivo}). Escolha a versão atualizada e completa deste PPC; ${consequencia}.`,
      );
    return { novo, nome };
  });

  /* ------------------------------------------------------------ revisarDeNovo */

  const revisarDeNovo = Effect.fn("ListaViva.revisarDeNovo")(
    function* (id: string, chave: string, arquivo: string, pedido?: Provider) {
      const { registro, p } = yield* abrirAcao(id, chave);
      const { novo, nome } = yield* lerArquivoNovo(registro, arquivo, "a pendência não foi marcada como resolvida");
      // O que a triagem do arquivo novo aponta (texto dirigido a IA, seções ausentes) e a lista não tem entra nela.
      const existentes = new Set((yield* listas.pendencias(id)).map((x) => x.chave));
      const novasTriagem = novo.revisao.pendencias
        .filter((x) => x.ficha === "TRIAGEM")
        .map((x) => ({ chave: chavePendencia(x), pendencia: x }))
        .filter((x) => !existentes.has(x.chave));
      if (novasTriagem.length)
        yield* listas.exclusivo(listas.acrescentar(id, novasTriagem, `Apareceu na nova revisão de ${nome}.`));
      const ficha = p.pendencia.ficha;
      let resolvida: boolean;
      let texto: string;
      let uso = null;
      if (p.pendencia.origem === "codigo") {
        // A ficha D (ou a triagem) inteira: a pendência só sai se a ficha não apontar mais nada no arquivo novo.
        const ainda = novo.revisao.pendencias.filter((x) => x.ficha === ficha && x.origem === "codigo");
        resolvida = ainda.length === 0;
        texto = resolvida
          ? `Conferida na nova revisão de ${nome}: o critério não aponta mais nada.`
          : `A nova revisão de ${nome} ainda aponta: ${ponto(ainda[0]!.mensagem.split("\n")[0]!)}`;
      } else {
        const { provider, modelo, ctx, nonce } = yield* prepararAcaoIa(registro, p, pedido, novo.revisao);
        const bloco = {
          id: `revisar-de-novo-${ficha.toLowerCase()}`,
          tipo: "S" as const,
          tema: p.pendencia.tema,
          ordemTema: p.pendencia.ordemTema,
          fichas: [ficha],
        };
        const pedidoTexto = pedidoS(
          bloco,
          [ctx.ficha],
          new Map([[ficha, ctx.proprio]]),
          ctx.contexto,
          nonce,
          ctx.comum,
        );
        const julgado = yield* julgarBloco({
          provider,
          modelo,
          nonce,
          bloco,
          fichas: [ctx.ficha],
          pedido: pedidoTexto,
          fontes: new Set(ctx.fontes),
          tempoTurno: tempoAcao,
          revisaoHumana: teveTextoParaIa(retirarTextoParaIa(novo.revisao.markdown, novo.revisao.linhasTextoParaIa)),
          registrarTentativa: (t) => listas.gravarAcao(id, chave, { acao: "revisarDeNovo", ...t }),
        }).pipe(Effect.provideContext(contextoMotor));
        const r: ResultadoFichaIa = julgado.resultado.resultados[0]!;
        uso = julgado.uso;
        resolvida = r.estado !== "FALHOU" && estadoDaIa(r) === null;
        texto = resolvida
          ? `Conferida na nova revisão de ${nome}: a IA avaliou o critério de novo e o app conferiu o trecho.`
          : r.estado === "FALHOU"
            ? `A nova revisão de ${nome} não pôde ser conferida (${r.motivoFalha ?? "resposta fora do formato"}); a pendência continua.`
            : `A nova revisão de ${nome} ainda aponta: ${ponto(r.justificativa)}`;
      }
      const situacao: SituacaoPendencia = resolvida ? "resolvida" : "aberta";
      return yield* concluirAcao(
        id,
        chave,
        { situacao, resolvidaPor: "revisarDeNovo" },
        { acao: "revisarDeNovo", situacao, texto, uso },
      );
    },
    (e, _id, _chave, arquivo) => comIa(arquivo, e),
  );

  /* ------------------------------------------------------------ cópia com a situação */

  /** Os resultados conferidos da leitura com IA que a lista guarda, para entrarem de novo na revisão. */
  const resultadosIa = (registro: Listas.RegistroLista) => registro.resultadosIa ?? undefined;

  const gerarCopia = Effect.fn("ListaViva.gerarCopia")(function* (id: string) {
    yield* listas.exclusivo(
      buscar(id).pipe(Effect.flatMap(regravarCopiaDaLista), Effect.provideContext(contextoCopia)),
    );
    return yield* lista(id);
  });

  /** Na vez das escritas: o texto e as pendências da mesma versão da lista (nunca no meio de um arquivo novo). */
  const documento = Effect.fn("ListaViva.documento")(function* (id: string) {
    const { registro, pendencias } = yield* listas.exclusivo(
      Effect.gen(function* () {
        const registro = yield* buscar(id);
        return { registro, pendencias: yield* listas.pendencias(registro.id) };
      }),
    );
    return documentoRevisado({ ...registro, pendencias });
  });

  /**
   * Confere a leitura com IA ligada à lista antes de trocar o que ela leu (o curso, o arquivo): recusa
   * com ela em andamento e indica se há revisão pausada/preparada para apagar depois que a troca concluir
   * (nunca antes das validações, para não perder uma leitura pausada numa ação recusada).
   */
  const verificarLeitura = Effect.fn("ListaViva.verificarLeitura")(function* (
    registro: Listas.RegistroLista,
    acao: string,
  ) {
    if (registro.revisao === null) return { mantida: null as string | null, apagar: null as string | null };
    const revisao = yield* revisoes.resumo(registro.revisao);
    if (revisao === null) return { mantida: null as string | null, apagar: null as string | null };
    if (revisao.situacao === "em_andamento")
      return yield* falha(
        registro.arquivo,
        `A leitura com IA deste PPC está em andamento. Pause-a antes de ${acao}; o que ela já leu fica na lista.`,
      );
    if (revisao.situacao === "concluida") return { mantida: revisao.id, apagar: null as string | null };
    return { mantida: null as string | null, apagar: revisao.id };
  });

  /** Troca a lista inteira: espera as escritas curtas e recusa se uma ação com IA está em andamento. */
  const trocandoALista = <A, E, R>(arquivo: string, efeito: Effect.Effect<A, E, R>) =>
    efeito.pipe(
      listas.exclusivo,
      vez.withPermitsIfAvailable(1),
      Effect.flatMap((o) => (o._tag === "Some" ? Effect.succeed(o.value) : Effect.fail(falha(arquivo, EM_ANDAMENTO)))),
    );

  /* ------------------------------------------------------------ "Qual é o curso?" */

  const trocarCurso = Effect.fn("ListaViva.trocarCurso")(
    function* (id: string, cnct: string, forma: string | undefined) {
      const registro = yield* buscar(id);
      const { mantida, apagar } = yield* verificarLeitura(registro, "trocar o curso");
      const ia = resultadosIa(registro);
      const revisado = yield* revisor.revisarArquivo({
        arquivo: registro.arquivo,
        gravar: true,
        sha256: registro.sha256,
        cnct,
        ...(forma === undefined ? {} : { forma }),
        ...(ia ? { ia } : {}),
      });
      // A lista nova (mesmo arquivo, mesmo conteúdo) herda a situação, o histórico e a sugestão de cada
      // pendência e o uso das ações, e a anterior sai.
      const resultado = yield* criarLista({
        arquivo: registro.arquivo,
        revisado,
        revisao: mantida,
        provider: registro.provider,
        modelo: registro.modelo,
        resultadosIa: registro.resultadosIa,
      }).pipe(Effect.provideContext(contextoListas));
      if (apagar !== null) yield* revisoes.apagar(apagar);
      return yield* lista(resultado.lista!);
    },
    (efeito, id) => trocandoALista(id, efeito),
  );

  /* ------------------------------------------------------------ "Enviar a versão corrigida" */

  const revisarArquivoNovo = Effect.fn("ListaViva.revisarArquivoNovo")(
    function* (id: string, arquivo: string) {
      const registro = yield* buscar(id);
      const { apagar } = yield* verificarLeitura(registro, "enviar a versão corrigida");
      const { novo, nome } = yield* lerArquivoNovo(registro, arquivo, "a lista não mudou");
      const pendencias = yield* listas.pendencias(id);
      const eventos = yield* listas.eventos(id);
      const plano = planoArquivoNovo(pendencias, novo.revisao.pendencias, nome, novo.revisao.curso.cnct === null);
      // O estado final da lista, para a cópia comentada do arquivo novo.
      const finais = new Map<string, Pick<PendenciaDaLista, "chave" | "situacao" | "resolvidaPor">>(
        pendencias.map((p) => [p.chave, p]),
      );
      const eventosFinais: { chave: string; acao: string; texto: string; motivo?: string | null }[] = [...eventos];
      for (const m of plano.mudancas) {
        const chave = m.nova?.chave ?? m.chave;
        finais.delete(m.chave);
        finais.set(chave, { chave, situacao: m.situacao, resolvidaPor: m.resolvidaPor });
        if (m.nova)
          for (const e of eventosFinais.filter((e) => e.chave === m.chave)) eventosFinais.push({ ...e, chave });
        if (m.evento) eventosFinais.push({ chave, ...m.evento });
      }
      // A cópia primeiro: se ela falha, nada mudou na lista, e a pessoa pode tentar de novo.
      const ia = resultadosIa(registro);
      const final = yield* revisor.revisarArquivo({
        arquivo,
        gravar: true,
        sha256: novo.sha256,
        ...cursoEscolhido(registro),
        ...(ia ? { ia } : {}),
        situacoes: marcasDaCopia([...finais.values()], eventosFinais),
      });
      const curso = final.revisao.curso;
      yield* listas.aplicarArquivoNovo(id, plano.mudancas, plano.novas, `Apareceu na revisão de ${nome}.`, {
        arquivo,
        sha256: final.sha256,
        markdown: final.revisao.markdown,
        linhasTextoParaIa: final.revisao.linhasTextoParaIa,
        cnct: curso.cnct?.slug ?? null,
        forma: curso.forma,
        resultado: { ...RevisorPpc.resultadoParaInterface(arquivo, final), lista: id },
      });
      if (apagar !== null) yield* revisoes.apagar(apagar);
      return {
        lista: yield* lista(id),
        resolvidas: plano.resolvidas,
        continuam: plano.continuam,
        novas: plano.contagemNovas,
      } satisfies ResultadoArquivoNovo;
    },
    (efeito, _id, arquivo) => trocandoALista(arquivo, efeito),
  );

  const expirar = DateTime.now.pipe(
    Effect.map((agora) => DateTime.formatIso(DateTime.subtract(agora, { days: DIAS_LISTA }))),
    Effect.flatMap(listas.expirar),
  );

  /** As discordâncias contra pendências do código, em CSV (separado por ponto e vírgula, como o Excel em português lê). */
  const exportarDiscordancias = listas.contestacoes.pipe(
    Effect.map((linhas) => {
      // Texto da pessoa e do PPC: o que começa como fórmula de planilha ganha um apóstrofo na frente.
      const campo = (t: string) => {
        const formula = /^[\t\r]/.test(t) || /^[=+\-@]/.test(t.trimStart());
        const limpo = t.replace(/"/g, '""').replace(/\s+/g, " ").trim();
        return `"${formula ? "'" : ""}${limpo}"`;
      };
      const cabeca = ["data", "arquivo", "ficha", "critério", "apontamento", "trecho", "motivo da coordenação"];
      const corpo = linhas
        .filter((l) => l.pendencia.origem === "codigo")
        .map((l) =>
          [
            l.em.slice(0, 10),
            l.arquivo.split(/[\\/]/).at(-1) ?? l.arquivo,
            l.pendencia.ficha,
            l.pendencia.tituloFicha,
            l.pendencia.mensagem,
            l.pendencia.trecho ?? "",
            l.motivo ?? "",
          ]
            .map(campo)
            .join(";"),
        );
      return [cabeca.map(campo).join(";"), ...corpo].join("\r\n");
    }),
  );

  const ultima = expirar.pipe(
    Effect.andThen(listas.ultima),
    Effect.flatMap((id) => (id === null ? Effect.succeed(null) : lista(id).pipe(Effect.orElseSucceed(() => null)))),
  );

  const doArquivo = (arquivo: string) =>
    listas
      .doArquivo(arquivo)
      .pipe(
        Effect.flatMap((id) => (id === null ? Effect.succeed(null) : lista(id).pipe(Effect.orElseSucceed(() => null)))),
      );

  // As listas sem uso há mais de `DIAS_LISTA` saem ao subir o servidor (e a cada `ultimaLista`).
  yield* expirar;

  const apagar = Effect.fn("ListaViva.apagar")(function* (id: string) {
    const registro = yield* listas.buscar(id);
    yield* listas.apagar(id);
    if (registro === null) return;
    if (registro.revisao !== null) {
      const rev = yield* revisoes.resumo(registro.revisao);
      if (rev !== null && rev.situacao !== "concluida") yield* revisoes.apagar(rev.id);
    }
    // Remove também leituras pausadas/preparadas órfãs do mesmo arquivo e conteúdo.
    yield* revisoes.apagarNaoConcluidasDoArquivo(registro.arquivo, registro.sha256);
  });

  return ListaViva.of({
    revisar,
    lista,
    ultima,
    doArquivo,
    trocarCurso,
    apagar,
    exportarDiscordancias,
    marcar,
    estimar,
    contestar,
    sugerir,
    revisarDeNovo,
    revisarArquivoNovo,
    gerarCopia,
    documento,
  });
});

/**
 * Pede as `Listas`, as `Revisoes`, o `RevisorPpc`, as `Preferencias`, o `Motor`, o `FileSystem`, as
 * `FontesNormativas` e o `PacoteContexto` do `kb.sqlite`.
 */
export const layer = (opcoes: OpcoesListaViva = {}) => Layer.effect(ListaViva, make(opcoes));
