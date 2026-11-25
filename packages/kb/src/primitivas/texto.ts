/**
 * Operações de texto Unicode sem equivalente direto em JavaScript.
 *
 * - `dividirEspacos` separa em qualquer espaço Unicode (o conjunto `ESPACOS`
 *   de `../texto.ts`), sem partes vazias.
 * - `semMarcas` tira as marcas combinantes (acentos e cedilhas) depois da decomposição NFD.
 */
import { aparar, ESPACOS } from "../texto.ts";

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
