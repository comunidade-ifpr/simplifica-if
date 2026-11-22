import { describe, expect, test } from "vite-plus/test";
import { idEsperadoDaNorma, metadadosDoIdNorma } from "./ids.ts";

describe("metadadosDoIdNorma", () => {
  test("os metadados do ID, como o front matter os escreve", () => {
    expect(metadadosDoIdNorma("br/cne-ceb/res/2012/6")).toEqual({
      tipo_documento: "Resolução",
      orgao: "CNE/CEB",
      jurisdicao: "BR",
      numero: "6",
      ano: 2012,
    });
    expect(metadadosDoIdNorma("br/lei/1996/9394")).toMatchObject({
      tipo_documento: "Lei",
      orgao: "Presidência da República",
    });
    expect(metadadosDoIdNorma("ifpr/consup/res/2026/282")).toMatchObject({ orgao: "CONSUP/IFPR", jurisdicao: "IFPR" });
    expect(metadadosDoIdNorma("ifpr/reitoria/in/2021/1")).toMatchObject({
      tipo_documento: "Instrução Normativa",
      orgao: "Reitoria/IFPR",
    });
  });

  test("é o inverso de idEsperadoDaNorma", () => {
    for (const id of [
      "br/cne-cp/parecer/2002/29",
      "br/cne-ces/res/2018/7",
      "br/decreto/2011/7611",
      "br/decreto-lei/1969/1044",
      "br/lc/2001/107",
      "br/mec/portaria/2021/24",
      "ifpr/proens/nt/2025/1",
      "ifpr/proens/portaria/2021/26",
      "ifpr/reitoria/in/2021/1",
    ]) {
      expect(idEsperadoDaNorma(metadadosDoIdNorma(id)!)).toBe(id);
    }
  });

  test("ID que não é de ato não tem metadados", () => {
    expect(metadadosDoIdNorma("br/lei/1996/9394~compilacao")).toBeNull();
    expect(metadadosDoIdNorma("externo:abnt/nbr/6023")).toBeNull();
  });
});
