import { describe, expect, it } from "vite-plus/test";
import { conferirPalavras } from "../src/conferencia.ts";

describe("conferirPalavras", () => {
  it("aceita mudança só de marcação, espaços e quebras", () => {
    const r = conferirPalavras(
      "## **2.4 PERFIL**\n\nO perfil do\n\negresso.",
      "### 2.4 PERFIL\n\nO perfil do egresso.",
    );
    expect(r.novas).toEqual([]);
    expect(r.removidas).toEqual([]);
  });

  it("lista a palavra acrescentada e a removida", () => {
    const r = conferirPalavras("Ministério da Educação\n\nO curso dura dois anos.", "O curso dura três anos.");
    expect(r.novas).toEqual([["três", 1]]);
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
    expect(r.novas).toEqual([]);
    expect(r.removidas).toEqual([]);
    expect(r.juncoes.map((j) => j.palavra).sort()).toEqual(["CAMPUS", "estudante"]);
    expect(r.separacoes).toEqual([{ palavra: "INSTITUTOFEDERAL", partes: ["INSTITUTO", "FEDERAL"] }]);
  });

  it("não aceita como junção a palavra cujos pedaços não saíram", () => {
    const r = conferirPalavras("o curso", "o cursocurso");
    expect(r.novas).toEqual([["cursocurso", 1]]);
  });

  it("aceita, listando, a palavra que já existia e aparece mais vezes, e ignora o <br>", () => {
    const r = conferirPalavras("|Carga horária<br>H/A|H/R|", "|Carga horária H/A|Carga horária H/R|");
    expect(r.novas).toEqual([]);
    expect(r.repetidas).toEqual([
      ["Carga", 1],
      ["horária", 1],
    ]);
    expect(r.removidas).toEqual([]);
  });

  it("não aceita como repetido o número que já existia em outro ponto", () => {
    const r = conferirPalavras("Lei 7.498 de 1986, revista em 1996.", "Lei 7.498 de 1996, revista em 1996.");
    expect(r.novas).toEqual([["1996", 1]]);
    expect(r.removidas).toEqual([["1986", 1]]);
  });
});
