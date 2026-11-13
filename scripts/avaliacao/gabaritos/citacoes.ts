/**
 * Reconhecimento, em texto de PPC, das citações às DCN da EPT usadas nos gabaritos Q02 e Q20.
 * É uma heurística provisória, versionada e testada; o resolvedor de citações da fase 2 a substitui.
 *
 * Cobre as grafias observadas nos 202 PPCs em 13/11/2026: "Resolução CNE/CP nº 1/2021",
 * "CNE/CP n. 01/2021", "CNE/CP nº 01 de 05 dejaneiro de 2021" (quebra de OCR),
 * "Resolução nº 1, de 5 de janeiro de 2021 (CNE/CP)" e citações com o tipo trocado
 * ("Parecer CNE/CP nº 01/2021, que define as Diretrizes...") ou o órgão trocado
 * ("Resolução CNE/CEB nº 1/2021, que define as Diretrizes Curriculares Nacionais Gerais para a
 * Educação Profissional e Tecnológica"), contadas como citação do ato quando "educação
 * profissional" aparece logo depois. Não conta a CNE/CEB nº 1/2021 sem esse contexto (diretrizes
 * da EJA) nem a CNE/CP nº 5/2021.
 */
import { textoCorrido } from "./fontes.ts";

const NUMERO = String.raw`(?:(?:numero|n\.?\s?o?)\.?\s*)?`;

const CNE_CP_1_2021 = [
  new RegExp(
    String.raw`cne\s*/?\s*cp\W{0,4}${NUMERO}0*1(?!\d)\s*(?:/\s*2021|[.,]?\s*(?:de\s*)?(?:0?5\s*)?(?:de\s*)?janeiro\s*de\s*2021)`,
    "gu",
  ),
  new RegExp(String.raw`resolucao\W{0,4}${NUMERO}0*1\s*,?\s*de\s*0?5\s*de\s*janeiro\s*de\s*2021`, "gu"),
  new RegExp(
    String.raw`(?:cne|educacao)\s*/\s*ceb\W{0,4}${NUMERO}0*1(?!\d)\s*/\s*2021[^|]{0,100}?educacao\s*-?\s*profissional`,
    "gu",
  ),
];

const CNE_CP_2_2026 = [
  new RegExp(
    String.raw`cne\s*/?\s*cp\W{0,4}${NUMERO}0*2(?!\d)\s*(?:/\s*2026|[.,]?\s*(?:de\s*)?(?:11\s*)?(?:de\s*)?novembro\s*de\s*2026)`,
    "gu",
  ),
  new RegExp(String.raw`resolucao\W{0,4}${NUMERO}0*2\s*,?\s*de\s*11\s*de\s*novembro\s*de\s*2026`, "gu"),
];

function trechos(texto: string, padroes: readonly RegExp[]): string[] {
  const corrido = textoCorrido(texto);
  const achados = new Set<string>();
  for (const padrao of padroes) {
    for (const casamento of corrido.matchAll(padrao)) achados.add(casamento[0]);
  }
  return [...achados].sort();
}

/** Trechos normalizados que citam a Resolução CNE/CP nº 1/2021 (vazio se não cita). */
export function citacoesCneCp1de2021(texto: string): string[] {
  return trechos(texto, CNE_CP_1_2021);
}

/** Trechos normalizados que citam a Resolução CNE/CP nº 2/2026 (vazio se não cita). */
export function citacoesCneCp2de2026(texto: string): string[] {
  return trechos(texto, CNE_CP_2_2026);
}
