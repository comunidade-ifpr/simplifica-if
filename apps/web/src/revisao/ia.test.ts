import { describe, expect, test } from "vite-plus/test";
import type { EstadoRevisaoIa, EstimativaAcao, ResultadoRevisaoPpc } from "@simplifica-if/contratos-app";
import {
  andamentoPorTema,
  contagemTemas,
  detalheEstimativa,
  leiturasPorTerminar,
  limiteDoPlano,
  temasProntos,
  textoAndamento,
  textoConclusao,
  textoEstimativa,
  textoEstimativaAcao,
} from "./ia.ts";

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

const bloco = (id: string, ordemTema: number, tema: string, estado: "pendente" | "em_andamento" | "pronto") => ({
  id,
  tipo: "S" as const,
  tema,
  ordemTema,
  fichas: 2,
  estado,
  naoConferidas: 0,
  segundos: null,
});

describe("a estimativa na faixa", () => {
  test("o limite do plano em palavras da pessoa", () => {
    expect(limiteDoPlano("uma janela de 5 horas do plano Pro")).toBe("do seu limite de 5 horas");
    expect(limiteDoPlano("a cota diária do plano gratuito")).toBe("da sua cota diária");
    expect(limiteDoPlano("o mês")).toBe("de o mês");
  });

  test("todos os critérios: tempo e fração do limite, sem etapas nem 'referência provisória'", () => {
    const texto = textoEstimativa(estimativa, "completo", "Claude");
    expect(texto).toBe("O Claude lê em cerca de 3 minutos, usando perto de 5 % do seu limite de 5 horas.");
    expect(texto).not.toMatch(/etapa|provisória|janela/);
  });

  test("o escopo menor diz quantos lê, com plural", () => {
    expect(textoEstimativa(estimativa, "rapido", "Claude")).toBe(
      "O Claude lê os 20 que mais devolvem PPC em cerca de 3 minutos, usando perto de 5 % do seu limite de 5 horas.",
    );
    expect(textoEstimativa({ ...estimativa, fichas: 1, minutos: 1 }, "rapido", "Claude")).toBe(
      "O Claude lê o que mais devolve PPC em cerca de 1 minuto, usando perto de 5 % do seu limite de 5 horas.",
    );
  });

  test("o detalhe do uso, com o preço pago por uso quando se sabe", () => {
    expect(detalheEstimativa(estimativa)).toMatch(/Pago por uso, custaria cerca de US\$ 0,33\.$/);
    expect(detalheEstimativa({ ...estimativa, custoUsd: null })).not.toMatch(/Pago por uso/);
  });

  test("a estimativa de uma ação por pendência", () => {
    const acao: EstimativaAcao = {
      provider: "claude",
      tokensEntrada: 1000,
      tokensSaida: 100,
      segundos: 1,
      custoUsd: null,
    };
    expect(textoEstimativaAcao(acao)).toBe("Cerca de 1 segundo.");
    expect(textoEstimativaAcao({ ...acao, segundos: 12.4 })).toBe("Cerca de 12 segundos.");
    expect(textoEstimativaAcao({ ...acao, tokensEntrada: 0, tokensSaida: 0 })).toBe("");
  });
});

describe("o andamento", () => {
  const estado = {
    blocos: [
      bloco("s-02-1", 2, "Matriz", "pronto"),
      bloco("s-01-1", 1, "Identificação", "em_andamento"),
      bloco("j-02", 2, "Matriz", "pronto"),
      bloco("j-03", 3, "Estágio", "pendente"),
    ],
  };

  test("os blocos por tema, na ordem do parecer", () => {
    expect(andamentoPorTema(estado)).toEqual([
      { ordem: 1, tema: "Identificação", prontos: 0, total: 1, emAndamento: true },
      { ordem: 2, tema: "Matriz", prontos: 2, total: 2, emAndamento: false },
      { ordem: 3, tema: "Estágio", prontos: 0, total: 1, emAndamento: false },
    ]);
    expect([...temasProntos(estado)]).toEqual([2]);
  });

  test("o texto da faixa durante a leitura", () => {
    expect(contagemTemas(estado)).toBe("1 de 3 temas");
    expect(textoAndamento(estado)).toBe("Lendo Identificação — 1 de 3 temas");
    expect(textoAndamento({ blocos: [bloco("a", 1, "Identificação", "pendente")] })).toBe("Lendo — 0 de 1 tema");
  });

  test("a frase do fim, com plural", () => {
    const r = { conferidosIa: 60, paraConferirIa: 12 } as ResultadoRevisaoPpc;
    expect(textoConclusao("Claude", r, 5)).toBe("O Claude leu 72 critérios e encontrou mais 5 pontos.");
    expect(textoConclusao("Claude", r, 1)).toBe("O Claude leu 72 critérios e encontrou mais 1 ponto.");
    expect(textoConclusao("Claude", { conferidosIa: 1, paraConferirIa: 0 } as ResultadoRevisaoPpc, 0)).toBe(
      "O Claude leu 1 critério e não encontrou pontos novos.",
    );
  });
});

test("a leitura preparada e nunca começada não conta como por terminar", () => {
  const e = (id: string, situacao: EstadoRevisaoIa["situacao"]) => ({ id, situacao }) as EstadoRevisaoIa;
  const lista = [e("a", "concluida"), e("p", "preparada"), e("b", "pausada"), e("c", "em_andamento"), e("d", "falhou")];
  expect(leiturasPorTerminar(lista).map((x) => x.id)).toEqual(["b", "c"]);
});
