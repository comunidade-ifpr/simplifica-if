import { describe, expect, test } from "vite-plus/test";
import type { EstadoRevisaoIa } from "@simplifica-if/contratos-app";
import { andamentoPorTema, revisaoParaRetomar, textoEstimativa } from "./ia.ts";

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
      "20 critérios em 6 etapas. Estimativa aproximada: cerca de 3 min e algo como 5% de uma janela de 5 horas do plano Pro (referência provisória: as empresas de IA não publicam o tamanho da janela). Pago por uso, isso custaria cerca de US$ 0,33.",
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

  test("depois de recarregar, reencontra a revisão mais recente que não terminou", () => {
    const e = (id: string, situacao: EstadoRevisaoIa["situacao"]) => ({ id, situacao }) as EstadoRevisaoIa;
    expect(revisaoParaRetomar([e("a", "concluida"), e("b", "pausada"), e("c", "em_andamento")])?.id).toBe("b");
    expect(revisaoParaRetomar([e("a", "concluida"), e("d", "falhou")])).toBeUndefined();
  });
});
