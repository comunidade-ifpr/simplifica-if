/**
 * Normalização de texto para reconhecer citações, com mapa de posições de volta ao original.
 *
 * O texto vira ASCII minúsculo (NFKD sem diacríticos), com `§` → `$`, `º`/`°` → `o`, travessões →
 * `-`, aspas tipográficas → aspas retas, `*` (ênfase do Markdown) e `<br>` → espaço. Cada caractere
 * normalizado guarda a posição do caractere original de onde veio, para recortar o trecho literal.
 */

export interface TextoNormalizado {
  texto: string;
  /** `origem[i]` é o índice (UTF-16) no original do caractere normalizado `i`; `origem[texto.length]` é o fim. */
  origem: Int32Array;
}

const SUBSTITUICOES: Readonly<Record<string, string>> = {
  "§": "$",
  º: "o",
  "°": "o",
  ª: "a",
  "–": "-",
  "—": "-",
  "‐": "-",
  "‑": "-",
  "−": "-",
  "“": '"',
  "”": '"',
  "„": '"',
  "″": '"',
  "‘": "'",
  "’": "'",
  "´": "'",
  "`": "'",
  "*": " ",
};

const cache = new Map<string, string>();

function normalizarCaractere(caractere: string): string {
  const substituto = SUBSTITUICOES[caractere];
  if (substituto !== undefined) return substituto;
  if (caractere.charCodeAt(0) < 0x80) return caractere.toLowerCase();
  let saida = cache.get(caractere);
  if (saida === undefined) {
    saida = caractere
      .normalize("NFKD")
      .replace(/[^\x00-\x7f]/g, "")
      .toLowerCase();
    cache.set(caractere, saida);
  }
  return saida;
}

export function normalizarComMapa(original: string): TextoNormalizado {
  const partes: string[] = [];
  const origem: number[] = [];
  let i = 0;
  while (i < original.length) {
    const codigo = original.codePointAt(i)!;
    const tamanho = codigo > 0xffff ? 2 : 1;
    const normalizado = normalizarCaractere(original.slice(i, i + tamanho));
    for (let k = 0; k < normalizado.length; k += 1) origem.push(i);
    partes.push(normalizado);
    i += tamanho;
  }
  origem.push(original.length);
  // `<br>` dos PPCs convertidos (quebras dentro de células) vira espaço, sem mudar o comprimento.
  const texto = partes.join("").replace(/<br\s*\/?>/g, (tag) => " ".repeat(tag.length));
  return { texto, origem: Int32Array.from(origem) };
}

/** Só o texto normalizado. */
export function normalizarCitacao(texto: string): string {
  return normalizarComMapa(texto).texto;
}
