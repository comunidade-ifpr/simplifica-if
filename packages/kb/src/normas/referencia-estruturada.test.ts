import { describe, expect, test } from "bun:test";
import { analisarDispositivos } from "./dispositivos.ts";
import { ehIdAto, ehIdCnct, RE_ID_ATO_COM_DISPOSITIVO, RE_REFERENCIA, semAcento } from "./ids.ts";
import {
  agruparReferencias,
  carregarUniversoReferencias,
  esquemaReferenciaNormativa,
  type ReferenciaNormativa,
  referenciasLegiveis,
  textoIdComDispositivo,
} from "./referencia-estruturada.ts";
import { normalizarCitacao } from "./texto-citacao.ts";
import { partesDispositivo, textoDispositivos } from "./texto-dispositivos.ts";

const universo = carregarUniversoReferencias();

describe("ids", () => {
  test("semAcento descarta o que não vira ASCII", () => {
    expect(semAcento("Ação ß Ⅻ ﬁ")).toBe("acao  xii fi");
  });

  test("referência citável: ato sem variante, externo: ou cnct:", () => {
    for (const id of ["br/cne-cp/res/2026/2", "br/lei/1996/9394", "externo:abnt/nbr/6023", "cnct:catalogo"]) {
      expect(RE_REFERENCIA.test(id)).toBe(true);
    }
    for (const id of ["br/lei/1996/9394~compilacao", "Resolução CNE/CP nº 2/2026", "cnct:", "br/cne-cp/res/2026/02"]) {
      expect(RE_REFERENCIA.test(id)).toBe(false);
    }
    expect(ehIdAto("br/lei/1996/9394")).toBe(true);
    expect(ehIdAto("br/lei/1996/9394~compilacao")).toBe(false);
    expect(ehIdCnct("cnct:tecnico-em-enfermagem")).toBe(true);
    expect(RE_ID_ATO_COM_DISPOSITIVO.test("br/cne-ceb/res/2025/3#art6-iii")).toBe(true);
    expect(RE_ID_ATO_COM_DISPOSITIVO.test("br/cne-ceb/res/2025/3")).toBe(false);
  });
});

describe("textoDispositivos", () => {
  // As citações das fichas antes da migração: o texto legível reproduz cada uma a partir dos IDs.
  test.each([
    ["arts. 29, 30 e 37, § 3º"],
    ["arts. 29, §§ 2º e 3º, e 30"],
    ["arts. 13 e 25"],
    ["art. 28, § 1º, I"],
    ["arts. 26, VI, e 28, § 1º, II"],
    ["arts. 7º, § 4º, e 22, X"],
    ["arts. 9º e 28, VII"],
    ["arts. 28, X, e 42"],
    ["arts. 56, § 4º, e 62, § 4º"],
    ["arts. 9º, 17, § 2º, 28, VI e VII, e 29, § 4º"],
    ["arts. 22, 26, II, 28, XIII e § 1º, III, e 36"],
    ["arts. 28, XVII e § 1º, IV, e 37"],
    ["art. 37, §§ 5º e 7º"],
    ["art. 26, §§ 1º e 9º-B"],
    ["arts. 28, II e § 2º, 38, § 8º, e 48 a 53"],
    ["art. 28, I, II, VIII e XVI"],
    ["arts. 1º a 4º"],
    ["arts. 26, X, 28, XVIII e § 4º, e 67"],
    ["arts. 22, VII, e 26, X e XII"],
    ["arts. 28, XIV, 60 a 63 e 72"],
    ["arts. 5º, 38, § 6º, 44, §§ 5º e 6º, e 45, § 8º"],
    ["art. 24, parágrafo único"],
    ["art. 22, II a V e IX"],
  ])("%p", (texto) => {
    const ids = analisarDispositivos(normalizarCitacao(texto));
    expect(textoDispositivos(ids)).toBe(texto);
  });

  test("letra de artigo, alínea, anexo e parágrafo único com incisos", () => {
    expect(textoDispositivos(["#art36A"])).toBe("art. 36-A");
    expect(textoDispositivos(["#art5-ii-al-a"])).toBe('art. 5º, II, alínea "a"');
    expect(textoDispositivos(["#anexo1-item3"])).toBe("Anexo 1, item 3");
    expect(textoDispositivos(["#art71-parunico-i", "#art71-parunico-ii"])).toBe("art. 71, parágrafo único, I e II");
    expect(textoDispositivos(["#art29", "#art29-par2"])).toBe("arts. 29 e 29, § 2º");
  });

  test("partes e ID malformado", () => {
    expect(partesDispositivo("#art28-par1-iv")).toEqual({
      tipo: "artigo",
      art: 28,
      letraArt: "",
      par: { numero: 1, letra: "" },
      inc: "iv",
      letraInc: "",
      ali: null,
      item: null,
    });
    expect(partesDispositivo("#art28º")).toBeNull();
    expect(() => textoDispositivos(["art. 28"])).toThrow("dispositivo malformado: art. 28");
  });
});

describe("referências estruturadas", () => {
  const entradas: ReferenciaNormativa[] = [
    { ref: "cnct:catalogo", papel: "fundamento" },
    { ref: "br/cne-cp/res/2026/2", dispositivo: "#art29", papel: "fundamento" },
    { ref: "br/cne-cp/res/2026/2", dispositivo: "#art30", papel: "fundamento" },
    { ref: "br/cne-cp/res/2026/2", dispositivo: "#art37-par3", papel: "complementar" },
    { ref: "ifpr/proens/nt/2025/1", papel: "fundamento", nota: "SEI nº 3881287" },
    { ref: "br/lei/2016/13409", papel: "fundamento" },
    { ref: "externo:abnt/nbr/6023", papel: "complementar" },
  ];

  test("o esquema aceita o formato e recusa texto livre", () => {
    for (const entrada of entradas) expect(esquemaReferenciaNormativa.parse(entrada)).toEqual(entrada);
    expect(esquemaReferenciaNormativa.safeParse("Resolução CNE/CP nº 2/2026").success).toBe(false);
    expect(esquemaReferenciaNormativa.safeParse({ ref: "br/cne-cp/res/2026/2", papel: "principal" }).success).toBe(
      false,
    );
  });

  test("agrupa entradas consecutivas da mesma norma e do mesmo papel", () => {
    expect(agruparReferencias(entradas).map((grupo) => [grupo.ref, grupo.dispositivos])).toEqual([
      ["cnct:catalogo", []],
      ["br/cne-cp/res/2026/2", ["#art29", "#art30"]],
      ["br/cne-cp/res/2026/2", ["#art37-par3"]],
      ["ifpr/proens/nt/2025/1", []],
      ["br/lei/2016/13409", []],
      ["externo:abnt/nbr/6023", []],
    ]);
  });

  test("texto legível com título canônico, dispositivos, nota e arquivo", () => {
    expect(referenciasLegiveis(entradas, universo)).toEqual([
      {
        texto: "Catálogo Nacional de Cursos Técnicos (CNCT)",
        ref: "cnct:catalogo",
        papel: "fundamento",
        dispositivos: [],
        path: "catalogos/cnct/manifest.json",
      },
      {
        texto: "Resolução CNE/CP nº 2/2026, arts. 29 e 30",
        ref: "br/cne-cp/res/2026/2",
        papel: "fundamento",
        dispositivos: ["#art29", "#art30"],
        path: "normas/br/resolucoes/RESOLUCAO_CNE-CP_2-2026_dcnept.md",
      },
      {
        texto: "Resolução CNE/CP nº 2/2026, art. 37, § 3º",
        ref: "br/cne-cp/res/2026/2",
        papel: "complementar",
        dispositivos: ["#art37-par3"],
        path: "normas/br/resolucoes/RESOLUCAO_CNE-CP_2-2026_dcnept.md",
      },
      {
        texto: "Nota Técnica PROENS/IFPR nº 1/2025 — SEI nº 3881287",
        ref: "ifpr/proens/nt/2025/1",
        papel: "fundamento",
        dispositivos: [],
        path: "normas/ifpr/notas-tecnicas/NOTA-TECNICA_PROENS-IFPR_1-2025_aee-nao-componente-curricular.md",
      },
      { texto: "Lei nº 13.409/2016", ref: "br/lei/2016/13409", papel: "fundamento", dispositivos: [] },
      { texto: "ABNT NBR 6023", ref: "externo:abnt/nbr/6023", papel: "complementar", dispositivos: [] },
    ]);
  });

  test("fontes: stub, curso do CNCT, variante e ID desconhecido", () => {
    expect(universo.fonte("br/cne-cp/res/2022/1")).toMatchObject({ situacao: "stub", status_vigencia: "revogada" });
    expect(universo.fonte("cnct:tecnico-em-enfermagem")).toMatchObject({
      title: "Técnico em Enfermagem (CNCT)",
      path: "catalogos/cnct/cursos/tecnico-em-enfermagem.json",
    });
    expect(universo.fonte("br/lei/1996/9394~compilacao")).toBeUndefined();
    expect(universo.fonte("br/cne-cp/res/2099/1")).toBeUndefined();
    expect(universo.titulo("br/cne-cp/res/2099/1")).toBe("br/cne-cp/res/2099/1");
    expect(textoIdComDispositivo("br/cne-ceb/res/2025/3#art6-iii", universo)).toBe(
      "Resolução CNE/CEB nº 3/2025, art. 6º, III",
    );
  });
});
