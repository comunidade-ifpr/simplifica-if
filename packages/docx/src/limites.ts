/**
 * Limites de leitura de um DOCX, todos aqui. Quem abre o arquivo pode trocar qualquer um
 * (`new PacoteOoxml(bytes, limites)`, `lerDocx(bytes, { limites })`).
 *
 * O arquivo vem do usuário e pode ser hostil; os limites existem para que um arquivo de poucos
 * kilobytes não esgote a memória nem o tempo. Os padrões folgam sobre os 12 PPCs reais conferidos
 * em 16/11/2026: arquivos de 0,7 a 7,3 MB, `document.xml` de até 4,5 MB descompactado e 104 mil
 * elementos, imagens de até 0,8 MB por PPC.
 *
 * Pior caso honesto dentro dos padrões, medido em 16/11/2026 (um `document.xml` de 14 a 25 MB com
 * 486 mil elementos e texto variado): cerca de 690 MB de memória residente no pico e 1,5 s, e
 * converte com o heap do V8 limitado a 512 MB. A árvore do XML custa cerca de 1 KB por elemento.
 */
export type LimitesDoPacote = {
  /** Bytes do arquivo `.docx`. */
  bytesDoArquivo: number;
  /** Entradas no ZIP. */
  entradas: number;
  /** Bytes descompactados de uma parte. */
  bytesPorParte: number;
  /** Bytes descompactados de todas as partes lidas. */
  bytesNoTotal: number;
  /**
   * Razão entre o tamanho descompactado e o compactado, conferida nas partes de mais de 10 MB. Abaixo
   * disso não há bomba, e um trecho repetitivo legítimo (uma tabela de linhas iguais) passa de 200:1.
   */
  razaoDeCompressao: number;
  /** Elementos numa parte XML. Quase cinco vezes o maior `document.xml` real. */
  elementosPorParte: number;
  /**
   * Níveis de aninhamento do XML. Um documento real fica na casa das dezenas (tabela em caixa de
   * texto em tabela); o limite protege as funções recursivas do leitor.
   */
  profundidadeDoXml: number;
  /** Células numa linha de tabela, contadas as de tabelas aninhadas. */
  celulasPorLinha: number;
  /** Posições da grade de uma tabela (células vezes colunas ocupadas). */
  posicoesPorTabela: number;
};

export const LIMITES_PADRAO: LimitesDoPacote = {
  bytesDoArquivo: 20 * 1024 * 1024,
  entradas: 10_000,
  bytesPorParte: 25 * 1024 * 1024,
  bytesNoTotal: 60 * 1024 * 1024,
  // O DEFLATE não passa de 1032:1; XML de documento fica na casa de 10:1 a 30:1.
  razaoDeCompressao: 200,
  elementosPorParte: 500_000,
  profundidadeDoXml: 256,
  celulasPorLinha: 1024,
  posicoesPorTabela: 2_000_000,
};
