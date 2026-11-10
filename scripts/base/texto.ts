/**
 * Regras de texto que determinam o conteúdo gerado (manifest.json, README.md,
 * índices de PPC, site/) e as mensagens do validador.
 *
 * Os arquivos publicados foram produzidos por anos com essas regras, e as
 * alternativas nativas do JavaScript dão resultados diferentes:
 * - `String.prototype.trim` e `\s` não tratam `\x1c`–`\x1f` e `\x85` como
 *   espaço, mas tratam o BOM (`\ufeff`) como espaço;
 * - `Array.prototype.sort` e `localeCompare` ordenam por unidade UTF-16 ou por
 *   localidade, não por code point;
 * - `length` e `slice` contam unidades UTF-16, e os previews e limites de
 *   caracteres contam code points;
 * - a leitura de texto precisa falhar em UTF-8 inválido e normalizar `\r\n`/`\r`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

/** Classe de caracteres (para usar dentro de `[...]`) com todos os espaços Unicode reconhecidos. */
export const ESPACOS = "\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const RE_ESPACO_INICIAL = new RegExp(`^[${ESPACOS}]+`);
const RE_ESPACO_FINAL = new RegExp(`[${ESPACOS}]+$`);
export const RE_TEM_ESPACO = new RegExp(`[${ESPACOS}]`);

/** Remove espaços (conjunto `ESPACOS`) do início e do fim. */
export function aparar(texto: string): string {
  return apararInicio(texto).replace(RE_ESPACO_FINAL, "");
}

/** Remove espaços (conjunto `ESPACOS`) do início. */
export function apararInicio(texto: string): string {
  return texto.replace(RE_ESPACO_INICIAL, "");
}

/** Remove das pontas qualquer caractere presente em `caracteres`. */
export function apararCaracteres(texto: string, caracteres: string): string {
  const conjunto = new Set(caracteres);
  let inicio = 0;
  let fim = texto.length;
  while (inicio < fim && conjunto.has(texto[inicio]!)) inicio += 1;
  while (fim > inicio && conjunto.has(texto[fim - 1]!)) fim -= 1;
  return texto.slice(inicio, fim);
}

/**
 * Divide em linhas em qualquer terminador Unicode (`\r\n`, `\n`, `\r`, `\v`,
 * `\f`, `\x1c`–`\x1e`, `\x85`, `\u2028`, `\u2029`), sem linha vazia final.
 */
export function dividirLinhas(texto: string): string[] {
  if (!texto) return [];
  const linhas = texto.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (linhas.at(-1) === "") linhas.pop();
  return linhas;
}

/** Linhas de um arquivo já lido com `lerTexto`: separa só em `\n`, sem linha vazia final. */
export function linhasDeArquivo(texto: string): string[] {
  if (!texto) return [];
  const linhas = texto.split("\n");
  if (linhas.at(-1) === "") linhas.pop();
  return linhas;
}

function ehAltoSurrogate(unidade: number): boolean {
  return unidade >= 0xd800 && unidade <= 0xdbff;
}

/** Quantidade de code points. */
export function contarCaracteres(texto: string): number {
  let total = 0;
  for (let i = 0; i < texto.length; i += 1) {
    const unidade = texto.charCodeAt(i);
    if (unidade < 0xdc00 || unidade > 0xdfff || i === 0 || !ehAltoSurrogate(texto.charCodeAt(i - 1))) total += 1;
  }
  return total;
}

/** Os primeiros `limite` code points. */
export function prefixo(texto: string, limite: number): string {
  let vistos = 0;
  let i = 0;
  while (i < texto.length && vistos < limite) {
    i += ehAltoSurrogate(texto.charCodeAt(i)) && i + 1 < texto.length ? 2 : 1;
    vistos += 1;
  }
  return texto.slice(0, i);
}

function pesoUnidade(unidade: number): number {
  // Converte a ordem UTF-16 para a ordem de code points.
  if (unidade >= 0xd800 && unidade <= 0xdfff) return unidade + 0x2000;
  if (unidade >= 0xe000) return unidade - 0x800;
  return unidade;
}

/** Comparação de textos por code point (independente de localidade). */
export function compararTexto(a: string, b: string): number {
  const limite = Math.min(a.length, b.length);
  for (let i = 0; i < limite; i += 1) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x !== y) return pesoUnidade(x) - pesoUnidade(y);
  }
  return a.length - b.length;
}

export function ordenarTextos(textos: Iterable<string>): string[] {
  return [...textos].sort(compararTexto);
}

/** Ordena caminhos componente a componente (`a/b` antes de `a-c/x`). */
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
 * Lê um arquivo como UTF-8 estrito (sem remover BOM) e normaliza `\r\n` e `\r`
 * para `\n`. Com `ignorarErros`, descarta bytes inválidos em vez de falhar.
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
