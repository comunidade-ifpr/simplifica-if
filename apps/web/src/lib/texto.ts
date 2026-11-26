/** Ajudantes de texto comuns às telas, puros. */

/** "1 critério", "2 critérios". */
export const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;

/** O último trecho de um caminho, com `/` ou barra invertida. */
export const nomeDoArquivo = (caminho: string): string => caminho.split(/[\\/]/).at(-1) ?? caminho;
