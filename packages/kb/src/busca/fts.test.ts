/** Os conceitos de uma consulta e as expressões do FTS5, sem banco. */
import { describe, expect, test } from "vite-plus/test";
import { raizRepositorio } from "../caminhos.ts";
import { conceitosDaConsulta, expressaoFts, expressaoFtsPrefixo } from "./fts.ts";
import { lerSinonimos } from "./sinonimos.ts";
import { radicais } from "./tokens.ts";

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

  test("expressão por prefixo da paleta: todos os termos, o último como prefixo", () => {
    expect(expressaoFtsPrefixo(["acompanhamento", "egres"], ["titulo", "texto"])).toBe(
      '{titulo texto} : ("acompanhamento" "egres"*)',
    );
    expect(expressaoFtsPrefixo(["de"], ["texto"])).toBe('{texto} : ("de")');
    expect(expressaoFtsPrefixo(['a"b'], ["texto"])).toBe('{texto} : ("a""b"*)');
    expect(expressaoFtsPrefixo([], ["texto"])).toBeNull();
  });

  test("o léxico cobre tipos de seção conhecidos", () => {
    expect(Object.keys(lexico.tipos)).toContain("acompanhamento_egresso");
    expect(lexico.grupos.length).toBeGreaterThan(3);
  });
});
