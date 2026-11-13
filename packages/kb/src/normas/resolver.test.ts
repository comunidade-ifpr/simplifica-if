import { describe, expect, test } from "bun:test";
import { analisarDispositivos } from "./dispositivos.ts";
import { ehIdDispositivo, ehIdExterno, ehIdNorma, idDoAto, idEsperadoDaNorma } from "./ids.ts";
import { caminhoStubs, lerRegistroStubs } from "./registro.ts";
import { extrairCitacoes, resolverCitacao } from "./resolver.ts";
import { normalizarCitacao } from "./texto-citacao.ts";

describe("IDs canônicos", () => {
  test("formato de norma, variante, externo e dispositivo", () => {
    for (const id of [
      "br/cne-cp/res/2026/2",
      "ifpr/consup/res/2024/190",
      "br/lei/1996/9394",
      "br/lei/1996/9394~compilacao",
    ]) {
      expect(ehIdNorma(id)).toBe(true);
    }
    for (const id of [
      "br/cne-cp/res/26/2",
      "br/lei/1996/09394",
      "BR/lei/1996/9394",
      "br/cne-cp/lei/2026/2",
      "br/lei/1996/9394~x",
    ]) {
      expect(ehIdNorma(id)).toBe(false);
    }
    expect(ehIdExterno("externo:cft/res/2019/89")).toBe(true);
    expect(ehIdExterno("externo:abnt/nbr/6023")).toBe(true);
    expect(ehIdExterno("cft/res/2019/89")).toBe(false);
    for (const d of ["#art28-xvi", "#art28-par1-iv", "#art71-parunico", "#art36A", "#art5-al-a", "#anexo1-item3"]) {
      expect(ehIdDispositivo(d)).toBe(true);
    }
    expect(idDoAto("br/lei/1996/9394~compilacao")).toBe("br/lei/1996/9394");
  });

  test("ID derivado do front matter", () => {
    const base = { jurisdicao: "BR", numero: "2", ano: 2026 };
    expect(idEsperadoDaNorma({ ...base, tipo_documento: "Resolução", orgao: "CNE/CP" })).toBe("br/cne-cp/res/2026/2");
    expect(
      idEsperadoDaNorma({
        tipo_documento: "Nota Técnica",
        orgao: "PROENS/IFPR",
        jurisdicao: "IFPR",
        numero: "1",
        ano: 2025,
      }),
    ).toBe("ifpr/proens/nt/2025/1");
    expect(
      idEsperadoDaNorma({
        tipo_documento: "Compilação",
        orgao: "Presidência da República",
        jurisdicao: "BR",
        numero: "9394",
        ano: 1996,
      }),
    ).toBe("br/lei/1996/9394~compilacao");
    expect(idEsperadoDaNorma({ ...base, tipo_documento: "Lei", orgao: "Congresso" })).toBeNull();
  });
});

describe("stubs.yaml", () => {
  test("segue o contrato e cobre as normas citadas sem texto", () => {
    const registro = lerRegistroStubs(caminhoStubs());
    const ids = new Set([...registro.normas, ...registro.externos].map((item) => item.id));
    for (const id of ["br/cne-ceb/res/2012/6", "br/cne-ceb/res/2018/3", "br/decreto/2004/5154", "br/lei/1968/5524"]) {
      expect(ids.has(id)).toBe(true);
    }
    expect(ids.has("externo:cft/res/2019/89")).toBe(true);
  });
});

describe("resolverCitacao", () => {
  test.each([
    ["Resolução CNE/CP nº 01/2021", "br/cne-cp/res/2021/1", "estrutural"],
    ["Resolução nº 1, de 5 de janeiro de 2021", "br/cne-cp/res/2021/1", "data-registro"],
    ["Res. CNE/CP 1/2021", "br/cne-cp/res/2021/1", "estrutural"],
    ["Resolução CNE/CP n° 1, de 5 de janeiro de 2021", "br/cne-cp/res/2021/1", "estrutural"],
    ["Resolução CNE/CP nº 01 de 05 dejaneiro de 2021", "br/cne-cp/res/2021/1", "estrutural"],
    ["Resolução CNE/CP nº 1. de 05 de janeiro de 2021", "br/cne-cp/res/2021/1", "estrutural"],
    ["Resolução CNE/CP nº 1, de 5 de janeiro<br>de 2021", "br/cne-cp/res/2021/1", "estrutural"],
    ["Resolução nº 1, de 5 de janeiro de 2021 (CNE/CP)", "br/cne-cp/res/2021/1", "estrutural"],
    ["CNE/CP nº 1/2021", "br/cne-cp/res/2021/1", "tipo-implicito"],
    ["n° 1, de 5 de janeiro de 2021 (CNE/CP)", "br/cne-cp/res/2021/1", "tipo-implicito"],
    [
      "Resolução CNE/CEB nº 1/2021, que define as Diretrizes Curriculares Nacionais Gerais para a Educação Profissional e Tecnológica",
      "br/cne-cp/res/2021/1",
      "dcnept-2021-orgao-trocado",
    ],
    ["Parecer CNE/CP nº 01/2021 que Define as Diretrizes", "br/cne-cp/res/2021/1", "dcnept-2021-tipo-trocado"],
    ["Resolução CNE/CEB nº 01/2021 (EJA)", "br/cne-ceb/res/2021/1", "estrutural"],
    ["Resolução CNE/CP nº 05 de 2021", "br/cne-cp/res/2021/5", "estrutural"],
    [
      "https://www.in.gov.br/en/web/dou/-/resolucao-cne/cp-n-1-de-5-de-janeiro-de-2021-297767578",
      "br/cne-cp/res/2021/1",
      "url-dou",
    ],
    ["http://www.planalto.gov.br/ccivil_03/leis/l9394.htm", "br/lei/1996/9394", "url-planalto"],
    ["https://www.planalto.gov.br/ccivil_03/_ato2007-2010/2008/lei/l11788.htm", "br/lei/2008/11788", "url-planalto"],
    ["Lei nº 9.394/96", "br/lei/1996/9394", "estrutural"],
    ["Lei nº 11.788", "br/lei/2008/11788", "sem-ano-registro"],
    ["LDB", "br/lei/1996/9394", "alias"],
    ["Resolução CNE nº 6/2012", "br/cne-ceb/res/2012/6", "orgao-incompleto-registro"],
    ["Resolução nº 54/2011 - CONSUP/IFPR", "ifpr/consup/res/2011/54", "estrutural"],
    ["Resolução nº 50/2017 (IFPR, 2017)", "ifpr/consup/res/2017/50", "orgao-implicito-ifpr"],
    ["Resolução CFT nº 89/2019", "externo:cft/res/2019/89", "estrutural"],
    ["ABNT NBR 6023", "externo:abnt/nbr/6023", "alias"],
    ["CNCT", "cnct:catalogo", "alias"],
  ])("%p → %p (%p)", (texto, id, regra) => {
    const r = resolverCitacao(texto);
    expect([r.id, r.regra]).toEqual([id, regra]);
  });

  test("a regra de órgão trocado tem confiança reduzida e nunca é silenciosa", () => {
    const r = resolverCitacao("Resolução CNE/CEB nº 1/2021, que define as DCN Gerais para a Educação Profissional");
    expect(r.confianca).toBeLessThan(0.8);
  });

  test.each(["Lei Estadual nº 18.419/2015", "texto sem citação", "Resolução nº 7/2099"])("não resolve %p", (texto) => {
    expect(resolverCitacao(texto).id).toBeNull();
  });

  test("dispositivos", () => {
    expect(resolverCitacao("Resolução CNE/CP nº 2/2026, art. 28, inciso XVI").dispositivoId).toBe("#art28-xvi");
    expect(resolverCitacao("Lei 9.394/96, art. 36-A").dispositivoId).toBe("#art36A");
    expect(resolverCitacao("alínea a do inciso II do art. 5º da Lei nº 11.788/2008").dispositivoId).toBe(
      "#art5-ii-al-a",
    );
    expect(resolverCitacao("Resolução CNE/CP nº 2/2026, art. 24, parágrafo único").dispositivoId).toBe(
      "#art24-parunico",
    );
    expect(
      resolverCitacao("Resolução CNE/CP nº 2/2026, arts. 28, II e § 2º, 38, § 8º, e 48 a 50").dispositivos,
    ).toEqual(["#art28-ii", "#art28-par2", "#art38-par8", "#art48", "#art49", "#art50"]);
    expect(resolverCitacao("Resolução CNE/CP nº 2/2026, arts. 29, §§ 2º e 3º, e 30").dispositivos).toEqual([
      "#art29-par2",
      "#art29-par3",
      "#art30",
    ]);
  });
});

describe("analisarDispositivos", () => {
  test.each([
    ["art. 28, i, ii e xvi", ["#art28-i", "#art28-ii", "#art28-xvi"]],
    ["inciso iii do art. 28", ["#art28-iii"]],
    ["$ 1o do art. 17", ["#art17-par1"]],
    ["art. 22, ii a v", ["#art22-ii", "#art22-iii", "#art22-iv", "#art22-v"]],
    ['art. 24, inciso v, alinea "e"', ["#art24-v-al-e"]],
  ])("%p", (texto, esperado) => {
    expect(analisarDispositivos(normalizarCitacao(texto))).toEqual(esperado);
  });
});

describe("extrairCitacoes", () => {
  test("enumerações, órgão antes do tipo, ato local e posições no original", () => {
    const texto =
      "Leis nos 10.639/2003 e 11.645/2008.\nBRASIL. Conselho Nacional de Educação. Câmara de Educação Básica. Parecer nº 12, aprovado em 4 de dezembro de 2013.\nPortaria nº 568, de 17 de dezembro de 2021 (IFPR/CAMPUS PALMAS).";
    const citacoes = extrairCitacoes(texto);
    expect(citacoes.map((c) => [c.linha, c.id, c.regra])).toEqual([
      [1, "br/lei/2003/10639", "estrutural"],
      [1, "br/lei/2008/11645", "enumeracao"],
      [2, "br/cne-ceb/parecer/2013/12", "estrutural"],
      [3, null, "ato-local"],
    ]);
    for (const c of citacoes) expect(texto.slice(c.inicio, c.fim)).toBe(c.trecho);
  });

  test("completa pelo documento sem trocar de ato quando a data diverge", () => {
    const texto =
      "Resolução CONSUP/IFPR nº 54/2011.\nResolução nº 54, de 21 de dezembro de 2011.\nResolução nº 1, de 19 de agosto de 2021; Instrução Normativa Reitoria/IFPR nº 1, de 26 de julho de 2021; Instrução Normativa nº 1, de 19 de agosto de 2021.";
    const ids = extrairCitacoes(texto).map((c) => [c.id, c.regra]);
    expect(ids[1]).toEqual(["ifpr/consup/res/2011/54", "data-registro"]);
    expect(ids.at(-1)).toEqual([null, "orgao-ausente"]);
  });
});
