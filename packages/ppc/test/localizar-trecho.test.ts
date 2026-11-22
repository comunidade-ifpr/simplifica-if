import { describe, expect, test } from "vite-plus/test";
import { localizadorDeLinhas } from "../src/localizar-trecho.ts";

const MARKDOWN = [
  "## 1 Apresentação", // 1
  "", // 2
  "O curso segue a [Lei nº 14.945/2024](https://planalto.gov.br/x) e o **CNCT**.", // 3
  "", // 4
  "## 2 Organização curricular", // 5
  "", // 6
  "- A carga horária total é de 1.200 horas,", // 7
  "distribuídas em três semestres.", // 8
  "", // 9
  "| Componente | Carga |", // 10
  "| --- | --- |", // 11
  "| Estágio supervisionado | 200 h |", // 12
  "", // 13
  "Conforme a Lei nº 14.945/2024, o itinerário é integrado.", // 14
].join("\n");

const SECOES = [
  { titulo: "1 Apresentação", linhaInicio: 1, linhaFim: 3 },
  { titulo: "2 Organização curricular", linhaInicio: 5, linhaFim: 14 },
];

const localizar = localizadorDeLinhas(MARKDOWN, SECOES);

describe("localizadorDeLinhas", () => {
  test("acha o trecho guardado sem a marcação do Markdown (link, negrito)", () => {
    expect(localizar("O curso segue a Lei nº 14.945/2024 e o CNCT.", null)).toEqual({ inicio: 3, fim: 3 });
  });

  test("trecho repetido: prefere a ocorrência na seção da pendência", () => {
    expect(localizar("Lei nº 14.945/2024", "2 Organização curricular")).toEqual({ inicio: 14, fim: 14 });
    expect(localizar("Lei nº 14.945/2024", null)).toEqual({ inicio: 3, fim: 3 });
    expect(localizar("Lei nº 14.945/2024", "Seção que não existe")).toEqual({ inicio: 3, fim: 3 });
  });

  test("com reticências, cobre do primeiro ao último pedaço, atravessando linhas", () => {
    expect(localizar("A carga horária total é de 1.200 horas … em três semestres", null)).toEqual({
      inicio: 7,
      fim: 8,
    });
  });

  test("atravessa a linha em branco entre dois parágrafos, como a conferência da IA aceita", () => {
    const md = "## 1 Texto\n\nPrimeiro parágrafo termina aqui.\n\n**\n\nSegundo parágrafo começa aqui.";
    expect(localizadorDeLinhas(md, [])("termina aqui. Segundo parágrafo começa", null)).toEqual({ inicio: 3, fim: 7 });
  });

  test("célula de tabela e acento ou caixa diferentes", () => {
    expect(localizar("ESTAGIO SUPERVISIONADO 200 h", null)).toEqual({ inicio: 12, fim: 12 });
  });

  test("trecho ausente, fora de ordem ou curto demais: nulo", () => {
    expect(localizar("Texto que não está no PPC", null)).toBeNull();
    expect(localizar("três semestres … A carga horária total", null)).toBeNull();
    expect(localizar("CH", null)).toBeNull();
  });
});
