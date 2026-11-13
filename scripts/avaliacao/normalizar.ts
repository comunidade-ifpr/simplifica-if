/**
 * Normalização de texto usada na pontuação: as respostas do agente e os padrões do gabarito são
 * comparados sem acentos, em minúsculas e com espaços colapsados, para que "Resolução CNE/CP nº 1/2021"
 * e "resolucao cne/cp n. 1/2021" casem com o mesmo padrão.
 */

const MARCAS_ORDINAIS: Readonly<Record<string, string>> = { º: "o", "°": "o", ª: "a" };

/** Remove acentos, ordinais e ênfase Markdown; minúsculas; espaços colapsados por linha. */
export function normalizarTexto(texto: string): string {
  return texto
    .replace(/[º°ª]/gu, (marca) => MARCAS_ORDINAIS[marca] ?? marca)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[*`_]/gu, "")
    .replace(/<br\s*\/?>/gu, " ")
    .replace(/[  -​ ]/gu, " ")
    .replace(/[‐-―]/gu, "-")
    .split(/\r\n|\r|\n/u)
    .map((linha) => linha.replace(/[ \t]+/gu, " ").trim())
    .join("\n");
}

/** Linhas não vazias do texto normalizado. */
export function linhasNormalizadas(texto: string): string[] {
  return normalizarTexto(texto)
    .split("\n")
    .filter((linha) => linha !== "");
}

/** Escapa um literal para uso dentro de uma expressão regular. */
export function escaparRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&");
}

/** Compila um padrão do gabarito (fonte de regex sobre texto normalizado). */
export function compilarPadrao(fonte: string): RegExp {
  return new RegExp(fonte, "u");
}

/** Comparação por código: a ordem não muda com a localidade da máquina. */
export function compararTexto(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** JSON determinístico com quebra final, no formato dos gabaritos gerados. */
export function serializarJson(valor: unknown): string {
  return `${JSON.stringify(valor, null, 2)}\n`;
}
