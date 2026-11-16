// @effect-diagnostics nodeBuiltinImport:off -- leitura síncrona de texto (UTF-8 estrito), usada pelos carregadores e pelos scripts
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
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

/** Classe de caracteres (para usar dentro de `[...]`) com todos os espaços Unicode reconhecidos. */
export const ESPACOS = "\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
export const RE_TEM_ESPACO = new RegExp(`[${ESPACOS}]`);

/** O código de unidade UTF-16 é de um espaço do conjunto `ESPACOS`. */
function ehEspaco(codigo: number): boolean {
  if (codigo <= 0x20)
    return codigo === 0x20 || (codigo >= 0x09 && codigo <= 0x0d) || (codigo >= 0x1c && codigo <= 0x1f);
  if (codigo < 0x85) return false;
  return (
    codigo === 0x85 ||
    codigo === 0xa0 ||
    codigo === 0x1680 ||
    (codigo >= 0x2000 && codigo <= 0x200a) ||
    codigo === 0x2028 ||
    codigo === 0x2029 ||
    codigo === 0x202f ||
    codigo === 0x205f ||
    codigo === 0x3000
  );
}

// O aparo é feito com laços, e não com expressões regulares: `[espaços]+$` recomeça a busca em
// cada espaço de uma sequência longa que não está no fim, e custa o quadrado do tamanho dela (80
// mil tabulações no meio de um parágrafo de um DOCX de 3 KB levavam 89 s).

/** Remove espaços (conjunto `ESPACOS`) do início e do fim. */
export function aparar(texto: string): string {
  return apararFim(apararInicio(texto));
}

/** Remove espaços (conjunto `ESPACOS`) do fim. */
export function apararFim(texto: string): string {
  let fim = texto.length;
  while (fim > 0 && ehEspaco(texto.charCodeAt(fim - 1))) fim -= 1;
  return fim === texto.length ? texto : texto.slice(0, fim);
}

/** Remove espaços (conjunto `ESPACOS`) do início. */
export function apararInicio(texto: string): string {
  let inicio = 0;
  while (inicio < texto.length && ehEspaco(texto.charCodeAt(inicio))) inicio += 1;
  return inicio === 0 ? texto : texto.slice(inicio);
}

/**
 * Remove do fim os caracteres que `pertence` aceita. É o `texto.replace(/[classe]+$/, "")` sem o
 * custo quadrático da expressão regular numa sequência longa que não está no fim.
 */
export function apararFimEnquanto(texto: string, pertence: (caractere: string) => boolean): string {
  let fim = texto.length;
  while (fim > 0 && pertence(texto[fim - 1]!)) fim -= 1;
  return fim === texto.length ? texto : texto.slice(0, fim);
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
    const pa = a.split(NodePath.sep);
    const pb = b.split(NodePath.sep);
    const limite = Math.min(pa.length, pb.length);
    for (let i = 0; i < limite; i += 1) {
      const comparacao = compararTexto(pa[i]!, pb[i]!);
      if (comparacao !== 0) return comparacao;
    }
    return pa.length - pb.length;
  });
}

// @effect-diagnostics-next-line extendsNativeError:off -- erro do carregador síncrono `lerTexto`, capturado por instanceof nos scripts (o C3 o troca)
export class ErroDecodificacao extends Error {}

/**
 * Lê um arquivo como UTF-8 estrito (sem remover BOM) e normaliza `\r\n` e `\r`
 * para `\n`. Com `ignorarErros`, descarta bytes inválidos em vez de falhar.
 */
export function lerTexto(caminho: string, opcoes: { ignorarErros?: boolean } = {}): string {
  const bytes = NodeFS.readFileSync(caminho);
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
