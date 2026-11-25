import { describe, expect, test } from "vite-plus/test";
import { ehErroFrontMatter, normaDoFrontMatter } from "./front-matter.ts";
import { registroStubsDoYaml } from "./registro.ts";

const NORMA = {
  id: "br/lei/2020/1",
  title: "Lei nº 1/2020",
  tipo_documento: "Lei",
  numero: "1",
  ano: 2020,
  orgao: "Presidência da República",
  jurisdicao: "BR",
  ementa: "Ementa.",
  status_vigencia: "vigente",
  keywords: ["teste"],
  assinada_em: "2020-01-02",
  publicada_em: "2020-01-03",
  vigente_de: "2020-01-03",
  datas_fonte: "Teste.",
  fonte_url: "https://www.planalto.gov.br/l1.htm",
};
const detalhe = (meta: Record<string, unknown>) => {
  try {
    normaDoFrontMatter(meta as never, "norma.md");
    return null;
  } catch (erro) {
    return ehErroFrontMatter(erro) ? erro.detalhe : String(erro);
  }
};

describe("fonte oficial e datas da norma", () => {
  test("a fonte é obrigatória: fonte_url, fonte_referencia ou os dois", () => {
    expect(detalhe(NORMA)).toBeNull();
    const { fonte_url: _, ...semFonte } = NORMA;
    expect(detalhe(semFonte)).toContain("norma sem fonte oficial");
    expect(detalhe({ ...semFonte, fonte_referencia: "DOU de 3/1/2020, Seção 1, p. 1" })).toBeNull();
  });

  test("data_publicacao não existe mais, e a data do ato fica no ano da norma", () => {
    expect(detalhe({ ...NORMA, data_publicacao: "2020-01-02" })).toContain("campo extinto");
    expect(detalhe({ ...NORMA, assinada_em: "2019-12-31" })).toContain("assinada_em fora do ano");
  });
});

const stub = (linhas: string[]) =>
  [
    "normas:",
    "  - id: br/lei/2020/1",
    "    title: Lei nº 1/2020",
    ...linhas,
    "    ementa: E.",
    "    status_vigencia: a confirmar",
    "    curadoria: conferido",
    "externos: []",
  ].join("\n");

describe("stub", () => {
  test("fonte obrigatória e datas com evidência", () => {
    expect(() => registroStubsDoYaml(stub(["    fonte_url: https://www.planalto.gov.br/l1.htm"]))).not.toThrow();
    expect(() => registroStubsDoYaml(stub([]))).toThrow(/sem fonte oficial/);
    expect(() =>
      registroStubsDoYaml(stub(["    fonte_referencia: DOU de 3/1/2020", '    assinada_em: "2020-01-02"'])),
    ).toThrow(/datas_fonte/);
    expect(() =>
      registroStubsDoYaml(
        stub([
          "    fonte_referencia: DOU",
          '    assinada_em: "2020-01-02"',
          '    publicada_em: "2020-01-01"',
          "    datas_fonte: x",
        ]),
      ),
    ).toThrow(/anterior a assinada_em/);
    expect(() =>
      registroStubsDoYaml(stub(["    fonte_referencia: DOU", '    data_publicacao: "2020-01-02"'])),
    ).toThrow();
  });
});
