/** As chaves com prefixo das tabelas do `kb.sqlite`: aceitam o ID com ou sem o prefixo. */

/** `campus/curso/versao` ou `ppc:campus/curso/versao` → `ppc:campus/curso/versao`. */
export function idPpc(valor: string): string {
  return valor.startsWith("ppc:") ? valor : `ppc:${valor}`;
}

/**
 * Subconsulta que resolve uma referência a PPC para o ID na tabela `ppcs`: o ID da versão
 * (`campus/curso/versao`, com ou sem `ppc:`) ou a chave do curso (`campus/curso`), que vale pelo PPC
 * vigente dele. Os parâmetros saem de `parametrosPpc`.
 */
export const SQL_PPC = "(SELECT id FROM ppcs WHERE id = ? OR (chave_curso = ? AND vigente = 1))";

export function parametrosPpc(valor: string): [string, string] {
  const chave = valor.replace(/^ppc:/, "");
  return [`ppc:${chave}`, chave];
}

/** `slug` ou `cnct:slug` → `cnct:slug`. */
export function idCnct(valor: string): string {
  return valor.startsWith("cnct:") ? valor : `cnct:${valor}`;
}
