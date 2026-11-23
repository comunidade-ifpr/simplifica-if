/**
 * O documento em blocos, para renderizar por partes (M1.6). Um PPC chega a 720 mil caracteres, e o
 * `react-markdown` sobre o texto inteiro trava a interface por segundos: o leitor monta primeiro o
 * bloco do trecho pedido e os outros aos poucos (`Documento.tsx`).
 *
 * O corte é antes de um cabeçalho ATX (`#` a `######` no começo da linha, fora de bloco de código
 * cercado). Um cabeçalho encerra parágrafo, lista, tabela e citação, então cada bloco dá a mesma árvore
 * que o trecho daria no documento inteiro. Há PPCs com mais de 200 mil caracteres sem cabeçalho (o
 * ementário inteiro numa tabela, por exemplo): passado `LIMITE_SEM_CABECALHO` vezes o tamanho, o corte
 * vale também depois de uma linha em branco, antes de uma linha que não continua o bloco anterior (sem
 * recuo, não é item de lista, linha de tabela, citação nem HTML). Nunca se corta dentro de bloco de
 * código cercado nem de uma região `<!-- redacao-nao-vigente -->` (que o
 * `remarkMarcadores` agrupa). Exceções conhecidas: definição de link por referência e nota de rodapé
 * (`[^1]`) em outro bloco ficam sem par; a base não as usa nas normas.
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
const ABRE_MARCADOR = /^<!--\s*(redacao-nao-vigente)\b[^>]*-->\s*$/;
const FECHA_MARCADOR = /^<!--\s*\/(redacao-nao-vigente)\s*-->\s*$/;
/** O começo de linha que pode continuar o bloco de cima mesmo depois de uma linha em branco. */
const CONTINUA = /^(?:[ \t]|[-*+](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|\||>|<|\[\^)/;

/** Quantas vezes o tamanho alvo um bloco pode crescer antes de cortar fora de cabeçalho. */
export const LIMITE_SEM_CABECALHO = 4;

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
  let marcador: string | null = null;
  for (let i = 0; i < linhas.length; i += 1) {
    const linha = linhas[i]!;
    const marca = CERCA.exec(linha)?.[1];
    if (marca !== undefined) {
      if (cerca === null) cerca = marca;
      else if (marca[0] === cerca[0] && marca.length >= cerca.length) cerca = null;
    } else if (cerca === null) {
      const livre = marcador === null && i > inicio;
      const cabecalho = livre && caracteres >= tamanho && CABECALHO.test(linha);
      const emBranco =
        livre &&
        caracteres >= tamanho * LIMITE_SEM_CABECALHO &&
        linha.trim() !== "" &&
        linhas[i - 1]!.trim() === "" &&
        !CONTINUA.test(linha);
      if (cabecalho || emBranco) {
        blocos.push({ texto: linhas.slice(inicio, i).join("\n"), linhaInicial: inicio + 1, linhaFinal: i });
        inicio = i;
        caracteres = 0;
      }
      const abre = ABRE_MARCADOR.exec(linha.trim())?.[1];
      if (abre !== undefined && marcador === null) marcador = abre;
      else if (marcador !== null && FECHA_MARCADOR.exec(linha.trim())?.[1] === marcador) marcador = null;
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
