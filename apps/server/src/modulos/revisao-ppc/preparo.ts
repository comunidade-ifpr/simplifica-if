/**
 * O preparo da revisão com IA (M1.11, etapa 4), em código e sem IA: do PPC convertido ao plano com o
 * texto de cada pedido.
 *
 * O contexto vem do `kb.sqlite` do servidor, como na pré-conferência, pelo `PacoteRevisaoPpc` do kb: as
 * fichas e, por bloco, o pacote de contexto do PPC aberto como PPC fora da base (`abrirAvulso`): as
 * seções do PPC dos tópicos das fichas, as normas e os dispositivos citados pelas fichas, os marcos e
 * as regras de transição, o curso do CNCT. As linhas que a triagem apontou como texto dirigido a IA
 * saem do Markdown antes de segmentar.
 *
 * - S: o recorte de cada ficha (`recorteDaFicha`) sai das seções dos tópicos dela mais a melhor seção
 *   por consulta;
 * - J: só as seções dos tópicos (`buscasPorFicha: 0`), até 30 mil caracteres;
 * - T: o contexto e trechos curtos das seções; o pedido se completa na hora, com os resumos dos temas.
 */
import * as Effect from "effect/Effect";
import * as PacoteRevisaoPpc from "@simplifica-if/kb/PacoteRevisaoPpc";
import { comumDoBloco, estruturaDoPpc } from "@simplifica-if/ppc/revisao-ia/estrutura";
import {
  type AlvosDoBloco,
  alvosDoTema,
  alvosPorRecorte,
  type ContextoNormativo,
  CRITERIO_PADRAO,
  type CriterioInconclusivo,
  fontesPermitidas,
  formatarContexto,
  pedidoJ,
  pedidoS,
  type RecorteFicha,
  trechosPorRecorte,
} from "@simplifica-if/ppc/revisao-ia/pedido";
import {
  type Bloco,
  type FichaIa,
  fichaIa,
  fichasForaDoModo,
  type ModoRevisaoIa,
  planejarBlocos,
  recorteDaFicha,
  retirarTextoParaIa,
  type SecaoTexto,
  secoesDoTema,
} from "@simplifica-if/ppc/revisao-ia/plano";
import { NOME_DA_FORMA } from "@simplifica-if/ppc/revisao-previa";

/** O curso em texto, para todo pedido: "Técnico em Agropecuária, forma de oferta integrada"; nulo sem curso. */
export const cursoEmTexto = (curso: {
  readonly cnct: { readonly denominacao: string } | null;
  readonly forma: string | null;
}): string | null =>
  curso.cnct
    ? `${curso.cnct.denominacao}${curso.forma ? `, forma de oferta ${NOME_DA_FORMA[curso.forma] ?? curso.forma}` : ", forma de oferta não identificada"}`
    : null;

/** Um bloco do plano, com o pedido pronto (vazio no T, montado na hora), as fontes permitidas e os alvos por ficha. */
export type BlocoPlano = Bloco & { pedido: string; caracteres: number; fontes: string[]; alvos: AlvosDoBloco };

/** O plano gravado com a revisão (`revisao_ppc_revisoes_ia.plano`). */
export type PlanoRevisaoIa = {
  /**
   * O Markdown convertido sem as linhas de texto dirigido a IA: a conferência dos trechos é contra ele,
   * e um trecho que cite a própria instrução escondida não passa.
   */
  markdown: string;
  nonce: string;
  cnct: string | null;
  fichas: FichaIa[];
  /** Fichas S e J fora do modo (para o aviso). */
  fora: string[];
  blocos: BlocoPlano[];
  /** As transversais: o contexto normativo e os trechos das seções delas. */
  transversais: { contexto: ContextoNormativo; trechos: string } | null;
  /** O critério do INCONCLUSIVO dos pedidos. */
  criterio: CriterioInconclusivo;
};

const LIMITE_CAMPO_CNCT = 700;
const CAMPOS_FORA_CNCT = new Set(["id", "path", "indice", "denominacao_normalizada"]);

/** O curso do CNCT em linhas `campo: valor` (texto tokeniza melhor que JSON acentuado). */
function cnctEmTexto(cnct: unknown): string | null {
  if (!cnct || typeof cnct !== "object") return null;
  const linhas: string[] = [];
  for (const [campo, valor] of Object.entries(cnct as Record<string, unknown>)) {
    if (CAMPOS_FORA_CNCT.has(campo) || valor === null || valor === "") continue;
    const texto = Array.isArray(valor)
      ? valor.join("; ")
      : typeof valor === "object"
        ? JSON.stringify(valor)
        : String(valor);
    linhas.push(
      `${campo}: ${texto.length > LIMITE_CAMPO_CNCT ? `${texto.slice(0, LIMITE_CAMPO_CNCT)} […]` : texto}`.replace(
        /\s+/g,
        " ",
      ),
    );
  }
  return linhas.join("\n");
}

function contextoDoPacote(pacote: PacoteRevisaoPpc.PacoteAvulso, curso: string | null): ContextoNormativo {
  return {
    // o dia em que o pacote calculou a vigência
    dataBase: pacote.vigencia_em,
    curso: curso ?? undefined,
    cnct: cnctEmTexto(pacote.cnct),
    normas: pacote.normas.map((n) => ({
      ref: n.ref,
      titulo: n.titulo ?? n.ref,
      situacao: n.status_vigencia,
      dispositivos: n.dispositivos.map((d) => ({ id: d.id.slice(d.id.indexOf("#")), texto: d.texto })),
    })),
    notas: [
      ...pacote.marcos.map(
        (m) =>
          `Marco "${m.tema}": norma vigente ${m.vigente}.${m.orientacao_analise ? ` ${m.orientacao_analise}` : ""}`,
      ),
      ...pacote.transicoes.map(
        (t) =>
          `Transição ${t.norma_id}${t.dispositivo} (${t.situacao} em ${pacote.vigencia_em}): ${t.regra}. Aplica-se a: ${t.aplica_a}.`,
      ),
    ],
  };
}

const secoesTexto = (pacote: PacoteRevisaoPpc.PacoteAvulso, soTopicos: boolean): SecaoTexto[] =>
  pacote.secoes
    .filter((s) => !soTopicos || s.motivo.some((m) => m.startsWith("topico:")))
    .map((s) => ({
      titulo: s.titulo,
      linhaInicio: s.linha_inicio,
      linhaFim: s.linha_fim,
      texto: s.texto,
      tipo: s.tipo,
      doTopico: s.motivo.some((m) => m.startsWith("topico:")),
    }));

/** A estrutura do PPC para os pedidos: o quadro de identificação com os fatos do `kb`, a matriz em TSV, o índice do ementário e o começo das referências. */
function estruturaDe(markdown: string, avulso: PacoteRevisaoPpc.PpcAvulso) {
  const { secoes, fatos } = avulso.estrutura();
  return estruturaDoPpc(
    markdown,
    secoes.map((x) => ({
      titulo: x.titulo,
      linhaInicio: x.linhaInicio,
      linhaFim: x.linhaFim,
      texto: x.texto,
      tipo: x.tipo,
    })),
    fatos.map((f) => ({ fato: f.fato, valor: f.valor })),
  );
}

/** Teto do recorte de cada transversal (as seções dos tópicos dela, guiadas pela estrutura). */
const LIMITE_RECORTE_T = 6000;

export interface EntradaPreparo {
  readonly markdown: string;
  readonly linhasTextoParaIa: readonly number[];
  readonly cnct: string | null;
  /** O curso identificado (denominação e forma), em texto, para todo pedido. */
  readonly curso: string | null;
  readonly modo: ModoRevisaoIa;
  readonly nonce: string;
  /** O critério do INCONCLUSIVO (padrão: `conservador`). */
  readonly criterio?: CriterioInconclusivo;
  /** Só estas fichas (o script de avaliação); sem ele, as do modo. */
  readonly soFichas?: readonly string[];
  /** Fichas `hibrido` escaladas pela pré-conferência em código, com a mensagem do verificador como pista. */
  readonly escaladas?: ReadonlyMap<string, string>;
}

/** O plano da revisão: fichas, blocos e pedidos. Pede o `PacoteRevisaoPpc` do `kb.sqlite`. */
export const preparar = Effect.fn("RevisaoIa.preparar")(function* (entrada: EntradaPreparo) {
  const kb = yield* PacoteRevisaoPpc.PacoteRevisaoPpc;
  const fichasJson = yield* kb.fichas();
  const criterio = entrada.criterio ?? CRITERIO_PADRAO;
  const todasFichas = fichasJson.map((f) => fichaIa(f as Record<string, unknown>));
  const fichas = entrada.soFichas ? todasFichas.filter((f) => entrada.soFichas!.includes(f.id)) : todasFichas;
  const escaladasIds = entrada.escaladas?.size ? new Set(entrada.escaladas.keys()) : undefined;
  const porId = new Map(fichas.map((f) => [f.id, f]));
  const jsonPorId = new Map(fichasJson.map((f) => [f.id, f]));
  const limpo = retirarTextoParaIa(entrada.markdown, entrada.linhasTextoParaIa);
  const avulso = yield* kb.abrirAvulso(limpo);
  const estrutura = estruturaDe(limpo, avulso);
  const pacote = (ids: readonly string[], buscasPorFicha: number) =>
    avulso.pacote(
      ids.map((id) => jsonPorId.get(id)!),
      { cnctId: entrada.cnct, buscasPorFicha },
    );

  const blocos: BlocoPlano[] = [];
  let transversais: PlanoRevisaoIa["transversais"] = null;
  for (const bloco of planejarBlocos(fichas, entrada.modo, undefined, escaladasIds)) {
    const doBloco = bloco.fichas.map((id) => porId.get(id)!);
    if (bloco.tipo === "focal") {
      const geral = yield* pacote(bloco.fichas, 0);
      const contexto = contextoDoPacote(geral, entrada.curso);
      const comum = comumDoBloco(doBloco, estrutura);
      const recortes = new Map<string, RecorteFicha>();
      for (const ficha of doBloco) {
        const proprio = yield* pacote([ficha.id], 1);
        recortes.set(ficha.id, recorteDaFicha(ficha, secoesTexto(proprio, false), comum));
      }
      const pedido = pedidoS(
        bloco,
        doBloco,
        recortes,
        contexto,
        entrada.nonce,
        comum.texto,
        criterio,
        entrada.escaladas,
      );
      const alvos = alvosPorRecorte(doBloco, recortes, comum.texto);
      blocos.push({ ...bloco, pedido, caracteres: pedido.length, fontes: [...fontesPermitidas(contexto)], alvos });
    } else if (bloco.tipo === "tematico") {
      const p = yield* pacote(bloco.fichas, 0);
      const contexto = contextoDoPacote(p, entrada.curso);
      const comum = comumDoBloco(doBloco, estrutura);
      const secoes = secoesTexto(p, true).filter((x) => !comum.excluirLinhas.has(x.linhaInicio));
      const secoesFormatadas = secoesDoTema(secoes, undefined, comum.semTabelaEm);
      const pedido = pedidoJ(bloco, doBloco, secoesFormatadas, contexto, entrada.nonce, comum.texto, criterio);
      const alvos = alvosDoTema(doBloco, secoesFormatadas, comum.texto);
      blocos.push({ ...bloco, pedido, caracteres: pedido.length, fontes: [...fontesPermitidas(contexto)], alvos });
    } else {
      const p = yield* pacote(bloco.fichas, 0);
      const contexto = contextoDoPacote(p, entrada.curso);
      // Cada transversal com o recorte das seções dos tópicos dela, e o comum do bloco (quadro,
      // matriz, ementário): no modo rápido há poucos temas J, e os resumos sozinhos não bastavam.
      const comum = comumDoBloco(doBloco, estrutura);
      const recortes = new Map<string, RecorteFicha>();
      for (const ficha of doBloco) {
        const proprio = yield* pacote([ficha.id], 0);
        recortes.set(
          ficha.id,
          recorteDaFicha(ficha, secoesTexto(proprio, true), { ...comum, limite: LIMITE_RECORTE_T }),
        );
      }
      const trechos = trechosPorRecorte(doBloco, recortes, comum.texto);
      const alvos = alvosPorRecorte(doBloco, recortes, comum.texto);
      transversais = { contexto, trechos };
      // Os resumos (até 600 caracteres por tema) e os resultados entram na hora.
      const caracteres = trechos.length + 6_000 + formatarContexto(contexto).length;
      blocos.push({ ...bloco, pedido: "", caracteres, fontes: [...fontesPermitidas(contexto)], alvos });
    }
  }
  const plano: PlanoRevisaoIa = {
    markdown: limpo,
    nonce: entrada.nonce,
    cnct: entrada.cnct,
    fichas: fichas.filter((f) => blocos.some((b) => b.fichas.includes(f.id))),
    fora: fichasForaDoModo(fichas, entrada.modo, escaladasIds).map((f) => f.id),
    blocos,
    transversais,
    criterio,
  };
  return plano;
}, Effect.scoped);

/** O contexto de uma ficha para a conversa por pendência e a nova revisão (etapa 5b). */
export type ContextoDaFicha = {
  ficha: FichaIa;
  /** O PPC entregue à ficha: o comum (quadro, matriz, ementário, quando a ficha pede) e o recorte dela. */
  recorte: string;
  /** As duas partes, para o `pedidoS` da nova revisão. */
  comum: string;
  proprio: { achou: boolean; texto: string };
  contexto: ContextoNormativo;
  fontes: string[];
};

export interface EntradaContextoFicha {
  readonly markdown: string;
  readonly linhasTextoParaIa: readonly number[];
  readonly cnct: string | null;
  readonly curso: string | null;
  readonly ficha: string;
}

/**
 * O recorte e o contexto normativo de uma ficha só, pelo mesmo caminho do lote S (`recorteDaFicha` com o
 * comum do bloco): vale para as fichas D, S e J. `null` se a ficha não está na base (a triagem).
 */
export const contextoDaFicha = Effect.fn("RevisaoIa.contextoDaFicha")(function* (entrada: EntradaContextoFicha) {
  const kb = yield* PacoteRevisaoPpc.PacoteRevisaoPpc;
  const json = (yield* kb.fichas()).find((f) => f.id === entrada.ficha);
  if (!json) return null;
  const ficha = fichaIa(json as Record<string, unknown>);
  const limpo = retirarTextoParaIa(entrada.markdown, entrada.linhasTextoParaIa);
  const avulso = yield* kb.abrirAvulso(limpo);
  const estrutura = estruturaDe(limpo, avulso);
  const pacote = yield* avulso.pacote([json], { cnctId: entrada.cnct, buscasPorFicha: 1 });
  const contexto = contextoDoPacote(pacote, entrada.curso);
  const comum = comumDoBloco([ficha], estrutura);
  const r = recorteDaFicha(ficha, secoesTexto(pacote, false), comum);
  const recorte = [comum.texto, r.texto].filter(Boolean).join("\n\n");
  return {
    ficha,
    recorte,
    comum: comum.texto,
    proprio: r,
    contexto,
    fontes: [...fontesPermitidas(contexto)],
  } satisfies ContextoDaFicha;
}, Effect.scoped);
