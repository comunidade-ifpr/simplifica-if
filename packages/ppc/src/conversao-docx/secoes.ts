/**
 * Seções do PPC: a hierarquia formada pelos títulos.
 */
import { match } from "@simplifica-if/kb/primitivas/regex";
import { aparar } from "@simplifica-if/kb/texto";
import type { Elemento, Titulo } from "@simplifica-if/docx/elementos";

const r = String.raw;

export type Secao = {
  /** Numeração sem o ponto final (`5.6`); `null` em título não numerado. */
  numero: string | null;
  titulo: string;
  nivel: number;
  /** Elementos até o próximo título (os das subseções ficam nelas). */
  elementos: Elemento[];
  subsecoes: Secao[];
};

/** Título com a numeração. */
export function tituloCompleto(secao: Secao): string {
  return secao.numero ? `${secao.numero} ${secao.titulo}` : secao.titulo;
}

const NUMERO_E_TITULO = r`^(\d+(?:\.\d+)*\.?)\s*[-–—.]?\s*(.+)$`;

function secaoDoTitulo(titulo: Titulo): Secao {
  const texto = aparar(titulo.texto);
  const m = match(NUMERO_E_TITULO, texto);
  if (!m) return { numero: null, titulo: texto, nivel: titulo.nivel, elementos: [], subsecoes: [] };
  const numero = m[1]!.replace(/\.+$/, "");
  // Com numeração, o nível é a profundidade dela, não o do estilo.
  return { numero, titulo: aparar(m[2]!), nivel: numero.split(".").length, elementos: [], subsecoes: [] };
}

/**
 * Organiza os elementos em seções. O que vem antes do primeiro título (capa, folha de rosto) fica
 * de fora.
 */
export function detectarSecoes(elementos: Elemento[]): Secao[] {
  const raizes: Secao[] = [];
  /** Da seção de nível 1 até a seção corrente. */
  let caminho: Secao[] = [];
  for (const elemento of elementos) {
    if (elemento.tipo !== "titulo") {
      caminho.at(-1)?.elementos.push(elemento);
      continue;
    }
    const secao = secaoDoTitulo(elemento);
    if (secao.nivel === 1 || !caminho.length) {
      raizes.push(secao);
      caminho = [secao];
      continue;
    }
    while (caminho.length >= secao.nivel) caminho.pop();
    const pai = caminho.at(-1);
    if (pai) pai.subsecoes.push(secao);
    else raizes.push(secao);
    caminho.push(secao);
  }
  return raizes;
}

/** Títulos completos de todas as seções, em profundidade. */
export function listarSecoes(secoes: Secao[]): string[] {
  return secoes.flatMap((secao) => [tituloCompleto(secao), ...listarSecoes(secao.subsecoes)]);
}
