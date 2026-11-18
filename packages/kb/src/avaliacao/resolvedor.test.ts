import { describe, expect, test } from "vite-plus/test";
import { raizRepositorio } from "../caminhos.ts";
import { carregarRegistro } from "../normas/registro.ts";
import { ppcsQueCitam } from "../ppcs/citacoes.ts";
import { avaliarResolvedor, lerAnotacoes } from "./resolvedor.ts";

const raiz = raizRepositorio();
const registro = carregarRegistro(raiz);

describe("avaliação do resolvedor (avaliacao/resolvedor/citacoes-anotadas.yaml)", () => {
  const anotacoes = lerAnotacoes(raiz);
  const resultado = avaliarResolvedor(anotacoes, registro, raiz);

  test("conjunto anotado: 20 PPCs, ~200 citações, trechos únicos", () => {
    expect(anotacoes.ppcs.length).toBe(20);
    expect(resultado.anotados).toBeGreaterThanOrEqual(200);
    expect(resultado.problemas).toEqual([]);
  });

  test("metas do plano: precisão ≥ 0,95 e recall ≥ 0,90", () => {
    // @effect-diagnostics-next-line globalConsole:off -- as métricas aparecem no log do teste
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
    const primeira = ppcsQueCitam("br/cne-cp/res/2021/1", { raiz, registro });
    expect(JSON.stringify(ppcsQueCitam("br/cne-cp/res/2021/1", { raiz, registro }))).toBe(JSON.stringify(primeira));
    const trocados = primeira.filter((ppc) => ppc.ocorrencias.some((o) => o.regra.startsWith("dcnept-2021-orgao-")));
    expect(trocados.length).toBeGreaterThanOrEqual(17);
  });
});
