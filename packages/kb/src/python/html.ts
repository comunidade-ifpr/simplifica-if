/**
 * `html.escape` do Python e as regras de `html.unescape` para referências
 * numéricas.
 *
 * O `escape` do Python troca `'` por `&#x27;` (e não por `&#39;` nem `&apos;`),
 * diferente das funções de escape de bibliotecas JavaScript.
 */

/** `html.escape(texto, quote=aspas)`. */
export function escapeHtml(texto: string, aspas = true): string {
  let saida = texto.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  if (aspas) saida = saida.replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
  return saida;
}

/** `_invalid_charrefs` de `html/__init__.py`: referências numéricas trocadas por outro caractere. */
const REFERENCIAS_INVALIDAS = new Map<number, string>([
  [0x00, "�"],
  [0x0d, "\r"],
  [0x80, "€"],
  [0x81, "\x81"],
  [0x82, "‚"],
  [0x83, "ƒ"],
  [0x84, "„"],
  [0x85, "…"],
  [0x86, "†"],
  [0x87, "‡"],
  [0x88, "ˆ"],
  [0x89, "‰"],
  [0x8a, "Š"],
  [0x8b, "‹"],
  [0x8c, "Œ"],
  [0x8d, "\x8d"],
  [0x8e, "Ž"],
  [0x8f, "\x8f"],
  [0x90, "\x90"],
  [0x91, "‘"],
  [0x92, "’"],
  [0x93, "“"],
  [0x94, "”"],
  [0x95, "•"],
  [0x96, "–"],
  [0x97, "—"],
  [0x98, "˜"],
  [0x99, "™"],
  [0x9a, "š"],
  [0x9b, "›"],
  [0x9c, "œ"],
  [0x9d, "\x9d"],
  [0x9e, "ž"],
  [0x9f, "Ÿ"],
]);

/** `_invalid_codepoints` de `html/__init__.py`: referências numéricas descartadas. */
function codigoDescartado(codigo: number): boolean {
  return (
    (codigo >= 0x1 && codigo <= 0x8) ||
    codigo === 0xb ||
    (codigo >= 0xe && codigo <= 0x1f) ||
    (codigo >= 0x7f && codigo <= 0x9f) ||
    (codigo >= 0xfdd0 && codigo <= 0xfdef) ||
    (codigo & 0xfffe) === 0xfffe
  );
}

/**
 * Caractere de uma referência numérica (`&#39;`, `&#x27`), pelas regras de
 * `html.unescape`: `\r` e Windows-1252 para alguns códigos, `�` para
 * surrogates e valores acima de `0x10FFFF`, vazio para não caracteres.
 */
export function caractereNumericoPy(digitos: string, hexadecimal: boolean): string {
  const valor = BigInt(hexadecimal ? `0x${digitos}` : digitos);
  if (valor > 0x10ffffn) return "�";
  const codigo = Number(valor);
  const trocado = REFERENCIAS_INVALIDAS.get(codigo);
  if (trocado !== undefined) return trocado;
  if (codigo >= 0xd800 && codigo <= 0xdfff) return "�";
  if (codigoDescartado(codigo)) return "";
  return String.fromCodePoint(codigo);
}
