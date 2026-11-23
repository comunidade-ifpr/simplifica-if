/**
 * Os metadados editoriais do front matter (`pontos_chave`): os artigos que um item
 * cita no parêntese final, "(art. 29; arts. 48 a 53)", para o `validar_base` conferir que a norma os
 * tem. Só o parêntese final é da própria norma; no meio do item, um artigo pode ser de outra.
 */
const RE_PARENTESE_FINAL = /\(([^()]*\barts?\.[^()]*)\)[.;]?\s*$/i;
const RE_ARTIGOS = /\barts?\.\s*(\d+[º°o]?(?:-[A-Z])?(?:\s*(?:,|e|a)\s*\d+[º°o]?(?:-[A-Z])?)*)/gi;

/** Os artigos citados no parêntese final do item, como no ID do dispositivo: `29`, `36A`. */
export function artigosCitados(item: string): string[] {
  const parentese = RE_PARENTESE_FINAL.exec(item)?.[1];
  if (parentese === undefined) return [];
  const artigos: string[] = [];
  for (const m of parentese.matchAll(RE_ARTIGOS)) {
    for (const n of m[1]!.matchAll(/(\d+)[º°o]?(?:-([A-Z]))?/g)) artigos.push(`${n[1]}${n[2] ?? ""}`);
  }
  return artigos;
}

/** Os artigos citados que a norma não tem, pelos sufixos dos dispositivos dela (`#art29`, `#anexo1-art3`). */
export function artigosInexistentes(
  item: string,
  dispositivos: ReadonlyArray<{ readonly dispositivo: string }>,
): string[] {
  const existentes = new Set(
    dispositivos.flatMap((d) => {
      const m = /(?:^#|-)art(\d+[A-Z]?)$/.exec(d.dispositivo);
      return m ? [m[1]!] : [];
    }),
  );
  return artigosCitados(item).filter((artigo) => !existentes.has(artigo));
}
