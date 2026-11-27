import { describe, expect, test } from "vite-plus/test";
import { diferencaPalavras, type Trecho } from "./diferenca.ts";

const marcados = (trechos: ReadonlyArray<Trecho>) => trechos.filter((t) => t.mudou).map((t) => t.texto);
const juntos = (trechos: ReadonlyArray<Trecho>) => trechos.map((t) => t.texto).join("");

describe("diferencaPalavras", () => {
  test("só as palavras que mudaram levam a marca; o texto volta inteiro", () => {
    const origem = "A Educação Profissional será desenvolvida nas formas articulada e subsequente.";
    const destino = "A Educação Profissional será ofertada nas formas articulada e subsequente.";
    const d = diferencaPalavras(origem, [destino]);
    expect(marcados(d.origem)).toEqual(["desenvolvida"]);
    expect(marcados(d.destinos[0]!)).toEqual(["ofertada"]);
    expect(juntos(d.origem)).toBe(origem);
    expect(juntos(d.destinos[0]!)).toBe(destino);
    expect(d).toMatchObject({ identicos: false, reescrito: false });
  });

  test("palavras seguidas mudadas formam um trecho só, com o espaço do meio", () => {
    const d = diferencaPalavras("os cursos de nível médio", ["os cursos técnicos de graduação"]);
    // "nível médio": duas palavras mudadas em sequência, com o espaço entre elas
    expect(marcados(d.destinos[0]!)).toEqual(["técnicos", "graduação"]);
    expect(marcados(d.origem)).toEqual(["nível médio"]);
  });

  test("pontuação das pontas, travessões, aspas e espaços não contam como mudança", () => {
    const d = diferencaPalavras("Educação Profissional – EPT;  “itinerários”", [
      'Educação Profissional - EPT. "itinerários"',
    ]);
    expect(d.identicos).toBe(true);
    expect(d.origem).toEqual([{ texto: "Educação Profissional – EPT;  “itinerários”", mudou: false }]);
  });

  test("1→N: os destinos se comparam juntos e voltam separados", () => {
    const d = diferencaPalavras("A EPT é modalidade integrada aos níveis.", [
      "A EPT é modalidade integrada aos níveis.",
      "A oferta organiza-se por áreas tecnológicas.",
    ]);
    expect(d.destinos).toHaveLength(2);
    expect(marcados(d.destinos[0]!)).toEqual([]);
    expect(juntos(d.destinos[1]!)).toBe("A oferta organiza-se por áreas tecnológicas.");
    expect(marcados(d.destinos[1]!)).toEqual(["A oferta organiza-se por áreas tecnológicas."]);
    expect(marcados(d.origem)).toEqual([]);
  });

  test("acima de 60% de palavras mudadas, o par vai inteiro, sem grifo", () => {
    const d = diferencaPalavras("Os cursos experimentais serão autorizados pelo sistema.", [
      "Compete às instituições acompanhar egressos com indicadores próprios.",
    ]);
    expect(d.reescrito).toBe(true);
    expect(marcados(d.origem)).toEqual([]);
    expect(marcados(d.destinos[0]!)).toEqual([]);
    // abaixo do limiar, o grifo fica: 2 de 8 palavras
    expect(diferencaPalavras("um dois três quatro", ["um dois três cinco"]).reescrito).toBe(false);
  });

  test("lado vazio", () => {
    expect(diferencaPalavras("", [])).toEqual({ origem: [], destinos: [], identicos: true, reescrito: false });
  });
});
