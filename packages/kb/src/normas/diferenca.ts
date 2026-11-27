/**
 * A diferença palavra a palavra entre o texto de um dispositivo e o dos correspondentes dele (o modo
 * Comparar do app): os trechos de cada lado, com as palavras que mudaram marcadas.
 *
 * As palavras se comparam sem a pontuação das pontas e com travessões e aspas unificados: "Tecnológica."
 * e "Tecnológica" são a mesma palavra, e "–" e "-" também. Os destinos (1→N) se comparam juntos, na
 * ordem, como um texto só, e voltam separados. Acima de `LIMIAR_REESCRITA` das palavras mudadas, o grifo
 * por palavra não ajuda a ler: os trechos voltam inteiros, sem marca, e `reescrito` diz por quê.
 */

/** Um pedaço do texto, com as palavras que mudaram (`mudou`) ou as que ficaram. */
export interface Trecho {
  readonly texto: string;
  readonly mudou: boolean;
}

export interface Diferenca {
  readonly origem: ReadonlyArray<Trecho>;
  /** Os trechos de cada destino, na ordem pedida. */
  readonly destinos: ReadonlyArray<ReadonlyArray<Trecho>>;
  /** As mesmas palavras dos dois lados, na mesma ordem (depois de normalizar). */
  readonly identicos: boolean;
  /** Mais de `LIMIAR_REESCRITA` das palavras mudaram: os trechos vêm sem marca. */
  readonly reescrito: boolean;
}

/** A fração de palavras mudadas acima da qual o par aparece inteiro, sem grifo por palavra. */
export const LIMIAR_REESCRITA = 0.6;

/** Acima deste tamanho da tabela da subsequência comum (palavras × palavras), o par vai sem grifo. */
const MAXIMO_CELULAS = 4_000_000;

const PONTAS = /^[.,;:!?()[\]]+|[.,;:!?()[\]]+$/g;

/** A chave de comparação de uma palavra. */
function chave(palavra: string): string {
  return palavra
    .normalize("NFC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[“”„«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(PONTAS, "");
}

interface Token {
  readonly texto: string;
  /** Índice da palavra no lado (todas as palavras dos destinos em sequência); `null` no espaço. */
  readonly palavra: number | null;
}

/** Os tokens do texto (palavras e espaços, na ordem), com as palavras numeradas a partir de `inicio`. */
function tokens(texto: string, inicio: number): { readonly tokens: Token[]; readonly chaves: string[] } {
  const saida: Token[] = [];
  const chaves: string[] = [];
  for (const m of texto.matchAll(/\s+|\S+/g)) {
    if (/^\s/.test(m[0])) saida.push({ texto: m[0], palavra: null });
    else {
      saida.push({ texto: m[0], palavra: inicio + chaves.length });
      chaves.push(chave(m[0]));
    }
  }
  return { tokens: saida, chaves };
}

/** As palavras de `a` e de `b` fora da maior subsequência comum, ou `null` se a tabela passa do teto. */
function foraDaComum(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): { readonly a: boolean[]; readonly b: boolean[] } | null {
  const n = a.length;
  const m = b.length;
  if ((n + 1) * (m + 1) > MAXIMO_CELULAS) return null;
  const largura = m + 1;
  const tabela = new Uint32Array((n + 1) * largura);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      tabela[i * largura + j] =
        a[i] === b[j]
          ? tabela[(i + 1) * largura + j + 1]! + 1
          : Math.max(tabela[(i + 1) * largura + j]!, tabela[i * largura + j + 1]!);
    }
  }
  const foraA = Array.from({ length: n }, () => true);
  const foraB = Array.from({ length: m }, () => true);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      foraA[i] = false;
      foraB[j] = false;
      i += 1;
      j += 1;
    } else if (tabela[(i + 1) * largura + j]! >= tabela[i * largura + j + 1]!) i += 1;
    else j += 1;
  }
  return { a: foraA, b: foraB };
}

/** Junta os tokens em trechos: o espaço entre duas palavras mudadas também mudou. */
function trechos(lista: ReadonlyArray<Token>, mudou: (palavra: number) => boolean): Trecho[] {
  const saida: { texto: string; mudou: boolean }[] = [];
  lista.forEach((t, k) => {
    const marcado =
      t.palavra !== null
        ? mudou(t.palavra)
        : (lista[k - 1]?.palavra ?? null) !== null &&
          (lista[k + 1]?.palavra ?? null) !== null &&
          mudou(lista[k - 1]!.palavra!) &&
          mudou(lista[k + 1]!.palavra!);
    const ultimo = saida.at(-1);
    if (ultimo && ultimo.mudou === marcado) ultimo.texto += t.texto;
    else saida.push({ texto: t.texto, mudou: marcado });
  });
  return saida;
}

const inteiro = (texto: string): Trecho[] => (texto === "" ? [] : [{ texto, mudou: false }]);

/** A diferença entre o texto de origem e os textos de destino, palavra a palavra. */
export function diferencaPalavras(origem: string, destinos: ReadonlyArray<string>): Diferenca {
  const ladoA = tokens(origem, 0);
  const ladosB: ReturnType<typeof tokens>[] = [];
  let inicio = 0;
  for (const d of destinos) {
    const lado = tokens(d, inicio);
    ladosB.push(lado);
    inicio += lado.chaves.length;
  }
  const chavesB = ladosB.flatMap((l) => l.chaves);
  const identicos = ladoA.chaves.length === chavesB.length && ladoA.chaves.every((c, k) => c === chavesB[k]);
  const semGrifo = (reescrito: boolean): Diferenca => ({
    origem: inteiro(origem),
    destinos: destinos.map(inteiro),
    identicos,
    reescrito,
  });
  if (identicos) return semGrifo(false);
  const fora = foraDaComum(ladoA.chaves, chavesB);
  if (fora === null) return semGrifo(true);
  const total = ladoA.chaves.length + chavesB.length;
  const mudadas = fora.a.filter(Boolean).length + fora.b.filter(Boolean).length;
  if (mudadas / total > LIMIAR_REESCRITA) return semGrifo(true);
  return {
    origem: trechos(ladoA.tokens, (p) => fora.a[p]!),
    destinos: ladosB.map((l) => trechos(l.tokens, (p) => fora.b[p]!)),
    identicos,
    reescrito: false,
  };
}
