import { describe, expect, it } from "@effect/vitest";
import { blocoDaLinha, dividirEmBlocos, ordemDeMontagem } from "./blocos.ts";

const linhas = (n: number, prefixo: string) => Array.from({ length: n }, (_, i) => `${prefixo} ${i + 1}`);

describe("dividirEmBlocos", () => {
  it("corta só antes de cabeçalho, com a linha inicial de cada bloco, e não perde texto", () => {
    const md = [
      "# Título",
      ...linhas(5, "a"),
      "## Seção 2",
      ...linhas(5, "b"),
      "texto # não é cabeçalho",
      "### Três",
      "c",
    ].join("\n");
    const blocos = dividirEmBlocos(md, 10);
    expect(blocos.map((b) => b.texto.split("\n")[0])).toEqual(["# Título", "## Seção 2", "### Três"]);
    expect(blocos.map((b) => b.linhaInicial)).toEqual([1, 7, 14]);
    expect(blocos.map((b) => b.linhaFinal)).toEqual([6, 13, 15]);
    expect(blocos.map((b) => b.texto).join("\n")).toBe(md);
  });

  it("não corta dentro de bloco de código cercado nem antes de atingir o tamanho", () => {
    const md = ["# A", "x".repeat(50), "```", "# comentário de código", "```", "# B", "y"].join("\n");
    expect(dividirEmBlocos(md, 20).map((b) => b.linhaInicial)).toEqual([1, 6]);
    expect(dividirEmBlocos(md, 10_000)).toHaveLength(1);
  });

  it("documento sem cabeçalho fica num bloco só", () => {
    expect(dividirEmBlocos(linhas(100, "linha").join("\n"), 10)).toHaveLength(1);
  });
});

describe("blocoDaLinha e ordemDeMontagem", () => {
  it("acha o bloco da linha e monta a partir dele, alternando os vizinhos", () => {
    const blocos = dividirEmBlocos(["# A", "a", "# B", "b", "# C", "c"].join("\n"), 1);
    expect(blocos).toHaveLength(3);
    expect(blocoDaLinha(blocos, 4)).toBe(1);
    expect(blocoDaLinha(blocos, 99)).toBe(2);
    expect(ordemDeMontagem(5, 2)).toEqual([2, 3, 1, 4, 0]);
    expect(ordemDeMontagem(3, 0)).toEqual([0, 1, 2]);
  });
});
