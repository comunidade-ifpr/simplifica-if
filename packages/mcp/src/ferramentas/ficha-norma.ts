/**
 * Ferramenta 3, `ficha_norma`: a situação de uma norma numa data, composta de `kb vigencia`
 * (`Normas.vigencia`: status, eventos, pendências e transições), `kb relacoes`
 * (`Normas.relacoes`) e das sucessoras de `kb impacto` (`Normas.sucessoras`).
 */
import * as Normas from "@simplifica-if/kb/Normas";
import { idDoAto } from "@simplifica-if/kb/normas/ids";
import type { EventoVigencia } from "@simplifica-if/kb/normas/vigencia";
import { z } from "zod";
import { type Aviso, ErroEntrada, esquemaLink, responder } from "../envelope.ts";
import { linkNorma } from "../links.ts";
import { blocoItem, citacao, comLink, dataBr } from "../texto.ts";
import { definirFerramenta } from "./ferramenta.ts";
import {
  avisosDasNormas,
  esquemaData,
  esquemaIdNorma,
  limitarTexto,
  situacaoDaNorma,
  tetoDoCorpo,
} from "./normas-comum.ts";
import {
  esquemaNormaResumo,
  esquemaRelacao,
  leitorDeNormas,
  type RelacaoSaida,
  relacaoSaida,
  resumoDaNorma,
} from "./tipos-comuns.ts";

/** Teto do texto para a IA (a especificação não fixa um para esta ferramenta). */
export const TETO_FICHA_NORMA = 12_000;
/** Evidência das relações no texto; o JSON traz o trecho inteiro. */
const TRECHO_RELACAO = 200;

const entrada = z.strictObject({
  id: esquemaIdNorma.describe('ID canônico da norma, como "br/cne-cp/res/2021/1"'),
  em: esquemaData.optional().describe("data da situação, AAAA-MM-DD (padrão: data de referência da base)"),
});

const esquemaInicio = z.strictObject({
  data: z.string().nullable(),
  minimo: z.string().nullable(),
  certo: z.boolean(),
});

const dados = z.strictObject({
  norma: esquemaNormaResumo.extend({
    orgao: z.string().nullable(),
    tipo_documento: z.string().nullable(),
    numero: z.string().nullable(),
    ano: z.number().int().nullable(),
    fonte_oficial: z.string().nullable(),
  }),
  vigencia: z.strictObject({
    data: z.string(),
    status: z.string(),
    certo: z.boolean(),
    inicio: esquemaInicio,
    eventos: z.array(
      z.strictObject({
        tipo: z.string(),
        origem: z.string(),
        operador: z.string().nullable(),
        /** Dispositivo atingido, quando a relação é parcial. */
        alvo_dispositivo: z.string().nullable(),
        alcance: z.string().nullable(),
        /** Data em que o evento produz efeito; `null` se a confirmar. */
        efeito_de: z.string().nullable(),
        efeito_minimo: z.string().nullable(),
        /** Na data: "sim", "não" ou "a confirmar". */
        ocorreu: z.string(),
      }),
    ),
    pendencias: z.array(z.string()),
  }),
  relacoes: z.strictObject({ entrada: z.array(esquemaRelacao), saida: z.array(esquemaRelacao) }),
  sucessoras: z.array(z.string()),
  transicoes: z.array(
    z.strictObject({
      id: z.string(),
      /** Dispositivo que estabelece a regra, com a norma (`br/cne-cp/res/2026/2#art71`). */
      dispositivo: z.string(),
      tipo: z.string(),
      norma_anterior: z.string().nullable(),
      aplica_a: z.string(),
      regra: z.string(),
      situacao_na_data: z.string(),
      inicio_em: z.string().nullable(),
      fim_em: z.string().nullable(),
      evidencia: z.string(),
      link: esquemaLink,
    }),
  ),
});

function ocorreu(valor: EventoVigencia["ocorreu"]): string {
  return valor === true ? "sim" : valor === false ? "não" : "a confirmar";
}

export const fichaNorma = definirFerramenta({
  nome: "ficha_norma",
  titulo: "Ficha da norma",
  descricao:
    "Situação de uma norma numa data: a vigência, com o que a determina e o que está a confirmar; as relações com outras normas nos dois sentidos (revoga, altera, regulamenta, fundamenta-se em); as normas sucessoras; e as regras de transição. Use quando a resposta depender de a norma estar em vigor, revogada ou substituída. Norma revogada não é inaplicável: confira as transições antes de concluir.",
  entrada,
  dados,
  executar({ id, em }, { kb, base }) {
    const ato = idDoAto(id.split("#")[0]!);
    const norma = leitorDeNormas(kb)(ato);
    if (!norma) {
      throw new ErroEntrada(
        `norma não encontrada na base: ${id}. Use buscar_norma ou resolver_citacoes para achar o ID canônico.`,
      );
    }
    const vigencia = kb(Normas.Normas.use((n) => n.vigencia(ato, em ? { em } : {})));
    const relacoes = kb(Normas.Normas.use((n) => n.relacoes(ato)));
    const resumo = resumoDaNorma(norma);
    const avisos: Aviso[] = vigencia.pendencias.map((p) => ({ tipo: "vigencia-a-confirmar", mensagem: p, ref: ato }));
    avisos.push(...avisosDasNormas([resumo]).filter((a) => a.tipo !== "vigencia-a-confirmar"));
    return responder(
      base,
      {
        norma: {
          ...resumo,
          orgao: norma.orgao,
          tipo_documento: norma.tipo_documento,
          numero: norma.numero,
          ano: norma.ano,
          fonte_oficial: norma.fonte,
        },
        vigencia: {
          data: vigencia.data,
          status: vigencia.status,
          certo: vigencia.certo,
          inicio: vigencia.inicio,
          eventos: vigencia.eventos.map((e) => ({
            tipo: e.tipo,
            origem: e.origem,
            operador: e.operador,
            alvo_dispositivo: e.alvo_dispositivo,
            alcance: e.alcance,
            efeito_de: e.efeito_de,
            efeito_minimo: e.efeito_minimo,
            ocorreu: ocorreu(e.ocorreu),
          })),
          pendencias: vigencia.pendencias,
        },
        relacoes: { entrada: relacoes.entrada.map(relacaoSaida), saida: relacoes.saida.map(relacaoSaida) },
        sucessoras: kb(Normas.Normas.use((n) => n.sucessoras(ato))),
        transicoes: vigencia.transicoes.map((t) => ({
          id: t.id,
          dispositivo: `${t.norma}${t.dispositivo}`,
          tipo: t.tipo,
          norma_anterior: t.norma_anterior ?? null,
          aplica_a: t.aplica_a,
          regra: t.regra,
          situacao_na_data: t.situacao,
          inicio_em: t.inicio_em,
          fim_em: t.fim_em,
          evidencia: t.evidencia,
          link: linkNorma(t.norma, t.dispositivo.slice(1)),
        })),
      },
      { avisos },
    );
  },
  texto(resposta) {
    const { norma, vigencia, relacoes, sucessoras, transicoes } = resposta.dados;
    const titulos = new Map<string, string>([[norma.id, norma.titulo]]);
    const nome = (id: string, dispositivo?: string | null) => {
      const titulo = titulos.get(id);
      const rotulo = titulo ? `${titulo}${dispositivo ? `, ${dispositivo}` : ""}` : `${id}${dispositivo ?? ""}`;
      return comLink(rotulo, linkNorma(id, dispositivo?.slice(1)));
    };
    const partes: string[] = [];
    const identificacao = [
      norma.orgao,
      norma.tipo_documento && norma.numero ? `${norma.tipo_documento} nº ${norma.numero}` : null,
      norma.data_publicacao ? `de ${dataBr(norma.data_publicacao)}` : null,
      norma.fonte_oficial ? `fonte oficial: ${norma.fonte_oficial}` : null,
    ].filter(Boolean);
    partes.push(
      [
        blocoItem({ titulo: norma.titulo, link: norma.link, detalhe: `\`${norma.id}\`; ${situacaoDaNorma(norma)}` }),
        ...(norma.ementa ? [citacao(norma.ementa)] : []),
        ...(identificacao.length ? [identificacao.join("; ")] : []),
      ].join("\n"),
    );
    const inicio = vigencia.inicio.data
      ? dataBr(vigencia.inicio.data)
      : `a confirmar${vigencia.inicio.minimo ? ` (não antes de ${dataBr(vigencia.inicio.minimo)})` : ""}`;
    const linhasVigencia = [
      `**Vigência em ${dataBr(vigencia.data)}:** ${vigencia.status}${vigencia.certo ? "" : " (a confirmar)"}; início: ${inicio}.`,
      ...vigencia.eventos.map((e) => {
        const alcance = e.alvo_dispositivo ?? e.alcance;
        const efeito = e.efeito_de
          ? dataBr(e.efeito_de)
          : `a confirmar${e.efeito_minimo ? `, não antes de ${dataBr(e.efeito_minimo)}` : ""}`;
        return `- ${e.tipo === "revoga" ? "revogação" : "alteração"} por ${nome(e.origem, e.operador)}${alcance ? ` (${alcance})` : ""}: efeito em ${efeito}; ocorreu na data: ${e.ocorreu}`;
      }),
    ];
    partes.push(linhasVigencia.join("\n"));
    if (sucessoras.length) partes.push(`**Sucessoras:** ${sucessoras.map((s) => nome(s)).join(", ")}.`);
    if (transicoes.length) {
      partes.push(
        [
          "**Regras de transição:**",
          ...transicoes.map((t) => {
            const prazo = [
              t.inicio_em ? `início ${dataBr(t.inicio_em)}` : "início a confirmar",
              t.fim_em ? `fim ${dataBr(t.fim_em)}` : null,
            ]
              .filter(Boolean)
              .join(", ");
            return `- ${comLink(t.id, t.link)} (${t.tipo}, \`${t.dispositivo}\`): ${t.situacao_na_data} na data; ${prazo}. Aplica-se a: ${t.aplica_a.replace(/\.$/, "")}.\n${citacao(t.regra)}`;
          }),
        ].join("\n"),
      );
    }
    const linhaRelacao = (r: RelacaoSaida) => {
      const trecho =
        r.evidencia.trecho.length > TRECHO_RELACAO
          ? `${r.evidencia.trecho.slice(0, TRECHO_RELACAO - 1).trimEnd()}…`
          : r.evidencia.trecho;
      const alcance = r.alcance ? ` (${r.alcance})` : "";
      return `- ${nome(r.origem, r.operador)} ${r.tipo} ${nome(r.alvo, r.alvo_dispositivo)}${alcance}: "${trecho}"`;
    };
    if (relacoes.saida.length)
      partes.push(["**Relações (esta norma é a origem):**", ...relacoes.saida.map(linhaRelacao)].join("\n"));
    if (relacoes.entrada.length) {
      partes.push(["**Relações (esta norma é o alvo):**", ...relacoes.entrada.map(linhaRelacao)].join("\n"));
    }
    return limitarTexto(
      partes.join("\n\n"),
      tetoDoCorpo(resposta, TETO_FICHA_NORMA),
      "Relações cortadas para caber na resposta; a lista completa está no JSON da resposta (structuredContent).",
    );
  },
});
