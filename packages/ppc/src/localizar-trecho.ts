/**
 * Onde está, no Markdown convertido do PPC, o trecho que uma pendência mostra: as linhas do primeiro ao
 * último pedaço (entre reticências), para o leitor abrir o documento rolado e destacado ali.
 *
 * O trecho guardado passou por `comoNoDocumento` (sem links, `*`, `|`, marcador de lista), então cada
 * linha do Markdown passa pela mesma limpeza e pela normalização da conferência antes da busca. O
 * trecho pode ser curto ("Lei nº 14.945/2024") e repetir-se no texto: vale a ocorrência dentro da seção
 * da pendência, se houver, e senão a primeira.
 */
import type { SecaoPpc } from "@simplifica-if/kb/ppcs/secoes";
import { alvoDosTrechos, pedacosDoTrecho } from "./revisao-ia/conferencia.ts";
import { comoNoDocumento } from "./verificadores/curriculo.ts";

export interface LinhasDoTrecho {
  /** Desde 1, como as âncoras do leitor. */
  readonly inicio: number;
  readonly fim: number;
}

/** Menos que isto, normalizado, casaria em qualquer lugar. */
const MINIMO = 4;

/** A marcação tirada vira espaço (`**CNCT**.` → `CNCT .`): sem espaço antes da pontuação, nos dois lados. */
const compactar = (texto: string) => texto.replace(/ (?=[.,;:!?)\]])/g, "").replace(/([([]) /g, "$1");

/**
 * As linhas normalizadas juntas num texto só, para a busca de um trecho que atravessa a quebra, e a
 * linha (desde 1) de cada posição dele. As linhas que a normalização deixa vazias ficam de fora, como no
 * `dobrar` da conferência, que junta os espaços: um trecho pode atravessar a linha em branco entre dois
 * parágrafos.
 */
export function indiceDeLinhas(linhas: readonly string[]): {
  readonly texto: string;
  readonly linhaDe: (posicao: number) => number;
} {
  const inicios: number[] = [];
  const numeros: number[] = [];
  const partes: string[] = [];
  let tamanho = 0;
  linhas.forEach((linha, i) => {
    if (linha.length === 0) return;
    inicios.push(tamanho);
    numeros.push(i + 1);
    partes.push(linha);
    tamanho += linha.length + 1;
  });
  const linhaDe = (posicao: number) => {
    let baixo = 0;
    let alto = inicios.length - 1;
    while (baixo < alto) {
      const meio = (baixo + alto + 1) >> 1;
      if (inicios[meio]! <= posicao) baixo = meio;
      else alto = meio - 1;
    }
    return numeros[baixo] ?? 1;
  };
  return { texto: partes.join(" "), linhaDe };
}

/**
 * Um localizador sobre o Markdown (prepare uma vez por documento): recebe o trecho e o título da seção
 * da pendência e devolve as linhas, ou `null` se o trecho não está no texto.
 */
export function localizadorDeLinhas(
  markdown: string,
  secoes: readonly Pick<SecaoPpc, "titulo" | "linhaInicio" | "linhaFim">[],
): (trecho: string, secao: string | null) => LinhasDoTrecho | null {
  const { texto, linhaDe } = indiceDeLinhas(
    markdown.split("\n").map((linha) => compactar(alvoDosTrechos(comoNoDocumento(linha)))),
  );

  return (trecho, secao) => {
    const pedacos = pedacosDoTrecho(trecho).map(compactar);
    if (pedacos.length === 0 || pedacos.reduce((t, p) => t + p.length, 0) < MINIMO) return null;
    const dentro = secao === null ? [] : secoes.filter((s) => s.titulo === secao);
    let primeira: LinhasDoTrecho | null = null;
    for (let desde = texto.indexOf(pedacos[0]!); desde >= 0; desde = texto.indexOf(pedacos[0]!, desde + 1)) {
      // Os outros pedaços, na ordem, depois do primeiro (reticências não reordenam o PPC).
      let fim = desde + pedacos[0]!.length;
      let achou = true;
      for (const p of pedacos.slice(1)) {
        const onde = texto.indexOf(p, fim);
        if (onde < 0) {
          achou = false;
          break;
        }
        fim = onde + p.length;
      }
      if (!achou) break;
      const linhasAchadas = { inicio: linhaDe(desde), fim: linhaDe(Math.max(desde, fim - 1)) };
      if (dentro.some((s) => s.linhaInicio <= linhasAchadas.inicio && linhasAchadas.inicio <= s.linhaFim))
        return linhasAchadas;
      primeira ??= linhasAchadas;
      if (dentro.length === 0) break;
    }
    return primeira;
  };
}
