import { assert, describe, it } from "@effect/vitest";
import type { Evento } from "@simplifica-if/contratos-app";
import {
  type Acao,
  aplicarEvento,
  aplicarItem,
  detalheWeb,
  type EstadoConversa,
  estadoInicial,
  reduzir,
  rotuloAprovacao,
  rotuloFerramenta,
} from "./estado.ts";

const aplicar = (estado: EstadoConversa, ...acoes: ReadonlyArray<Acao>) => acoes.reduce(reduzir, estado);
/** Um evento do turno 1 que chega por `conversa.acompanhar`. */
const evento = (e: Evento): Acao => ({ tipo: "aoVivo", item: { _tag: "EventoTurno", turno: 1, ordem: 0, evento: e } });

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
      evento({ _tag: "FerramentaIniciada", id: "t1", nome: "ifpr.ficha_curso", tipo: "mcp-app", entrada: {} }),
      evento({ _tag: "TextoParcial", texto: "Segundo" }),
      evento({ _tag: "TextoFinal", texto: "Segundo bloco." }),
      evento({ _tag: "FimTurno", motivo: "concluido" }),
    );
    assert.strictEqual(estado.fase, "pronta");
    assert.deepStrictEqual(
      estado.itens.map((item) => [item.tipo, "texto" in item ? item.texto : "id" in item ? item.id : item.chave]),
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
      evento({ _tag: "FimTurno", motivo: "concluido" }),
    );
    assert.deepInclude(soParcial.itens.at(-1), { tipo: "resposta", texto: "Sem final", final: true });
  });
});

describe("reduzir: ferramentas, aprovações e avisos", () => {
  it("atualiza a ferramenta pelo id, com o resumo e a falha", () => {
    const estado = aplicar(
      respondendo(),
      evento({ _tag: "FerramentaIniciada", id: "t1", nome: "ifpr.buscar_norma", tipo: "mcp-app", entrada: { q: 1 } }),
      evento({ _tag: "FerramentaConcluida", id: "t1", nome: "ifpr.buscar_norma", resumo: "3 normas", falhou: false }),
      evento({ _tag: "FerramentaConcluida", id: "t2", nome: "Bash", resumo: "erro", falhou: true }),
    );
    assert.deepInclude(estado.itens[1], { id: "t1", situacao: "concluida", resumo: "3 normas" });
    assert.deepInclude(estado.itens[2], { id: "t2", situacao: "falhou" });
  });

  it("acompanha a aprovação: pendente, enviando, permitida; a sem resposta expira no fim do turno", () => {
    const pedido = aplicar(
      respondendo(),
      evento({
        _tag: "PedidoAprovacao",
        id: "a1",
        ferramenta: "Write",
        tipo: "escrita",
        descricao: "Escrever x.md",
        entrada: {},
      }),
      evento({
        _tag: "PedidoAprovacao",
        id: "a2",
        ferramenta: "Write",
        tipo: "escrita",
        descricao: "Escrever y.md",
        entrada: {},
      }),
    );
    const respondida = aplicar(
      pedido,
      { tipo: "respondendo", aprovacao: "a1" },
      { tipo: "respondida", aprovacao: "a1", decisao: "negar" },
      evento({ _tag: "FimTurno", motivo: "concluido" }),
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
      evento({ _tag: "Erro", tipo: "cota", mensagem: "limite de uso" }),
      { tipo: "interrompendo" },
    );
    assert.strictEqual(estado.fase, "interrompendo");
    // A cota vira o cartão do limite da assinatura, com a IA que chegou a ele.
    assert.deepStrictEqual(estado.itens.at(-1), {
      tipo: "limite",
      chave: "i2",
      provider: "codex",
      detalhe: "limite de uso",
      turno: 1,
    });
    assert.deepStrictEqual(estado.uso, { entrada: 10, saida: 2, custoUsd: 0.01 });
    const fim = reduzir(estado, evento({ _tag: "FimTurno", motivo: "interrompido" }));
    assert.deepInclude(fim.itens.at(-1), { tipo: "aviso", texto: "Resposta interrompida.", gravidade: "info" });
  });

  it("o erro do provider no turno sai em português, com o original nos detalhes técnicos", () => {
    const estado = aplicar(
      respondendo(),
      evento({ _tag: "Erro", tipo: "semLogin", mensagem: "Not logged in · Please run /login" }),
    );
    assert.deepInclude(estado.itens.at(-1), {
      tipo: "aviso",
      texto: "O ChatGPT (Codex) está sem login. Entre na conta em Configurações › Sua IA e tente de novo.",
      detalhe: "Not logged in · Please run /login",
    });
  });

  it("o acompanhamento que falha fecha o que ficou aberto e mostra o erro", () => {
    const estado = aplicar(respondendo(), evento({ _tag: "TextoParcial", texto: "Meio" }), {
      tipo: "naoAcompanhou",
      erro: { texto: "A conversa sumiu.", detalhe: "SessaoDesconhecida" },
    });
    assert.strictEqual(estado.fase, "pronta");
    assert.deepInclude(estado.itens[1], { final: true });
    assert.deepInclude(estado.itens.at(-1), {
      tipo: "aviso",
      texto: "A conversa sumiu.",
      detalhe: "SessaoDesconhecida",
    });
  });
});

describe("reduzir: a conversa ao vivo", () => {
  it("a mensagem gravada toma o lugar da pendente, com o turno do servidor", () => {
    const enviada = respondendo();
    assert.deepInclude(enviada.itens[0], { tipo: "pessoa", texto: "Olá", pendente: true, turno: 1 });
    const gravada = aplicar(enviada, {
      tipo: "aoVivo",
      item: { _tag: "Mensagem", turno: 1, ordem: 1, texto: "Olá" },
    });
    assert.deepStrictEqual(gravada.itens, [{ tipo: "pessoa", chave: "i1", texto: "Olá", turno: 1 }]);
    assert.strictEqual(gravada.ordem, 1);
    // A mensagem de outra tela (sem pendente aqui) entra como nova.
    const deOutra = aplicar(gravada, { tipo: "aoVivo", item: { _tag: "Mensagem", turno: 2, ordem: 5, texto: "E?" } });
    assert.deepInclude(deOutra.itens.at(-1), { tipo: "pessoa", texto: "E?", turno: 2 });
    assert.strictEqual(deOutra.turno, 2);
  });

  it("o servidor recusa a mensagem: ela sai, o turno volta e o erro aparece", () => {
    const estado = aplicar(respondendo(), { tipo: "naoEnviou", erro: { texto: "Outra resposta em andamento." } });
    assert.strictEqual(estado.fase, "pronta");
    assert.strictEqual(estado.turno, 0);
    assert.deepStrictEqual(
      estado.itens.map((item) => item.tipo),
      ["aviso"],
    );
  });

  it("o estado vem do servidor: o turno que falha com a sessão viva deixa a conversa pronta", () => {
    const estado = aplicar(
      respondendo(),
      { tipo: "aoVivo", item: { _tag: "Estado", estado: "respondendo" } },
      evento({ _tag: "Erro", tipo: "cota", mensagem: "limite de uso" }),
      { tipo: "aoVivo", item: { _tag: "Estado", estado: "pronta" } },
      evento({ _tag: "FimTurno", motivo: "falha" }),
    );
    assert.strictEqual(estado.fase, "pronta");
    assert.strictEqual(estado.estadoServidor, "pronta");
    const caiu = aplicar(
      respondendo(),
      { tipo: "aoVivo", item: { _tag: "Estado", estado: "caiu" } },
      evento({ _tag: "FimTurno", motivo: "falha" }),
    );
    assert.strictEqual(caiu.estadoServidor, "caiu");
    assert.strictEqual(caiu.fase, "pronta");
  });

  it("ao retomar depois de uma queda, a resposta aberta sai: o servidor a manda de novo, acumulada", () => {
    const aberta = aplicar(
      respondendo(),
      evento({ _tag: "TextoFinal", texto: "Primeiro bloco." }),
      evento({ _tag: "TextoParcial", texto: "Seg" }),
    );
    const retomada = aplicar(aberta, { tipo: "retomando" }, evento({ _tag: "TextoParcial", texto: "Segundo" }));
    assert.deepStrictEqual(
      retomada.itens.flatMap((item) => (item.tipo === "resposta" ? [[item.texto, item.final]] : [])),
      [
        ["Primeiro bloco.", true],
        ["Segundo", false],
      ],
    );
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
  it("as do MCP pelo título ou legíveis; as nativas pelo tipo do driver, nunca pelo nome técnico", () => {
    assert.strictEqual(rotuloFerramenta({ nome: "ifpr.buscar_norma", classe: "mcp-app" }), "Buscar norma");
    assert.strictEqual(rotuloFerramenta({ nome: "pessoal.minha_tool", classe: "mcp-outro" }), "Minha tool");
    assert.strictEqual(rotuloFerramenta({ nome: "Write", classe: "escrita" }), "Alterar arquivos");
    assert.strictEqual(rotuloFerramenta({ nome: "Bash", classe: "comando" }), "Rodar comando");
    assert.strictEqual(rotuloFerramenta({ nome: "Task", classe: "outra" }), "Outra ação da IA");
    const pesquisa = { acao: "pesquisar", alvo: "x" } as const;
    assert.strictEqual(rotuloFerramenta({ nome: "qualquer", classe: "web", web: pesquisa }), "Pesquisar na internet");
    assert.strictEqual(
      rotuloFerramenta({ nome: "qualquer", classe: "web", web: { acao: "ler", alvo: "https://x" } }),
      "Ler página na internet",
    );
    assert.strictEqual(rotuloFerramenta({ nome: "qualquer", classe: "web" }), "Consultar a internet");
    assert.strictEqual(rotuloAprovacao({ ferramenta: "Write", classe: "escrita" }), "Alterar arquivos");
    assert.strictEqual(rotuloAprovacao({ ferramenta: "xyz_q", classe: "outra" }), "uma ação no computador");
    assert.strictEqual(rotuloAprovacao({ ferramenta: "ifpr.buscar_norma", classe: "mcp-app" }), "Buscar norma");
  });

  it("detalheWeb mostra a consulta ou o domínio curto sem a consulta da URL, e sobrevive à conclusão", () => {
    assert.strictEqual(detalheWeb({ acao: "pesquisar", alvo: "Resolução COFEN 736/2024" }), "Resolução COFEN 736/2024");
    assert.strictEqual(
      detalheWeb({ acao: "ler", alvo: "https://www.planalto.gov.br/ccivil_03/leis/l7498.htm?segredo=1" }),
      "www.planalto.gov.br/ccivil_03/leis/l7498.htm",
    );
    assert.strictEqual(detalheWeb({ acao: "ler", alvo: "https://www.in.gov.br/" }), "www.in.gov.br");
    const web = { acao: "ler", alvo: "https://www.planalto.gov.br/ccivil_03/leis/l7498.htm" } as const;
    const estado = aplicar(
      respondendo(),
      evento({ _tag: "FerramentaIniciada", id: "w1", nome: "WebFetch", tipo: "web", web, entrada: {} }),
      evento({
        _tag: "FerramentaConcluida",
        id: "w1",
        nome: "WebFetch",
        resumo: "HTML bruto da página…",
        falhou: false,
      }),
    );
    assert.deepInclude(estado.itens[1], { id: "w1", situacao: "concluida", classe: "web", web });
  });
});

describe("MudancasPasta", () => {
  it("vira a linha da pasta logo depois da mensagem da pessoa, só com os nomes", () => {
    let estado = aplicarItem(estadoInicial("claude"), {
      _tag: "Mensagem",
      turno: 1,
      ordem: 1,
      texto: "Confira de novo",
    });
    estado = aplicarEvento(estado, {
      _tag: "MudancasPasta",
      anexados: [{ nome: "Foto.png" }],
      novos: [{ nome: "Ata.docx", texto: ".simplifica/textos/Ata.docx.md" }],
      mudados: [{ nome: "Minuta.docx", semTexto: "O arquivo está protegido." }],
      removidos: ["velho.md"],
    });
    assert.deepStrictEqual(
      estado.itens.map((item) => item.tipo),
      ["pessoa", "pasta"],
    );
    assert.deepInclude(estado.itens[1], {
      anexados: ["Foto.png"],
      novos: ["Ata.docx"],
      mudados: ["Minuta.docx"],
      removidos: ["velho.md"],
      semTexto: ["Minuta.docx"],
    });
  });
});
