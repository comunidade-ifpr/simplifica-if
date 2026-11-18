// @effect-diagnostics nodeBuiltinImport:off -- leitura síncrona de JSON tipado, usada pelos scripts e skills
/**
 * Leitura e escrita de JSON tipado (inteiro e fracionário distintos), sempre com a mesma saída.
 *
 * - `carregarJsonTipado` lê floats como `Flutuante` (para que `1.0` continue `1.0`),
 *   inteiros grandes como `bigint`, aceita `NaN`/`Infinity` e guarda a ordem
 *   original das chaves quando há chaves numéricas, que o JavaScript reordena.
 * - `serializarJsonTipado` escreve sem escapar o que não é ASCII, com indentação,
 *   separadores e ordenação das chaves (por code point) opcionais.
 */
import { compararTexto, lerTexto } from "../texto.ts";
import { chavesNaOrdem, ehDicionario, Flutuante, ORDEM_CHAVES, type Dicionario, reprFloat } from "./valores.ts";

export class ErroJsonTipado extends SyntaxError {}

const RE_INDICE = /^(?:0|[1-9]\d*)$/;

function ehChaveNumerica(chave: string): boolean {
  return RE_INDICE.test(chave) && Number(chave) < 2 ** 32 - 1;
}

function definir(objeto: Dicionario, chave: string, valor: unknown): void {
  if (chave === "__proto__")
    Object.defineProperty(objeto, chave, { value: valor, enumerable: true, writable: true, configurable: true });
  else objeto[chave] = valor;
}

/** Analisa um texto JSON (modo estrito: sem caracteres de controle crus em textos). */
export function analisarJsonTipado(texto: string): unknown {
  let pos = 0;
  const erro = (mensagem: string): never => {
    const antes = texto.slice(0, pos);
    const linha = antes.split("\n").length;
    const coluna = pos - antes.lastIndexOf("\n");
    throw new ErroJsonTipado(`${mensagem}: line ${linha} column ${coluna} (char ${pos})`);
  };
  const pularEspacos = () => {
    while (pos < texto.length) {
      const c = texto[pos];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") pos += 1;
      else break;
    }
  };
  const lerTextoJson = (): string => {
    pos += 1;
    let saida = "";
    for (;;) {
      if (pos >= texto.length) erro("Unterminated string starting at");
      const c = texto[pos]!;
      if (c === '"') {
        pos += 1;
        return saida;
      }
      if (c === "\\") {
        const e = texto[pos + 1];
        const simples: Record<string, string> = {
          '"': '"',
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
        };
        if (e !== undefined && e in simples) {
          saida += simples[e];
          pos += 2;
          continue;
        }
        if (e === "u") {
          const hex = texto.slice(pos + 2, pos + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) erro("Invalid \\uXXXX escape");
          let codigo = Number.parseInt(hex, 16);
          pos += 6;
          if (codigo >= 0xd800 && codigo <= 0xdbff && texto.slice(pos, pos + 2) === "\\u") {
            const hex2 = texto.slice(pos + 2, pos + 6);
            if (/^[0-9a-fA-F]{4}$/.test(hex2)) {
              const baixo = Number.parseInt(hex2, 16);
              if (baixo >= 0xdc00 && baixo <= 0xdfff) {
                codigo = 0x10000 + ((codigo - 0xd800) << 10) + (baixo - 0xdc00);
                pos += 6;
              }
            }
          }
          saida += String.fromCodePoint(codigo);
          continue;
        }
        erro("Invalid \\escape");
      }
      if (c.charCodeAt(0) < 0x20) erro("Invalid control character at");
      saida += c;
      pos += 1;
    }
  };
  const lerValor = (): unknown => {
    pularEspacos();
    const c = texto[pos];
    if (c === "{") {
      pos += 1;
      const objeto: Dicionario = {};
      const ordem: string[] = [];
      let numerica = false;
      pularEspacos();
      if (texto[pos] === "}") {
        pos += 1;
        return objeto;
      }
      for (;;) {
        pularEspacos();
        if (texto[pos] !== '"') erro("Expecting property name enclosed in double quotes");
        const chave = lerTextoJson();
        pularEspacos();
        if (texto[pos] !== ":") erro("Expecting ':' delimiter");
        pos += 1;
        const valor = lerValor();
        if (!Object.hasOwn(objeto, chave)) ordem.push(chave);
        if (ehChaveNumerica(chave)) numerica = true;
        definir(objeto, chave, valor);
        pularEspacos();
        if (texto[pos] === ",") {
          pos += 1;
          continue;
        }
        if (texto[pos] === "}") {
          pos += 1;
          break;
        }
        erro("Expecting ',' delimiter");
      }
      if (numerica) Object.defineProperty(objeto, ORDEM_CHAVES, { value: ordem, enumerable: true, writable: true });
      return objeto;
    }
    if (c === "[") {
      pos += 1;
      const lista: unknown[] = [];
      pularEspacos();
      if (texto[pos] === "]") {
        pos += 1;
        return lista;
      }
      for (;;) {
        lista.push(lerValor());
        pularEspacos();
        if (texto[pos] === ",") {
          pos += 1;
          continue;
        }
        if (texto[pos] === "]") {
          pos += 1;
          return lista;
        }
        erro("Expecting ',' delimiter");
      }
    }
    if (c === '"') return lerTextoJson();
    for (const [literal, valor] of [
      ["null", null],
      ["true", true],
      ["false", false],
      ["NaN", new Flutuante(Number.NaN)],
      ["Infinity", new Flutuante(Infinity)],
      ["-Infinity", new Flutuante(-Infinity)],
    ] as const) {
      if (texto.startsWith(literal, pos)) {
        pos += literal.length;
        return valor;
      }
    }
    const numero = /-?(?:0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?/y;
    numero.lastIndex = pos;
    const m = numero.exec(texto);
    if (!m) return erro("Expecting value");
    pos = numero.lastIndex;
    if (m[1] !== undefined || m[2] !== undefined) return new Flutuante(Number(m[0]));
    const inteiro = Number(m[0]);
    return Number.isSafeInteger(inteiro) ? inteiro : BigInt(m[0]);
  };
  const valor = lerValor();
  pularEspacos();
  if (pos !== texto.length) erro("Extra data");
  return valor;
}

/** Lê um arquivo JSON em UTF-8. */
export function carregarJsonTipado(caminho: string): unknown {
  return analisarJsonTipado(lerTexto(caminho));
}

const ESCAPES: Record<string, string> = {
  '"': '\\"',
  "\\": "\\\\",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\b": "\\b",
  "\f": "\\f",
};

/** Literal de texto JSON: escapa só aspas, barra invertida e controles. */
export function literalDeTextoJson(texto: string): string {
  return `"${texto.replace(/[\x00-\x1f"\\]/g, (c) => ESCAPES[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)}"`;
}

function numeroJson(valor: number | Flutuante | bigint): string {
  if (typeof valor === "bigint") return valor.toString();
  const numero = valor instanceof Flutuante ? valor.valor : valor;
  const ehFloat = valor instanceof Flutuante || !Number.isInteger(numero);
  if (Number.isNaN(numero)) return "NaN";
  if (numero === Infinity) return "Infinity";
  if (numero === -Infinity) return "-Infinity";
  if (ehFloat) return reprFloat(numero);
  return BigInt(numero).toString();
}

type OpcoesSerializacao = {
  /** Indentação (`indent`); ausente gera uma linha só. */
  indent?: number;
  /** Separadores de itens e de chave; o padrão é `(", ", ": ")` sem indentação e `(",", ": ")` com. */
  separadores?: readonly [string, string];
  /** Ordena as chaves, por code point. */
  ordenarChaves?: boolean;
};

/** Serializa um valor JSON tipado. */
export function serializarJsonTipado(valor: unknown, opcoes: OpcoesSerializacao = {}): string {
  const { indent, ordenarChaves = false } = opcoes;
  const [sepItem, sepChave] = opcoes.separadores ?? (indent === undefined ? [", ", ": "] : [",", ": "]);
  const escrever = (item: unknown, nivel: number): string => {
    if (item === null || item === undefined) return "null";
    if (item === true) return "true";
    if (item === false) return "false";
    if (typeof item === "number" || typeof item === "bigint" || item instanceof Flutuante) return numeroJson(item);
    if (typeof item === "string") return literalDeTextoJson(item);
    const quebra = indent === undefined ? "" : `\n${" ".repeat(indent * (nivel + 1))}`;
    const fecho = indent === undefined ? "" : `\n${" ".repeat(indent * nivel)}`;
    if (Array.isArray(item)) {
      if (!item.length) return "[]";
      return `[${quebra}${item.map((filho) => escrever(filho, nivel + 1)).join(sepItem + quebra)}${fecho}]`;
    }
    if (ehDicionario(item)) {
      let chaves = chavesNaOrdem(item);
      if (!chaves.length) return "{}";
      if (ordenarChaves) chaves = [...chaves].sort(compararTexto);
      const partes = chaves.map(
        (chave) => `${literalDeTextoJson(chave)}${sepChave}${escrever(item[chave], nivel + 1)}`,
      );
      return `{${quebra}${partes.join(sepItem + quebra)}${fecho}}`;
    }
    throw new TypeError(`Object of type ${typeof item} is not JSON serializable`);
  };
  return escrever(valor, 0);
}

/** JSON indentado com 2 espaços e `\n` final, o formato dos arquivos gravados. */
export function jsonTipadoIndentado(valor: unknown): string {
  return `${serializarJsonTipado(valor, { indent: 2 })}\n`;
}

/** Cópia profunda de um valor JSON (preserva `Flutuante` e a ordem original das chaves). */
export function copiarValorJson<T>(valor: T): T {
  if (Array.isArray(valor)) return valor.map(copiarValorJson) as T;
  if (ehDicionario(valor)) {
    const copia: Dicionario = {};
    for (const chave of Object.keys(valor)) definir(copia, chave, copiarValorJson(valor[chave]));
    const ordem = valor[ORDEM_CHAVES];
    if (ordem) Object.defineProperty(copia, ORDEM_CHAVES, { value: [...ordem], enumerable: true, writable: true });
    return copia as T;
  }
  return valor;
}
