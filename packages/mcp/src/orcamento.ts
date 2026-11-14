/**
 * Orçamento de tamanho (decisão de desenho 6): cada ferramenta tem um teto de caracteres no texto
 * para a IA. As listas paginam por número de itens e pelo teto ao mesmo tempo: a página termina no
 * último item que cabe, e o cursor aponta para o primeiro que ficou de fora. Assim o texto nunca passa
 * do teto e a paginação continua completa e sem repetição.
 */
import { codificarCursor, ErroEntrada, lerCursor, type Pagina } from "./envelope.ts";

/**
 * Folga para o que `montarTexto` acrescenta ao corpo (avisos, linha de paginação com o cursor,
 * rodapé) e para o cabeçalho que a ferramenta escreve antes dos itens.
 */
export const RESERVA_TEXTO = 1500;

/** Corta um texto em `maximo` caracteres, com "…" no fim quando cortado. */
export function cortar(texto: string, maximo: number): string {
  if (texto.length <= maximo) return texto;
  return `${texto.slice(0, Math.max(0, maximo - 1)).trimEnd()}…`;
}

/**
 * Página de uma lista já ordenada: até `limite` itens a partir do cursor, enquanto a soma de
 * `medir(item)` (o tamanho do bloco do item no texto, com o separador) couber em `orcamento`. O
 * primeiro item da página entra sempre; a ferramenta corta o texto dele se for maior que o orçamento.
 */
export function paginarNoTeto<T>(
  itens: readonly T[],
  opcoes: {
    limite: number;
    cursor?: string | undefined;
    consulta: unknown;
    orcamento: number;
    medir: (item: T) => number;
  },
): { itens: T[]; pagina: Pagina; inicio: number } {
  const inicio = lerCursor(opcoes.cursor, opcoes.consulta);
  if (inicio > itens.length) throw new ErroEntrada("cursor além do fim da lista: repita a chamada sem cursor");
  const pagina: T[] = [];
  let usado = 0;
  for (let i = inicio; i < itens.length && pagina.length < opcoes.limite; i += 1) {
    const tamanho = opcoes.medir(itens[i]!);
    if (pagina.length > 0 && usado + tamanho > opcoes.orcamento) break;
    pagina.push(itens[i]!);
    usado += tamanho;
  }
  const fim = inicio + pagina.length;
  return {
    itens: pagina,
    inicio,
    pagina: {
      total: itens.length,
      devolvidos: pagina.length,
      ...(fim < itens.length ? { cursor: codificarCursor(fim, opcoes.consulta) } : {}),
    },
  };
}

/**
 * Linhas de uma lista dentro de `orcamento` caracteres; as que não cabem viram uma linha final
 * "… e mais N <resto>".
 */
export function linhasNoOrcamento(linhas: readonly string[], orcamento: number, resto: string): string[] {
  const saida: string[] = [];
  let usado = 0;
  for (const [i, linha] of linhas.entries()) {
    if (usado + linha.length + 1 > orcamento) {
      saida.push(`… e mais ${linhas.length - i} ${resto}`);
      return saida;
    }
    saida.push(linha);
    usado += linha.length + 1;
  }
  return saida;
}
