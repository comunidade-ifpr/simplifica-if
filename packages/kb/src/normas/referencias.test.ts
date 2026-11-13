import { describe, expect, test } from "bun:test";
import {
  chaveEstruturada,
  normaDaReferencia,
  type NormaManifesto,
  normalizarReferencia,
  semAcento,
  tokensOrgao,
} from "./referencias.ts";

const MANIFEST: NormaManifesto[] = [
  {
    title: "Resolução CNE/CP nº 1/2021",
    tipo_documento: "Resolução",
    numero: "1",
    ano: 2021,
    orgao: "CNE/CP",
    aliases: ["Resolução CNE/CP nº 1/2021", "DCNEPT"],
    status_vigencia: "revogada",
  },
  {
    title: "Resolução CNE/CP nº 2/2026",
    tipo_documento: "Resolução",
    numero: "2",
    ano: 2026,
    orgao: "CNE/CP",
    aliases: ["DCNEPT 2026"],
    status_vigencia: "vigente",
  },
  {
    title: "Resolução CONSUP/IFPR nº 64/2022",
    tipo_documento: "Resolução",
    numero: "64",
    ano: 2022,
    orgao: "CONSUP/IFPR",
    aliases: [],
    status_vigencia: "vigente",
  },
  {
    title: "Lei nº 9.394/1996",
    tipo_documento: "Lei",
    numero: "9394",
    ano: 1996,
    orgao: "Presidência da República",
    aliases: [],
    status_vigencia: "vigente",
  },
];

describe("normalizarReferencia", () => {
  test.each([
    ["Resolução CNE/CP nº 1/2021", "resolucao cne/cp 1/2021"],
    ["Res. CNE/CP n° 01/2021", "resolucao cne/cp 1/2021"],
    ["Resolução CNE/CP nº 1, de 5 de janeiro de 2021", "resolucao cne/cp 1/2021"],
    ["Resolução CNE/CP nº 1, de 1º de janeiro de 2021", "resolucao cne/cp 1/2021"],
    ["Lei 9.394/1996, art. 26", "lei 9394/1996, art. 26"],
    ["  Portaria n.  7/2024  ", "portaria 7/2024"],
    ["\x1cLei\x1f nº 1/2020", "lei 1/2020"],
  ])("%p → %p", (entrada, esperado) => {
    expect(normalizarReferencia(entrada)).toBe(esperado);
  });

  test("semAcento descarta o que não vira ASCII", () => {
    expect(semAcento("Ação ß Ⅻ ﬁ")).toBe("acao  xii fi");
  });
});

describe("chaveEstruturada", () => {
  test("extrai tipo, número e ano", () => {
    expect(chaveEstruturada("Resolução CNE/CP nº 1/2021, art. 53")).toEqual(["resolucao", "1", "2021"]);
    expect(chaveEstruturada("Nota Técnica PROENS nº 1/2025")).toEqual(["nota tecnica", "1", "2025"]);
  });

  test("sem tipo conhecido ou sem N/AAAA não há chave", () => {
    expect(chaveEstruturada("CNCT")).toBeNull();
    expect(chaveEstruturada("DCNEPT/2026")).toBeNull();
    expect(chaveEstruturada("Resolução CNE/CP nº 1/20210")).toBeNull();
  });
});

describe("tokensOrgao", () => {
  test("remove órgãos genéricos", () => {
    expect([...tokensOrgao("Presidência da República")]).toEqual([]);
    expect([...tokensOrgao("CONSUP/IFPR")]).toEqual(["ifpr"]);
    expect([...tokensOrgao("CNE/CP")]).toEqual(["cne", "cp"]);
  });
});

describe("normaDaReferencia", () => {
  test.each([
    ["Resolução CNE/CP nº 1/2021, art. 53", "Resolução CNE/CP nº 1/2021"],
    ["Res. CNE/CP n° 1/2021", "Resolução CNE/CP nº 1/2021"],
    ["Resolução CNE/CP nº 1, de 5 de janeiro de 2021", "Resolução CNE/CP nº 1/2021"],
    ["RESOLUÇÃO CNE/CP 01/2021, art. 3º", "Resolução CNE/CP nº 1/2021"],
    ["Resolução IFPR 64/2022", "Resolução CONSUP/IFPR nº 64/2022"],
    ["Resolução Consup/IFPR nº 64/2022, art. 16", "Resolução CONSUP/IFPR nº 64/2022"],
    ["Lei 9.394/1996", "Lei nº 9.394/1996"],
    ["DCNEPT 2026", "Resolução CNE/CP nº 2/2026"],
  ])("casa variante de grafia %p", (referencia, titulo) => {
    expect(normaDaReferencia(referencia, MANIFEST)?.title).toBe(titulo);
  });

  test.each([
    "Resolução CNE/CP nº 1/20210",
    "Resolução CNE/CEB nº 1/2021", // mesmo número e ano, outro órgão
    "DCNEPT", // sigla sem número é ambígua entre versões
    "DCNEPT/2026",
    "CNCT",
  ])("não casa falso positivo %p", (referencia) => {
    expect(normaDaReferencia(referencia, MANIFEST)?.title).not.toBe("Resolução CNE/CP nº 1/2021");
  });

  test("alias com número só casa no fim de palavra", () => {
    expect(normaDaReferencia("DCNEPT 20260", MANIFEST)).toBeNull();
    expect(normaDaReferencia("DCNEPT 2026, art. 28", MANIFEST)?.title).toBe("Resolução CNE/CP nº 2/2026");
  });
});
