/**
 * `ListaViva`: a lista de pendências que a pessoa mantém (M1.11, etapa 5b), no servidor, e as ações
 * dentro de cada pendência.
 *
 * - **A lista** nasce de cada revisão (a pré-conferência, `revisar`) e de cada revisão com IA concluída
 *   (`criarLista`, de `criar-lista.ts`, chamada também pela `RevisaoIa`). Fica no `conversas.sqlite` (`Listas`), com o texto do PPC
 *   que as ações usam; sobrevive a fechar o app e à cota. A situação marcada passa para a lista nova do
 *   mesmo arquivo com o mesmo conteúdo (chave da pendência igual).
 * - **O roteiro**: as paradas são os temas com pendência ou critério conferido, na ordem do parecer da
 *   PROENS; a lista lembra as paradas vistas e onde a pessoa estava.
 * - **"Vou ajustar" e "Já resolvi"** (`marcar`): só mudam a situação, sem IA.
 * - **"Já resolvi" com o arquivo novo** (`revisarDeNovo`): o servidor converte e pré-confere o `.docx` novo
 *   e reconfere **só a ficha da pendência**: no código (fichas D e triagem) e, nas da IA, num lote de uma
 *   ficha conferido como no julgamento. A situação sai do resultado: `resolvida` só se a ficha não
 *   aponta mais nada; senão volta a `aberta`, com o que ainda falta.
 * - **"Discordo…"** (`contestar`) e **"Sugerir texto"** (`sugerir`): uma sessão sem ferramentas, com o
 *   pedido e a conferência do `conversa.ts` do `packages/ppc`. Quem decide é o código (ver lá).
 * - O uso de cada ação com IA fica em `acoes_ia` e soma ao uso da revisão com IA de onde a lista veio.
 *   Uma ação com IA por vez; a estimativa vem antes (`estimar`).
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
import * as Semaphore from "effect/Semaphore";
import {
  type AvisoNaoAceito,
  type EstimativaAcao,
  FalhaRevisaoPpc,
  type ListaPendencias,
  type PendenciaViva,
  type Provider,
  type ResultadoRevisaoPpc,
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
import { estimarAcao } from "./estimativa.ts";
import { pedidoS } from "@simplifica-if/ppc/revisao-ia/pedido";
import { dobrar, retirarTextoParaIa, teveTextoParaIa } from "@simplifica-if/ppc/revisao-ia/plano";
import { MODELO_PADRAO } from "./modelos.ts";
import {
  chavePendencia,
  estadoDaIa,
  type MarcaPendencia,
  NOME_DA_FORMA,
  type ResultadoFichaIa,
} from "@simplifica-if/ppc/revisao-previa";
import { TEMAS } from "@simplifica-if/ppc/temas";
import * as Listas from "../persistencia/Listas.ts";
import * as Preferencias from "../persistencia/Preferencias.ts";
import * as Revisoes from "../persistencia/Revisoes.ts";
import * as RevisorPpc from "./RevisorPpc.ts";
import { criarLista, novoNonce } from "./criar-lista.ts";
import { julgarBloco, PausaRevisao, turnoSemFerramentas } from "./julgamento.ts";
import { contextoDaFicha, type PlanoRevisaoIa } from "./preparo.ts";

export const TEMPO_ACAO = Duration.minutes(4);
export const LIMITE_MOTIVO = 1500;

export class ListaViva extends Context.Service<
  ListaViva,
  {
    /** A pré-conferência (`RevisorPpc.revisar`) com a lista viva gravada: o resultado traz o `lista`. */
    readonly revisar: (entrada: RevisorPpc.EntradaRevisao) => Effect.Effect<ResultadoRevisaoPpc, FalhaRevisaoPpc>;
    readonly lista: (id: string) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc>;
    readonly ultima: Effect.Effect<ListaPendencias | null>;
    readonly apagar: (id: string) => Effect.Effect<void>;
    /** As discordâncias contra pendências do código, em CSV, para a curadoria das regras. */
    readonly exportarDiscordancias: Effect.Effect<string>;
    readonly marcar: (
      id: string,
      chave: string,
      situacao: "aberta" | "vou_ajustar" | "resolvida",
    ) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc>;
    readonly verParada: (id: string, ordem: number) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc>;
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
    readonly gerarCopia: (id: string) => Effect.Effect<ListaPendencias, FalhaRevisaoPpc>;
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

const ROTULO_ACAO: Record<"aberta" | "vou_ajustar" | "resolvida", string> = {
  aberta: "Reaberta por você.",
  vou_ajustar: "Você marcou que vai ajustar.",
  resolvida: "Você marcou como resolvida (sem nova revisão do arquivo).",
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
  // Uma ação com IA por vez: um clique duplo não paga duas vezes.
  const vez = yield* Semaphore.make(1);

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
    const ordens = [
      ...new Set([...registro.resultado.pendencias, ...registro.resultado.criterios].map((x) => x.ordemTema)),
    ].sort((a, b) => a - b);
    const vistas = new Set(registro.paradasVistas);
    return {
      id: registro.id,
      arquivoOriginal: registro.arquivo,
      revisao: registro.revisao,
      provider: registro.provider,
      resultado: registro.resultado,
      pendencias: vivas,
      paradas: ordens.map((ordem) => ({ ordem, tema: TEMAS[ordem]?.titulo ?? "Outros", vista: vistas.has(ordem) })),
      paradaAtual: registro.paradaAtual,
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
    yield* listas.mudar(id, chave, mudanca, evento);
    return yield* lista(id);
  });

  /** Uma ação com IA por vez; a pausa do provider (limite, cota, queda) vira a frase para a pessoa. */
  const comIa = <A, R>(arquivo: string, efeito: Effect.Effect<A, FalhaRevisaoPpc | PausaRevisao | AvisoNaoAceito, R>) =>
    efeito.pipe(
      Effect.catchTags({ PausaRevisao: (pausa: PausaRevisao) => Effect.fail(falha(arquivo, pausa.motivo)) }),
      vez.withPermitsIfAvailable(1),
      Effect.flatMap((o) =>
        o._tag === "Some"
          ? Effect.succeed(o.value)
          : Effect.fail(falha(arquivo, "Já há uma ação com a IA em andamento. Espere ela terminar.")),
      ),
    );

  /* ------------------------------------------------------------ revisar, marcar, paradas */

  const revisar = Effect.fn("ListaViva.revisar")(function* (entrada: RevisorPpc.EntradaRevisao) {
    const revisado = yield* revisor.revisarCompleto(entrada);
    return yield* criarLista({
      arquivo: entrada.arquivo,
      revisado,
      revisao: null,
      provider: null,
      modelo: null,
    }).pipe(Effect.provideContext(contextoListas));
  });

  const marcar = Effect.fn("ListaViva.marcar")(function* (
    id: string,
    chave: string,
    situacao: "aberta" | "vou_ajustar" | "resolvida",
  ) {
    const registro = yield* buscar(id);
    yield* pendenciaDe(registro, chave);
    return yield* concluirAcao(
      id,
      chave,
      { situacao, resolvidaPor: "pessoa" },
      { acao: "marcar", situacao, texto: ROTULO_ACAO[situacao] },
    );
  });

  const verParada = Effect.fn("ListaViva.verParada")(function* (id: string, ordem: number) {
    yield* buscar(id);
    yield* listas.verParada(id, ordem);
    return yield* lista(id);
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
        yield* listas.mudar(
          id,
          chave,
          { situacao: p.situacao, resolvidaPor: p.resolvidaPor },
          {
            acao: "sugerir",
            situacao: p.situacao,
            texto: "A IA não devolveu uma redação que o app pudesse conferir.",
            uso: turno.uso,
          },
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

  /* ------------------------------------------------------------ revisarDeNovo */

  const revisarDeNovo = Effect.fn("ListaViva.revisarDeNovo")(
    function* (id: string, chave: string, arquivo: string, pedido?: Provider) {
      const { registro, p } = yield* abrirAcao(id, chave);
      const novo = yield* revisor.revisarArquivo({
        arquivo,
        gravar: false,
        ...(registro.cnct === null ? {} : { cnct: registro.cnct }),
        ...(registro.forma === null ? {} : { forma: registro.forma }),
      });
      if (novo.sha256 === registro.sha256)
        return yield* falha(
          arquivo,
          "É o mesmo arquivo revisado. Salve as mudanças no Word e escolha o arquivo atualizado.",
        );
      const nome = arquivo.split(/[\\/]/).at(-1) ?? arquivo;
      // Parece outro documento: outro curso (CNCT, forma) ou poucos títulos de seção em comum. Não marca nada.
      const antes = registro.resultado.curso;
      const depois = novo.revisao.curso;
      const comparacao = comparacaoComOriginal(registro.markdown, novo.revisao.markdown);
      const outroCurso = (antes.cnct?.slug ?? null) !== (depois.cnct?.slug ?? null) || antes.forma !== depois.forma;
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
          `${nome} parece outro documento ou uma versão incompleta (${motivo}). Escolha a versão atualizada e completa deste PPC; a pendência não foi marcada como resolvida.`,
        );
      // O que a triagem do arquivo novo aponta (texto dirigido a IA, seções ausentes) e a lista não tem entra nela.
      const existentes = new Set((yield* listas.pendencias(id)).map((x) => x.chave));
      const novasTriagem = novo.revisao.pendencias
        .filter((x) => x.ficha === "TRIAGEM")
        .map((x) => ({ chave: chavePendencia(x), pendencia: x }))
        .filter((x) => !existentes.has(x.chave));
      if (novasTriagem.length) yield* listas.acrescentar(id, novasTriagem, `Apareceu na nova revisão de ${nome}.`);
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

  const gerarCopia = Effect.fn("ListaViva.gerarCopia")(function* (id: string) {
    const registro = yield* buscar(id);
    const pendencias = yield* listas.pendencias(id);
    const eventos = yield* listas.eventos(id);
    const situacoes: Record<string, MarcaPendencia> = {};
    for (const p of pendencias) {
      if (p.situacao === "aberta") continue;
      const ultimo = eventos.filter((e) => e.chave === p.chave).at(-1);
      const ultimaContestacao = eventos.filter((e) => e.chave === p.chave && e.acao === "contestar").at(-1);
      const nota =
        p.situacao === "resolvida"
          ? p.resolvidaPor === "revisarDeNovo"
            ? "Conferida na nova revisão do arquivo atualizado."
            : "Marcada pela coordenação, sem nova revisão."
          : p.situacao === "contestada_mantida" && ultimo?.acao === "contestar"
            ? ultimo.texto.replace(/^Mantida: /, "Resposta da revisão: ")
            : p.situacao === "contestada_aceita" && ultimaContestacao
              ? `Motivo da coordenação: “${ultimaContestacao.motivo ?? ""}”. ${ultimaContestacao.texto}`
              : undefined;
      situacoes[p.chave] = {
        situacao: p.situacao,
        ...(nota ? { nota } : {}),
        // Só a pendência confirmada pela nova revisão sai do documento.
        ...(p.situacao === "resolvida" && p.resolvidaPor === "revisarDeNovo" ? { foraDoDocumento: true } : {}),
      };
    }
    // A lista da revisão com IA: os resultados conferidos da IA entram de novo, como na conclusão.
    let ia: { resultados: ResultadoFichaIa[]; fora: string[] } | undefined;
    if (registro.revisao !== null) {
      const revisao = yield* revisoes.buscar(registro.revisao);
      const plano = revisao?.plano as PlanoRevisaoIa | null | undefined;
      const blocos = yield* revisoes.blocos(registro.revisao);
      ia = {
        resultados: blocos.flatMap((b) => (b.resultado as { resultados: ResultadoFichaIa[] }).resultados),
        fora: plano?.fora ?? [],
      };
    }
    const final = yield* revisor.revisarArquivo({
      arquivo: registro.arquivo,
      gravar: true,
      sha256: registro.sha256,
      ...(registro.cnct === null ? {} : { cnct: registro.cnct }),
      ...(registro.forma === null ? {} : { forma: registro.forma }),
      ...(ia ? { ia } : {}),
      situacoes,
    });
    yield* listas.trocarResultado(id, { ...RevisorPpc.resultadoParaInterface(registro.arquivo, final), lista: id });
    return yield* lista(id);
  });

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

  // As listas sem uso há mais de `DIAS_LISTA` saem ao subir o servidor (e a cada `ultimaLista`).
  yield* expirar;

  return ListaViva.of({
    revisar,
    lista,
    ultima,
    apagar: listas.apagar,
    exportarDiscordancias,
    marcar,
    verParada,
    estimar,
    contestar,
    sugerir,
    revisarDeNovo,
    gerarCopia,
  });
});

/**
 * Pede as `Listas`, as `Revisoes`, o `RevisorPpc`, as `Preferencias`, o `Motor`, o `FileSystem`, as
 * `FontesNormativas` e o `PacoteContexto` do `kb.sqlite`.
 */
export const layer = (opcoes: OpcoesListaViva = {}) => Layer.effect(ListaViva, make(opcoes));
