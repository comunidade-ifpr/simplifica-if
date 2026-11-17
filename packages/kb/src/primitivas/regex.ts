/**
 * Expressões regulares com classes Unicode, para as regras de texto dos PPCs.
 *
 * `traduzirPadrao` converte a fonte de um padrão para JavaScript (flag `u`):
 * - `\s`, `\d`, `\w`, `\b` e seus negados passam a ser Unicode (no
 *   JavaScript, `\d`, `\w` e `\b` são só ASCII e `\s` tem outro conjunto);
 * - `.` não casa só `\n` (no JavaScript, também deixa de casar `\r`, `\u2028`, `\u2029`);
 * - `$` casa no fim ou antes de um `\n` final;
 * - `]` logo depois de `[` ou `[^` é literal.
 *
 * Com `dotAll`, `.` casa qualquer caractere.
 *
 * `search` acha a primeira ocorrência, `match` só no início, `fullmatch` só o
 * texto inteiro; `finditer`, `sub` e `split` percorrem todas; `escape` escapa um
 * texto para entrar num padrão.
 */
import { ESPACOS } from "../texto.ts";

const PALAVRA = "\\p{L}\\p{N}_";
const LIMITE = `(?:(?<=[${PALAVRA}])(?![${PALAVRA}])|(?<![${PALAVRA}])(?=[${PALAVRA}]))`;
const NAO_LIMITE = `(?:(?<=[${PALAVRA}])(?=[${PALAVRA}])|(?<![${PALAVRA}])(?![${PALAVRA}]))`;
const SINTAXE_JS = new Set("^$\\.*+?()[]{}|/");

/** Traduz a fonte de um padrão para a de um padrão JavaScript com flag `u`. */
export function traduzirPadrao(fonte: string, dotAll = false): string {
  let saida = "";
  let emClasse = false;
  let i = 0;
  while (i < fonte.length) {
    const c = fonte[i]!;
    if (c === "\\") {
      const e = fonte[i + 1];
      if (e === undefined) throw new SyntaxError(`padrão termina em barra invertida: ${fonte}`);
      i += 2;
      if (e === "s") saida += emClasse ? ESPACOS : `[${ESPACOS}]`;
      else if (e === "S") {
        if (emClasse) throw new SyntaxError(`\\S dentro de classe não suportado: ${fonte}`);
        saida += `[^${ESPACOS}]`;
      } else if (e === "d") saida += "\\p{Nd}";
      else if (e === "D") saida += "\\P{Nd}";
      else if (e === "w") saida += emClasse ? PALAVRA : `[${PALAVRA}]`;
      else if (e === "W") {
        if (emClasse) throw new SyntaxError(`\\W dentro de classe não suportado: ${fonte}`);
        saida += `[^${PALAVRA}]`;
      } else if (e === "b") saida += emClasse ? "\\x08" : LIMITE;
      else if (e === "B") saida += NAO_LIMITE;
      else if (e === "A") saida += "^";
      else if (e === "Z") saida += "$";
      else if (e === "U") {
        saida += `\\u{${fonte.slice(i, i + 8)}}`;
        i += 8;
      } else if ("nrtfvx0123456789u".includes(e)) saida += `\\${e}`;
      else if (SINTAXE_JS.has(e) || (emClasse && e === "-")) saida += `\\${e}`;
      else saida += e;
      continue;
    }
    if (emClasse) {
      if (c === "]") emClasse = false;
      saida += c;
      i += 1;
      continue;
    }
    if (c === "[") {
      emClasse = true;
      saida += "[";
      i += 1;
      if (fonte[i] === "^") {
        saida += "^";
        i += 1;
      }
      if (fonte[i] === "]") {
        saida += "\\]";
        i += 1;
      }
      continue;
    }
    if (c === "(" && fonte.startsWith("(?P", i)) throw new SyntaxError(`grupo nomeado (?P<…>) não suportado: ${fonte}`);
    if (c === ".") saida += dotAll ? "[\\s\\S]" : "[^\\n]";
    else if (c === "$") saida += "(?:$|(?=\\n$))";
    else saida += c;
    i += 1;
  }
  return saida;
}

export type OpcoesRegex = { ignoreCase?: boolean; dotAll?: boolean };

const cache = new Map<string, RegExp>();

function compilar(fonte: string, modo: "search" | "match" | "fullmatch", flags: OpcoesRegex, global = false): RegExp {
  const chave = `${modo}\u0000${flags.ignoreCase ? "i" : ""}${flags.dotAll ? "s" : ""}${global ? "g" : ""}\u0000${fonte}`;
  let re = cache.get(chave);
  if (!re) {
    const traduzido = traduzirPadrao(fonte, flags.dotAll);
    const corpo = modo === "search" ? traduzido : modo === "match" ? `^(?:${traduzido})` : `^(?:${traduzido})$`;
    re = new RegExp(corpo, `u${flags.ignoreCase ? "i" : ""}${global ? "g" : ""}`);
    cache.set(chave, re);
  }
  re.lastIndex = 0;
  return re;
}

/** Primeira ocorrência do padrão no texto. */
export function search(padrao: string, texto: string, flags: OpcoesRegex = {}): RegExpExecArray | null {
  return compilar(padrao, "search", flags).exec(texto);
}

/** Ocorrência ancorada no início do texto. */
export function match(padrao: string, texto: string, flags: OpcoesRegex = {}): RegExpExecArray | null {
  return compilar(padrao, "match", flags).exec(texto);
}

/** Ocorrência que cobre o texto inteiro. */
export function fullmatch(padrao: string, texto: string, flags: OpcoesRegex = {}): RegExpExecArray | null {
  return compilar(padrao, "fullmatch", flags).exec(texto);
}

/** Todas as ocorrências, sem sobreposição. */
export function finditer(padrao: string, texto: string, flags: OpcoesRegex = {}): RegExpExecArray[] {
  return [...texto.matchAll(compilar(padrao, "search", flags, true))];
}

/**
 * Troca cada ocorrência pelo substituto: uma função ou um texto com
 * referências `\1`…`\9` (`$` não tem significado especial).
 */
export function sub(
  padrao: string,
  substituto: string | ((m: RegExpExecArray) => string),
  texto: string,
  flags: OpcoesRegex = {},
): string {
  const re = compilar(padrao, "search", flags, true);
  const funcao =
    typeof substituto === "function"
      ? substituto
      : (m: RegExpExecArray) => substituto.replace(/\\(\d)/g, (_, grupo: string) => m[Number(grupo)] ?? "");
  let saida = "";
  let ultimo = 0;
  for (const m of texto.matchAll(re)) {
    saida += texto.slice(ultimo, m.index) + funcao(m);
    ultimo = m.index + m[0].length;
  }
  return saida + texto.slice(ultimo);
}

/**
 * Divide o texto nas ocorrências do padrão, que não pode ter grupos de captura: intercalar o que
 * eles capturam não está implementado, e o padrão é recusado para não dar um resultado diferente
 * do esperado em silêncio.
 */
export function split(padrao: string, texto: string, flags: OpcoesRegex = {}): string[] {
  const re = compilar(padrao, "search", flags, true);
  // Casar com o texto vazio revela quantos grupos o padrão tem.
  if (new RegExp(`${re.source}|`, re.flags.replace("g", "")).exec("")!.length > 1) {
    throw new SyntaxError(`split não aceita padrão com grupos de captura: ${padrao}`);
  }
  const partes: string[] = [];
  let ultimo = 0;
  for (const m of texto.matchAll(re)) {
    partes.push(texto.slice(ultimo, m.index));
    ultimo = m.index + m[0].length;
  }
  partes.push(texto.slice(ultimo));
  return partes;
}

/** O texto como fonte de padrão literal (escapa o que não é letra, dígito ou `_`). */
export function escape(texto: string): string {
  return Array.from(texto)
    .map((c) => (/[\p{L}\p{N}_]/u.test(c) ? c : `\\${c}`))
    .join("");
}
