/**
 * `textwrap.wrap` do Python 3.14 com `break_on_hyphens=False`.
 *
 * Reproduz `TextWrapper` com as opções padrão (`expand_tabs`, tabulação 8,
 * `replace_whitespace`, `drop_whitespace`, sem recuos nem `max_lines`):
 * - os tabs viram espaços até a próxima coluna múltipla de 8 (`expandtabs`);
 * - só os espaços ASCII do `textwrap` (`\t\n\v\f\r `) separam palavras, e
 *   viram espaço simples;
 * - larguras contam code points;
 * - um pedaço só com espaços Unicode (por exemplo `\xa0`) é palavra para a
 *   divisão, mas é descartado como espaço no começo ou no fim de linha, como no
 *   Python (`chunk.strip() == ""`).
 *
 * A quebra em hífens (`break_on_hyphens=True`, o padrão do Python) não está
 * portada.
 */
import { aparar, contarCaracteres, prefixo } from "../texto.ts";
import { expandirTabs } from "./texto.ts";

export type OpcoesWrap = {
  /** `break_long_words` (padrão `true`): parte palavras maiores que a largura. */
  quebrarPalavrasLongas?: boolean;
};

const ESPACOS_TEXTWRAP = /[\t\n\v\f\r ]/g;
const SEPARADOR = /([\t\n\v\f\r ]+)/;

/** `TextWrapper._split_chunks` com `break_on_hyphens=False`. */
function pedacos(texto: string): string[] {
  const espacado = expandirTabs(texto, 8).replace(ESPACOS_TEXTWRAP, " ");
  return espacado.split(SEPARADOR).filter((pedaco) => pedaco !== "");
}

const soEspaco = (pedaco: string) => aparar(pedaco) === "";

/** `textwrap.wrap(texto, width=largura, break_on_hyphens=False, ...)`. */
export function wrap(texto: string, largura: number, opcoes: OpcoesWrap = {}): string[] {
  if (largura <= 0) throw new RangeError(`invalid width ${largura} (must be > 0)`);
  const quebrarLongas = opcoes.quebrarPalavrasLongas ?? true;
  const pilha = pedacos(texto).reverse();
  const linhas: string[] = [];
  while (pilha.length) {
    const linha: string[] = [];
    let tamanho = 0;
    if (soEspaco(pilha.at(-1)!) && linhas.length) pilha.pop();
    while (pilha.length) {
      const l = contarCaracteres(pilha.at(-1)!);
      if (tamanho + l <= largura) {
        linha.push(pilha.pop()!);
        tamanho += l;
      } else break;
    }
    if (pilha.length && contarCaracteres(pilha.at(-1)!) > largura) {
      // `_handle_long_word`
      const restante = largura < 1 ? 1 : largura - tamanho;
      if (quebrarLongas && restante > 0) {
        const pedaco = pilha.at(-1)!;
        const inicio = prefixo(pedaco, restante);
        linha.push(inicio);
        pilha[pilha.length - 1] = pedaco.slice(inicio.length);
      } else if (!linha.length) {
        linha.push(pilha.pop()!);
      }
      tamanho = linha.reduce((soma, pedaco) => soma + contarCaracteres(pedaco), 0);
    }
    if (linha.length && soEspaco(linha.at(-1)!)) {
      tamanho -= contarCaracteres(linha.at(-1)!);
      linha.pop();
    }
    if (linha.length) linhas.push(linha.join(""));
  }
  return linhas;
}
