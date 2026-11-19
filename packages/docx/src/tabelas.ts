/**
 * Tabela em grade regular de textos (sem mesclas) e sua forma em Markdown.
 *
 * A primeira linha é sempre o cabeçalho; as extrações de matriz, ementário e identificação do
 * `@simplifica-if/ppc` trabalham sobre esta forma.
 */
import { match, sub } from "@simplifica-if/kb/primitivas/regex";
import { ErroDocx } from "./erro.ts";
import { aparar } from "@simplifica-if/kb/texto";
import type { CelulaTabela, Tabela } from "./elementos.ts";

const r = String.raw;

/** Células de uma tabela depois de expandida; a maior tabela de um PPC real tem alguns milhares. */
const CELULAS_MAXIMAS = 2_000_000;
/** Caracteres de texto de uma tabela expandida (com as repetições das mesclas). */
const TEXTO_MAXIMO = 16 * 1024 * 1024;

export type TabelaNormalizada = {
  cabecalho: string[];
  linhas: string[][];
};

/** Número de colunas: o do cabeçalho ou, sem ele, o da primeira linha. */
export function colunasDaTabela(tabela: TabelaNormalizada): number {
  return tabela.cabecalho.length || (tabela.linhas[0]?.length ?? 0);
}

/** Cabeçalho seguido das linhas de dados. */
export function todasAsLinhas(tabela: TabelaNormalizada): string[][] {
  return tabela.cabecalho.length ? [tabela.cabecalho, ...tabela.linhas] : tabela.linhas;
}

/** Texto de célula numa linha só: parágrafos viram `<br>` e `|` é escapado. */
function limparTextoDaCelula(texto: string): string {
  if (!texto) return "";
  const linhas: string[] = [];
  for (const bruta of texto.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")) {
    const linha = aparar(sub(r`[ \t\f\v]+`, " ", bruta));
    if (linha) linhas.push(linha.replaceAll("|", "\\|"));
  }
  return linhas.join("<br>");
}

/**
 * Expande as mesclas: a célula de várias colunas deixa o texto na primeira e vazias as demais, e a
 * continuação vazia de uma mescla vertical recebe o texto da célula de cima.
 */
function expandirMesclas(linhas: CelulaTabela[][], colunas: number, gastar?: (caracteres: number) => void): string[][] {
  // O texto de uma célula mesclada se repete na grade: é limpo uma vez só.
  const limpos = new Map<string, string>();
  const limpar = (texto: string) => {
    let limpo = limpos.get(texto);
    if (limpo === undefined) limpos.set(texto, (limpo = limparTextoDaCelula(texto)));
    return limpo;
  };
  const grade = linhas.map((linha) => {
    const expandida: Array<{ texto: string; continuacao: boolean }> = [];
    for (const celula of linha) {
      const texto = limpar(celula.texto);
      for (let i = 0; i < celula.colunas; i += 1) {
        expandida.push({ texto: i === 0 ? texto : "", continuacao: celula.continuacao });
      }
    }
    while (expandida.length < colunas) expandida.push({ texto: "", continuacao: false });
    return expandida;
  });
  for (let i = 1; i < grade.length; i += 1) {
    for (const [j, celula] of grade[i]!.entries()) {
      // A linha de cima é sempre tão larga quanto esta: todas foram completadas até `colunas`.
      if (celula.continuacao && !celula.texto) celula.texto = grade[i - 1]![j]!.texto;
    }
  }
  // A mescla multiplica o texto: uma célula de 1 MB repetida em 2 mil linhas daria uma tabela de
  // 2 GB no Markdown. O total vai para o orçamento do documento (`orcamento.ts`), quando há um.
  let caracteres = 0;
  for (const linha of grade) for (const celula of linha) caracteres += celula.texto.length;
  if (caracteres > TEXTO_MAXIMO) {
    throw new ErroDocx({ motivo: "mescladas-demais" });
  }
  gastar?.(caracteres);
  return grade.map((linha) => linha.map((celula) => celula.texto));
}

/** Tabela do documento em grade regular. */
export function normalizarTabela(tabela: Tabela, gastar?: (caracteres: number) => void): TabelaNormalizada {
  if (!tabela.linhas.length) return { cabecalho: [], linhas: [] };
  let colunas = 0;
  for (const linha of tabela.linhas) {
    colunas = Math.max(
      colunas,
      linha.reduce((soma, celula) => soma + celula.colunas, 0),
    );
  }
  // Todas as linhas são completadas até a mais larga: uma linha desproporcional num arquivo
  // montado para isso multiplicaria a tabela inteira.
  if (colunas * tabela.linhas.length > CELULAS_MAXIMAS) {
    throw new ErroDocx({ motivo: "celulas-demais", limite: CELULAS_MAXIMAS });
  }
  const [cabecalho = [], ...linhas] = expandirMesclas(tabela.linhas, colunas, gastar);
  return { cabecalho, linhas };
}

function linhaMarkdown(celulas: string[], colunas: number): string {
  const valores = Array.from({ length: colunas }, (_, i) => aparar(celulas[i] ?? ""));
  return `| ${valores.join(" | ")} |`;
}

/** Coluna alinhada à direita quando mais da metade das células preenchidas é numérica. */
function alinhadaADireita(tabela: TabelaNormalizada, coluna: number): boolean {
  let numericas = 0;
  let total = 0;
  for (const linha of tabela.linhas) {
    const celula = linha[coluna];
    if (!celula) continue;
    total += 1;
    if (match(r`^[\d.,\s\-+]+%?$`, aparar(celula))) numericas += 1;
  }
  return total > 0 && numericas / total > 0.5;
}

/** Tabela pipe do Markdown; texto vazio para tabela vazia. */
export function tabelaEmMarkdown(tabela: TabelaNormalizada): string {
  if (!tabela.cabecalho.length && !tabela.linhas.length) return "";
  const colunas = colunasDaTabela(tabela);
  const separadores = Array.from({ length: colunas }, (_, i) => (alinhadaADireita(tabela, i) ? "---:" : "---"));
  return [
    linhaMarkdown(tabela.cabecalho, colunas),
    `|${separadores.join("|")}|`,
    ...tabela.linhas.map((linha) => linhaMarkdown(linha, colunas)),
  ].join("\n");
}
