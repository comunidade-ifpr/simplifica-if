/**
 * Métodos de `str` do Python sem equivalente direto em JavaScript.
 *
 * - `casefold()` não é `toLowerCase()`: `ß` vira `ss`, `ﬁ` vira `fi`, os
 *   minúsculos cherokee viram maiúsculos etc. (tabela em `unicode-dados.ts`).
 * - `split()` sem argumento separa em qualquer espaço Unicode do Python
 *   (o conjunto `ESPACOS` de `../texto.ts`), sem partes vazias.
 * - `isdigit()` inclui dígitos não decimais (sobrescritos, circulados).
 */
import { aparar, ESPACOS } from "../texto.ts";
import { CASEFOLD_ESPECIAL, DIGITOS_NAO_DECIMAIS } from "./unicode-dados.ts";

const CASEFOLD = new Map<number, string>(CASEFOLD_ESPECIAL);

/** `str.casefold()`. */
export function casefold(texto: string): string {
  let saida = "";
  for (const caractere of texto) {
    const especial = CASEFOLD.get(caractere.codePointAt(0)!);
    saida += especial ?? caractere.toLowerCase();
  }
  return saida;
}

const RE_ESPACOS = new RegExp(`[${ESPACOS}]+`, "u");

/** `str.split()` sem argumento. */
export function dividirEspacos(texto: string): string[] {
  const aparado = aparar(texto);
  return aparado ? aparado.split(RE_ESPACOS) : [];
}

/** `" ".join(texto.split())`: colapsa espaços e apara as pontas. */
export function colapsarEspacos(texto: string): string {
  return dividirEspacos(texto).join(" ");
}

const RE_MARCA_NAO_ESPACADORA = /\p{Mn}/gu;

/** `"".join(c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn")`. */
export function semMarcas(texto: string): string {
  return texto.normalize("NFD").replace(RE_MARCA_NAO_ESPACADORA, "");
}

/** `unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii")`. */
export function asciiNfkd(texto: string): string {
  return texto.normalize("NFKD").replace(/[^\x00-\x7f]/g, "");
}

const RE_DIGITO = new RegExp(`^[\\p{Nd}${DIGITOS_NAO_DECIMAIS}]$`, "u");

/** `caractere.isdigit()` para um code point. */
export function ehDigito(caractere: string): boolean {
  return RE_DIGITO.test(caractere);
}

/** `"".join(c for c in texto if c.isdigit())`. */
export function somenteDigitos(texto: string): string {
  return Array.from(texto)
    .filter((caractere) => ehDigito(caractere))
    .join("");
}
