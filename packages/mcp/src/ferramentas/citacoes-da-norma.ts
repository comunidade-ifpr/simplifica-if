/**
 * Ferramenta 6, `citacoes_da_norma`: os PPCs que citam uma norma ou um dispositivo, pela tabela
 * `citacoes` (`Ppcs.citacoesDaNorma`, a mesma regra de `kb citacoes`). Sem `ppc`, um resumo por PPC
 * (a contagem de ocorrências); com `ppc`, as ocorrências, com linha, trecho, regra e confiança.
 */
import * as Schema from "effect/Schema";
import { EsquemaLink, Fonte, NormaResumo } from "../contratos.ts";
import { comPadrao, inteiro, numero, opcional, texto } from "../esquema.ts";
import { linkNorma } from "../links.ts";
import { cortar } from "../orcamento.ts";
import { blocoItem, comLink } from "../texto.ts";
import { filtroTexto, idNorma } from "./comum-ppcs.ts";
import { definirFerramenta } from "./ferramenta.ts";

/** Teto do texto para a IA, em caracteres. */
export const TETO_CITACOES = 8000;
const MAX_TRECHO = 300;

export const Entrada = Schema.Struct({
  id: idNorma(
    'ID canônico da norma, com dispositivo opcional ("br/cne-cp/res/2021/1" ou "br/cne-cp/res/2021/1#art20")',
  ),
  confianca_min: comPadrao(
    numero({ minimo: 0, maximo: 1 }),
    0,
    "confiança mínima das citações (0 a 1); padrão 0",
  ),
  ppc: opcional(filtroTexto('um PPC ("campus/curso"): devolve as ocorrências em vez do resumo')),
  nivel: opcional(filtroTexto('nível do PPC ("médio", "superior", "pós-graduação")')),
  campus: opcional(filtroTexto('campus, pelo ID ("curitiba")')),
  limite: comPadrao(inteiro({ minimo: 1, maximo: 50 }), 30, "PPCs por página (1 a 50); padrão 30"),
  cursor: opcional(texto({ minimo: 1 }, "cursor da página seguinte, devolvido pela chamada anterior")),
});

export const Ocorrencia = Schema.Struct({
  linha: Schema.Int,
  trecho: Schema.String,
  regra: Schema.String,
  confianca: Schema.Finite,
  /** Primeiro dispositivo citado (`ato#dispositivo`), ou `null`. */
  dispositivo: Schema.NullOr(Schema.String),
  /** O dispositivo citado, ou a norma. */
  link: EsquemaLink,
  /** Linha do PPC onde está a citação. */
  fonte: Fonte,
});
export type Ocorrencia = typeof Ocorrencia.Type;

export const ItemPpc = Schema.Struct({
  ppc: Schema.String,
  curso: Schema.String,
  campus: Schema.String,
  nivel: Schema.String,
  forma: Schema.String,
  link: EsquemaLink,
  /** Sem `ppc`, a contagem; com `ppc`, as ocorrências. */
  ocorrencias: Schema.Union([inteiro({ minimo: 0 }), Schema.Array(Ocorrencia)]),
});
export type ItemPpc = typeof ItemPpc.Type;

export const Dados = Schema.Struct({
  /** O ID consultado, com o dispositivo se houver (como `kb citacoes`). */
  id: Schema.String,
  norma: NormaResumo,
  total_ppcs: inteiro({ minimo: 0 }),
  total_ocorrencias: inteiro({ minimo: 0 }),
  ppcs: Schema.Array(ItemPpc),
});

/** O bloco de um PPC no texto (também mede o item na paginação pelo teto). */
export function blocoPpc(p: ItemPpc): string {
  const cabecalho = `${comLink(`${p.curso} (${p.campus})`, p.link)} — \`${p.ppc}\`, ${p.nivel}, ${p.forma}`;
  if (typeof p.ocorrencias === "number") {
    return `- ${cabecalho}: ${p.ocorrencias} ${p.ocorrencias === 1 ? "ocorrência" : "ocorrências"}`;
  }
  return [
    `### ${cabecalho}`,
    ...p.ocorrencias.map((o) =>
      blocoItem({
        titulo: `linha ${o.linha}`,
        detalhe: `regra \`${o.regra}\`, confiança ${o.confianca}${o.dispositivo ? `, ${comLink(o.dispositivo, o.link)}` : ""}`,
        literal: cortar(o.trecho, MAX_TRECHO),
        fonte: o.fonte,
      }),
    ),
  ].join("\n\n");
}

function cabecalhoNorma(norma: NormaResumo, id: string): string {
  const dispositivo = id.split("#")[1];
  const alvo = dispositivo ? `${norma.titulo}, #${dispositivo}` : norma.titulo;
  const link = dispositivo ? linkNorma(norma.id, dispositivo) : norma.link;
  return `PPCs que citam ${comLink(alvo, link)} (${norma.status_vigencia ?? norma.situacao})`;
}

export const citacoesDaNorma = definirFerramenta({
  nome: "citacoes_da_norma",
  titulo: "PPCs que citam a norma",
  descricao:
    "PPCs da base que citam uma norma ou um dispositivo, com linha, trecho e confiança. Use quando precisar da lista completa; `impacto_da_norma` traz só uma amostra. Sem `ppc`, devolve um resumo por PPC; com `ppc`, as ocorrências.",
  entrada: Entrada,
  dados: Dados,
  texto({ dados: d }) {
    const partes = [
      `${cabecalhoNorma(d.norma, d.id)}: ${d.total_ppcs} PPCs, ${d.total_ocorrencias} ocorrências.`,
      ...d.ppcs.map(blocoPpc),
    ];
    return partes.join(d.ppcs.some((p) => Array.isArray(p.ocorrencias)) ? "\n\n" : "\n");
  },
});
