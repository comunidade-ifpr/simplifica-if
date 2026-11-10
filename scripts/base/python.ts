/**
 * Equivalências mínimas com a semântica do Python usada pelos antigos scripts
 * da base (`str.strip`, `splitlines`, ordenação por code point, `repr`, `==`,
 * `pathlib`). Mantêm a saída byte a byte e as mensagens do validador.
 */
import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Caracteres para os quais `str.isspace()` (e `\s` do `re`) é verdadeiro. */
export const ESPACOS_PY = "\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const RE_ESPACO_INICIAL = new RegExp(`^[${ESPACOS_PY}]+`);
const RE_ESPACO_FINAL = new RegExp(`[${ESPACOS_PY}]+$`);
export const RE_TEM_ESPACO = new RegExp(`[${ESPACOS_PY}]`);

/** `str.strip()` sem argumento. */
export function strip(texto: string): string {
  return lstrip(texto).replace(RE_ESPACO_FINAL, "");
}

/** `str.lstrip()` sem argumento. */
export function lstrip(texto: string): string {
  return texto.replace(RE_ESPACO_INICIAL, "");
}

/** `str.strip(chars)`. */
export function stripChars(texto: string, chars: string): string {
  const conjunto = new Set(chars);
  let inicio = 0;
  let fim = texto.length;
  while (inicio < fim && conjunto.has(texto[inicio]!)) inicio += 1;
  while (fim > inicio && conjunto.has(texto[fim - 1]!)) fim -= 1;
  return texto.slice(inicio, fim);
}

/** `str.splitlines()`: separa em todos os terminadores de linha do Python. */
export function splitlines(texto: string): string[] {
  if (!texto) return [];
  const linhas = texto.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (linhas.at(-1) === "") linhas.pop();
  return linhas;
}

/** Linhas como na iteração de arquivo texto do Python (mantém só `\n` como separador). */
export function linhasDeArquivo(texto: string): string[] {
  if (!texto) return [];
  const linhas = texto.split("\n");
  if (linhas.at(-1) === "") linhas.pop();
  return linhas;
}

/** Quantidade de code points (`len(str)`). */
export function tamanho(texto: string): number {
  let total = 0;
  for (let i = 0; i < texto.length; i += 1) {
    const unidade = texto.charCodeAt(i);
    if (unidade < 0xdc00 || unidade > 0xdfff || i === 0 || !ehAltoSurrogate(texto.charCodeAt(i - 1))) total += 1;
  }
  return total;
}

function ehAltoSurrogate(unidade: number): boolean {
  return unidade >= 0xd800 && unidade <= 0xdbff;
}

/** `texto[:limite]` contando code points. */
export function prefixo(texto: string, limite: number): string {
  let vistos = 0;
  let i = 0;
  while (i < texto.length && vistos < limite) {
    const unidade = texto.charCodeAt(i);
    i += ehAltoSurrogate(unidade) && i + 1 < texto.length ? 2 : 1;
    vistos += 1;
  }
  return texto.slice(0, i);
}

function pesoUnidade(unidade: number): number {
  // Converte a ordem UTF-16 para a ordem de code points do Python.
  if (unidade >= 0xd800 && unidade <= 0xdfff) return unidade + 0x2000;
  if (unidade >= 0xe000) return unidade - 0x800;
  return unidade;
}

/** Comparação de strings por code point (ordem de `sorted()` no Python). */
export function compararTexto(a: string, b: string): number {
  const limite = Math.min(a.length, b.length);
  for (let i = 0; i < limite; i += 1) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x !== y) return pesoUnidade(x) - pesoUnidade(y);
  }
  return a.length - b.length;
}

/** Ordena textos como `sorted()` do Python. */
export function ordenarTextos(textos: Iterable<string>): string[] {
  return [...textos].sort(compararTexto);
}

/** Ordena caminhos como `sorted()` de objetos `pathlib.Path` (por componentes). */
export function ordenarCaminhos(caminhos: Iterable<string>): string[] {
  return [...caminhos].sort((a, b) => {
    const pa = a.split(path.sep);
    const pb = b.split(path.sep);
    const limite = Math.min(pa.length, pb.length);
    for (let i = 0; i < limite; i += 1) {
      const comparacao = compararTexto(pa[i]!, pb[i]!);
      if (comparacao !== 0) return comparacao;
    }
    return pa.length - pb.length;
  });
}

export class ErroDecodificacao extends Error {}

/**
 * `Path.read_text(encoding="utf-8")`: decodifica UTF-8 estrito (sem remover BOM)
 * e aplica a tradução de quebras de linha universais. Com `ignorarErros`,
 * equivale a `errors="ignore"`.
 */
export function lerTexto(caminho: string, opcoes: { ignorarErros?: boolean } = {}): string {
  const bytes = readFileSync(caminho);
  let texto: string;
  try {
    texto = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (erro) {
    if (!opcoes.ignorarErros) {
      throw new ErroDecodificacao(`'utf-8' codec can't decode ${caminho}: ${(erro as Error).message}`);
    }
    texto = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(bytes).replaceAll("\ufffd", "");
  }
  return texto.replace(/\r\n?/g, "\n");
}

export type ValorJson = null | boolean | number | string | ValorJson[] | { [chave: string]: ValorJson };
export type ObjetoJson = { [chave: string]: unknown };

export function ehObjeto(valor: unknown): valor is ObjetoJson {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/** `isinstance(valor, int)`: no Python, `bool` também é `int`. */
export function ehInteiro(valor: unknown): valor is number | boolean {
  return typeof valor === "boolean" || (typeof valor === "number" && Number.isInteger(valor));
}

/** `dict.get(chave, padrao)`. */
export function obter(objeto: ObjetoJson, chave: string, padrao: unknown = null): unknown {
  return Object.hasOwn(objeto, chave) ? objeto[chave] : padrao;
}

export function tem(objeto: ObjetoJson, chave: string): boolean {
  return Object.hasOwn(objeto, chave);
}

/** Itera um valor como o `for` do Python (lista, texto, chaves de dict). */
export function iterar(valor: unknown): unknown[] {
  if (Array.isArray(valor)) return valor;
  if (typeof valor === "string") return Array.from(valor);
  if (ehObjeto(valor)) return Object.keys(valor);
  throw new TypeError(`'${nomeTipoPython(valor)}' object is not iterable`);
}

function nomeTipoPython(valor: unknown): string {
  if (valor === null || valor === undefined) return "NoneType";
  if (typeof valor === "boolean") return "bool";
  if (typeof valor === "number") return Number.isInteger(valor) ? "int" : "float";
  return typeof valor;
}

/** Igualdade `==` do Python entre valores JSON. */
export function iguais(a: unknown, b: unknown): boolean {
  const nuloA = a === null || a === undefined;
  const nuloB = b === null || b === undefined;
  if (nuloA || nuloB) return nuloA && nuloB;
  const numericoA = typeof a === "number" || typeof a === "boolean";
  const numericoB = typeof b === "number" || typeof b === "boolean";
  if (numericoA || numericoB) return numericoA && numericoB && Number(a) === Number(b);
  if (typeof a === "string" || typeof b === "string") return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => iguais(item, b[i]));
  }
  if (ehObjeto(a) && ehObjeto(b)) {
    const chavesA = Object.keys(a);
    if (chavesA.length !== Object.keys(b).length) return false;
    return chavesA.every((chave) => Object.hasOwn(b, chave) && iguais(a[chave], b[chave]));
  }
  return false;
}

export function conjuntosIguais<T>(a: Set<T>, b: Set<T>): boolean {
  return a.size === b.size && [...a].every((item) => b.has(item));
}

const RE_NAO_IMPRIMIVEL = /[\p{C}\p{Zl}\p{Zp}\p{Zs}]/u;

function reprTexto(texto: string): string {
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

/** `repr()` do Python para valores JSON. */
export function repr(valor: unknown): string {
  if (valor === null || valor === undefined) return "None";
  if (typeof valor === "boolean") return valor ? "True" : "False";
  if (typeof valor === "number") return String(valor);
  if (typeof valor === "string") return reprTexto(valor);
  if (Array.isArray(valor)) return `[${valor.map(repr).join(", ")}]`;
  if (ehObjeto(valor)) {
    return `{${Object.entries(valor)
      .map(([chave, item]) => `${reprTexto(chave)}: ${repr(item)}`)
      .join(", ")}}`;
  }
  return String(valor);
}

/** `str()` do Python para valores JSON. */
export function str(valor: unknown): string {
  return typeof valor === "string" ? valor : repr(valor);
}

/** `json.dumps(valor, ensure_ascii=False, indent=2) + "\n"`. */
export function jsonIndentado(valor: unknown): string {
  return `${JSON.stringify(valor, null, 2)}\n`;
}

/** `json.dumps(valor, ensure_ascii=False, separators=(",", ":"))`. */
export function jsonCompacto(valor: unknown): string {
  return JSON.stringify(valor);
}

/**
 * Traduz um padrão do módulo `re` do Python (subconjunto usado em schemas)
 * para `RegExp` com flag `u`, preservando `\d`, `\s`, `\w`, `.` e `$` do Python.
 */
export function regexPython(padrao: string): RegExp {
  let saida = "";
  let emClasse = false;
  for (let i = 0; i < padrao.length; i += 1) {
    const caractere = padrao[i]!;
    if (caractere === "\\") {
      const proximo = padrao[i + 1] ?? "";
      i += 1;
      const traducaoClasse: Record<string, string> = { d: "\\p{Nd}", s: ESPACOS_PY, w: "\\p{L}\\p{N}_" };
      const traducao: Record<string, string> = {
        d: "\\p{Nd}",
        D: "\\P{Nd}",
        s: `[${ESPACOS_PY}]`,
        S: `[^${ESPACOS_PY}]`,
        w: "[\\p{L}\\p{N}_]",
        W: "[^\\p{L}\\p{N}_]",
        A: "^",
        Z: "$",
      };
      if (emClasse && traducaoClasse[proximo]) saida += traducaoClasse[proximo];
      else if (!emClasse && traducao[proximo]) saida += traducao[proximo];
      else if (/^[^\p{L}\p{N}]$/u.test(proximo) && !"^$\\.*+?()[]{}|/".includes(proximo) && !(emClasse && proximo === "-")) {
        // Com a flag `u`, o JS rejeita escapes de pontuação que o `re` aceita (ex.: `\-`, `\#`, `\ `).
        saida += `\\u{${proximo.codePointAt(0)!.toString(16)}}`;
      } else saida += `\\${proximo}`;
      continue;
    }
    if (emClasse) {
      if (caractere === "]") emClasse = false;
      saida += caractere;
      continue;
    }
    if (caractere === "[") {
      emClasse = true;
      saida += caractere;
      if (padrao[i + 1] === "^") saida += padrao[++i];
      if (padrao[i + 1] === "]") saida += `\\${padrao[++i]}`;
      continue;
    }
    if (caractere === ".") saida += "[^\\n]";
    else if (caractere === "$") saida += "(?=\\n?$)";
    else saida += caractere;
  }
  return new RegExp(saida, "u");
}

/** Partes de `urllib.parse.urlsplit` usadas pelo validador. */
export function urlsplit(url: string): { scheme: string; netloc: string } {
  let resto = url.replace(/^[\x00-\x20]+/, "").replace(/[\t\r\n]/g, "");
  let scheme = "";
  const indice = resto.indexOf(":");
  if (indice > 0 && /^[A-Za-z]/.test(resto) && /^[A-Za-z0-9+\-.]+$/.test(resto.slice(0, indice))) {
    scheme = resto.slice(0, indice).toLowerCase();
    resto = resto.slice(indice + 1);
  }
  let netloc = "";
  if (resto.startsWith("//")) {
    let fim = resto.length;
    for (const delimitador of "/?#") {
      const posicao = resto.indexOf(delimitador, 2);
      if (posicao >= 0) fim = Math.min(fim, posicao);
    }
    netloc = resto.slice(2, fim);
    if (netloc.includes("[") !== netloc.includes("]")) throw new Error("Invalid IPv6 URL");
  }
  return { scheme, netloc };
}

function ehDiretorio(caminho: string): boolean {
  try {
    return statSync(caminho).isDirectory();
  } catch {
    return false;
  }
}

export function ehArquivo(caminho: string): boolean {
  try {
    return statSync(caminho).isFile();
  } catch {
    return false;
  }
}

function casaCuringa(nome: string, padrao: string): boolean {
  if (padrao === "*") return true;
  if (padrao.startsWith("*") && !padrao.slice(1).includes("*")) return nome.endsWith(padrao.slice(1));
  return nome === padrao;
}

/** `Path.glob(padrao)` para padrões como `*.ext` e `*` seguido de `/*.ext` (inclui ocultos). */
export function glob(diretorio: string, padrao: string): string[] {
  const partes = padrao.split("/");
  let atuais = [diretorio];
  for (const [indice, parte] of partes.entries()) {
    const ultima = indice === partes.length - 1;
    const proximos: string[] = [];
    for (const atual of atuais) {
      if (!ehDiretorio(atual)) continue;
      for (const nome of readdirSync(atual).sort(compararTexto)) {
        const caminho = path.join(atual, nome);
        if (casaCuringa(nome, parte) && (ultima || ehDiretorio(caminho))) proximos.push(caminho);
      }
    }
    atuais = proximos;
  }
  return atuais;
}

/** `Path.rglob(padrao)` sem seguir links simbólicos de diretório (Python 3.13+). */
export function rglob(diretorio: string, padrao: string): string[] {
  const resultado: string[] = [];
  const visitar = (atual: string) => {
    for (const nome of readdirSync(atual).sort(compararTexto)) {
      const caminho = path.join(atual, nome);
      if (casaCuringa(nome, padrao)) resultado.push(caminho);
      if (lstatSync(caminho).isDirectory()) visitar(caminho);
    }
  };
  if (ehDiretorio(diretorio)) visitar(diretorio);
  return resultado;
}
