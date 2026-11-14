/**
 * Orçamento de tamanho (decisão de desenho 6): cada ferramenta tem um teto de caracteres no texto
 * para a IA. As listas paginam por número de itens e pelo teto ao mesmo tempo: a página termina no
 * último item que cabe, e o cursor aponta para o primeiro que ficou de fora. Assim o texto nunca passa
 * do teto e a paginação continua completa e sem repetição. A paginação no teto (`paginarNoTeto`) fica
 * no `envelope.ts`, com o cursor; aqui ficam só funções puras de texto, que os schemas das ferramentas
 * (e a interface do app, pelo `GrupoLeitura`) importam sem o `node:crypto` do cursor.
 */

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
