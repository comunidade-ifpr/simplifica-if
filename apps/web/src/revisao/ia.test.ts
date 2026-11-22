import { describe, expect, test } from "vite-plus/test";
import type {
  BlocoRevisaoIa,
  EstadoRevisaoIa,
  EstimativaAcao,
  ResultadoRevisaoPpc,
} from "@simplifica-if/contratos-app";
import {
  andamentoPorTema,
  blocosProntos,
  contagemTemas,
  duracao,
  leiturasPorTerminar,
  limiteDoPlano,
  linhasAndamento,
  rodapeAndamento,
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

const bloco = (
  id: string,
  ordemTema: number,
  tema: string,
  estado: "pendente" | "em_andamento" | "pronto",
  extra: Partial<BlocoRevisaoIa> = {},
): BlocoRevisaoIa => ({
  id,
  tipo: "S",
  tema,
  ordemTema,
  fichas: 2,
  titulosFichas: ["Critério um", "Critério dois"],
  estado,
  etapa: null,
  iniciadoEm: null,
  ultimaAtividadeEm: null,
  naoConferidas: 0,
  pendenciasEncontradas: 0,
  segundos: null,
  ...extra,
});

describe("a estimativa na faixa", () => {
  test("o limite do plano em palavras da pessoa", () => {
    expect(limiteDoPlano("uma janela de 5 horas do plano Pro")).toBe("do limite de 5 horas do plano Pro");
    expect(limiteDoPlano("a cota diária do plano gratuito")).toBe("da cota diária do plano gratuito");
    expect(limiteDoPlano("o mês")).toBe("de o mês");
  });

  test("todos os critérios: tempo e fração do limite, sem etapas nem 'referência provisória'", () => {
    const texto = textoEstimativa(estimativa, "completo", "Claude");
    expect(texto).toBe(
      "O Claude confere em cerca de 3 minutos, usando perto de 5 % do limite de 5 horas do plano Pro.",
    );
    expect(texto).not.toMatch(/etapa|provisória|janela/);
  });

  test("o escopo menor diz quantos lê, com plural", () => {
    expect(textoEstimativa(estimativa, "rapido", "Claude")).toBe(
      "O Claude confere os 20 que mais devolvem PPC em cerca de 3 minutos, usando perto de 5 % do limite de 5 horas do plano Pro.",
    );
    expect(textoEstimativa({ ...estimativa, fichas: 1, minutos: 1 }, "rapido", "Claude")).toBe(
      "O Claude confere o que mais devolve PPC em cerca de 1 minuto, usando perto de 5 % do limite de 5 horas do plano Pro.",
    );
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
    expect(blocosProntos(estado)).toBe(2);
  });

  test("o texto da faixa durante a leitura, com os temas lidos em paralelo", () => {
    expect(contagemTemas(estado)).toBe("1 de 3 temas");
    expect(textoAndamento(estado)).toBe("Conferindo Identificação — 1 de 3 temas");
    expect(textoAndamento({ blocos: [bloco("a", 1, "Identificação", "pendente")] })).toBe("Conferindo — 0 de 1 tema");
    const paralelo = {
      blocos: [
        bloco("s-01-1", 1, "Identificação e oferta", "em_andamento"),
        bloco("j-02", 2, "Matriz curricular", "em_andamento"),
        bloco("j-03", 3, "Estágio", "pronto"),
        bloco("j-04", 4, "Avaliação", "pendente"),
      ],
    };
    expect(textoAndamento(paralelo)).toBe("Conferindo Identificação e oferta e Matriz curricular — 1 de 4 temas");
  });

  test("o painel 'Ver andamento': pronto, lendo (etapa e tempo no relógio da tela), parado e na fila", () => {
    const agora = Date.parse("2026-11-22T10:01:30Z");
    const linhas = linhasAndamento(
      {
        situacao: "pausada",
        blocoPausado: "j-03",
        blocos: [
          bloco("j-03", 3, "Estágio", "pendente"),
          bloco("s-01-1", 1, "Identificação", "pronto", { segundos: 42.3, pendenciasEncontradas: 2 }),
          bloco("j-02", 2, "Matriz", "em_andamento", {
            etapa: "recebendo",
            iniciadoEm: "2026-11-22T10:00:00Z",
            ultimaAtividadeEm: "2026-11-22T10:01:25Z",
          }),
          bloco("t", 9, "Transversais", "pendente", { tipo: "T" }),
        ],
      },
      agora,
    );
    expect(linhas.map((l) => [l.titulo, l.situacao, l.detalhe])).toEqual([
      ["Identificação", "pronto", "Conferido em 42 s; 2 pontos encontrados."],
      ["Matriz", "lendo", "Recebendo a resposta; conferindo há 1 min 30 s; último sinal da IA há 5 s."],
      ["Estágio", "pausado", "A conferência parou neste tema."],
      ["Critérios transversais", "fila", "Na fila."],
    ]);
    expect(linhas[1]!.criterios).toEqual(["Critério um", "Critério dois"]);
    expect(duracao(60)).toBe("1 min");
    expect(
      rodapeAndamento({
        modelo: "claude-sonnet-5-5",
        uso: { entrada: 1000, saida: 250, cacheLeitura: 0, cacheEscrita: 500, custoUsd: 0 },
      }),
    ).toBe("Modelo claude-sonnet-5-5. Uso: 1.500 tokens de entrada e 250 de saída até aqui.");
  });

  test("a frase do fim, com plural", () => {
    const r = { conferidosIa: 60, paraConferirIa: 12 } as ResultadoRevisaoPpc;
    expect(textoConclusao("Claude", r, 5)).toBe("O Claude conferiu 72 critérios e encontrou mais 5 pontos.");
    expect(textoConclusao("Claude", r, 1)).toBe("O Claude conferiu 72 critérios e encontrou mais 1 ponto.");
    expect(textoConclusao("Claude", { conferidosIa: 1, paraConferirIa: 0 } as ResultadoRevisaoPpc, 0)).toBe(
      "O Claude conferiu 1 critério e não encontrou pontos novos.",
    );
  });
});

test("a leitura preparada e nunca começada não conta como por terminar", () => {
  const e = (id: string, situacao: EstadoRevisaoIa["situacao"]) => ({ id, situacao }) as EstadoRevisaoIa;
  const lista = [e("a", "concluida"), e("p", "preparada"), e("b", "pausada"), e("c", "em_andamento"), e("d", "falhou")];
  expect(leiturasPorTerminar(lista).map((x) => x.id)).toEqual(["b", "c"]);
});
