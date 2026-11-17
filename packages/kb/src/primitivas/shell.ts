/**
 * `shlex.split(texto)` do Python (modo POSIX, sem comentários).
 *
 * - separa em espaço, tab, `\r` e `\n`;
 * - aspas simples preservam tudo; aspas duplas aceitam `\"` e `\\`;
 * - fora de aspas, `\` escapa o caractere seguinte;
 * - aspas vazias (`''`, `""`) produzem um argumento vazio.
 */

const ESPACOS = new Set([" ", "\t", "\r", "\n"]);

/** `shlex.split(texto)`. Lança `Error("ValueError: ...")` como o Python em aspas ou escape sem fim. */
export function dividirComandoShell(texto: string): string[] {
  const tokens: string[] = [];
  let atual = "";
  let emToken = false;
  let i = 0;
  const caracteres = Array.from(texto);
  while (i < caracteres.length) {
    const c = caracteres[i]!;
    if (ESPACOS.has(c)) {
      if (emToken) tokens.push(atual);
      atual = "";
      emToken = false;
      i += 1;
      continue;
    }
    emToken = true;
    if (c === "\\") {
      if (i + 1 >= caracteres.length) throw new Error("ValueError: No escaped character");
      atual += caracteres[i + 1];
      i += 2;
      continue;
    }
    if (c === "'") {
      const fim = caracteres.indexOf("'", i + 1);
      if (fim < 0) throw new Error("ValueError: No closing quotation");
      atual += caracteres.slice(i + 1, fim).join("");
      i = fim + 1;
      continue;
    }
    if (c === '"') {
      i += 1;
      for (;;) {
        if (i >= caracteres.length) throw new Error("ValueError: No closing quotation");
        const d = caracteres[i]!;
        if (d === '"') {
          i += 1;
          break;
        }
        if (d === "\\") {
          if (i + 1 >= caracteres.length) throw new Error("ValueError: No escaped character");
          const seguinte = caracteres[i + 1]!;
          atual += seguinte === '"' || seguinte === "\\" ? seguinte : `\\${seguinte}`;
          i += 2;
          continue;
        }
        atual += d;
        i += 1;
      }
      continue;
    }
    atual += c;
    i += 1;
  }
  if (emToken) tokens.push(atual);
  return tokens;
}
