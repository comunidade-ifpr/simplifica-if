/**
 * Identidade dos PPCs da base. Cada PPC que entra na base ganha um ID permanente,
 * `ppc:<campus_id>/<curso_slug>/<versao>`, e não sai mais: o PPC novo de um curso entra como versão
 * nova e o anterior fica, substituído. A versão é o ano do documento (`2023`), com sufixo quando o
 * curso tem dois PPCs do mesmo ano (`2023-2`).
 *
 * A chave (`<campus_id>/<curso_slug>/<versao>`) é o ID sem o prefixo `ppc:`; é ela que vai em
 * links (`ifpr://ppc/...`), nas seções e nas ferramentas. A chave do curso (`<campus_id>/<curso_slug>`)
 * vale como atalho para o PPC vigente do curso.
 */
export const RE_SLUG_PPC = "[a-z0-9]+(?:-[a-z0-9]+)*";
export const RE_VERSAO_PPC = "[0-9]{4}(?:-[2-9]|-[1-9][0-9]+)?";
const RE_CHAVE = new RegExp(`^(${RE_SLUG_PPC})/(${RE_SLUG_PPC})(?:/(${RE_VERSAO_PPC}))?$`);

export const PASTA_PPCS = "institucional/ifpr/ppcs";

export type PartesPpc = { campusId: string; cursoSlug: string; versao: string };

export function chavePpc(campusId: string, cursoSlug: string, versao: string): string {
  return `${campusId}/${cursoSlug}/${versao}`;
}

export function idPpc(campusId: string, cursoSlug: string, versao: string): string {
  return `ppc:${chavePpc(campusId, cursoSlug, versao)}`;
}

/** Caminho do Markdown do PPC, relativo a `base-conhecimento/`. */
export function caminhoPpc(campusId: string, cursoSlug: string, versao: string): string {
  return `${PASTA_PPCS}/${campusId}/${cursoSlug}/${versao}.md`;
}

/**
 * Campus, curso e versão de uma referência a PPC: a chave, o ID (`ppc:`), o link (`ifpr://ppc/`) ou a
 * chave do curso (sem versão: `versao` fica `undefined`, e quem consulta resolve para o vigente).
 * `null` se não for referência a PPC.
 */
export function analisarReferenciaPpc(valor: string): { campusId: string; cursoSlug: string; versao?: string } | null {
  const chave = valor.replace(/^ifpr:\/\/ppc\//, "").replace(/^ppc:/, "");
  const m = RE_CHAVE.exec(chave);
  if (!m) return null;
  return { campusId: m[1]!, cursoSlug: m[2]!, ...(m[3] ? { versao: m[3] } : {}) };
}

/** Partes de um caminho `institucional/ifpr/ppcs/<campus>/<curso>/<versao>.md`; `null` se não for um. */
export function partesDoCaminhoPpc(caminho: string): PartesPpc | null {
  const m = new RegExp(`^${PASTA_PPCS}/(${RE_SLUG_PPC})/(${RE_SLUG_PPC})/(${RE_VERSAO_PPC})\\.md$`).exec(caminho);
  return m ? { campusId: m[1]!, cursoSlug: m[2]!, versao: m[3]! } : null;
}

/** Ordem das versões de um curso: por ano e, no mesmo ano, pelo sufixo. */
export function compararVersoesPpc(a: string, b: string): number {
  const [anoA, sufA] = a.split("-");
  const [anoB, sufB] = b.split("-");
  return Number(anoA) - Number(anoB) || Number(sufA ?? 1) - Number(sufB ?? 1);
}
