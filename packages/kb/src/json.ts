/**
 * Valores JSON: tipos, comparação, notação textual e serialização dos arquivos.
 *
 * A notação textual (`representar`/`textoDe`) e a comparação (`valoresIguais`)
 * seguem as convenções da base desde a primeira versão do validador, e por isso
 * fazem parte da saída: mensagens do validador citam listas como `['a', 'b']`,
 * ausência como `None` e booleanos como `True`; e o README mostra campos não
 * textuais do front matter nessa mesma notação.
 */

export type ObjetoJson = { [chave: string]: unknown };

export function ehObjeto(valor: unknown): valor is ObjetoJson {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/** Itens de uma lista JSON; outro tipo de valor conta como lista vazia. */
export function itensDe(valor: unknown): unknown[] {
  return Array.isArray(valor) ? valor : [];
}

/** Inteiro JSON. Booleanos contam como inteiros (0/1), como sempre contaram na base. */
export function ehInteiro(valor: unknown): valor is number | boolean {
  return typeof valor === "boolean" || (typeof valor === "number" && Number.isInteger(valor));
}

/**
 * Itens percorridos por um laço sobre o valor, como nos scripts originais:
 * lista dá os itens, texto dá os caracteres (code points), objeto dá as
 * chaves e ausência (nulo ou não preenchido) dá lista vazia. Número e booleano
 * verdadeiros não são percorríveis e lançam `TypeError`.
 */
export function itensPercorridos(valor: unknown): unknown[] {
  if (!preenchido(valor)) return [];
  if (Array.isArray(valor)) return [...valor];
  if (typeof valor === "string") return Array.from(valor);
  if (ehObjeto(valor)) return Object.keys(valor);
  throw new TypeError(`${representar(valor)} não é percorrível`);
}

/**
 * Valor considerado preenchido, pela regra de verdade usada desde os scripts
 * originais: nulo/ausente, `false`, `0`, texto vazio, lista vazia e objeto
 * vazio contam como não preenchidos.
 */
export function preenchido(valor: unknown): boolean {
  if (valor === null || valor === undefined || valor === false || valor === 0 || valor === "") return false;
  if (Array.isArray(valor)) return valor.length > 0;
  if (ehObjeto(valor)) return Object.keys(valor).length > 0;
  return true;
}

/** `textoDe(valor)` quando preenchido; senão `""`. */
export function textoOuVazio(valor: unknown): string {
  return preenchido(valor) ? textoDe(valor) : "";
}

/**
 * Igualdade estrutural entre valores JSON. Ausente equivale a `null`, booleano
 * equivale a 0/1 e a ordem das chaves dos objetos não importa.
 */
export function valoresIguais(a: unknown, b: unknown): boolean {
  const nuloA = a === null || a === undefined;
  const nuloB = b === null || b === undefined;
  if (nuloA || nuloB) return nuloA && nuloB;
  const numericoA = typeof a === "number" || typeof a === "boolean";
  const numericoB = typeof b === "number" || typeof b === "boolean";
  if (numericoA || numericoB) return numericoA && numericoB && Number(a) === Number(b);
  if (typeof a === "string" || typeof b === "string") return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => valoresIguais(item, b[i]))
    );
  }
  if (ehObjeto(a) && ehObjeto(b)) {
    const chavesA = Object.keys(a);
    if (chavesA.length !== Object.keys(b).length) return false;
    return chavesA.every((chave) => Object.hasOwn(b, chave) && valoresIguais(a[chave], b[chave]));
  }
  return false;
}

const RE_NAO_IMPRIMIVEL = /[\p{C}\p{Zl}\p{Zp}\p{Zs}]/u;

function representarTexto(texto: string): string {
  const aspas = texto.includes("'") && !texto.includes('"') ? '"' : "'";
  let saida = aspas;
  for (const caractere of texto) {
    const codigo = caractere.codePointAt(0)!;
    if (caractere === "\\" || caractere === aspas) saida += `\\${caractere}`;
    else if (caractere === "\t") saida += "\\t";
    else if (caractere === "\n") saida += "\\n";
    else if (caractere === "\r") saida += "\\r";
    else if (caractere !== " " && RE_NAO_IMPRIMIVEL.test(caractere)) {
      if (codigo < 0x100) saida += `\\x${codigo.toString(16).padStart(2, "0")}`;
      else if (codigo < 0x10000) saida += `\\u${codigo.toString(16).padStart(4, "0")}`;
      else saida += `\\U${codigo.toString(16).padStart(8, "0")}`;
    } else saida += caractere;
  }
  return saida + aspas;
}

/**
 * Notação literal de um valor: textos entre aspas simples (com escapes),
 * `None`, `True`/`False`, listas `[...]` e objetos `{'chave': valor}`.
 */
export function representar(valor: unknown): string {
  if (valor === null || valor === undefined) return "None";
  if (typeof valor === "boolean") return valor ? "True" : "False";
  if (typeof valor === "number") return String(valor);
  if (typeof valor === "string") return representarTexto(valor);
  if (Array.isArray(valor)) return `[${valor.map(representar).join(", ")}]`;
  if (ehObjeto(valor)) {
    return `{${Object.entries(valor)
      .map(([chave, item]) => `${representarTexto(chave)}: ${representar(item)}`)
      .join(", ")}}`;
  }
  return String(valor);
}

/** Texto de um valor numa mensagem: textos como estão, demais valores em `representar`. */
export function textoDe(valor: unknown): string {
  return typeof valor === "string" ? valor : representar(valor);
}

/** Serialização dos arquivos `.json` da base: indentação de 2 espaços, sem escapar não-ASCII, com `\n` final. */
export function jsonIndentado(valor: unknown): string {
  return `${JSON.stringify(valor, null, 2)}\n`;
}

/** Serialização de uma linha `.jsonl`, sem espaços. */
export function jsonCompacto(valor: unknown): string {
  return JSON.stringify(valor);
}
