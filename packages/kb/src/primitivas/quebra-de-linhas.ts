/**
 * Quebra de um texto em linhas de até `largura` caracteres, sem quebrar em hífens:
 * - os tabs viram espaços até a próxima coluna múltipla de 8 (`expandirTabs`);
 * - só os espaços ASCII (`\t\n\v\f\r `) separam palavras, e
 *   viram espaço simples;
 * - larguras contam code points;
 * - um pedaço só com espaços Unicode (por exemplo `\xa0`) é palavra para a
 *   divisão, mas é descartado como espaço no começo ou no fim de linha;
 * - sem recuos nem limite de linhas.
 *
 * A quebra em hífens não está implementada.
 */
import { aparar, contarCaracteres, prefixo } from "../texto.ts";
import { expandirTabs } from "./texto.ts";

export type OpcoesWrap = {
  /** Parte palavras maiores que a largura (padrão `true`). */
  quebrarPalavrasLongas?: boolean;
};

const ESPACOS_ASCII = /[\t\n\v\f\r ]/g;
const SEPARADOR = /([\t\n\v\f\r ]+)/;

/** Pedaços do texto: palavras e sequências de espaços. */
function pedacos(texto: string): string[] {
  const espacado = expandirTabs(texto, 8).replace(ESPACOS_ASCII, " ");
  return espacado.split(SEPARADOR).filter((pedaco) => pedaco !== "");
}

const soEspaco = (pedaco: string) => aparar(pedaco) === "";

/** Linhas do texto, de até `largura` caracteres. */
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
      // palavra maior que a linha
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
