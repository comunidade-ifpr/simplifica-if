/**
 * O preparo da revisão com IA (M1.11, etapa 4), em código e sem IA: do PPC convertido ao plano com o
 * texto de cada pedido.
 *
 * O contexto vem do `kb.sqlite` do servidor, como na pré-conferência: as fichas (`fichasDoBanco`) e,
 * por bloco, o pacote de contexto de um PPC fora da base (`pacoteContextoAvulso` sobre o banco em
 * memória de `bancoDoPpcAvulso`): as seções do PPC dos tópicos das fichas, as normas e os dispositivos
 * citados pelas fichas, os marcos e as regras de transição, o curso do CNCT. As linhas que a triagem
 * apontou como texto dirigido a IA saem do Markdown antes de segmentar.
 *
 * - S: o recorte de cada ficha (`recorteDaFicha`) sai das seções dos tópicos dela mais a melhor seção
 *   por consulta;
 * - J: só as seções dos tópicos (`buscasPorFicha: 0`), até 30 mil caracteres;
 * - T: o contexto e trechos curtos das seções; o pedido se completa na hora, com os resumos dos temas.
 */
import * as Effect from "effect/Effect";
import { FontesNormativas } from "@simplifica-if/kb/FontesNormativas";
import { bancoDoPpcAvulso } from "@simplifica-if/kb/db/compilar";
import {
  fichasDoBanco,
  nomesDeCampiDoBanco,
  pacoteContextoAvulso,
  type PacoteAvulso,
} from "@simplifica-if/kb/db/pacote-contexto";
import { palavrasDeCampi } from "@simplifica-if/kb/ppcs/secoes";
import {
  type ContextoNormativo,
  fontesPermitidas,
  formatarContexto,
  pedidoJ,
  pedidoS,
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

/** Um bloco do plano, com o pedido pronto (vazio no T, montado na hora) e as fontes permitidas. */
export type BlocoPlano = Bloco & { pedido: string; caracteres: number; fontes: string[] };

/** O plano gravado com a revisão (`revisoes_ia.plano`). */
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

function contextoDoPacote(pacote: PacoteAvulso, dataBase: string): ContextoNormativo {
  return {
    dataBase,
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
          `Transição ${t.norma_id}${t.dispositivo} (${t.situacao} em ${dataBase}): ${t.regra}. Aplica-se a: ${t.aplica_a}.`,
      ),
    ],
  };
}

const secoesTexto = (pacote: PacoteAvulso, soTopicos: boolean): SecaoTexto[] =>
  pacote.secoes
    .filter((s) => !soTopicos || s.motivo.some((m) => m.startsWith("topico:")))
    .map((s) => ({ titulo: s.titulo, linhaInicio: s.linha_inicio, linhaFim: s.linha_fim, texto: s.texto }));

export interface EntradaPreparo {
  readonly markdown: string;
  readonly linhasTextoParaIa: readonly number[];
  readonly cnct: string | null;
  readonly modo: ModoRevisaoIa;
  readonly nonce: string;
}

/** O plano da revisão: fichas, blocos e pedidos. Pede o `kb.sqlite` (`SqlClient`) e as `FontesNormativas`. */
export const preparar = Effect.fn("RevisaoIa.preparar")(function* (entrada: EntradaPreparo) {
  const fontes = yield* FontesNormativas;
  const fichasJson = yield* fichasDoBanco();
  const fichas = fichasJson.map((f) => fichaIa(f as Record<string, unknown>));
  const porId = new Map(fichas.map((f) => [f.id, f]));
  const jsonPorId = new Map(fichasJson.map((f) => [f.id, f]));
  const limpo = retirarTextoParaIa(entrada.markdown, entrada.linhasTextoParaIa);
  const campi = palavrasDeCampi(yield* nomesDeCampiDoBanco());
  const db = yield* Effect.acquireRelease(
    Effect.sync(() =>
      bancoDoPpcAvulso(limpo, { registro: fontes.registro, palavrasCampi: campi, sinonimos: fontes.sinonimos }),
    ),
    (banco) => Effect.sync(() => banco.close()),
  );
  const pacote = (ids: readonly string[], buscasPorFicha: number) =>
    pacoteContextoAvulso(
      db,
      ids.map((id) => jsonPorId.get(id)!),
      { cnctId: entrada.cnct, buscasPorFicha },
    );

  const blocos: BlocoPlano[] = [];
  let transversais: PlanoRevisaoIa["transversais"] = null;
  for (const bloco of planejarBlocos(fichas, entrada.modo)) {
    const doBloco = bloco.fichas.map((id) => porId.get(id)!);
    if (bloco.tipo === "S") {
      const geral = yield* pacote(bloco.fichas, 0);
      const contexto = contextoDoPacote(geral, fontes.dataReferencia);
      const recortes = new Map<string, { achou: boolean; texto: string }>();
      for (const ficha of doBloco) {
        const proprio = yield* pacote([ficha.id], 1);
        recortes.set(ficha.id, recorteDaFicha(ficha, secoesTexto(proprio, false)));
      }
      const pedido = pedidoS(bloco, doBloco, recortes, contexto, entrada.nonce);
      blocos.push({ ...bloco, pedido, caracteres: pedido.length, fontes: [...fontesPermitidas(contexto)] });
    } else if (bloco.tipo === "J") {
      const p = yield* pacote(bloco.fichas, 0);
      const contexto = contextoDoPacote(p, fontes.dataReferencia);
      const pedido = pedidoJ(bloco, doBloco, secoesDoTema(secoesTexto(p, true)), contexto, entrada.nonce);
      blocos.push({ ...bloco, pedido, caracteres: pedido.length, fontes: [...fontesPermitidas(contexto)] });
    } else {
      const p = yield* pacote(bloco.fichas, 0);
      const contexto = contextoDoPacote(p, fontes.dataReferencia);
      const trechos = secoesDoTema(secoesTexto(p, true), 8_000);
      transversais = { contexto, trechos };
      // Os resumos (até 600 caracteres por tema) e os resultados entram na hora.
      const caracteres = trechos.length + 6_000 + formatarContexto(contexto).length;
      blocos.push({ ...bloco, pedido: "", caracteres, fontes: [...fontesPermitidas(contexto)] });
    }
  }
  const plano: PlanoRevisaoIa = {
    markdown: limpo,
    nonce: entrada.nonce,
    cnct: entrada.cnct,
    fichas: fichas.filter((f) => blocos.some((b) => b.fichas.includes(f.id))),
    fora: fichasForaDoModo(fichas, entrada.modo).map((f) => f.id),
    blocos,
    transversais,
  };
  return plano;
}, Effect.scoped);
