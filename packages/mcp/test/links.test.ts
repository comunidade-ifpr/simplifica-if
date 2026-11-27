import { describe, expect, test } from "vite-plus/test";
import { lerLink, linkCampus, linkCnct, linkCurso, linkDe, linkNorma, linkPpc } from "../src/links.ts";

describe("links ifpr:// (tabela de docs/plans/app-simplifica-if.md)", () => {
  test("norma, com e sem dispositivo", () => {
    expect(linkNorma("br/cne-cp/res/2026/2")).toBe("ifpr://norma/br/cne-cp/res/2026/2");
    expect(linkNorma("br/cne-cp/res/2026/2", "art28-xviii")).toBe("ifpr://norma/br/cne-cp/res/2026/2#art28-xviii");
    expect(linkNorma("br/cne-cp/res/2026/2#art28-xviii")).toBe("ifpr://norma/br/cne-cp/res/2026/2#art28-xviii");
    expect(linkNorma("br/cne-ceb/res/2025/3#art18A-par1")).toBe("ifpr://norma/br/cne-ceb/res/2025/3#art18A-par1");
    expect(linkNorma("externo:abnt/nbr/6023")).toBe("ifpr://norma/externo:abnt/nbr/6023");
  });

  test("curso", () => {
    expect(linkCurso("curso:curitiba/tecnico-em-enfermagem")).toBe("ifpr://curso/curitiba/tecnico-em-enfermagem");
    expect(linkCurso("curitiba/tecnico-em-enfermagem")).toBe("ifpr://curso/curitiba/tecnico-em-enfermagem");
  });

  test("ppc, com e sem seção; sem versão, o vigente", () => {
    expect(linkPpc("ppc:curitiba/tecnico-em-enfermagem/2023")).toBe("ifpr://ppc/curitiba/tecnico-em-enfermagem/2023");
    expect(linkPpc("curitiba/tecnico-em-enfermagem/2023", "avaliacao-1")).toBe(
      "ifpr://ppc/curitiba/tecnico-em-enfermagem/2023#avaliacao-1",
    );
    // ID da tabela secoes
    expect(linkPpc("curitiba/tecnico-em-enfermagem/2023#estagio_praticas-2")).toBe(
      "ifpr://ppc/curitiba/tecnico-em-enfermagem/2023#estagio_praticas-2",
    );
    expect(linkPpc("ppc:curitiba/tecnico-em-enfermagem")).toBe("ifpr://ppc/curitiba/tecnico-em-enfermagem");
  });

  test("cnct e campus", () => {
    expect(linkCnct("cnct:tecnico-em-enfermagem")).toBe("ifpr://cnct/tecnico-em-enfermagem");
    expect(linkCnct("tecnico-em-enfermagem")).toBe("ifpr://cnct/tecnico-em-enfermagem");
    expect(linkCampus("campus:curitiba")).toBe("ifpr://campus/curitiba");
    expect(linkCampus("curitiba")).toBe("ifpr://campus/curitiba");
  });

  test("linkDe escolhe pelo prefixo do ID canônico", () => {
    expect(linkDe("curso:curitiba/tecnico-em-enfermagem")).toBe("ifpr://curso/curitiba/tecnico-em-enfermagem");
    expect(linkDe("ppc:curitiba/tecnico-em-enfermagem/2023")).toBe("ifpr://ppc/curitiba/tecnico-em-enfermagem/2023");
    expect(linkDe("cnct:tecnico-em-enfermagem")).toBe("ifpr://cnct/tecnico-em-enfermagem");
    expect(linkDe("campus:curitiba")).toBe("ifpr://campus/curitiba");
    expect(linkDe("br/lei/1996/9394#art36")).toBe("ifpr://norma/br/lei/1996/9394#art36");
    expect(linkDe("externo:cft/res/2019/89")).toBe("ifpr://norma/externo:cft/res/2019/89");
  });

  test("recusa IDs fora do formato", () => {
    expect(() => linkCurso("curitiba")).toThrow('esperava "campus/curso"');
    expect(() => linkPpc("ppc:a/b/c/d")).toThrow('esperava "campus/curso" ou "campus/curso/versao"');
    expect(() => linkCampus("a/b")).toThrow("esperava um segmento");
    expect(() => linkNorma("")).toThrow("ID inválido");
    expect(() => linkNorma("br//lei")).toThrow("ID inválido");
    expect(() => linkNorma("com espaço")).toThrow("ID inválido");
    expect(() => linkNorma("br/lei/1996/9394#art36", "art37")).toThrow("já traz o fragmento");
    expect(() => linkNorma("br/lei/1996/9394", "art 36")).toThrow("fragmento inválido");
  });

  test("lerLink desmonta o que os construtores montam", () => {
    expect(lerLink("ifpr://norma/br/cne-cp/res/2026/2#art28-xviii")).toEqual({
      tipo: "norma",
      caminho: "br/cne-cp/res/2026/2",
      fragmento: "art28-xviii",
    });
    expect(lerLink(linkPpc("curitiba/tecnico-em-enfermagem/2023#avaliacao-1"))).toEqual({
      tipo: "ppc",
      caminho: "curitiba/tecnico-em-enfermagem/2023",
      fragmento: "avaliacao-1",
    });
    expect(lerLink("ifpr://campus/curitiba")).toEqual({ tipo: "campus", caminho: "curitiba", fragmento: null });
    expect(lerLink("https://ifpr.edu.br")).toBeNull();
    expect(lerLink("ifpr://outro/x")).toBeNull();
    expect(lerLink("ifpr://norma/a b")).toBeNull();
  });
});
