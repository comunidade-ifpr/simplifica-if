/**
 * Escrita do Markdown bruto do PPC: as seções em texto, antes da normalização
 * (`../normalizador-markdown.ts`). A escrita dos elementos é a de `@simplifica-if/docx/markdown`.
 */
import { type Elemento } from "@simplifica-if/docx/elementos";
import { Escritor, linhaDeTitulo, type NormalizarTabela } from "@simplifica-if/docx/markdown";
import { normalizarTabela } from "@simplifica-if/docx/tabelas";
import { type Secao, tituloCompleto } from "./secoes.ts";

/** Os parágrafos do Word separados por uma linha em branco, como no Markdown; os itens de uma lista, juntos. */
const SEQUENCIA = { separarParagrafos: true };

function escreverSecao(escritor: Escritor, secao: Secao): string {
  const linhas = [linhaDeTitulo(secao.nivel, tituloCompleto(secao)), ""];
  const corpo = escritor.elementos(secao.elementos, SEQUENCIA);
  if (corpo) linhas.push(corpo);
  for (const subsecao of secao.subsecoes) linhas.push("", escreverSecao(escritor, subsecao));
  return linhas.join("\n");
}

/** Markdown bruto do documento: por seções quando há títulos, senão os elementos em sequência. */
export function escreverMarkdown(
  elementos: Elemento[],
  secoes: Secao[],
  normalizar: NormalizarTabela = normalizarTabela,
): string {
  const escritor = new Escritor(normalizar);
  if (!secoes.length) return escritor.elementos(elementos, SEQUENCIA);
  return secoes.map((secao) => escreverSecao(escritor, secao)).join("\n");
}
