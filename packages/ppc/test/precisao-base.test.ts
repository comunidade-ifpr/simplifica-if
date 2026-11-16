/**
 * Regressão da pré-conferência nos PPCs técnicos da base: os números agregados por ficha que estão
 * em `PRECISAO.md`, onde a amostra conferida à mão de cada regra está registrada. Mudou um número?
 * Ou a base mudou (PPC novo, norma, relação, CNCT), ou um verificador mudou: confira uma amostra dos
 * novos apontamentos (`node packages/ppc/scripts/pre-conferencia.ts --base --amostra <ficha>`) e
 * atualize os dois juntos.
 */
import { describe, expect, test } from "vite-plus/test";
import { preConferir } from "../src/pre-conferencia.ts";
import { baseComum, lerPpc, ppcsTecnicos } from "../scripts/base-tecnica.ts";
import { contarPorFicha } from "../scripts/precisao.ts";

/** Por ficha: PPCs atende, nao_atende, a_conferir, nao_se_aplica; apontamentos nao_atende e a_conferir. */
const ESPERADO: Record<string, [number, number, number, number, number, number]> = {
  "CT-IDENT-01": [107, 0, 3, 0, 0, 2],
  "CT-IDENT-08": [0, 110, 0, 0, 273, 48],
  "CT-IDENT-13": [106, 0, 4, 0, 0, 3],
  "CT-CURR-02": [90, 0, 20, 0, 0, 19],
  "CT-CURR-16": [102, 0, 8, 0, 0, 8],
  "CT-CURR-18": [73, 0, 9, 28, 0, 9],
  "CT-CURR-22": [107, 3, 0, 0, 3, 0],
  "CT-SUP-09": [0, 87, 23, 0, 142, 91],
  "CT-SUP-12": [3, 103, 4, 0, 320, 120],
  "CT-SUP-14": [70, 11, 29, 0, 13, 36],
  "CT-SUP-21": [23, 14, 73, 0, 14, 73],
  "CT-SUP-24": [0, 14, 96, 0, 14, 96],
};

describe("pré-conferência nos PPCs técnicos da base", () => {
  const ppcs = ppcsTecnicos();
  const comum = baseComum();
  const resultados = ppcs.map((ppc) => preConferir(lerPpc(ppc), { ...comum, cnct: ppc.cnct, forma: ppc.forma }));

  test("a amostra: 110 PPCs técnicos, 82 integrados, 1 sem CNCT", () => {
    expect([ppcs.length, ppcs.filter((p) => p.forma === "integrado").length, ppcs.filter((p) => !p.cnct).length]).toEqual(
      [110, 82, 1],
    );
  });

  test("os números por ficha são os de PRECISAO.md", () => {
    const contagem = Object.fromEntries(
      Object.entries(contarPorFicha(resultados)).map(([ficha, c]) => [
        ficha,
        [c.atende, c.nao_atende, c.a_conferir, c.nao_se_aplica, c.apontamentos_nao_atende, c.apontamentos_a_conferir],
      ]),
    );
    expect(contagem).toEqual(ESPERADO);
  });

  test("triagem: nenhum texto dirigido à IA na base; 78 PPCs com seção do modelo não encontrada", () => {
    const porRegra = (regra: string) => resultados.filter((r) => r.triagem.some((a) => a.regra === regra)).length;
    expect([porRegra("texto-dirigido-a-ia"), porRegra("secoes-do-modelo")]).toEqual([0, 78]);
  });

  test("todo trecho apontado é literal do PPC", () => {
    resultados.forEach((resultado, i) => {
      const linhas = lerPpc(ppcs[i]!).split("\n");
      for (const ficha of resultado.fichas)
        for (const t of [...ficha.apontamentos.flatMap((a) => a.trechos), ...ficha.evidencias])
          expect(linhas[t.linha - 1]).toContain(t.texto);
    });
  });
}, 120_000);
