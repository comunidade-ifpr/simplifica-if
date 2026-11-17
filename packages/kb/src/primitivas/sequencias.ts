/**
 * Similaridade de duas sequências pelos blocos casados mais longos
 * (Ratcliff e Obershelp), sem função de lixo e com a heurística `autojunk`
 * ligada por padrão: em sequências `b` com 200 elementos ou mais, os elementos
 * que aparecem em mais de 1% + 1 das posições deixam de iniciar casamentos.
 *
 * Textos são comparados por code point.
 */

export type Bloco = readonly [a: number, b: number, tamanho: number];

export class SequenceMatcher<T = string> {
  private readonly a: readonly T[];
  private readonly b: readonly T[];
  private readonly b2j = new Map<T, number[]>();
  private blocos: Bloco[] | null = null;

  constructor(a: string | readonly T[], b: string | readonly T[], autojunk = true) {
    this.a = (typeof a === "string" ? Array.from(a) : a) as readonly T[];
    this.b = (typeof b === "string" ? Array.from(b) : b) as readonly T[];
    this.b.forEach((elemento, j) => {
      const indices = this.b2j.get(elemento);
      if (indices) indices.push(j);
      else this.b2j.set(elemento, [j]);
    });
    const n = this.b.length;
    if (autojunk && n >= 200) {
      const limite = Math.floor(n / 100) + 1;
      // cópia: o laço apaga do próprio mapa
      for (const [elemento, indices] of Array.from(this.b2j)) {
        if (indices.length > limite) this.b2j.delete(elemento);
      }
    }
  }

  /** O bloco casado mais longo entre `a[alo:ahi]` e `b[blo:bhi]`. */
  encontrarMaiorCasamento(alo: number, ahi: number, blo: number, bhi: number): Bloco {
    const { a, b, b2j } = this;
    let melhorI = alo;
    let melhorJ = blo;
    let melhorTamanho = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i += 1) {
      const novo = new Map<number, number>();
      for (const j of b2j.get(a[i]!) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        novo.set(j, k);
        if (k > melhorTamanho) {
          melhorI = i - k + 1;
          melhorJ = j - k + 1;
          melhorTamanho = k;
        }
      }
      j2len = novo;
    }
    // Sem função de lixo, o conjunto de lixo é vazio: só a extensão por elementos
    // não-lixo se aplica (inclui os populares retirados de b2j).
    while (melhorI > alo && melhorJ > blo && a[melhorI - 1] === b[melhorJ - 1]) {
      melhorI -= 1;
      melhorJ -= 1;
      melhorTamanho += 1;
    }
    while (
      melhorI + melhorTamanho < ahi &&
      melhorJ + melhorTamanho < bhi &&
      a[melhorI + melhorTamanho] === b[melhorJ + melhorTamanho]
    ) {
      melhorTamanho += 1;
    }
    return [melhorI, melhorJ, melhorTamanho];
  }

  /** Os blocos casados, em ordem, com o bloco sentinela final `(a.length, b.length, 0)`. */
  blocosCasados(): Bloco[] {
    if (this.blocos) return this.blocos;
    const la = this.a.length;
    const lb = this.b.length;
    const fila: Array<[number, number, number, number]> = [[0, la, 0, lb]];
    const casados: Bloco[] = [];
    while (fila.length) {
      const [alo, ahi, blo, bhi] = fila.pop()!;
      const bloco = this.encontrarMaiorCasamento(alo, ahi, blo, bhi);
      const [i, j, k] = bloco;
      if (k) {
        casados.push(bloco);
        if (alo < i && blo < j) fila.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) fila.push([i + k, ahi, j + k, bhi]);
      }
    }
    casados.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
    const naoAdjacentes: Bloco[] = [];
    let [i1, j1, k1] = [0, 0, 0];
    for (const [i2, j2, k2] of casados) {
      if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2;
      else {
        if (k1) naoAdjacentes.push([i1, j1, k1]);
        [i1, j1, k1] = [i2, j2, k2];
      }
    }
    if (k1) naoAdjacentes.push([i1, j1, k1]);
    naoAdjacentes.push([la, lb, 0]);
    this.blocos = naoAdjacentes;
    return naoAdjacentes;
  }

  /** Razão de similaridade: `2 * M / T`, com M elementos casados e T o total das duas sequências. */
  ratio(): number {
    const casados = this.blocosCasados().reduce((soma, [, , k]) => soma + k, 0);
    const total = this.a.length + this.b.length;
    return total ? (2.0 * casados) / total : 1.0;
  }
}
