/**
 * Markdown das normas como árvore mdast (`remark-parse` + `remark-gfm`) e como sequência de
 * palavras.
 *
 * - `arvoreMarkdown(texto)`: o arquivo inteiro, com o front matter trocado por linhas em branco,
 *   para que `position.start.line` do mdast seja a linha do arquivo. As posições do mdast também
 *   trazem `offset` em unidades UTF-16 (índice de string do JS); `linhaDoOffset` converte um offset
 *   em linha quando só ele estiver disponível.
 * - `palavrasMarkdown(texto)`: o texto sem a marcação Markdown (cabeçalhos, ênfase, listas,
 *   citações, tabelas, HTML), sem `*` (negrito solto ou partido) e sem `#` solto, em palavras separadas por espaço. É a régua do
 *   saneamento ("texto preservado palavra por palavra") e da reconstituição pelos dispositivos.
 */
import type { Nodes, Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

const processador = unified().use(remarkParse).use(remarkGfm);

/** Troca o front matter (`---` ... `---`) por linhas em branco, preservando a contagem de linhas. */
export function semFrontMatter(texto: string): string {
  if (!texto.startsWith("---\n")) return texto;
  const fim = texto.indexOf("\n---", 4);
  if (fim === -1) return texto;
  const fimLinha = texto.indexOf("\n", fim + 4);
  const corte = fimLinha === -1 ? texto.length : fimLinha;
  const linhas = texto.slice(0, corte).split("\n").length - 1;
  return "\n".repeat(linhas) + texto.slice(corte);
}

/** Árvore mdast do arquivo, com o front matter em branco (linhas do mdast = linhas do arquivo). */
export function arvoreMarkdown(texto: string): Root {
  return processador.parse(semFrontMatter(texto)) as Root;
}

const BLOCOS = new Set([
  "paragraph",
  "heading",
  "listItem",
  "tableCell",
  "tableRow",
  "code",
  "blockquote",
  "thematicBreak",
  "table",
  "list",
  "footnoteDefinition",
]);

/**
 * Texto visível de um nó: valores de `text`/`inlineCode`/`code`, com quebra entre blocos; sem HTML.
 * Com `semRiscado`, o texto tachado (`~~...~~`, redação revogada mantida no arquivo) fica de fora.
 */
export function textoDoNo(no: Nodes, opcoes: { semRiscado?: boolean } = {}): string {
  const partes: string[] = [];
  const visitar = (atual: Nodes): void => {
    if (opcoes.semRiscado && atual.type === "delete") return;
    if (atual.type === "text" || atual.type === "inlineCode") {
      partes.push(atual.value);
      return;
    }
    if (atual.type === "code") {
      partes.push(atual.value, "\n");
      return;
    }
    if (atual.type === "break") {
      partes.push(" ");
      return;
    }
    if (atual.type === "html") return;
    if ("children" in atual) {
      for (const filho of atual.children) visitar(filho as Nodes);
    }
    if (BLOCOS.has(atual.type)) partes.push("\n");
  };
  visitar(no);
  return partes.join("");
}

/**
 * Palavras de um texto já sem marcação: tira `*` soltos e separa por espaço. Uma palavra só de `#` é
 * marcação de cabeçalho que a conversão deixou solta no fim de uma linha, e não conta.
 */
export function palavrasDoTexto(texto: string): string[] {
  return texto
    .replace(/\*/g, "")
    .split(/\s+/u)
    .filter((palavra) => palavra !== "" && !/^#+$/.test(palavra));
}

/** Palavras do Markdown de uma norma (sem front matter e sem marcação). */
export function palavrasMarkdown(texto: string): string[] {
  return palavrasDoTexto(textoDoNo(arvoreMarkdown(texto)));
}

/** Linha (1-based) de um offset em unidades UTF-16 de `texto`. */
export function linhaDoOffset(texto: string, offset: number): number {
  let linha = 1;
  const limite = Math.min(offset, texto.length);
  for (let i = 0; i < limite; i++) if (texto.charCodeAt(i) === 10) linha++;
  return linha;
}

/** Primeira divergência entre duas sequências de palavras (`null` se forem iguais). */
export function primeiraDivergencia(
  antes: readonly string[],
  depois: readonly string[],
): { indice: number; antes: string; depois: string } | null {
  const total = Math.max(antes.length, depois.length);
  for (let i = 0; i < total; i++) {
    if (antes[i] !== depois[i]) {
      return {
        indice: i,
        antes: antes.slice(Math.max(0, i - 6), i + 6).join(" "),
        depois: depois.slice(Math.max(0, i - 6), i + 6).join(" "),
      };
    }
  }
  return null;
}
