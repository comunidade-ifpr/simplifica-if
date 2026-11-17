/**
 * O documento em blocos, para renderizar por partes (M1.6). Um PPC chega a 720 mil caracteres, e o
 * `react-markdown` sobre o texto inteiro trava a interface por segundos: o leitor monta primeiro o
 * bloco do trecho pedido e os outros aos poucos (`Documento.tsx`).
 *
 * O corte é só antes de um cabeçalho ATX (`#` a `######` no começo da linha, fora de bloco de código
 * cercado). Um cabeçalho encerra parágrafo, lista, tabela e citação, então cada bloco dá a mesma árvore
 * que o trecho daria no documento inteiro. Exceções conhecidas: definição de link por referência e nota
 * de rodapé (`[^1]`) em outro bloco ficam sem par; a base não as usa nas normas.
 *
 * Cada bloco guarda a linha do arquivo em que começa: o plugin `rehypeDispositivos` soma o deslocamento
 * às posições do bloco para casar com as linhas das âncoras.
 */

export interface Bloco {
  readonly texto: string;
  /** A linha do arquivo da primeira linha do bloco, desde 1. */
  readonly linhaInicial: number;
  /** A última linha do bloco. */
  readonly linhaFinal: number;
}

const CABECALHO = /^#{1,6}(?:[ \t]|$)/;
const CERCA = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Divide o Markdown em blocos de pelo menos `tamanho` caracteres (o último pode ser menor), sempre
 * antes de um cabeçalho. Um documento sem cabeçalhos fica num bloco só.
 */
export function dividirEmBlocos(markdown: string, tamanho = 8_000): ReadonlyArray<Bloco> {
  const linhas = markdown.split("\n");
  const blocos: Bloco[] = [];
  let inicio = 0;
  let caracteres = 0;
  let cerca: string | null = null;
  for (let i = 0; i < linhas.length; i += 1) {
    const linha = linhas[i]!;
    const marca = CERCA.exec(linha)?.[1];
    if (marca !== undefined) {
      if (cerca === null) cerca = marca;
      else if (marca[0] === cerca[0] && marca.length >= cerca.length) cerca = null;
    } else if (cerca === null && i > inicio && caracteres >= tamanho && CABECALHO.test(linha)) {
      blocos.push({ texto: linhas.slice(inicio, i).join("\n"), linhaInicial: inicio + 1, linhaFinal: i });
      inicio = i;
      caracteres = 0;
    }
    caracteres += linha.length + 1;
  }
  blocos.push({ texto: linhas.slice(inicio).join("\n"), linhaInicial: inicio + 1, linhaFinal: linhas.length });
  return blocos;
}

/** O índice do bloco que contém a linha; o último, se a linha passa do fim. */
export function blocoDaLinha(blocos: ReadonlyArray<Bloco>, linha: number): number {
  const indice = blocos.findIndex((b) => linha <= b.linhaFinal);
  return indice === -1 ? blocos.length - 1 : indice;
}

/**
 * A ordem em que os blocos se montam: o do alvo primeiro, depois os vizinhos, alternando o de baixo e o
 * de cima, para quem rola a partir do trecho encontrar o texto pronto.
 */
export function ordemDeMontagem(total: number, alvo: number): ReadonlyArray<number> {
  const ordem = [alvo];
  for (let distancia = 1; ordem.length < total; distancia += 1) {
    if (alvo + distancia < total) ordem.push(alvo + distancia);
    if (alvo - distancia >= 0) ordem.push(alvo - distancia);
  }
  return ordem;
}
