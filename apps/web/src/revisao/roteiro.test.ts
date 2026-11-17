import { describe, expect, test } from "vite-plus/test";
import type { ListaPendencias, PendenciaViva } from "@simplifica-if/contratos-app";
import { avisoCobertura, paradaInicial, pendenciasDaParada, resumoSituacoes, textoEstimativaAcao } from "./roteiro.ts";

const viva = (
  ordemTema: number,
  situacao: PendenciaViva["situacao"],
  estado: "nao_atende" | "a_conferir" = "nao_atende",
) =>
  ({
    chave: `k${ordemTema}${situacao}${estado}`,
    pendencia: { ordemTema, estado, tema: `Tema ${ordemTema}` },
    situacao,
    resolvidaPor: null,
    historico: [],
    sugestao: null,
    aceitaIa: true,
  }) as unknown as PendenciaViva;

const lista = (pendencias: PendenciaViva[], vistas: number[], atual = 0) =>
  ({
    paradas: [1, 2, 3].map((ordem) => ({ ordem, tema: `Tema ${ordem}`, vista: vistas.includes(ordem) })),
    pendencias,
    paradaAtual: atual,
  }) as unknown as ListaPendencias;

describe("roteiro na tela", () => {
  test("o aviso de cobertura diz o que não foi visto e quantas pendências há lá", () => {
    const l = lista([viva(2, "aberta"), viva(3, "resolvida"), viva(3, "vou_ajustar")], [1]);
    expect(avisoCobertura(l)).toBe(
      "Você passou por 1 de 3 paradas. Ainda não viu: Tema 2 (1 pendência); Tema 3 (1 pendência). Parar aqui não quer dizer que o resto está em ordem.",
    );
    expect(avisoCobertura(lista([], [1, 2, 3]))).toBeNull();
  });

  test("a parada em que a pessoa estava, e as pendências da parada com o ajuste antes do conferir", () => {
    expect(paradaInicial(lista([], [], 3))).toBe(2);
    expect(paradaInicial(lista([], [], 9))).toBe(0);
    const l = lista([viva(2, "aberta", "a_conferir"), viva(2, "aberta", "nao_atende")], []);
    expect(pendenciasDaParada(l, 2).map((p) => p.pendencia.estado)).toEqual(["nao_atende", "a_conferir"]);
  });

  test("o resumo das situações e a estimativa de uma ação", () => {
    expect(resumoSituacoes(lista([viva(1, "aberta"), viva(2, "aberta"), viva(2, "contestada_aceita")], []))).toBe(
      "2 abertas · 1 contestada com evidência, para conferir.",
    );
    expect(
      textoEstimativaAcao({ provider: "claude", tokensEntrada: 6000, tokensSaida: 450, segundos: 6, custoUsd: 0.025 }),
    ).toBe("Estimativa: cerca de 6 s (pago por uso, uns US$\u00a00,025). Soma ao uso desta revisão.");
    expect(
      textoEstimativaAcao({ provider: "claude", tokensEntrada: 0, tokensSaida: 0, segundos: 5, custoUsd: 0 }),
    ).toBe("Sem IA: o app confere no código.");
  });
});
