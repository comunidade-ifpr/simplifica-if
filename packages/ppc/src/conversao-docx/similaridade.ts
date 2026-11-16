/**
 * Semelhança aproximada entre textos: o `fuzz.partial_ratio` do `rapidfuzz`, de que o ementário
 * depende para achar nomes de cidades com erro de digitação ("Sao Paulo", "Curitba").
 *
 * `partialRatio(a, b)` é a maior semelhança entre o texto mais curto (a agulha) e um trecho do
 * mais longo (o palheiro). A semelhança entre dois textos é `100 × (1 − d / (n + m))`, em que `d`
 * é a distância de inserções e remoções (`n + m − 2 × LCS`, com LCS a maior subsequência comum).
 * Os trechos comparados são os do `rapidfuzz` para agulhas de até 64 caracteres (acima disso ele
 * usa uma heurística; aqui o cálculo continua exato):
 * - os prefixos do palheiro mais curtos que a agulha;
 * - todas as janelas do tamanho da agulha;
 * - os sufixos mais curtos que a agulha.
 *
 * Com os dois textos do mesmo tamanho, vale o maior resultado entre as duas escolhas de agulha (os
 * prefixos e sufixos de um contra o outro inteiro, e vice-versa).
 *
 * A LCS é calculada pelo algoritmo de bits paralelos de Hyyrö: uma passada pelo trecho, com uma
 * palavra de 32 bits de estado, em que cada caractere do trecho entra como a máscara das posições
 * em que ele ocorre na agulha. Uma passada dá a LCS de todos os prefixos do trecho, o que resolve
 * de uma vez os prefixos e (com a agulha invertida, da direita para a esquerda) os sufixos.
 * Agulhas com mais de 32 caracteres caem na programação dinâmica clássica; o ementário só usa
 * agulhas de até 14.
 *
 * O resultado é o mesmo `double` do `rapidfuzz`, feito com as mesmas operações (a comparação com
 * o limiar 85 não pode divergir por arredondamento); `test/similaridade.test.ts` confere contra
 * escores gerados por ele.
 */

/** Semelhança normalizada, com a aritmética do `rapidfuzz`: `(1 − d / total) × 100`. */
function escore(lcs: number, tamanhoA: number, tamanhoB: number): number {
  const total = tamanhoA + tamanhoB;
  if (total === 0) return 100;
  return (1.0 - (total - 2 * lcs) / total) * 100;
}

function contarBits(valor: number): number {
  let v = valor >>> 0;
  v -= (v >>> 1) & 0x55555555;
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Agulha preparada para ser procurada em vários palheiros. */
export type Agulha = {
  caracteres: string[];
  /** Máscara das posições de cada caractere, e a mesma com a agulha invertida. */
  direta: Map<string, number>;
  invertida: Map<string, number>;
};

function mascaras(caracteres: string[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const [indice, caractere] of caracteres.entries()) {
    mapa.set(caractere, (mapa.get(caractere) ?? 0) | (1 << indice));
  }
  return mapa;
}

/** Prepara a agulha (por code point). Com mais de 32 caracteres, só `partialRatio` a aceita. */
export function prepararAgulha(texto: string): Agulha {
  const caracteres = Array.from(texto);
  return { caracteres, direta: mascaras(caracteres), invertida: mascaras(caracteres.toReversed()) };
}

/** Máscaras de cada caractere do palheiro em relação à agulha (0 para quem não ocorre nela). */
export function mascarasDoPalheiro(mapa: Map<string, number>, palheiro: string[]): Int32Array {
  const saida = new Int32Array(palheiro.length);
  for (let i = 0; i < palheiro.length; i += 1) saida[i] = mapa.get(palheiro[i]!) ?? 0;
  return saida;
}

/**
 * `partial_ratio` entre uma agulha de `n` caracteres (até 32) e o trecho `[inicio, fim)` do
 * palheiro, dado pelas máscaras de `mascarasDoPalheiro` (diretas e invertidas). O trecho tem de
 * ser mais longo que a agulha: com tamanhos iguais, use `partialRatio`, que compara nos dois sentidos.
 */
export function partialRatioNoTrecho(
  n: number,
  diretas: Int32Array,
  invertidas: Int32Array,
  inicio: number,
  fim: number,
): number {
  const validos = n === 32 ? 0xffffffff : (1 << n) - 1;
  let melhor = 0;
  let estado = 0xffffffff;
  // Prefixos mais curtos que a agulha.
  for (let k = 1; k < n; k += 1) {
    const u = (estado & diretas[inicio + k - 1]!) >>> 0;
    estado = ((estado + u) | (estado - u)) >>> 0;
    // Cada bit zerado no estado é um caractere da agulha na subsequência comum.
    const valor = escore(contarBits(~estado & validos), n, k);
    if (valor > melhor) melhor = valor;
  }
  // Janelas do tamanho da agulha; a última é também o maior dos sufixos.
  for (let i = inicio; i <= fim - n; i += 1) {
    estado = 0xffffffff;
    for (let j = i; j < i + n; j += 1) {
      const u = (estado & diretas[j]!) >>> 0;
      estado = ((estado + u) | (estado - u)) >>> 0;
    }
    const valor = escore(contarBits(~estado & validos), n, n);
    if (valor > melhor) melhor = valor;
  }
  // Sufixos mais curtos que a agulha: a LCS não muda com os dois textos invertidos.
  estado = 0xffffffff;
  for (let k = 1; k < n; k += 1) {
    const u = (estado & invertidas[fim - k]!) >>> 0;
    estado = ((estado + u) | (estado - u)) >>> 0;
    const valor = escore(contarBits(~estado & validos), n, k);
    if (valor > melhor) melhor = valor;
  }
  return melhor;
}

/** LCS por programação dinâmica, para agulhas que não cabem numa palavra. */
function lcsClassica(a: string[], b: string[], inicioB: number, fimB: number): number {
  let anterior = new Array<number>(a.length + 1).fill(0);
  for (let j = inicioB; j < fimB; j += 1) {
    const atual = [0];
    for (let i = 1; i <= a.length; i += 1) {
      atual.push(a[i - 1] === b[j] ? anterior[i - 1]! + 1 : Math.max(anterior[i]!, atual[i - 1]!));
    }
    anterior = atual;
  }
  return anterior[a.length]!;
}

/** `partial_ratio` com os papéis fixos: `agulha` contra os trechos de `palheiro`, que não é mais curto. */
function partialRatioOrientado(agulha: string[], palheiro: string[]): number {
  const n = agulha.length;
  const m = palheiro.length;
  if (n <= 32) {
    const diretas = mascarasDoPalheiro(mascaras(agulha), palheiro);
    const invertidas = mascarasDoPalheiro(mascaras(agulha.toReversed()), palheiro);
    return partialRatioNoTrecho(n, diretas, invertidas, 0, m);
  }
  let melhor = 0;
  for (let fim = 1; fim < n; fim += 1) melhor = Math.max(melhor, escore(lcsClassica(agulha, palheiro, 0, fim), n, fim));
  for (let i = 0; i <= m - n; i += 1) melhor = Math.max(melhor, escore(lcsClassica(agulha, palheiro, i, i + n), n, n));
  for (let i = m - n + 1; i < m; i += 1)
    melhor = Math.max(melhor, escore(lcsClassica(agulha, palheiro, i, m), n, m - i));
  return melhor;
}

/** `rapidfuzz.fuzz.partial_ratio(a, b)`, de 0 a 100. A comparação é por code point. */
export function partialRatio(a: string, b: string): number {
  let agulha = Array.from(a);
  let palheiro = Array.from(b);
  if (agulha.length > palheiro.length) [agulha, palheiro] = [palheiro, agulha];
  if (agulha.length === 0) return palheiro.length === 0 ? 100 : 0;
  const valor = partialRatioOrientado(agulha, palheiro);
  if (agulha.length !== palheiro.length || valor === 100) return valor;
  return Math.max(valor, partialRatioOrientado(palheiro, agulha));
}
