/** Peças do banco sem compilar: blocos de norma, papel da citação, expressão de busca, sinônimos. */
import { describe, expect, test } from "bun:test";
import { lerSinonimos } from "../busca/sinonimos.ts";
import { radicais } from "../busca/tokens.ts";
import { papelDaCitacao } from "./compilar.ts";
import { conceitosDaConsulta, expressaoFts } from "./consultas.ts";
import { artigoDe, blocosDaNorma, trechoDoArtigo } from "./normas-blocos.ts";

const NORMA = [
  "---",
  "id: br/lei/2008/11788",
  "---",
  "",
  "## Resumo",
  "",
  "- resumo",
  "",
  "## CAPÍTULO I",
  "",
  "### Art. 1º",
  "",
  "Estágio é ato educativo.",
  "",
  "### Art. 36-A",
  "",
  "Texto do 36-A.",
].join("\n");

describe("blocos de norma", () => {
  test("título abre bloco; artigo e dispositivo do título; linhas do arquivo", () => {
    const blocos = blocosDaNorma(NORMA);
    expect(blocos.map((b) => [b.titulo, b.caminho, b.artigo, b.dispositivo, b.linha_inicio, b.linha_fim])).toEqual([
      ["Resumo", "Resumo", null, null, 5, 7],
      ["CAPÍTULO I", "CAPÍTULO I", null, null, 9, 9],
      ["Art. 1º", "CAPÍTULO I > Art. 1º", "1", "#art1", 11, 13],
      ["Art. 36-A", "CAPÍTULO I > Art. 36-A", "36-A", "#art36A", 15, 17],
    ]);
    expect(blocos[2]!.texto).toBe("Estágio é ato educativo.");
  });

  test("artigoDe e trechoDoArtigo (norma sem título de artigo)", () => {
    expect(artigoDe("**Art. 28.** A estrutura")).toEqual({ artigo: "28", dispositivo: "#art28" });
    const texto = ["## Texto", "", "Art. 1º Primeiro.", "", "§ 1º Parágrafo.", "", "Art. 2º Segundo."].join("\n");
    expect(trechoDoArtigo(texto, "1")).toEqual({
      linha_inicio: 3,
      linha_fim: 5,
      texto: "Art. 1º Primeiro.\n\n§ 1º Parágrafo.",
    });
  });
});

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
  const lexico = lerSinonimos();
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
