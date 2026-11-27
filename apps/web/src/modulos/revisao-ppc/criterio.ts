/**
 * Os textos da ficha de um critério (`FichaCriterio`), em linguagem de quem revisa: a criticidade, como o
 * app confere (o modo traduzido), o estado do critério neste PPC e o texto que vai à conversa ao lado na
 * ficha da pendência.
 */
import type { EstadoCriterio, FichaCriterio } from "@simplifica-if/contratos-app/modulos/revisao-ppc";

const CRITICIDADES: Readonly<Record<string, string>> = {
  BLOQ: "Bloqueia a submissão",
  OBRIG: "Obrigatório",
  REC: "Recomendado",
};

/** A criticidade da ficha (`BLOQ`, `OBRIG`, `REC`) por extenso. */
export const nomeCriticidade = (criticidade: string): string => CRITICIDADES[criticidade] ?? criticidade;

const ESTADOS: Readonly<Record<EstadoCriterio, string>> = {
  nao_atende: "para corrigir",
  a_conferir: "para conferir",
  atende: "em ordem",
  nao_se_aplica: "não se aplica",
  nao_lido: "ainda não lido",
};

/** O estado de um critério na régua, por extenso ("para corrigir", "em ordem"). */
export const nomeEstadoCriterio = (estado: EstadoCriterio): string => ESTADOS[estado];

/** "a, b e c". */
function emLista(itens: ReadonlyArray<string>): string {
  return itens.length <= 1 ? (itens[0] ?? "") : `${itens.slice(0, -1).join(", ")} e ${itens.at(-1)}`;
}

/** Como o app confere o critério, em uma frase. */
export function comoConfere(ficha: Pick<FichaCriterio, "modo" | "secoes">): string {
  if (ficha.modo === "D") return "o app confere sozinho, sem IA.";
  if (ficha.modo === "S") return "o app acha o trecho no PPC, e a IA confirma o que ele diz.";
  const secoes = ficha.secoes.length === 0 ? "do PPC" : `de ${emLista(ficha.secoes)}`;
  return `a IA julga as seções ${secoes}; o app confere o trecho e as normas citadas.`;
}

/**
 * O nome de uma referência do "Por que": a norma pelo nome curto do link (`nomeCurto`), ou pelo título da
 * base quando o nome curto é só "Norma"; o CNCT e a referência externa, pelo título.
 */
export function nomeDaReferencia(
  n: Pick<FichaCriterio["normas"][number], "norma" | "tipo" | "titulo">,
  nomeCurto: (link: string) => string,
): string {
  const curto = n.tipo === "norma" ? nomeCurto(`ifpr://norma/${n.norma}`) : null;
  return (curto === "Norma" ? null : curto) ?? n.titulo ?? n.norma.replace(/^(externo|cnct):/, "");
}

/** O critério como vai na ficha da pendência, na conversa ao lado: o que confere e o que conta. */
export function textoDoCriterio(ficha: FichaCriterio): string {
  return [
    `Critério da revisão: ${ficha.id} — ${ficha.titulo}${ficha.criticidade === null ? "" : ` (${nomeCriticidade(ficha.criticidade)})`}`,
    ficha.pergunta === null ? "" : `O que confere: ${ficha.pergunta}`,
    ficha.atendido === null ? "" : `Conta como atendido: ${ficha.atendido}`,
    ficha.naoAtendido === null ? "" : `Não atendido: ${ficha.naoAtendido}`,
    ficha.aConferir === null ? "" : `Fica “a conferir” quando: ${ficha.aConferir}`,
  ]
    .filter(Boolean)
    .join("\n");
}
