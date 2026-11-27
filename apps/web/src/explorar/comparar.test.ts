import type { LinhaComparada, NormaDoIndice } from "@simplifica-if/contratos-app";
import { describe, expect, it } from "vite-plus/test";
import {
  comparacaoDaBusca,
  comparacoesDe,
  linhasVisiveis,
  numeroDaNorma,
  textoHerdado,
  textoSubordinados,
  textoTambem,
} from "./comparar.ts";

const DCN_2021 = "br/cne-cp/res/2021/1";
const DCN_2026 = "br/cne-cp/res/2026/2";

const norma = (id: string, titulo: string, comparar_com: NormaDoIndice["comparar_com"]): NormaDoIndice => ({
  id,
  titulo,
  tipo: "Resolução",
  numero: null,
  ano: null,
  orgao: "CNE/CP",
  situacao: "base",
  status_vigencia: "vigente",
  ementa: null,
  apelidos: [],
  comparar_com,
  link: `ifpr://norma/${id}`,
});

const NORMAS = [
  norma(DCN_2021, "Resolução CNE/CP nº 1/2021", [{ norma: DCN_2026, relacao: "sucessora" }]),
  norma(DCN_2026, "Resolução CNE/CP nº 2/2026", [{ norma: DCN_2021, relacao: "anterior" }]),
  norma("br/lei/1996/9394", "Lei nº 9.394/1996", []),
];

describe("modo Comparar", () => {
  it("a contagem dos filhos do artigo mostrado só pelo caput", () => {
    expect(textoSubordinados([{ tipo: "inciso", quantos: 17 }])).toBe("17 incisos");
    expect(textoSubordinados([{ tipo: "paragrafo", quantos: 1 }])).toBe("1 parágrafo");
    expect(
      textoSubordinados([
        { tipo: "inciso", quantos: 3 },
        { tipo: "paragrafo", quantos: 2 },
        { tipo: "alinea", quantos: 1 },
      ]),
    ).toBe("3 incisos, 2 parágrafos e 1 alínea");
    expect(textoSubordinados([])).toBeNull();
  });

  it("N→1 e herança, com o rótulo dentro da frase", () => {
    const origem = "Resolução CNE/CP nº 1/2021";
    expect(textoTambem([{ rotulo: "Art. 11" }], origem)).toBe("Também corresponde ao art. 11 da 1/2021.");
    expect(textoTambem([{ rotulo: "Art. 10" }, { rotulo: "Art. 11, § 1º" }, { rotulo: "Art. 12" }], origem)).toBe(
      "Também corresponde a estes dispositivos da 1/2021: art. 10; art. 11, § 1º e art. 12.",
    );
    expect(textoTambem([], origem)).toBeNull();
    expect(textoHerdado({ rotulo: "Art. 5º" })).toBe("Pela linha do art. 5º.");
  });

  it("“Só o que mudou” esconde só os pares equivalentes idênticos e sem nota", () => {
    const linha = (identicos: boolean, tipo: LinhaComparada["tipo"], nota: string | null = null) =>
      ({ identicos, tipo, nota }) as LinhaComparada;
    const linhas = [
      linha(true, "equivalente"),
      linha(false, "equivalente"),
      linha(false, "sem-equivalente"),
      // o caput igual, com a mudança nos incisos: a nota da tabela diz qual
      linha(true, "parcial", "A 2/2026 acrescenta a avaliação da aprendizagem (inciso V)."),
      linha(true, "equivalente", "Com remissão atualizada."),
    ];
    expect(linhasVisiveis(linhas, false)).toHaveLength(5);
    expect(linhasVisiveis(linhas, true)).toEqual(linhas.slice(1));
  });

  it("o número da norma no título", () => {
    expect(numeroDaNorma("Resolução CNE/CP nº 2/2026")).toBe("2/2026");
    expect(numeroDaNorma("Resolução CNE/CP nº 1, de 5 de janeiro de 2021")).toBe("Resolução CNE/CP nº 1");
    expect(numeroDaNorma("Lei nº 9.394, de 20 de dezembro de 1996")).toBe("Lei nº 9.394");
    expect(numeroDaNorma("Lei de Diretrizes e Bases")).toBe("Lei de Diretrizes e Bases");
  });

  it("as comparações da norma do leitor, pelo índice, com a origem da tabela em `a`", () => {
    const esperado = {
      a: DCN_2021,
      b: DCN_2026,
      detalhe: "Resolução CNE/CP nº 1/2021 ⇄ Resolução CNE/CP nº 2/2026",
    };
    expect(comparacoesDe(DCN_2021, NORMAS)).toEqual([{ ...esperado, titulo: "Comparar com a sucessora" }]);
    expect(comparacoesDe(DCN_2026, NORMAS)).toEqual([{ ...esperado, titulo: "Comparar com a anterior" }]);
    expect(comparacoesDe("br/lei/1996/9394", NORMAS)).toEqual([]);
    expect(comparacoesDe("desconhecida", NORMAS)).toEqual([]);
    // a da busca, com os mesmos textos
    expect(
      comparacaoDaBusca({
        a: DCN_2021,
        b: DCN_2026,
        titulo_a: "Resolução CNE/CP nº 1/2021",
        titulo_b: "Resolução CNE/CP nº 2/2026",
        relacao: "anterior",
      }),
    ).toEqual({ ...esperado, titulo: "Comparar com a anterior" });
  });
});
