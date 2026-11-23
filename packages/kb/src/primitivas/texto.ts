/**
 * Operações de texto Unicode sem equivalente direto em JavaScript.
 *
 * - `casefold` não é `toLowerCase()`: `ß` vira `ss`, `ﬁ` vira `fi`, os
 *   minúsculos cherokee viram maiúsculos etc. (tabela em `unicode-dados.ts`).
 * - `dividirEspacos` separa em qualquer espaço Unicode (o conjunto `ESPACOS`
 *   de `../texto.ts`), sem partes vazias.
 * - `ehDigito` inclui dígitos não decimais (sobrescritos, circulados).
 */
import { aparar, ESPACOS } from "../texto.ts";
import { CASEFOLD_ESPECIAL, DIGITOS_NAO_DECIMAIS } from "./unicode-dados.ts";

const CASEFOLD = new Map<number, string>(CASEFOLD_ESPECIAL);

/** Case folding completo, para comparar textos sem caixa. */
export function casefold(texto: string): string {
  let saida = "";
  for (const caractere of texto) {
    const especial = CASEFOLD.get(caractere.codePointAt(0)!);
    saida += especial ?? caractere.toLowerCase();
  }
  return saida;
}

const RE_ESPACOS = new RegExp(`[${ESPACOS}]+`, "u");

/** Partes separadas por espaços Unicode, sem partes vazias. */
export function dividirEspacos(texto: string): string[] {
  const aparado = aparar(texto);
  return aparado ? aparado.split(RE_ESPACOS) : [];
}

/** Colapsa espaços e apara as pontas. */
export function colapsarEspacos(texto: string): string {
  return dividirEspacos(texto).join(" ");
}

const RE_MARCA_NAO_ESPACADORA = /\p{Mn}/gu;

/** Tira as marcas combinantes (categoria `Mn`) depois da decomposição NFD: acentos e cedilhas. */
export function semMarcas(texto: string): string {
  return texto.normalize("NFD").replace(RE_MARCA_NAO_ESPACADORA, "");
}

/** Decomposição NFKD sem o que não é ASCII. */
export function asciiNfkd(texto: string): string {
  return texto.normalize("NFKD").replace(/[^\x00-\x7f]/g, "");
}

const RE_DIGITO = new RegExp(`^[\\p{Nd}${DIGITOS_NAO_DECIMAIS}]$`, "u");

/** Dígito de um code point, decimal ou não (sobrescritos, circulados). */
export function ehDigito(caractere: string): boolean {
  return RE_DIGITO.test(caractere);
}

/** Só os dígitos do texto (como `ehDigito`). */
export function somenteDigitos(texto: string): string {
  return Array.from(texto)
    .filter((caractere) => ehDigito(caractere))
    .join("");
}
