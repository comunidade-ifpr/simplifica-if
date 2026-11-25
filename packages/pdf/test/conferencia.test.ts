import { describe, expect, it } from "vite-plus/test";
import { conferirPalavras } from "../src/conferencia.ts";

describe("conferirPalavras", () => {
  it("aceita mudança só de marcação, espaços e quebras", () => {
    const r = conferirPalavras(
      "## **2.4 PERFIL**\n\nO perfil do\n\negresso.",
      "### 2.4 PERFIL\n\nO perfil do egresso.",
    );
    expect(r.acrescentadas).toEqual([]);
    expect(r.removidas).toEqual([]);
  });

  it("lista a palavra acrescentada e a removida", () => {
    const r = conferirPalavras("Ministério da Educação\n\nO curso dura dois anos.", "O curso dura três anos.");
    expect(r.acrescentadas).toEqual([["três", 1]]);
    expect(r.removidas).toEqual([
      ["da", 1],
      ["dois", 1],
      ["Educação", 1],
      ["Ministério", 1],
    ]);
  });

  it("reconhece a palavra partida que volta a ser uma e a colada que é separada", () => {
    const r = conferirPalavras(
      "o estu- dante do C A M P U S e o INSTITUTOFEDERAL",
      "o estudante do CAMPUS e o INSTITUTO FEDERAL",
    );
    expect(r.acrescentadas).toEqual([]);
    expect(r.removidas).toEqual([]);
    expect(r.juncoes.map((j) => j.palavra).sort()).toEqual(["CAMPUS", "estudante"]);
    expect(r.separacoes).toEqual([{ palavra: "INSTITUTOFEDERAL", partes: ["INSTITUTO", "FEDERAL"] }]);
  });

  it("não aceita como junção a palavra cujos pedaços não saíram", () => {
    const r = conferirPalavras("o curso", "o cursocurso");
    expect(r.acrescentadas).toEqual([["cursocurso", 1]]);
  });
});
