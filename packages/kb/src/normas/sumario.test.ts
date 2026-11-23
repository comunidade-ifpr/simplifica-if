import { describe, expect, test } from "vite-plus/test";
import { divisaoDoCabecalho } from "./divisoes.ts";
import { analisarNorma } from "./estrutura.ts";
import { sumarioDaNorma } from "./sumario.ts";

const sumario = (linhas: ReadonlyArray<string>) => {
  const texto = linhas.join("\n");
  const { dispositivos, problemas } = analisarNorma(texto, { id: "x/res/2026/1", path: "x.md" });
  return { itens: sumarioDaNorma(texto, dispositivos), problemas };
};
const resumo = (itens: ReturnType<typeof sumarioDaNorma>) =>
  itens.map(
    (i) =>
      `${"  ".repeat(i.nivel)}${i.rotulo}${i.nome ? ` · ${i.nome}` : ""}${i.artigos ? ` [${i.artigos.primeiro}–${i.artigos.ultimo}]` : ""}`,
  );

describe("divisaoDoCabecalho", () => {
  test("rótulo e nome, no mesmo cabeçalho ou não", () => {
    expect(divisaoDoCabecalho("TÍTULO III")).toEqual({ tipo: "titulo", rotulo: "TÍTULO III", nome: null });
    expect(divisaoDoCabecalho("CAPÍTULO I - DA DEFINIÇÃO")).toEqual({
      tipo: "capitulo",
      rotulo: "CAPÍTULO I",
      nome: "DA DEFINIÇÃO",
    });
    expect(divisaoDoCabecalho("Seção I Da Frequência")?.nome).toBe("Da Frequência");
    expect(divisaoDoCabecalho("Seção Única")).toEqual({ tipo: "secao", rotulo: "Seção Única", nome: null });
    expect(divisaoDoCabecalho("CAPÍTULO II-A (Incluído pela Lei nº 12.677, de 2012)")).toEqual({
      tipo: "capitulo",
      rotulo: "CAPÍTULO II-A",
      nome: null,
    });
  });
  test("a letra com espaços (Planalto) e a nota de redação fora do nome", () => {
    expect(divisaoDoCabecalho("Seção IV – A")).toEqual({ tipo: "secao", rotulo: "Seção IV-A", nome: null });
    expect(
      divisaoDoCabecalho("CAPÍTULO III Da Educação Profissional (Redação dada pela Lei nº 11.741, de 2008)"),
    ).toEqual({
      tipo: "capitulo",
      rotulo: "CAPÍTULO III",
      nome: "Da Educação Profissional",
    });
    expect(divisaoDoCabecalho("CAPÍTULO I - DA DEFINIÇÃO")?.rotulo).toBe("CAPÍTULO I");
  });
  test("o rótulo sem acento, como alguns textos oficiais grafam", () => {
    expect(divisaoDoCabecalho("TITULO IV")).toEqual({ tipo: "titulo", rotulo: "TITULO IV", nome: null });
  });

  test("o que não é divisão", () => {
    expect(divisaoDoCabecalho("PARTE GERAL")).toBeNull();
    expect(divisaoDoCabecalho("DAS DISPOSIÇÕES GERAIS")).toBeNull();
    expect(divisaoDoCabecalho("Seção Do Atendimento Prioritário")).toBeNull();
    expect(divisaoDoCabecalho("Art. 1º")).toBeNull();
  });
});

describe("sumarioDaNorma", () => {
  test("títulos, capítulos e seções: o nível vem do tipo, o nome do cabeçalho seguinte, a faixa dos artigos", () => {
    const { itens, problemas } = sumario([
      "O CONSELHO resolve:", // 1
      "",
      "",
      "",
      "",
      "",
      "## TÍTULO I", // 7
      "",
      "### DAS FINALIDADES",
      "",
      "#### Art. 1º",
      "",
      "Texto.",
      "",
      "## TÍTULO II", // 15
      "",
      "### DO ACESSO",
      "",
      "### CAPÍTULO I", // 19
      "",
      "#### DAS FORMAS",
      "",
      "#### DE ACESSO",
      "",
      "#### Art. 2º",
      "",
      "Texto.",
      "",
      "#### Seção I Das Vagas", // 29
      "",
      "#### Art. 3º",
      "",
      "Texto.",
      "",
      "#### Art. 4º-A",
      "",
      "Texto.",
      "",
      "### CAPÍTULO II – DO REGISTRO", // 39
      "",
      "#### Art. 5º",
      "",
      "Texto.",
    ]);
    expect(problemas).toEqual([]);
    expect(resumo(itens)).toEqual([
      "TÍTULO I · DAS FINALIDADES [1–1]",
      "TÍTULO II · DO ACESSO [2–5]",
      "  CAPÍTULO I · DAS FORMAS DE ACESSO [2–4-A]",
      "    Seção I · Das Vagas [3–4-A]",
      "  CAPÍTULO II · DO REGISTRO [5–5]",
    ]);
    expect(itens.map((i) => [i.linha, i.linha_fim])).toEqual([
      [7, 9],
      [15, 17],
      [19, 23],
      [29, 29],
      [39, 39],
    ]);
  });

  test("o anexo recomeça os níveis e leva o nome do cabeçalho seguinte", () => {
    const { itens } = sumario([
      "#### Art. 1º",
      "",
      "Aprova o regulamento.",
      "",
      "## ANEXO",
      "",
      "### REGULAMENTO DO CENTRO",
      "",
      "### CAPÍTULO I",
      "",
      "#### DOS OBJETIVOS",
      "",
      "#### Art. 1º",
      "",
      "Texto.",
    ]);
    expect(resumo(itens)).toEqual(["ANEXO · REGULAMENTO DO CENTRO [1–1]", "CAPÍTULO I · DOS OBJETIVOS [1–1]"]);
    expect(itens[0]!.tipo).toBe("anexo");
  });

  test("norma sem artigos: um tópico por cabeçalho do texto, pelo nível dele", () => {
    const { itens } = sumario([
      "Interessado: o Conselho.",
      "",
      "### I – RELATÓRIO",
      "",
      "Texto.",
      "",
      "#### Mérito",
      "",
      "Texto.",
      "",
      "### II – VOTO",
      "",
      "Texto.",
    ]);
    expect(resumo(itens)).toEqual(["I – RELATÓRIO", "  Mérito", "II – VOTO"]);
  });

  test("o parser acusa a divisão e o nome fora do nível", () => {
    const { problemas } = sumario(["## CAPÍTULO I", "", "### DAS DISPOSIÇÕES", "", "#### Art. 1º", "", "Texto."]);
    expect(problemas).toEqual([
      "x.md:1: cabeçalho de CAPÍTULO I deve ser de nível 3 (###)",
      "x.md:3: o nome da divisão deve ser de nível 4 (####), um abaixo do rótulo",
    ]);
  });
});
