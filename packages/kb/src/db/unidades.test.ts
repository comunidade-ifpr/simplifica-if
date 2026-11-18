/** Peças do banco sem compilar: papel da citação, expressão de busca, sinônimos. */
import { describe, expect, test } from "vite-plus/test";
import { lerSinonimos } from "../busca/sinonimos.ts";
import { raizRepositorio } from "../caminhos.ts";
import { radicais } from "../busca/tokens.ts";
import { papelDaCitacao } from "./compilar.ts";
import { conceitosDaConsulta, expressaoFts } from "./consultas.ts";

describe("papel da citação", () => {
  const linhas = [
    "## 6 EMENTÁRIO",
    "Componente: X",
    "Ementa: Lei 9.394.",
    "**Bibliografia básica**",
    "BRASIL. Lei 9.394.",
  ];
  test("depois do rótulo de bibliografia é referência; antes, fundamento", () => {
    const secao = { tipo: "ementas", linha_inicio: 1 };
    expect(papelDaCitacao(linhas, 3, secao)).toBe("fundamento");
    expect(papelDaCitacao(linhas, 5, secao)).toBe("referencia-bibliografica");
    expect(papelDaCitacao(linhas, 3, { tipo: "referencias", linha_inicio: 1 })).toBe("referencia-bibliografica");
  });
});

describe("consulta", () => {
  const lexico = lerSinonimos(raizRepositorio());
  test("modos: termos, radicais e grupos de sinônimos", () => {
    expect(conceitosDaConsulta("acompanhamento de egressos", "simples")).toEqual([
      { alternativas: [["acompanhamento"]] },
      { alternativas: [["egressos"]] },
    ]);
    expect(conceitosDaConsulta("acompanhamento de egressos", "radicais")).toEqual([
      { alternativas: [["acompanh"]] },
      { alternativas: [["egress"]] },
    ]);
    const completo = conceitosDaConsulta("ex-alunos", "completo", lexico);
    expect(completo).toHaveLength(1);
    expect(completo[0]!.alternativas).toContainEqual(radicais("egresso"));
  });

  test("expressão FTS5 com colunas, frases e operador", () => {
    const conceitos = [{ alternativas: [["egress"], ["ex", "alun"]] }, { alternativas: [["acompanh"]] }];
    expect(expressaoFts(conceitos, ["radicais", "expansao"], "AND")).toBe(
      '{radicais expansao} : (("egress" OR "ex alun") AND "acompanh")',
    );
  });

  test("o léxico cobre tipos de seção conhecidos", () => {
    expect(Object.keys(lexico.tipos)).toContain("acompanhamento_egresso");
    expect(lexico.grupos.length).toBeGreaterThan(3);
  });
});
