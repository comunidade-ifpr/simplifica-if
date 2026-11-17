/**
 * `urllib.parse.quote` e `Path.as_uri()` do Python.
 *
 * O `pathToFileURL` do Node não codifica `!$&'()*+,;=:@` e outros caracteres
 * que o Python codifica: aqui só letras e dígitos ASCII, `_.-~` e os
 * caracteres de `seguros` ficam como estão; o resto vira `%XX` (UTF-8, hexa
 * maiúsculo).
 */

const SEMPRE_SEGUROS = /^[A-Za-z0-9_.\-~]$/;

/** `urllib.parse.quote(texto, safe=seguros)`. */
export function quote(texto: string, seguros = "/"): string {
  const conjunto = new Set(seguros);
  let saida = "";
  for (const caractere of texto) {
    if (SEMPRE_SEGUROS.test(caractere) || (caractere.length === 1 && caractere < "\x80" && conjunto.has(caractere))) {
      saida += caractere;
      continue;
    }
    for (const byte of new TextEncoder().encode(caractere)) {
      saida += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return saida;
}

/** `PosixPath(caminho).as_uri()` (Python 3.14) para um caminho absoluto. */
export function caminhoComoUri(caminho: string): string {
  if (!caminho.startsWith("/")) throw new Error("ValueError: relative paths can't be expressed as file URIs");
  // `PurePosixPath`: exatamente duas barras iniciais formam a raiz (uma ou três ou mais viram uma só),
  // e barras repetidas e componentes `.` somem.
  const raiz = caminho.startsWith("//") && !caminho.startsWith("///") ? "//" : "/";
  const partes = caminho.split("/").filter((parte) => parte !== "" && parte !== ".");
  return `file://${raiz}${quote(partes.join("/"))}`;
}
