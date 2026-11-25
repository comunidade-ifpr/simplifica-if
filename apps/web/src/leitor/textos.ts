/**
 * Os textos do leitor `ifpr://` (M1.6), em funções puras: o selo de vigência, os nomes das relações
 * entre normas e a "citação" que "Copiar citação" põe na área de transferência (o trecho literal e a
 * referência formal, no feitio da ABNT NBR 6023 para legislação).
 */
import type { LinkLido } from "@simplifica-if/contratos-app";
import type { Vigencia } from "../explorar/colecoes.ts";
import { dataCurta, dataPorExtenso } from "../lib/formato.ts";

export type FichaNorma = Extract<LinkLido, { tipo: "norma" }>["resposta"]["dados"];
export type DispositivoLido = Extract<LinkLido, { tipo: "dispositivo" }>["resposta"]["dados"]["dispositivos"][number];
export type Relacao = FichaNorma["relacoes"]["saida"][number];

/* ================================================================== selo de vigência */

export type VarianteSelo = "success" | "error" | "warning" | "info";

export interface Selo {
  readonly rotulo: string;
  readonly variante: VarianteSelo;
  /** A explicação, em linguagem comum. */
  readonly detalhe: string;
  /** A forma do sinal de vigência (`explorar/Vigencia.tsx`); `null` no selo que não é de vigência. */
  readonly sinal: Vigencia | null;
}

const STATUS: Readonly<
  Record<
    string,
    {
      readonly rotulo: string;
      readonly variante: VarianteSelo;
      readonly estado: string;
      readonly sinal: Vigencia | null;
    }
  >
> = {
  vigente: { rotulo: "Em vigor", variante: "success", estado: "em vigor", sinal: "vigente" },
  alterada: {
    rotulo: "Em vigor, com alterações",
    variante: "info",
    estado: "em vigor, com partes alteradas por outras normas",
    sinal: "alterada",
  },
  "parcialmente revogada": {
    rotulo: "Revogada em parte",
    variante: "warning",
    estado: "revogada em parte",
    sinal: "parcialmente revogada",
  },
  revogada: { rotulo: "Revogada", variante: "error", estado: "revogada", sinal: "revogada" },
  "ainda-nao-vigente": {
    rotulo: "Ainda não está em vigor",
    variante: "warning",
    estado: "ainda não está em vigor",
    sinal: "ainda-nao-vigente",
  },
};

/** Quando o estado da norma passou a valer: o efeito do evento que o decide, ou o início da vigência. */
function quandoDoEstado(ficha: FichaNorma): string | null {
  const { status, eventos, inicio } = ficha.vigencia;
  const tipo =
    status === "revogada" || status === "parcialmente revogada" ? "revoga" : status === "alterada" ? "altera" : null;
  if (tipo !== null) {
    const evento = eventos.filter((e) => e.tipo === tipo && e.ocorreu !== "não").at(-1);
    // sem relação registrada, o estado vem do próprio texto (dispositivo revogado, nota de redação)
    if (evento === undefined) return "É o que o texto consolidado mostra; os atos estão em “Alterada por”.";
    const nome = tipo === "revoga" ? "Revogação" : "Alteração";
    return evento.efeito_de === null ? null : `${nome} com efeito em ${dataCurta(evento.efeito_de)}.`;
  }
  if (inicio.aguardando) return "Assinada e ainda não publicada: entra em vigor com a publicação.";
  if ((status === "vigente" || status === "ainda-nao-vigente") && inicio.data !== null) {
    return `Início da vigência: ${dataCurta(inicio.data)}.`;
  }
  return null;
}

/**
 * Os selos da norma no dia da consulta: o estado (em vigor, revogada, ainda não em vigor…) e, quando a
 * base não o conferiu (stub com status "a confirmar"), "Vigência a confirmar". O detalhe diz em que dia
 * o estado foi calculado, e a data do evento à parte (o dia da consulta não é o da revogação).
 */
export function selosDaNorma(ficha: FichaNorma): ReadonlyArray<Selo> {
  const dia = dataCurta(ficha.vigencia.data);
  const selos: Selo[] = [];
  if (ficha.norma.situacao !== "base") {
    selos.push({
      rotulo: ficha.norma.situacao === "stub" ? "Sem o texto na base" : "Referência externa",
      variante: "info",
      detalhe: "A base guarda só a referência desta norma, não o texto.",
      sinal: null,
    });
  }
  const conhecido = STATUS[ficha.vigencia.status];
  if (conhecido !== undefined) {
    const quando = quandoDoEstado(ficha);
    const transicao =
      ficha.vigencia.status === "revogada"
        ? " Norma revogada ainda pode valer em situações de transição: veja as regras abaixo."
        : "";
    selos.push({
      rotulo: conhecido.rotulo,
      variante: conhecido.variante,
      sinal: conhecido.sinal,
      detalhe: `Em ${dia}: ${conhecido.estado}.${quando === null ? "" : ` ${quando}`}${transicao}`,
    });
  }
  if (conhecido === undefined) {
    selos.push({
      rotulo: "Vigência a confirmar",
      variante: "warning",
      sinal: "a confirmar",
      detalhe: "A base não conferiu a situação desta norma; confira na fonte oficial.",
    });
  }
  return selos;
}

/* ================================================================== datas do ato */

/**
 * As datas do ato para o cabeçalho: "Ato de 11/11/2026" (a assinatura, ou a data registrada da norma) e
 * a publicação só quando a norma a registra, como está ("Publicação no DOU: a confirmar"). A data
 * registrada da norma (`data_publicacao`) é a do ato em boa parte da base, e não a da publicação.
 */
export function datasDoCabecalho(
  norma: Pick<FichaNorma["norma"], "id" | "data_publicacao">,
  datas: { readonly assinada_em: string | null; readonly publicada_em: string | null } | null,
): ReadonlyArray<string> {
  const partes: string[] = [];
  const ato = datas?.assinada_em ?? norma.data_publicacao;
  if (ato !== null) partes.push(`Ato de ${dataCurta(ato)}`);
  if (datas !== null && datas.publicada_em !== null) {
    const onde = norma.id.startsWith("br/") ? "Publicação no DOU" : "Publicação oficial";
    const quando = /^\d{4}-\d{2}-\d{2}/.test(datas.publicada_em) ? dataCurta(datas.publicada_em) : datas.publicada_em;
    partes.push(`${onde}: ${quando}`);
  }
  return partes;
}

/* ================================================================== relações */

/** Como a relação se lê do lado desta norma: "Revoga" (ela é a origem) ou "Revogada por" (o alvo). */
const RELACOES: Readonly<Record<string, { readonly saida: string; readonly entrada: string }>> = {
  revoga: { saida: "Revoga", entrada: "Revogada por" },
  altera: { saida: "Altera", entrada: "Alterada por" },
  regulamenta: { saida: "Regulamenta", entrada: "Regulamentada por" },
  "fundamenta-se-em": { saida: "Fundamenta-se em", entrada: "Serve de fundamento a" },
};

export function nomeDaRelacao(tipo: string, sentido: "saida" | "entrada"): string {
  return RELACOES[tipo]?.[sentido] ?? tipo.replace(/-/g, " ");
}

/** As situações de uma regra de transição na data, em linguagem comum. */
export function situacaoDaTransicao(situacao: string): string {
  switch (situacao) {
    case "a-iniciar":
      return "ainda não começou";
    case "em-curso":
      return "em curso";
    default:
      return "encerrada";
  }
}

/* ================================================================== citação */

/** Quem emite a norma, pelo prefixo do ID: `br/` é a União, `ifpr/` o Instituto. */
function autoria(id: string): string | null {
  if (id.startsWith("br/")) return "BRASIL";
  if (id.startsWith("ifpr/")) return "INSTITUTO FEDERAL DO PARANÁ";
  if (id.startsWith("pr/")) return "PARANÁ";
  return null;
}

const comPonto = (texto: string) => (/[.!?]$/.test(texto.trim()) ? texto.trim() : `${texto.trim()}.`);

/** A referência formal da norma: "BRASIL. Resolução CNE/CP nº 2/2026, de 11 de novembro de 2026. Ementa. Referência da fonte. Disponível em: …". */
export function referenciaDaNorma(norma: FichaNorma["norma"]): string {
  const partes: string[] = [];
  const autor = autoria(norma.id);
  if (autor !== null) partes.push(`${autor}.`);
  const titulo =
    norma.data_publicacao !== null && !/\bde \d{1,2} de /.test(norma.titulo)
      ? `${norma.titulo}, de ${dataPorExtenso(norma.data_publicacao)}`
      : norma.titulo;
  partes.push(comPonto(titulo));
  if (norma.ementa !== null && norma.ementa.trim() !== "") partes.push(comPonto(norma.ementa));
  if (norma.fonte_referencia !== null) partes.push(comPonto(norma.fonte_referencia));
  if (norma.fonte_url !== null) partes.push(`Disponível em: ${norma.fonte_url}.`);
  return partes.join(" ");
}

const TETO_TRECHO = 2_000;

/** O trecho até `TETO_TRECHO` caracteres, cortado no último espaço antes do limite (sem partir palavra). */
export function trechoLimitado(texto: string): string {
  const limpo = texto.trim();
  if (limpo.length <= TETO_TRECHO) return limpo;
  const corte = limpo.slice(0, TETO_TRECHO + 1);
  const espaco = corte.search(/\s\S*$/);
  return `${(espaco > 0 ? corte.slice(0, espaco) : corte.slice(0, TETO_TRECHO)).trimEnd()} […]`;
}

/**
 * A citação de um dispositivo: o texto literal entre aspas, com o caput herdado e "[…]" em cada salto
 * (do caput do artigo ao parágrafo, do parágrafo ao inciso: o que fica entre eles foi omitido), os
 * incisos e parágrafos subordinados, o nome curto entre parênteses e a referência.
 */
export function citacaoDoDispositivo(opcoes: {
  readonly dispositivo: DispositivoLido;
  readonly norma: FichaNorma["norma"];
  readonly nomeCurto: string;
}): string {
  const { dispositivo, norma, nomeCurto } = opcoes;
  const linhas = [
    ...dispositivo.caput.map((c) => `${c} […]`),
    dispositivo.texto,
    ...dispositivo.subordinados.map((s) => s.texto),
  ];
  return [`“${trechoLimitado(linhas.join("\n"))}”`, `(${nomeCurto})`, "", referenciaDaNorma(norma)].join("\n");
}

/** A citação de um PPC ou de uma seção dele. */
export function citacaoDoPpc(opcoes: {
  readonly curso: string;
  readonly campus: string;
  readonly secao?: { readonly titulo: string; readonly texto: string } | undefined;
}): string {
  const curso = opcoes.curso.trim();
  const referencia = `INSTITUTO FEDERAL DO PARANÁ. Campus ${opcoes.campus}. Projeto Pedagógico do Curso ${curso}.`;
  if (opcoes.secao === undefined) return referencia;
  return [
    `“${trechoLimitado(opcoes.secao.texto)}”`,
    `(PPC do curso ${curso}, Campus ${opcoes.campus}, seção “${opcoes.secao.titulo}”)`,
    "",
    referencia,
  ].join("\n");
}
