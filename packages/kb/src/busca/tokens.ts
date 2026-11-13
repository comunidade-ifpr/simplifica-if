/**
 * Termos da busca textual: a mesma função gera a coluna auxiliar de radicais (na compilação do
 * `kb.sqlite`) e os termos da consulta, para que indexação e consulta não divirjam.
 *
 * - Tokens como os do tokenizador `unicode61` do FTS5: sequências de letras e dígitos.
 * - Minúsculas; palavras vazias (stopwords) de português ficam de fora.
 * - Radical Snowball (`stemmer.ts`) calculado com acentos e depois sem eles, como o
 *   `remove_diacritics 2` do FTS5 faz com o texto original.
 */
import { radical } from "./stemmer.ts";

/** Palavras vazias de português (lista curta, conferida contra as consultas da avaliação). */
export const PALAVRAS_VAZIAS = new Set(
  (
    "a à ao aos as às até com como da das de dela dele do dos e é em entre era essa esse esta este " +
    "eu foi há isso isto já la lhe mais mas me mesmo na nas nem no nos o os ou para pela pelas pelo " +
    "pelos por qual quando que se sem ser seu seus sua suas são também te tem um uma umas uns " +
    "sobre seja sejam ser será serão onde"
  ).split(" "),
);

const RE_TOKEN = /[\p{L}\p{N}]+/gu;

/** Remove acentos (NFKD sem marcas combinantes). */
export function semDiacriticos(texto: string): string {
  return texto.normalize("NFKD").replace(/\p{M}/gu, "");
}

/** Tokens em minúsculas, na ordem do texto (com repetições e palavras vazias). */
export function tokens(texto: string): string[] {
  return [...texto.toLowerCase().normalize("NFC").matchAll(RE_TOKEN)].map((m) => m[0]);
}

/** Radical sem acentos de um token em minúsculas; números ficam como estão. */
export function radicalDoToken(token: string): string {
  if (/^\p{N}+$/u.test(token)) return token;
  return semDiacriticos(radical(token));
}

/** Tokens sem palavras vazias. */
export function termos(texto: string): string[] {
  return tokens(texto).filter((t) => !PALAVRAS_VAZIAS.has(t));
}

/** Radicais do texto, sem palavras vazias, na ordem (coluna auxiliar do FTS5). */
export function radicais(texto: string): string[] {
  return termos(texto).map(radicalDoToken);
}

/** Termo citado para a sintaxe de consulta do FTS5 (aspas duplas, sem operadores). */
export function termoFts(termo: string): string {
  return `"${termo.replaceAll('"', '""')}"`;
}
