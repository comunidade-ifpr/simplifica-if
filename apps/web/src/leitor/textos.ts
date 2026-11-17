/**
 * Os textos do leitor `ifpr://` (M1.6), em funções puras: o selo de vigência, os nomes das relações
 * entre normas e a "citação" que "Copiar citação" põe na área de transferência (o trecho literal e a
 * referência formal, no feitio da ABNT NBR 6023 para legislação).
 */
import type { LinkLido } from "@simplifica-if/contratos-app";

export type FichaNorma = Extract<LinkLido, { tipo: "norma" }>["resposta"]["dados"];
export type DispositivoLido = Extract<LinkLido, { tipo: "dispositivo" }>["resposta"]["dados"]["dispositivos"][number];
export type Relacao = FichaNorma["relacoes"]["saida"][number];

/* ================================================================== datas */

const FORMATO_DATA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});
const FORMATO_EXTENSO = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const comoData = (iso: string): Date | null => {
  const data = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(data.getTime()) ? null : data;
};

/** `2026-11-12` → "12/11/2026"; o que não é data fica como veio. */
export function dataCurta(iso: string): string {
  const data = comoData(iso);
  return data === null ? iso : FORMATO_DATA.format(data);
}

/** `2026-11-11` → "11 de novembro de 2026". */
export function dataPorExtenso(iso: string): string {
  const data = comoData(iso);
  return data === null ? iso : FORMATO_EXTENSO.format(data);
}

/* ================================================================== selo de vigência */

export type VarianteSelo = "success" | "error" | "warning" | "info";

export interface Selo {
  readonly rotulo: string;
  readonly variante: VarianteSelo;
  /** A explicação, em linguagem comum. */
  readonly detalhe: string;
}

const STATUS: Readonly<Record<string, Omit<Selo, "detalhe"> & { readonly detalhe: (data: string) => string }>> = {
  vigente: { rotulo: "Em vigor", variante: "success", detalhe: (d) => `Em vigor em ${d}.` },
  alterada: {
    rotulo: "Em vigor, com alterações",
    variante: "info",
    detalhe: (d) => `Em vigor em ${d}, com partes alteradas por outras normas.`,
  },
  "parcialmente revogada": {
    rotulo: "Revogada em parte",
    variante: "warning",
    detalhe: (d) => `Em ${d}, parte do texto já foi revogada por outra norma.`,
  },
  revogada: {
    rotulo: "Revogada",
    variante: "error",
    detalhe: (d) =>
      `Revogada em ${d}. Norma revogada ainda pode valer em situações de transição: veja as regras abaixo.`,
  },
  "ainda-nao-vigente": {
    rotulo: "Ainda não está em vigor",
    variante: "warning",
    detalhe: (d) => `Em ${d}, esta norma ainda não estava em vigor.`,
  },
};

/**
 * Os selos da norma na data de referência da base: o estado (em vigor, revogada…) e, quando a data que
 * o decide ainda não está registrada, "Vigência a confirmar", com o motivo.
 */
export function selosDaNorma(ficha: FichaNorma): ReadonlyArray<Selo> {
  const data = dataCurta(ficha.vigencia.data);
  const selos: Selo[] = [];
  if (ficha.norma.situacao !== "base") {
    selos.push({
      rotulo: ficha.norma.situacao === "stub" ? "Sem o texto na base" : "Referência externa",
      variante: "info",
      detalhe: "A base guarda só a referência desta norma, não o texto.",
    });
  }
  const conhecido = STATUS[ficha.vigencia.status];
  if (conhecido !== undefined) {
    selos.push({ rotulo: conhecido.rotulo, variante: conhecido.variante, detalhe: conhecido.detalhe(data) });
  }
  const aConfirmar = !ficha.vigencia.certo || ficha.norma.vigencia_a_confirmar || conhecido === undefined;
  if (aConfirmar) {
    const motivos = ficha.vigencia.pendencias.length > 0 ? ` ${ficha.vigencia.pendencias.join("; ")}.` : "";
    selos.push({
      rotulo: "Vigência a confirmar",
      variante: "warning",
      detalhe: `A data que decide a vigência ainda não está registrada na base; confira na fonte oficial.${motivos}`,
    });
  }
  return selos;
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
    case "encerrada":
      return "encerrada";
    default:
      return "a confirmar";
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

/** A referência formal da norma: "BRASIL. Resolução CNE/CP nº 2/2026, de 11 de novembro de 2026. Ementa. Disponível em: …". */
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
  if (norma.fonte_oficial !== null) partes.push(`Disponível em: ${norma.fonte_oficial}.`);
  return partes.join(" ");
}

const TETO_TRECHO = 2_000;

function trechoLimitado(texto: string): string {
  const limpo = texto.trim();
  return limpo.length <= TETO_TRECHO ? limpo : `${limpo.slice(0, TETO_TRECHO).trimEnd()} […]`;
}

/**
 * A citação de um dispositivo: o texto literal entre aspas, com o caput herdado e "[…]" entre ele e o
 * dispositivo, os incisos e parágrafos subordinados, o nome curto entre parênteses e a referência.
 */
export function citacaoDoDispositivo(opcoes: {
  readonly dispositivo: DispositivoLido;
  readonly norma: FichaNorma["norma"];
  readonly nomeCurto: string;
}): string {
  const { dispositivo, norma, nomeCurto } = opcoes;
  const linhas = [
    ...dispositivo.caput.map((c, i) => (i === dispositivo.caput.length - 1 ? `${c} […]` : c)),
    dispositivo.texto,
    ...dispositivo.subordinados.map((s) => s.texto),
  ];
  return [`“${trechoLimitado(linhas.join("\n"))}”`, `(${nomeCurto})`, "", referenciaDaNorma(norma)].join("\n");
}

/** A citação da norma inteira: só a referência. */
export function citacaoDaNorma(norma: FichaNorma["norma"]): string {
  return referenciaDaNorma(norma);
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
