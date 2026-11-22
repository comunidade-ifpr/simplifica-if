/**
 * Tabela em grade regular de textos e sua forma em Markdown.
 *
 * Uma célula mesclada não cabe numa tabela pipe; a grade sai de duas formas:
 *
 * - a de leitura (`normalizarTabela`), a do Markdown e do ementário: as colunas da grade que
 *   nenhuma linha separa viram uma só, a cópia horizontal que sobra fica vazia e a continuação
 *   vertical repete o texto de cima, para que cada linha se leia sozinha;
 * - a repetida (`formasDaTabela(...).repetida`), a da extração da matriz e da identificação: a
 *   célula mesclada se repete em cada posição que ocupa. "CARGA HORÁRIA TOTAL DO CURSO" mesclada
 *   sobre "Ano" e "Componente" chega nas duas colunas.
 *
 * A primeira linha é sempre o cabeçalho.
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

/** Posição da grade: o texto da célula que a ocupa e se ela é a cópia de uma mescla horizontal. */
type Posicao = { texto: string; copia: boolean };

/**
 * Expande as mesclas numa grade de `colunas` posições por linha. A célula de várias colunas ocupa
 * a primeira posição e marca as demais como cópias; a continuação de uma mescla vertical recebe o
 * texto da célula que começa na mesma coluna da linha de cima. `separadas[j]` diz se
 * alguma linha começa uma célula na coluna `j` (o preenchimento de uma linha curta não conta).
 */
function expandirMesclas(
  linhas: CelulaTabela[][],
  colunas: number,
  gastar?: (caracteres: number) => void,
): { grade: Posicao[][]; separadas: boolean[] } {
  // O texto de uma célula mesclada se repete na grade: é limpo uma vez só.
  const limpos = new Map<string, string>();
  const limpar = (texto: string) => {
    let limpo = limpos.get(texto);
    if (limpo === undefined) limpos.set(texto, (limpo = limparTextoDaCelula(texto)));
    return limpo;
  };
  const separadas = Array.from({ length: colunas }, (_, j) => j === 0);
  const grade: Posicao[][] = [];
  for (const [i, linha] of linhas.entries()) {
    const expandida: Posicao[] = [];
    for (const celula of linha) {
      separadas[expandida.length] = true;
      let texto = limpar(celula.texto);
      // A linha de cima é sempre tão larga quanto esta: todas são completadas até `colunas`.
      const acima = i > 0 ? grade[i - 1]![expandida.length]! : null;
      // A continuação mostra a célula de cima, como no Word. Se nada começa nessa coluna na linha
      // de cima (mescla malformada), a célula vale por si.
      if (celula.continuacao && acima && !acima.copia) texto = acima.texto;
      for (let k = 0; k < celula.colunas; k += 1) expandida.push({ texto, copia: k > 0 });
    }
    while (expandida.length < colunas) expandida.push({ texto: "", copia: false });
    grade.push(expandida);
  }
  // A mescla multiplica o texto: uma célula de 1 MB repetida em 2 mil linhas daria uma tabela de
  // 2 GB no Markdown. O total vai para o orçamento do documento (`orcamento.ts`), quando há um.
  let caracteres = 0;
  for (const linha of grade) for (const posicao of linha) caracteres += posicao.texto.length;
  if (caracteres > TEXTO_MAXIMO) {
    throw new ErroDocx({ motivo: "mescladas-demais" });
  }
  gastar?.(caracteres);
  return { grade, separadas };
}

function emCabecalhoELinhas(grade: string[][]): TabelaNormalizada {
  const [cabecalho = [], ...linhas] = grade;
  return { cabecalho, linhas };
}

/** As duas formas da tabela: a de leitura e a repetida (veja o início do módulo). */
export type FormasDaTabela = { leitura: TabelaNormalizada; repetida: TabelaNormalizada };

/**
 * Tabela do documento nas duas formas. `gastar` recebe os caracteres da forma repetida, a maior
 * das duas.
 */
export function formasDaTabela(tabela: Tabela, gastar?: (caracteres: number) => void): FormasDaTabela {
  if (!tabela.linhas.length) {
    const vazia = { cabecalho: [], linhas: [] };
    return { leitura: vazia, repetida: vazia };
  }
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
  const { grade, separadas } = expandirMesclas(tabela.linhas, colunas, gastar);
  const leitura = grade.map((linha) =>
    linha.flatMap((posicao, j) => (separadas[j] ? [posicao.copia ? "" : posicao.texto] : [])),
  );
  const repetida = grade.map((linha) => linha.map((posicao) => posicao.texto));
  return { leitura: emCabecalhoELinhas(leitura), repetida: emCabecalhoELinhas(repetida) };
}

/** Tabela do documento em grade regular, na forma de leitura. */
export function normalizarTabela(tabela: Tabela, gastar?: (caracteres: number) => void): TabelaNormalizada {
  return formasDaTabela(tabela, gastar).leitura;
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
