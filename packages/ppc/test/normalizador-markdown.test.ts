/**
 * Consolidação de parágrafos do normalizador: a versão em tempo linear tem de dar a mesma saída
 * da original, que avaliava o texto acumulado inteiro a cada linha unida (custo quadrático: 40 mil
 * parágrafos curtos sem pontuação levavam 19 s).
 */
import { match, search } from "@simplifica-if/kb/python/re";
import { aparar, apararFim } from "@simplifica-if/kb/texto";
import { describe, expect, test } from "vite-plus/test";
import { consolidarParagrafos, ehParagrafoContinuavel, normalizarMarkdown } from "../src/normalizador-markdown.ts";

/** A consolidação como era antes (porte direto do `markdown_normalizer.py`), para comparar. */
function consolidarDeReferencia(linhas: string[]): string[] {
  const deveUnir = (atualOriginal: string, proximaOriginal: string): boolean => {
    const atual = aparar(atualOriginal);
    const proxima = aparar(proximaOriginal);
    if (!atual || !proxima) return false;
    if (!ehParagrafoContinuavel(atual) || !ehParagrafoContinuavel(proxima)) return false;
    if (search("[.!?]$", atual)) return false;
    if (atual.endsWith("-")) return true;
    return Boolean(match("^[a-zà-ÿ0-9(]", proxima));
  };
  const resultado: string[] = [];
  let indice = 0;
  while (indice < linhas.length) {
    const atual = linhas[indice]!;
    if (!ehParagrafoContinuavel(atual)) {
      resultado.push(atual);
      indice += 1;
      continue;
    }
    let consolidado = aparar(atual);
    while (indice + 1 < linhas.length && deveUnir(consolidado, linhas[indice + 1]!)) {
      const proxima = aparar(linhas[indice + 1]!);
      consolidado = consolidado.endsWith("-")
        ? apararFim(consolidado.slice(0, -1)) + proxima
        : `${consolidado} ${proxima}`;
      indice += 1;
    }
    resultado.push(consolidado);
    indice += 1;
  }
  return resultado;
}

/** Gerador congruente linear: os casos são sempre os mesmos. */
function sorteador(semente: number): (limite: number) => number {
  let estado = semente;
  return (limite) => {
    estado = (Math.imul(estado, 1103515245) + 12345) >>> 0;
    return (estado >>> 8) % limite;
  };
}

const PEDACOS = [
  "texto corrido sem ponto",
  "continua em minúscula",
  "Começa com maiúscula",
  "termina com ponto.",
  "pergunta?",
  "hifeni-",
  "-",
  "- item de lista",
  "1. item numerado",
  "1.",
  "12",
  "3)",
  "1.2.3",
  "2026 começa com número",
  "(entre parênteses)",
  "# título",
  "> citação",
  "![imagem](x.png)",
  "<br>",
  "| célula | outra |",
  "termina em barra |",
  "```",
  "TEXTO EM MAIÚSCULAS",
  "",
  "   ",
  "  recuado e com espaço no fim  ",
  "à moda antiga",
  "é assim",
  "0 zero",
  "!",
  "[x",
  "a -",
  "palavra ".repeat(60),
  "1234567890".repeat(30),
  "9".repeat(2100),
  "x".repeat(2100),
  "٣ algarismo árabe",
  "termina em exclamação!",
  "1)".repeat(1100),
  "1.".repeat(1100),
  "12-",
  "1)-",
  "1.2-",
  "9".repeat(2100) + "-",
  "9".repeat(2100) + ")",
  "9".repeat(2100) + ".",
  "0",
  "(",
  ")",
  ".",
  "1.2.3." + "4".repeat(2100),
  "-" + "9".repeat(2100),
  "* " + "9".repeat(2100),
  "7 " + "x".repeat(2100),
  "7. " + "x".repeat(2100),
  "7.x" + "y".repeat(2100),
];

describe("consolidarParagrafos", () => {
  test("dá a mesma saída da versão original em sequências sorteadas", () => {
    const sortear = sorteador(20261116);
    for (let caso = 0; caso < 400; caso += 1) {
      const linhas = Array.from({ length: 1 + sortear(60) }, () => PEDACOS[sortear(PEDACOS.length)]!);
      expect(consolidarParagrafos(linhas), JSON.stringify(linhas).slice(0, 300)).toEqual(
        consolidarDeReferencia(linhas),
      );
    }
  });

  test("dá a mesma saída em parágrafos longos, que passam do limite de remontagem", () => {
    const sortear = sorteador(7);
    const comuns = [
      "texto corrido sem ponto",
      "continua em minúscula",
      "hifeni-",
      "a -",
      "palavra ".repeat(60),
      "(entre parênteses)",
      "0 zero",
    ];
    for (const inicio of [
      "começo",
      "1.",
      "12",
      "9".repeat(2100),
      "1. item",
      "2026 texto",
      "-",
      "```",
      "!-",
      "TEXTO",
      "٣".repeat(2100),
      "1)".repeat(1100),
      "1.".repeat(1100),
      "9".repeat(2100) + "-",
      "9".repeat(2100) + ")",
      "1.2.3." + "4".repeat(2100),
      "12-",
      "1)-",
      "#-",
      ">-",
      "|-",
      "<-",
      "``-",
      "*-",
      "+-",
    ]) {
      for (const fim of ["termina com ponto.", "| célula |", "termina em barra |", "# título", "Maiúscula", ""]) {
        const linhas = [
          inicio,
          "[x",
          ...Array.from({ length: 150 }, () => comuns[sortear(comuns.length)]!),
          fim,
          "depois",
        ];
        expect(consolidarParagrafos(linhas), `${inicio.slice(0, 20)} … ${fim}`).toEqual(consolidarDeReferencia(linhas));
      }
    }
  });

  test(
    "começo só de numeração, com mais de 2 mil caracteres, seguido de 80 mil linhas: a decisão é tomada uma vez",
    { timeout: 5_000 },
    () => {
      // Antes, com o começo indeciso, o texto inteiro era remontado a cada linha unida (74 s).
      const linhas = ["1)".repeat(1100), ...Array.from({ length: 80_000 }, (_, i) => `a${i.toString(36)}`)];
      const consolidadas = consolidarParagrafos(linhas);
      expect(consolidadas).toHaveLength(1);
      expect(consolidadas[0]!.length).toBe(linhas.join(" ").length);
      // Num caso menor, igual à versão original.
      const menor = linhas.slice(0, 600);
      expect(consolidarParagrafos(menor)).toEqual(consolidarDeReferencia(menor));
    },
  );

  test("200 mil linhas curtas sem pontuação em tempo linear", { timeout: 15_000 }, () => {
    const linhas = Array.from({ length: 200_000 }, (_, i) => `linha ${i} sem pontuação`);
    const [unico, ...resto] = consolidarParagrafos(linhas);
    expect(resto).toEqual([]);
    expect(unico!.startsWith("linha 0 sem pontuação linha 1 sem pontuação")).toBe(true);
    expect(unico!.endsWith("linha 199999 sem pontuação")).toBe(true);
    // E pela normalização inteira.
    const texto = linhas.slice(0, 50_000).join("\n");
    expect(normalizarMarkdown(texto).markdownNormalizado.split("\n")).toHaveLength(2);
  });
});
