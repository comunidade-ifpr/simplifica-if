/**
 * Os metadados editoriais do front matter (`pontos_chave`): os artigos que um item
 * cita no parêntese final, "(art. 29; arts. 48 a 53)", para o `validar_base` conferir que a norma os
 * tem. Só o parêntese final é da própria norma; no meio do item, um artigo pode ser de outra. O
 * parêntese que nomeia outro ato ("(Lei nº 9.394/1996, art. 26)") não é conferido.
 */
const RE_PARENTESE_FINAL = /\(([^()]*\b[Aa]rts?\.[^()]*)\)[.;]?\s*$/;
const RE_OUTRO_ATO =
  /\b(?:Lei|Decreto|Resolução|Portaria|Parecer|Medida Provisória|Instrução Normativa|Nota Técnica|Constituição)\b/;
const NUMERO = String.raw`\d+[º°o]?(?:-[A-Z])?`;
/** Depois de `art.`, os números em lista ou faixa, com incisos no meio: "5º, I; e 7º", "3º ao 5º". */
const RE_ARTIGOS = new RegExp(
  String.raw`\b[Aa]rts?\.\s*(${NUMERO}(?:(?:\s*,\s*[IVXLC]+\b)*\s*(?:;\s*e|,|e|ao|a)\s*${NUMERO})*)`,
  "g",
);

/** Os artigos citados no parêntese final do item, como no ID do dispositivo: `29`, `36A`. */
export function artigosCitados(item: string): string[] {
  const parentese = RE_PARENTESE_FINAL.exec(item)?.[1];
  if (parentese === undefined || RE_OUTRO_ATO.test(parentese)) return [];
  const artigos: string[] = [];
  for (const m of parentese.matchAll(RE_ARTIGOS)) {
    // o inciso romano não tem dígito: só os números de artigo casam
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
