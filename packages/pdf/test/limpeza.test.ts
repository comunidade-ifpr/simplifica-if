import { describe, expect, it } from "vite-plus/test";
import { continua, limparMarkdownConvertido, nivelDaNumeracao, numeroDePagina, type Passada } from "../src/limpeza.ts";

const blocos = (...partes: string[]) => `${partes.join("\n\n")}\n`;
const limpar = (texto: string, passadas?: Passada[]) =>
  limparMarkdownConvertido(texto, passadas ? { passadas } : {}).texto;

const LONGO = "O ensino, a pesquisa e a extensão constituem os pilares do ensino superior. Cada um";

describe("limparMarkdownConvertido", () => {
  it("troca os marcadores das fontes de símbolos por itens de lista, e por • na tabela", () => {
    expect(limpar(blocos(" Primeiro item;   Segundo item."), ["marcadores"])).toBe(
      blocos("- Primeiro item;", "- Segundo item."),
    );
    expect(limpar(blocos("|a| x<br> y|", "|---|---|"), ["marcadores"])).toBe(blocos("|a|• x<br>• y|", "|---|---|"));
  });

  it("tira o cabeçalho institucional repetido, e não o rótulo repetido nem a referência", () => {
    const pagina = (n: number) => [
      "Ministerio da Educacao",
      "## INSTITUTOFEDERAL Parana",
      `Texto da página ${n}.`,
      "**Bibliografia Básica:**",
      "SILVA, A. Introdução. São Paulo: Campus, 2005.",
    ];
    const saida = limpar(blocos(...pagina(1), ...pagina(2), ...pagina(3)), ["cabecalhos"]);
    expect(saida).not.toContain("Ministerio");
    expect(saida).not.toContain("INSTITUTOFEDERAL");
    expect(saida.match(/Bibliografia Básica/g)).toHaveLength(3);
    expect(saida.match(/Campus, 2005/g)).toHaveLength(3);
  });

  it("não tira o bloco institucional que aparece menos de 3 vezes", () => {
    const texto = blocos("INSTITUTO FEDERAL DO PARANÁ", "Texto.", "INSTITUTO FEDERAL DO PARANÁ");
    expect(limpar(texto, ["cabecalhos"])).toBe(texto);
  });

  it("tira o número de página que segue a sequência e deixa o número fora dela", () => {
    expect(limpar(blocos("Texto.", "4", "Mais.", "```\n5\n```", "Carga horária", "80", "Fim.", "6"), ["paginas"])).toBe(
      blocos("Texto.", "Mais.", "Carga horária", "80", "Fim."),
    );
  });

  it("tira o sumário, inclusive a entrada partida em duas linhas", () => {
    const sumario = [
      "SUMÁRIO",
      "- **1 APRESENTAÇÃO DO PROJETO6**",
      "- 1.1 IDENTIFICAÇÃO6",
      "- 1.1.5 Regime Letivo (Periodicidade)6",
      "- 3.2 TECNOLOGIAS DIGITAIS DE INFORMAÇÃO E COMUNICAÇÃO NO",
      "- PROCESSO DE ENSINO-APRENDIZAGEM47",
      "2.1 Justificativa ........ 24",
      "2.2 Objetivos 25",
    ];
    expect(limpar(blocos(...sumario, "## 1 APRESENTAÇÃO DO PROJETO", "Texto."), ["sumario"])).toBe(
      blocos("## 1 APRESENTAÇÃO DO PROJETO", "Texto."),
    );
  });

  it("junta a tabela partida pela página e tira a linha vazia", () => {
    const parteDeCima = "|A|B|\n|---|---|\n|1|2|\n|||";
    const parteDeBaixo = "|||\n|---|---|\n|3|4|";
    // `|||` é a linha vazia de duas colunas, como o conversor antigo a escrevia.
    expect(limpar(blocos(parteDeCima, parteDeBaixo), ["tabelas"])).toBe(blocos("|A|B|\n|---|---|\n|1|2|\n|3|4|"));
    expect(limpar(blocos("|A|B|\n|---|---|\n|1|2|", "|A|B|\n|---|---|\n|3|4|"), ["tabelas"])).toBe(
      blocos("|A|B|\n|---|---|\n|1|2|\n|3|4|"),
    );
  });

  it("não junta tabelas de colunas diferentes", () => {
    const texto = blocos("|A|B|\n|---|---|\n|1|2|", "|||\n|---|---|---|\n|3|4|5|");
    expect(limpar(texto, ["tabelas"])).toBe(texto);
  });

  it("tira o negrito dos títulos, põe o nível pela numeração e promove o item que é título", () => {
    expect(
      limpar(
        blocos(
          "## **2.4 PERFIL DO EGRESSO**",
          "## _2.5.4.1 Integração com a Pós-graduação_",
          "## **Reitor**",
          "- 2.5.6 Mecanismos de Interação",
          "**3 METODOLOGIA**",
          "## 1.1.10",
          "Escolaridade mínima exigida",
        ),
        ["titulos"],
      ),
    ).toBe(
      blocos(
        "### 2.4 PERFIL DO EGRESSO",
        "##### 2.5.4.1 Integração com a Pós-graduação",
        "## Reitor",
        "#### 2.5.6 Mecanismos de Interação",
        "## 3 METODOLOGIA",
        "#### 1.1.10 Escolaridade mínima exigida",
      ),
    );
  });

  it("não promove o item numerado que é frase", () => {
    const texto = blocos("- 2.5.6 Mecanismos de interação. Não se aplica (NSA).");
    expect(limpar(texto, ["titulos"])).toBe(texto);
  });

  it("junta o parágrafo e o item partidos pela página", () => {
    expect(
      limpar(
        blocos(
          LONGO,
          "desses pilares existe.",
          "- Sejam cidadãos críticos, propositivos e dinâmicos na busca",
          "- de novos conhecimentos.",
        ),
        ["paragrafos"],
      ),
    ).toBe(
      blocos(
        `${LONGO} desses pilares existe.`,
        "- Sejam cidadãos críticos, propositivos e dinâmicos na busca de novos conhecimentos.",
      ),
    );
  });

  it("não junta o parágrafo que acaba em pontuação, o curto ou o seguinte em maiúscula", () => {
    expect(continua("Fim da frase com ponto final e mais de cinquenta caracteres.", "depois")).toBe(false);
    expect(continua("Curto", "depois")).toBe(false);
    expect(continua(LONGO, "Depois")).toBe(false);
    expect(continua(LONGO, "## título")).toBe(false);
    expect(continua(LONGO, "|a|b|")).toBe(false);
  });

  it("tira o espaço antes da pontuação depois de ênfase e o espaço repetido", () => {
    expect(limpar(blocos("gestores do _campus_ ; **Livro** . Mais  um"), ["espacos"])).toBe(
      blocos("gestores do _campus_; **Livro**. Mais um"),
    );
  });

  it("tira o cabeçalho de página de dentro da tabela, e não a linha de conteúdo", () => {
    const tabela = [
      "|INSTITUTOFEDERAL<br>Parana||",
      "|---|---|",
      "|Componente|Carga|",
      "|1 [INSTITUTOFEDERAL]<br>Parana|Ministerio da Educacao|",
      "||Resolução de autorização do curso no IFPR: Resolução nº 114/2022|",
      "|4|FONE DE OUVIDO COM MICROFONE|",
      "|Fonte: Secretaria Acadêmica do Campus||",
    ].join("\n");
    expect(limpar(blocos(tabela), ["tabelas"])).toBe(
      blocos(
        [
          "|||",
          "|---|---|",
          "|Componente|Carga|",
          "||Resolução de autorização do curso no IFPR: Resolução nº 114/2022|",
          "|4|FONE DE OUVIDO COM MICROFONE|",
          "|Fonte: Secretaria Acadêmica do Campus||",
        ].join("\n"),
      ),
    );
  });

  it("limpar duas vezes dá o mesmo resultado", () => {
    const texto = blocos(
      LONGO,
      "|A|B|\n|---|---|\n|1|2|",
      "3",
      "|INSTITUTOFEDERAL<br>Parana||\n|---|---|\n|3|4|",
      "desses pilares existe.",
    );
    const uma = limpar(texto);
    expect(limpar(uma)).toBe(uma);
  });

  it("conta as mudanças por passada", () => {
    const { contagens } = limparMarkdownConvertido(blocos("Texto.", "1", "## **Título**"));
    expect(contagens.paginas).toBe(1);
    expect(contagens.titulos).toBe(1);
    expect(contagens.cabecalhos).toBe(0);
  });
});

describe("auxiliares", () => {
  it("nivelDaNumeracao", () => {
    expect(nivelDaNumeracao("2 JUSTIFICATIVA")).toBe(2);
    expect(nivelDaNumeracao("2.4.1 Áreas")).toBe(4);
    expect(nivelDaNumeracao("1.2.3.4.5.6 Fundo")).toBe(6);
    expect(nivelDaNumeracao("2019")).toBeNull();
    expect(nivelDaNumeracao("Reitor")).toBeNull();
  });

  it("numeroDePagina", () => {
    expect(numeroDePagina("12")).toBe(12);
    expect(numeroDePagina("Página 3 de 40")).toBe(3);
    expect(numeroDePagina("– 7 –")).toBe(7);
    expect(numeroDePagina("- 7")).toBeNull();
    expect(numeroDePagina("## 2")).toBeNull();
    expect(numeroDePagina("Texto 2")).toBeNull();
  });
});
