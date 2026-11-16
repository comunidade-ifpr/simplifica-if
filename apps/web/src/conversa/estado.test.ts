import { assert, describe, it } from "@effect/vitest";
import type { Evento } from "@simplifica-if/contratos-app";
import { type Acao, type EstadoConversa, estadoInicial, foiInterrompido, reduzir, rotuloFerramenta } from "./estado.ts";

const aplicar = (estado: EstadoConversa, ...acoes: ReadonlyArray<Acao>) => acoes.reduce(reduzir, estado);
const evento = (e: Evento): Acao => ({ tipo: "evento", evento: e });

/** Uma conversa já iniciada, com a mensagem da pessoa enviada. */
const respondendo = () =>
  aplicar(
    estadoInicial("codex", "/pasta"),
    { tipo: "iniciando" },
    { tipo: "iniciada", sessao: "s1" },
    { tipo: "enviada", texto: "Olá" },
  );

describe("reduzir: texto", () => {
  it("junta os parciais e troca pelo final (Codex: um bloco por vez)", () => {
    const estado = aplicar(
      respondendo(),
      evento({ _tag: "TextoParcial", texto: "Car" }),
      evento({ _tag: "TextoParcial", texto: "ga hor" }),
      evento({ _tag: "TextoFinal", texto: "Carga horária: 1.200 h." }),
      evento({ _tag: "FerramentaIniciada", id: "t1", nome: "ifpr.ficha_curso", entrada: {} }),
      evento({ _tag: "TextoParcial", texto: "Segundo" }),
      evento({ _tag: "TextoFinal", texto: "Segundo bloco." }),
      evento({ _tag: "FimTurno", motivo: "completed" }),
    );
    assert.strictEqual(estado.fase, "pronta");
    assert.deepStrictEqual(
      estado.itens.map((item) => [item.tipo, "texto" in item ? item.texto : item.id]),
      [
        ["pessoa", "Olá"],
        ["resposta", "Carga horária: 1.200 h."],
        ["ferramenta", "t1"],
        ["resposta", "Segundo bloco."],
      ],
    );
    // A ferramenta sem `FerramentaConcluida` se fecha com o turno.
    assert.deepInclude(estado.itens[2], { situacao: "concluida" });
  });

  it("final sem parciais vira uma resposta nova; o fim do turno fecha a resposta aberta", () => {
    const soFinal = aplicar(respondendo(), evento({ _tag: "TextoFinal", texto: "Pronto." }));
    assert.deepInclude(soFinal.itens.at(-1), { tipo: "resposta", texto: "Pronto.", final: true });
    const soParcial = aplicar(
      respondendo(),
      evento({ _tag: "TextoParcial", texto: "Sem final" }),
      evento({ _tag: "FimTurno", motivo: "end_turn" }),
    );
    assert.deepInclude(soParcial.itens.at(-1), { tipo: "resposta", texto: "Sem final", final: true });
  });
});

describe("reduzir: ferramentas, aprovações e avisos", () => {
  it("atualiza a ferramenta pelo id, com o resumo e a falha", () => {
    const estado = aplicar(
      respondendo(),
      evento({ _tag: "FerramentaIniciada", id: "t1", nome: "ifpr.buscar_norma", entrada: { q: 1 } }),
      evento({ _tag: "FerramentaConcluida", id: "t1", nome: "ifpr.buscar_norma", resumo: "3 normas", falhou: false }),
      evento({ _tag: "FerramentaConcluida", id: "t2", nome: "Bash", resumo: "erro", falhou: true }),
    );
    assert.deepInclude(estado.itens[1], { id: "t1", situacao: "concluida", resumo: "3 normas" });
    assert.deepInclude(estado.itens[2], { id: "t2", situacao: "falhou" });
  });

  it("acompanha a aprovação: pendente, enviando, permitida; a sem resposta expira no fim do turno", () => {
    const pedido = aplicar(
      respondendo(),
      evento({ _tag: "PedidoAprovacao", id: "a1", ferramenta: "Write", descricao: "Escrever x.md", entrada: {} }),
      evento({ _tag: "PedidoAprovacao", id: "a2", ferramenta: "Write", descricao: "Escrever y.md", entrada: {} }),
    );
    const respondida = aplicar(
      pedido,
      { tipo: "respondendo", aprovacao: "a1" },
      { tipo: "respondida", aprovacao: "a1", decisao: "negar" },
      evento({ _tag: "FimTurno", motivo: "end_turn" }),
    );
    assert.deepInclude(respondida.itens[1], { situacao: "negada" });
    assert.deepInclude(respondida.itens[2], { situacao: "expirada" });
    const falhou = aplicar(
      pedido,
      { tipo: "respondendo", aprovacao: "a1" },
      {
        tipo: "respostaFalhou",
        aprovacao: "a1",
        erro: { texto: "Caiu." },
      },
    );
    assert.deepInclude(falhou.itens[1], { situacao: "pendente" });
    assert.deepInclude(falhou.itens.at(-1), { tipo: "aviso", texto: "Caiu.", gravidade: "erro" });
  });

  it("guarda o uso de tokens, mostra o erro do provider e avisa a interrupção", () => {
    const estado = aplicar(
      respondendo(),
      evento({ _tag: "UsoTokens", entrada: 10, saida: 2, custoUsd: 0.01 }),
      evento({ _tag: "Erro", mensagem: "limite de uso" }),
      { tipo: "interrompendo" },
    );
    assert.strictEqual(estado.fase, "interrompendo");
    assert.deepStrictEqual(estado.itens.at(-1), {
      tipo: "aviso",
      chave: "i2",
      texto: "Limite de uso.",
      gravidade: "erro",
    });
    assert.deepStrictEqual(estado.uso, { entrada: 10, saida: 2, custoUsd: 0.01 });
    const fim = reduzir(estado, evento({ _tag: "FimTurno", motivo: "interrupted" }));
    assert.deepInclude(fim.itens.at(-1), { tipo: "aviso", texto: "Resposta interrompida.", gravidade: "info" });
    assert.isTrue(foiInterrompido("cancelled"));
    assert.isFalse(foiInterrompido("end_turn"));
  });

  it("o erro do provider no turno sai em português, com o original nos detalhes técnicos", () => {
    const estado = aplicar(respondendo(), evento({ _tag: "Erro", mensagem: "Not logged in · Please run /login" }));
    assert.deepInclude(estado.itens.at(-1), {
      tipo: "aviso",
      texto: "O ChatGPT (Codex) está sem login. Entre na conta pela tela Início e tente de novo.",
      detalhe: "Not logged in · Please run /login",
    });
  });

  it("o turno que cai fecha o que ficou aberto e mostra o erro", () => {
    const estado = aplicar(respondendo(), evento({ _tag: "TextoParcial", texto: "Meio" }), {
      tipo: "turnoFalhou",
      erro: { texto: "A conexão caiu.", detalhe: "socket fechado" },
    });
    assert.strictEqual(estado.fase, "pronta");
    assert.deepInclude(estado.itens[1], { final: true });
    assert.deepInclude(estado.itens.at(-1), { tipo: "aviso", texto: "A conexão caiu.", detalhe: "socket fechado" });
  });
});

describe("reduzir: sessão", () => {
  it("o erro ao iniciar volta ao formulário; nova conversa guarda o provider e a pasta", () => {
    const erro = aplicar(
      estadoInicial(),
      { tipo: "escolher", provider: "antigravity" },
      { tipo: "iniciando" },
      {
        tipo: "naoIniciou",
        erro: { texto: "Pasta inválida." },
      },
    );
    assert.deepInclude(erro, {
      fase: "configurando",
      provider: "antigravity",
      erroInicio: { texto: "Pasta inválida." },
    });
    const nova = reduzir(respondendo(), { tipo: "nova" });
    assert.deepStrictEqual(nova, estadoInicial("codex", "/pasta"));
  });
});

describe("rotuloFerramenta", () => {
  it("usa o título das ferramentas do ifpr e deixa as outras legíveis", () => {
    assert.strictEqual(rotuloFerramenta("ifpr.buscar_norma"), "Buscar norma");
    assert.strictEqual(rotuloFerramenta("mcp__ifpr__ficha_curso"), "Ficha do curso");
    assert.strictEqual(rotuloFerramenta("escrever_arquivo"), "Escrever arquivo");
    assert.strictEqual(rotuloFerramenta("Write"), "Gravar arquivo");
    assert.strictEqual(rotuloFerramenta("Bash"), "Rodar um comando");
    assert.strictEqual(rotuloFerramenta("Ferramenta"), "Ferramenta");
  });
});
