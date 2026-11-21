/**
 * Ferramenta 7, `impacto_da_norma`: o que uma norma atinge na base, por `Impacto.daNorma` (a regra de
 * `kb impacto`): relações, sucessoras, transições, normas que a citam, fichas da revisão de PPC,
 * tópicos e PPCs. Os outros arquivos das skills ficam na CLI (servem à curadoria); a lista completa
 * de PPCs vem de `citacoes_da_norma`.
 */
import * as Schema from "effect/Schema";
import { EsquemaLink, NormaResumo, Relacao, TransicaoResumo } from "../contratos.ts";
import { inteiro } from "../esquema.ts";
import { linkNorma } from "../links.ts";
import { cortar, linhasNoOrcamento } from "../orcamento.ts";
import { comLink, dataBr } from "../texto.ts";
import { idNorma, linhaTransicao } from "./comum-ppcs.ts";
import { definirFerramenta } from "./ferramenta.ts";

export const TETO_IMPACTO = 8000;
/** PPCs na amostra; a lista completa vem de `citacoes_da_norma`. */
export const AMOSTRA_PPCS = 10;

export const Entrada = Schema.Struct({
  id: idNorma('ID canônico da norma, com dispositivo opcional ("br/cne-cp/res/2021/1")'),
});

export const Dados = Schema.Struct({
  norma: NormaResumo,
  /** Status na data de referência, com "(a confirmar)" quando incerto. */
  status: Schema.String,
  data_referencia: Schema.String,
  sucessoras: Schema.Array(Schema.String),
  transicoes: Schema.Array(TransicaoResumo),
  relacoes: Schema.Array(Relacao),
  normas_que_citam: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      titulo: Schema.String,
      /** Dispositivos da norma citante que citam esta (ou `preâmbulo`). */
      dispositivos: Schema.Array(Schema.String),
      link: EsquemaLink,
    }),
  ),
  ppcs: Schema.Struct({
    total: inteiro({ minimo: 0 }),
    amostra: Schema.Array(
      Schema.Struct({ ppc: Schema.String, nome: Schema.String, campus: Schema.String, link: EsquemaLink }),
    ),
  }),
  fichas: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      titulo: Schema.String,
      /** Motivos: referencia, referencia-correspondente, citacao, citacao-sucessora, tema. */
      papel: Schema.String,
      dispositivos: Schema.Array(Schema.String),
      link: EsquemaLink,
    }),
  ),
  topicos: Schema.Array(Schema.String),
});

export const impactoDaNorma = definirFerramenta({
  nome: "impacto_da_norma",
  titulo: "Impacto da norma",
  descricao:
    'O que uma norma (revogada, alterada ou nova) atinge na base: os PPCs que a citam, as fichas da revisão de PPC, as normas que a citam, as relações, as sucessoras e as transições. Use para responder "o que muda com esta norma".',
  entrada: Entrada,
  dados: Dados,
  texto({ dados: d }) {
    const lista = (titulo: string, linhas: string[], orcamento: number, resto: string) =>
      linhas.length === 0
        ? `${titulo}: nenhuma.`
        : [`${titulo}:`, ...linhasNoOrcamento(linhas, orcamento, resto)].join("\n");
    const relacao = (r: Relacao) =>
      `- ${r.origem}${r.operador ?? ""} **${r.tipo}** ${r.alvo}${r.alvo_dispositivo ?? ""} — evidência em ${r.evidencia.em}: "${cortar(r.evidencia.trecho, 200)}"`;
    return [
      `Impacto de ${comLink(d.norma.titulo, d.norma.link)}: ${d.status} em ${dataBr(d.data_referencia)}.`,
      `Sucessoras: ${d.sucessoras.length ? d.sucessoras.map((s) => comLink(s, linkNorma(s))).join(", ") : "nenhuma"}.`,
      lista("Regras de transição (norma revogada não é inaplicável)", d.transicoes.map(linhaTransicao), 1500, "regras"),
      lista("Relações", d.relacoes.map(relacao), 1500, "relações"),
      lista(
        "Normas que a citam",
        d.normas_que_citam.map((n) => `- ${comLink(n.titulo, n.link)} (${n.dispositivos.join(", ")})`),
        800,
        "normas",
      ),
      `PPCs que a citam: ${d.ppcs.total}${d.ppcs.total > d.ppcs.amostra.length ? ` (amostra de ${d.ppcs.amostra.length}; lista completa em \`citacoes_da_norma\`)` : ""}${d.ppcs.amostra.length ? `: ${d.ppcs.amostra.map((p) => comLink(`${p.nome} (${p.campus})`, p.link)).join("; ")}` : ""}.`,
      lista(
        "fichas da revisão de PPC atingidas",
        d.fichas.map(
          (f) =>
            `- ${comLink(f.id, f.link)} ${f.titulo} — ${f.papel}${f.dispositivos.length ? ` (${f.dispositivos.join(", ")})` : ""}`,
        ),
        3500,
        "fichas (lista completa no JSON)",
      ),
      `Tópicos atingidos: ${d.topicos.length ? d.topicos.map((t) => `\`${t}\``).join(", ") : "nenhum"}.`,
    ].join("\n\n");
  },
});
