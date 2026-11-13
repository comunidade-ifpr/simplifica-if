/**
 * Quebra de linhas do `Paragraph` do `reportlab` 5.1, para que o PDF do
 * `pdfmake` tenha as mesmas linhas do script Python.
 *
 * O `pdfmake` quebra pelas regras do Unicode (UAX #14), que também permitem
 * quebrar depois de `/` e de `-`; o `reportlab` só quebra em espaços. Por isso
 * o texto é quebrado aqui e entregue ao `pdfmake` com as linhas já separadas
 * por `\n`.
 *
 * Dois modos, como nos estilos do script Python:
 * - `normal` (`breakLines`): palavras separadas por espaço; a palavra entra na
 *   linha se `largura + espaço + palavra` não passar da largura útil mais 5%
 *   dos espaços da linha (`rl_config.spaceShrinkage`). O espaço entre palavras
 *   é medido e desenhado na fonte do trecho em que ele está.
 * - `cjk` (`cjkFragSplit`, usado nas células com `wordWrap="CJK"`): soma
 *   caractere a caractere, inclusive o espaço que segue a palavra; ao
 *   estourar, volta até o último espaço na segunda metade da linha e, se não
 *   houver, corta a palavra no meio.
 *
 * Fora do escopo (o relatório não usa): hifenização e divisão de palavras
 * mais largas que a linha no modo `normal`.
 */

export type Peca = { text: string };
export type Linha<T extends Peca> = T[];
/** Largura, em pontos, de um texto no estilo da peça. */
export type Medidor<T extends Peca> = (texto: string, peca: T) => number;

const FUZZ = 1e-6;
const ENCOLHIMENTO_ESPACO = 0.05;
/** `reportlab.lib.textsplit.ALL_CANNOT_START`. */
const NAO_INICIA_LINHA = new Set(
  "!',.:;?!\")]、。」』】〕］】）" +
    "々―ぁぃぅぇぉっゃゅょゎァィ" +
    "ゥェォッャュョヮーヵヶ" +
    "゛゜・ヽヾゝゞ―‐\xb0′″℃￠％‰",
);
const RE_ESPACO_ZS = /^\p{Zs}$/u;

function larguraMaxima(larguras: readonly number[], linha: number): number {
  return larguras[Math.min(linha, larguras.length - 1)]!;
}

/** Junta caracteres consecutivos da mesma peça. */
function agrupar<T extends Peca>(caracteres: Array<{ c: string; peca: T }>): Linha<T> {
  const linha: Linha<T> = [];
  let anterior: T | undefined;
  for (const { c, peca } of caracteres) {
    if (peca === anterior) linha[linha.length - 1]!.text += c;
    else linha.push({ ...peca, text: c });
    anterior = peca;
  }
  return linha;
}

/** Tira espaços do fim da linha (o `reportlab` os desenha, mas não aparecem). */
function semEspacoFinal<T extends Peca>(linha: Linha<T>): Linha<T> {
  while (linha.length) {
    const ultima = linha.at(-1)!;
    ultima.text = ultima.text.replace(/ +$/, "");
    if (ultima.text) break;
    linha.pop();
  }
  return linha;
}

/** `breakLines` (caso de vários fragmentos) sobre peças com espaços já colapsados. */
export function quebrarNormal<T extends Peca>(pecas: T[], larguras: readonly number[], medir: Medidor<T>): Linha<T>[] {
  // `espaco`: o espaço que precede a palavra, no trecho em que ele está.
  type Palavra = { partes: Linha<T>; largura: number; espaco: T | null };
  const palavras: Palavra[] = [];
  let atual: Array<{ c: string; peca: T }> = [];
  let espaco: T | null = null;
  const fecharPalavra = () => {
    if (!atual.length) return;
    const partes = agrupar(atual);
    const largura = partes.reduce((total, parte) => total + medir(parte.text, parte), 0);
    palavras.push({ partes, largura, espaco });
    atual = [];
  };
  for (const peca of pecas) {
    for (const c of peca.text) {
      if (c === " ") {
        fecharPalavra();
        espaco = peca;
      } else atual.push({ c, peca });
    }
  }
  fecharPalavra();

  const linhas: Linha<T>[] = [];
  let linha: Palavra[] = [];
  let larguraAtual = 0;
  let espacos = 0;
  const fecharLinha = () => {
    const saida: Linha<T> = [];
    linha.forEach((palavra, i) => {
      if (i > 0 && palavra.espaco) saida.push({ ...palavra.espaco, text: " " });
      for (const parte of palavra.partes) saida.push({ ...parte });
    });
    linhas.push(saida);
  };
  for (const palavra of palavras) {
    const espaco = linha.length && palavra.espaco ? medir(" ", palavra.espaco) : 0;
    const nova = larguraAtual + espaco + palavra.largura;
    const limite = larguraMaxima(larguras, linhas.length) + ENCOLHIMENTO_ESPACO * (espacos + espaco);
    if (nova > limite && linha.length) {
      fecharLinha();
      linha = [palavra];
      larguraAtual = palavra.largura;
      espacos = 0;
    } else {
      linha.push(palavra);
      larguraAtual = nova;
      espacos += espaco;
    }
  }
  if (linha.length) fecharLinha();
  return linhas;
}

/** `cjkFragSplit`: quebra caractere a caractere, voltando ao último espaço da segunda metade da linha. */
export function quebrarCjk<T extends Peca>(pecas: T[], larguras: readonly number[], medir: Medidor<T>): Linha<T>[] {
  const caracteres: Array<{ c: string; peca: T; largura: number }> = [];
  for (const peca of pecas) for (const c of peca.text) caracteres.push({ c, peca, largura: medir(c, peca) });

  const linhas: Linha<T>[] = [];
  let i = 0;
  let usada = 0;
  let inicioLinha = 0;
  let maxima = larguraMaxima(larguras, 0);
  while (i < caracteres.length) {
    let u = caracteres[i]!;
    i += 1;
    usada += u.largura;
    if (!(usada > maxima + FUZZ && usada > 0)) continue;
    if (u.c.codePointAt(0)! < 0x3000) {
      const limite = (inicioLinha + i) >> 1;
      for (let j = i - 1; j > limite; j--) {
        const uj = caracteres[j]!;
        if (RE_ESPACO_ZS.test(uj.c) || uj.c.codePointAt(0)! >= 0x3000) {
          const k = j + 1;
          if (k < i) {
            u = caracteres[k]!;
            i = k + 1;
            break;
          }
        }
      }
    }
    if (!NAO_INICIA_LINHA.has(u.c) && i > inicioLinha + 1) i -= 1;
    linhas.push(semEspacoFinal(agrupar(caracteres.slice(inicioLinha, i))));
    maxima = larguraMaxima(larguras, linhas.length);
    inicioLinha = i;
    usada = 0;
  }
  if (usada > 0) linhas.push(semEspacoFinal(agrupar(caracteres.slice(inicioLinha))));
  return linhas;
}
