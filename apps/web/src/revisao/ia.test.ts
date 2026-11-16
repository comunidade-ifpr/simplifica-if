import { describe, expect, test } from "vite-plus/test";
import type { EstadoRevisaoIa } from "@simplifica-if/contratos-app";
import { andamentoPorTema, textoEstimativa } from "./ia.ts";

const estimativa = {
  provider: "claude" as const,
  blocos: 6,
  fichas: 20,
  tokensEntrada: 60_000,
  tokensSaida: 7_000,
  minutos: 3,
  custoUsd: 0.33,
  percentualJanela: 5,
  nomeJanela: "uma janela de 5 horas do plano Pro",
};

describe("revisão com IA na tela", () => {
  test("a estimativa em linguagem de quem usa o plano", () => {
    expect(textoEstimativa(estimativa)).toBe(
      "20 critérios em 6 etapas. Deve usar cerca de 5% de uma janela de 5 horas do plano Pro (uns 67 mil tokens) e levar uns 3 min. Na API, isso custaria cerca de US$ 0,33.",
    );
  });

  test("o andamento por tema, na ordem do parecer", () => {
    const bloco = (id: string, ordemTema: number, tema: string, estado: "pendente" | "em_andamento" | "pronto") => ({
      id,
      tipo: "S" as const,
      tema,
      ordemTema,
      fichas: 2,
      estado,
      naoConferidas: id === "j-02" ? 1 : 0,
      segundos: null,
    });
    const estado = {
      blocos: [
        bloco("s-02-1", 2, "Matriz", "pronto"),
        bloco("s-01-1", 1, "Identificação", "em_andamento"),
        bloco("j-02", 2, "Matriz", "pronto"),
      ],
    } as unknown as EstadoRevisaoIa;
    expect(andamentoPorTema(estado)).toEqual([
      { ordem: 1, tema: "Identificação", prontos: 0, total: 1, emAndamento: true, naoConferidas: 0 },
      { ordem: 2, tema: "Matriz", prontos: 2, total: 2, emAndamento: false, naoConferidas: 1 },
    ]);
  });
});
