/**
 * Ferramenta 3, `ficha_norma`: a situação de uma norma numa data, composta de `kb vigencia`
 * (`Normas.vigencia`: status, eventos, pendências e transições), `kb relacoes`
 * (`Normas.relacoes`) e das sucessoras de `kb impacto` (`Normas.sucessoras`).
 */
import * as Schema from "effect/Schema";
import { UrlOficial } from "@simplifica-if/kb/normas/fonte";
import { EsquemaLink, NormaResumo, Relacao } from "../contratos.ts";
import { opcional } from "../esquema.ts";
import { linkNorma } from "../links.ts";
import { blocoItem, citacao, comLink, dataBr } from "../texto.ts";
import { definirFerramenta } from "./ferramenta.ts";
import { esquemaData, esquemaIdNorma, limitarTexto, situacaoDaNorma, tetoDoCorpo } from "./normas-comum.ts";

/** Teto do texto para a IA (a especificação não fixa um para esta ferramenta). */
export const TETO_FICHA_NORMA = 12_000;
/** Evidência das relações no texto; o JSON traz o trecho inteiro. */
const TRECHO_RELACAO = 200;

export const Entrada = Schema.Struct({
  id: esquemaIdNorma('ID canônico da norma, como "br/cne-cp/res/2021/1"'),
  em: opcional(esquemaData("data da situação, AAAA-MM-DD (padrão: data de referência da base)")),
});

const Inicio = Schema.Struct({
  data: Schema.NullOr(Schema.String),
  minimo: Schema.NullOr(Schema.String),
  certo: Schema.Boolean,
});

export const Dados = Schema.Struct({
  norma: Schema.Struct({
    ...NormaResumo.fields,
    orgao: Schema.NullOr(Schema.String),
    tipo_documento: Schema.NullOr(Schema.String),
    numero: Schema.NullOr(Schema.String),
    ano: Schema.NullOr(Schema.Int),
    /** URL https do texto oficial; `null` quando a fonte oficial está pendente. */
    fonte_url: Schema.NullOr(UrlOficial),
    /** Referência da fonte sem link (número do SEI, Boletim de Serviço, PDF assinado). */
    fonte_referencia: Schema.NullOr(Schema.String),
    /**
     * Metadados editoriais da curadoria, fora do texto da norma: indicam onde olhar, não fundamentam.
     * `pontos_chave`: o que a norma dispõe, com o dispositivo de cada ponto.
     */
    pontos_chave: Schema.Array(Schema.String),
    /** Como o texto foi obtido e consolidado. */
    notas_da_fonte: Schema.Array(Schema.String),
  }),
  vigencia: Schema.Struct({
    data: Schema.String,
    status: Schema.String,
    certo: Schema.Boolean,
    inicio: Inicio,
    eventos: Schema.Array(
      Schema.Struct({
        tipo: Schema.String,
        origem: Schema.String,
        operador: Schema.NullOr(Schema.String),
        /** Dispositivo atingido, quando a relação é parcial. */
        alvo_dispositivo: Schema.NullOr(Schema.String),
        alcance: Schema.NullOr(Schema.String),
        /** Data em que o evento produz efeito; `null` se a confirmar. */
        efeito_de: Schema.NullOr(Schema.String),
        efeito_minimo: Schema.NullOr(Schema.String),
        /** Na data: "sim", "não" ou "a confirmar". */
        ocorreu: Schema.String,
      }),
    ),
    pendencias: Schema.Array(Schema.String),
  }),
  relacoes: Schema.Struct({ entrada: Schema.Array(Relacao), saida: Schema.Array(Relacao) }),
  sucessoras: Schema.Array(Schema.String),
  transicoes: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      /** Dispositivo que estabelece a regra, com a norma (`br/cne-cp/res/2026/2#art71`). */
      dispositivo: Schema.String,
      tipo: Schema.String,
      norma_anterior: Schema.NullOr(Schema.String),
      aplica_a: Schema.String,
      regra: Schema.String,
      situacao_na_data: Schema.String,
      inicio_em: Schema.NullOr(Schema.String),
      fim_em: Schema.NullOr(Schema.String),
      evidencia: Schema.String,
      link: EsquemaLink,
    }),
  ),
});

export const fichaNorma = definirFerramenta({
  nome: "ficha_norma",
  titulo: "Ficha da norma",
  descricao:
    "Situação de uma norma numa data: a vigência, com o que a determina e o que está a confirmar; as relações com outras normas nos dois sentidos (revoga, altera, regulamenta, fundamenta-se em); as normas sucessoras; as regras de transição; e os pontos-chave da curadoria, que indicam onde olhar e não são fundamento. Use quando a resposta depender de a norma estar em vigor, revogada ou substituída. Norma revogada não é inaplicável: confira as transições antes de concluir.",
  entrada: Entrada,
  dados: Dados,
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
      norma.fonte_url !== null ? `fonte oficial: ${norma.fonte_url}` : "fonte oficial: sem URL registrada",
      norma.fonte_referencia !== null ? `referência da fonte: ${norma.fonte_referencia}` : null,
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
    // depois da vigência e das transições, que o corte do teto não pode levar; as relações, por último
    const editorial = (titulo: string, itens: ReadonlyArray<string>) => {
      if (itens.length) partes.push([`**${titulo}**`, ...itens.map((item) => `- ${item}`)].join("\n"));
    };
    editorial("Pontos-chave (indicação da curadoria, não fundamento; cite o dispositivo):", norma.pontos_chave);
    editorial("Notas da fonte:", norma.notas_da_fonte);
    const linhaRelacao = (r: Relacao) => {
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
