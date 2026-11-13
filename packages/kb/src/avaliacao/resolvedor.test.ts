import { describe, expect, test } from "bun:test";
import { adequacaoArt71, INDICADORES } from "../adequacao/art71.ts";
import { ppcsQueCitam } from "../ppcs/citacoes.ts";
import { avaliarResolvedor, lerAnotacoes } from "./resolvedor.ts";

describe("avaliação do resolvedor (avaliacao/resolvedor/citacoes-anotadas.yaml)", () => {
  const anotacoes = lerAnotacoes();
  const resultado = avaliarResolvedor(anotacoes);

  test("conjunto anotado: 20 PPCs, ~200 citações, trechos únicos", () => {
    expect(anotacoes.ppcs.length).toBe(20);
    expect(resultado.anotados).toBeGreaterThanOrEqual(200);
    expect(resultado.problemas).toEqual([]);
  });

  test("metas do plano: precisão ≥ 0,95 e recall ≥ 0,90", () => {
    console.log(
      `resolvedor: precisão ${resultado.precisao}, recall ${resultado.recall}, dispositivos ${resultado.dispositivos.taxa} ` +
        `(${resultado.acertos}/${resultado.emitidos} emitidos, ${resultado.acertos}/${resultado.anotados} anotados)`,
    );
    expect(resultado.precisao).toBeGreaterThanOrEqual(0.95);
    expect(resultado.recall).toBeGreaterThanOrEqual(0.9);
  });
});

describe("consultas sobre os PPCs", () => {
  test("kb citacoes é determinístico e acha a DCN de 2021 com órgão trocado", () => {
    const primeira = ppcsQueCitam("br/cne-cp/res/2021/1");
    expect(JSON.stringify(ppcsQueCitam("br/cne-cp/res/2021/1"))).toBe(JSON.stringify(primeira));
    const trocados = primeira.filter((ppc) => ppc.ocorrencias.some((o) => o.regra.startsWith("dcnept-2021-orgao-")));
    expect(trocados.length).toBeGreaterThanOrEqual(17);
  });

  test("adequação ao art. 71: todo curso alcançado tem um indicador", () => {
    const relatorio = adequacaoArt71();
    const soma = INDICADORES.reduce((total, indicador) => total + relatorio.totais[indicador], 0);
    expect(soma).toBe(relatorio.total);
    expect(relatorio.cursos.every((curso) => curso.situacao === "ativo" || curso.situacao === "em_oferta")).toBe(true);
  });
});
