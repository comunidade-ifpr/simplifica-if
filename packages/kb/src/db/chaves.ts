/** As chaves com prefixo das tabelas do `kb.sqlite`: aceitam o ID com ou sem o prefixo. */

/** `campus/curso` ou `ppc:campus/curso` → `ppc:campus/curso`. */
export function idPpc(valor: string): string {
  return valor.startsWith("ppc:") ? valor : `ppc:${valor}`;
}

/** `slug` ou `cnct:slug` → `cnct:slug`. */
export function idCnct(valor: string): string {
  return valor.startsWith("cnct:") ? valor : `cnct:${valor}`;
}
