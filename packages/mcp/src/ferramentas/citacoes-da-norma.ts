/**
 * Ferramenta 6, `citacoes_da_norma`: os PPCs que citam uma norma ou um dispositivo, pela tabela
 * `citacoes` (`Ppcs.citacoesDaNorma`, a mesma regra de `kb citacoes`). Sem `ppc`, um resumo por PPC
 * (a contagem de ocorrências); com `ppc`, as ocorrências, com linha, trecho, regra e confiança.
 */
import * as Ppcs from "@simplifica-if/kb/Ppcs";
import type { PpcCitante } from "@simplifica-if/kb/ppcs/citacoes";
import { z } from "zod";
import { type Aviso, esquemaFonte, esquemaLink, responder } from "../envelope.ts";
import { linkNorma, linkPpc } from "../links.ts";
import { cortar, paginarNoTeto, RESERVA_TEXTO } from "../orcamento.ts";
import { blocoItem, comLink } from "../texto.ts";
import { avisoBaixaConfianca, chavePpc, filtroTexto, idNorma, normaPedida } from "./comum-ppcs.ts";
import { esquemaNormaResumo, type NormaResumo } from "./tipos-comuns.ts";
import { definirFerramenta } from "./ferramenta.ts";

/** Teto do texto para a IA, em caracteres. */
export const TETO_CITACOES = 8000;
const MAX_TRECHO = 300;

const entrada = z.strictObject({
  id: idNorma(
    'ID canônico da norma, com dispositivo opcional ("br/cne-cp/res/2021/1" ou "br/cne-cp/res/2021/1#art20")',
  ),
  confianca_min: z.number().min(0).max(1).default(0).describe("confiança mínima das citações (0 a 1); padrão 0"),
  ppc: filtroTexto('um PPC ("campus/curso"): devolve as ocorrências em vez do resumo').optional(),
  nivel: filtroTexto('nível do PPC ("médio", "superior", "pós-graduação")').optional(),
  campus: filtroTexto('campus, pelo ID ("curitiba")').optional(),
  limite: z.number().int().min(1).max(50).default(30).describe("PPCs por página (1 a 50); padrão 30"),
  cursor: z.string().min(1).optional().describe("cursor da página seguinte, devolvido pela chamada anterior"),
});

const esquemaOcorrencia = z.strictObject({
  linha: z.number().int(),
  trecho: z.string(),
  regra: z.string(),
  confianca: z.number(),
  /** Primeiro dispositivo citado (`ato#dispositivo`), ou `null`. */
  dispositivo: z.string().nullable(),
  /** O dispositivo citado, ou a norma. */
  link: esquemaLink,
  /** Linha do PPC onde está a citação. */
  fonte: esquemaFonte,
});
type Ocorrencia = z.infer<typeof esquemaOcorrencia>;

const dados = z.strictObject({
  /** O ID consultado, com o dispositivo se houver (como `kb citacoes`). */
  id: z.string(),
  norma: esquemaNormaResumo,
  total_ppcs: z.number().int().min(0),
  total_ocorrencias: z.number().int().min(0),
  ppcs: z.array(
    z.strictObject({
      ppc: z.string(),
      curso: z.string(),
      campus: z.string(),
      nivel: z.string(),
      forma: z.string(),
      link: esquemaLink,
      /** Sem `ppc`, a contagem; com `ppc`, as ocorrências. */
      ocorrencias: z.union([z.number().int().min(0), z.array(esquemaOcorrencia)]),
    }),
  ),
});
type Dados = z.infer<typeof dados>;
type ItemPpc = Dados["ppcs"][number];

function ocorrencias(ato: string, p: PpcCitante): Ocorrencia[] {
  return p.ocorrencias.map((o) => ({
    linha: o.linha,
    trecho: o.trecho,
    regra: o.regra,
    confianca: o.confianca,
    dispositivo: o.dispositivoId ? `${ato}${o.dispositivoId}` : null,
    link: o.dispositivoId ? linkNorma(ato, o.dispositivoId.slice(1)) : linkNorma(ato),
    fonte: { path: `base-conhecimento/${p.path}`, linha_inicio: o.linha, linha_fim: o.linha },
  }));
}

function blocoPpc(p: ItemPpc): string {
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
  entrada,
  dados,
  executar(e, { kb, base }) {
    const norma = normaPedida(kb, e.id);
    const ato = norma.id;
    const ppc = e.ppc === undefined ? undefined : chavePpc(e.ppc);
    const citantes = kb(Ppcs.Ppcs.use((p) => p.citacoesDaNorma(e.id, { confiancaMinima: e.confianca_min }))).filter(
      (p) =>
        (ppc === undefined || p.ppc === ppc) &&
        (e.nivel === undefined || p.nivel === e.nivel) &&
        (e.campus === undefined || p.ppc.split("/")[0] === e.campus),
    );
    const itens: (ItemPpc & { regras: string[] })[] = citantes.map((p) => ({
      ppc: p.ppc,
      curso: p.curso,
      campus: p.campus,
      nivel: p.nivel,
      forma: p.tipo_oferta,
      link: linkPpc(p.ppc),
      ocorrencias: ppc === undefined ? p.ocorrencias.length : ocorrencias(ato, p),
      regras: p.ocorrencias.map((o) => o.regra),
    }));
    const consulta = {
      ferramenta: "citacoes_da_norma",
      base: base.versao,
      id: e.id,
      confianca_min: e.confianca_min,
      ppc,
      nivel: e.nivel,
      campus: e.campus,
    };
    const { itens: pagina, pagina: paginacao } = paginarNoTeto(itens, {
      limite: e.limite,
      cursor: e.cursor,
      consulta,
      orcamento: TETO_CITACOES - RESERVA_TEXTO,
      medir: (item) => blocoPpc(item).length + 2,
    });
    const avisos: Aviso[] = [...avisoBaixaConfianca(pagina.flatMap((p) => p.regras))];
    if (itens.length === 0) {
      avisos.push({
        tipo: "nao-encontrado",
        mensagem: `nenhum PPC da base cita ${e.id}${ppc || e.nivel || e.campus ? " com esses filtros" : ""}${e.confianca_min > 0 ? ` com confiança ≥ ${e.confianca_min}` : ""}`,
        ref: e.id,
      });
    }
    return responder(
      base,
      {
        id: e.id,
        norma,
        total_ppcs: itens.length,
        total_ocorrencias: citantes.reduce((total, p) => total + p.ocorrencias.length, 0),
        ppcs: pagina.map(({ regras: _r, ...item }) => item),
      },
      { avisos, pagina: paginacao },
    );
  },
  texto({ dados: d }) {
    const partes = [
      `${cabecalhoNorma(d.norma, d.id)}: ${d.total_ppcs} PPCs, ${d.total_ocorrencias} ocorrências.`,
      ...d.ppcs.map(blocoPpc),
    ];
    return partes.join(d.ppcs.some((p) => Array.isArray(p.ocorrencias)) ? "\n\n" : "\n");
  },
});
