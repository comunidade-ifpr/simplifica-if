import { assert, describe, it } from "@effect/vitest";
import {
  AprovacaoDesconhecida,
  FalhaProvider,
  OperacaoNaoSuportada,
  PastaTrabalhoInvalida,
  SessaoDesconhecida,
  TurnoEmAndamento,
} from "@simplifica-if/contratos-app";
import { RpcClientDefect, RpcClientError } from "effect/rpc/RpcClientError";
import { explicarErro, explicarErroDoTurno, explicarFalhaProvider, mensagemDeErro, PERDEU_CONTATO } from "./erros.ts";

describe("mensagemDeErro", () => {
  it("usa a mensagem em português dos erros tipados, com maiúscula e ponto", () => {
    assert.strictEqual(
      mensagemDeErro(new PastaTrabalhoInvalida({ pasta: "x" })),
      "A pasta da tarefa precisa ser o caminho completo de uma pasta que existe: x.",
    );
  });

  it("explica a queda da conexão e os defeitos", () => {
    const queda = new RpcClientError({ reason: new RpcClientDefect({ message: "socket", cause: undefined }) });
    assert.strictEqual(mensagemDeErro(queda), PERDEU_CONTATO);
    assert.match(explicarErro(queda).detalhe ?? "", /servidor local caiu \(RpcClientError\)/);
    assert.deepStrictEqual(explicarErro(new Error("boom")), {
      texto: "Algo deu errado no app. Tente de novo.",
      detalhe: "boom",
    });
  });

  it("OperacaoNaoSuportada aponta a orientação de Configurações › Sua IA", () => {
    assert.strictEqual(
      mensagemDeErro(new OperacaoNaoSuportada({ provider: "claude", operacao: "instalação" })),
      "O app ainda não instala o Claude. Siga a orientação em Configurações › Sua IA.",
    );
    assert.strictEqual(
      mensagemDeErro(new OperacaoNaoSuportada({ provider: "codex", operacao: "login" })),
      "O app ainda não faz o login do ChatGPT (Codex). Siga a orientação em Configurações › Sua IA.",
    );
  });
});

describe("explicarFalhaProvider", () => {
  it("as falhas conhecidas em português pelo tipo, com o nome do provider e o texto técnico nos detalhes", () => {
    assert.deepStrictEqual(
      explicarErro(
        new FalhaProvider({
          provider: "claude",
          operacao: "ler mensagens",
          tipo: "semLogin",
          tecnico: "Not logged in",
        }),
      ),
      {
        texto: "O Claude está sem login. Entre na conta em Configurações › Sua IA e tente de novo.",
        detalhe: "claude: falha em ler mensagens: Not logged in",
      },
    );
    assert.deepStrictEqual(
      explicarFalhaProvider({ provider: "codex", operacao: "abrir app-server", tipo: "cliAusente" }),
      {
        texto:
          "O ChatGPT (Codex) não está instalado neste computador. Instale-o em Configurações › Sua IA e tente de novo.",
        detalhe: "codex: falha em abrir app-server",
      },
    );
    assert.match(
      explicarFalhaProvider({ provider: "antigravity", operacao: "session/new", tipo: "mcp" }).texto,
      /^A base do IFPR não ficou disponível para o Gemini \(Antigravity\)/,
    );
    assert.match(
      explicarFalhaProvider({ provider: "codex", operacao: "thread/start", tipo: "modelo" }).texto,
      /^O modelo pedido não está disponível na sua conta do ChatGPT \(Codex\)/,
    );
    assert.strictEqual(
      explicarFalhaProvider({ provider: "claude", operacao: "initialize", tipo: "tempo" }).texto,
      "O Claude demorou demais para responder. Tente de novo em instantes.",
    );
  });

  it("sem tipo conhecido, diz a operação em português e guarda o texto técnico", () => {
    assert.deepStrictEqual(
      explicarFalhaProvider({
        provider: "codex",
        operacao: "turn/start",
        tipo: "desconhecido",
        tecnico: "something odd",
      }),
      {
        texto:
          "O ChatGPT (Codex) não conseguiu responder. Tente de novo; se o erro continuar, veja os detalhes técnicos.",
        detalhe: "codex: falha em turn/start: something odd",
      },
    );
    assert.match(
      explicarFalhaProvider({ provider: "claude", operacao: "iniciar sessão", tipo: "desconhecido" }).texto,
      /não conseguiu abrir a conversa/,
    );
    assert.match(
      explicarFalhaProvider({ provider: "outro", operacao: "?", tipo: "desconhecido" }).texto,
      /^O outro não/,
    );
    // Um tipo fora da lista (servidor de outra versão) vale como desconhecido.
    assert.match(
      explicarErro({ _tag: "FalhaProvider", provider: "claude", operacao: "turn/start", tipo: "novo" }).texto,
      /^O Claude não conseguiu responder/,
    );
  });
});

describe("explicarErroDoTurno", () => {
  it("traduz pelo tipo e deixa a mensagem nos detalhes técnicos", () => {
    assert.deepStrictEqual(
      explicarErroDoTurno("codex", { tipo: "mcp", mensagem: "servidor MCP ifpr não iniciou: boom" }),
      {
        texto:
          "A base do IFPR não ficou disponível para o ChatGPT (Codex). Comece uma nova conversa; se o erro continuar, reinicie o app.",
        detalhe: "servidor MCP ifpr não iniciou: boom",
      },
    );
    assert.deepStrictEqual(
      explicarErroDoTurno("claude", { tipo: "limiteApp", mensagem: "turno terminou com error_max_turns" }),
      {
        texto:
          "A resposta passou do limite de passos que o app permite. Divida o pedido em partes menores e envie de novo.",
        detalhe: "turno terminou com error_max_turns",
      },
    );
    assert.strictEqual(
      explicarErroDoTurno("claude", { tipo: "cota", mensagem: "Claude AI usage limit reached|1763402400" }).texto,
      "Sua conta do Claude chegou ao limite de uso. Espere o limite renovar ou escolha outra IA para esta conversa.",
    );
  });

  it("sem tipo conhecido, a frase genérica, nunca o texto da CLI", () => {
    assert.deepStrictEqual(
      explicarErroDoTurno("antigravity", { tipo: "desconhecido", mensagem: "Unexpected token < in JSON" }),
      {
        texto:
          "O Gemini (Antigravity) não conseguiu responder. Tente de novo; se o erro continuar, veja os detalhes técnicos.",
        detalhe: "Unexpected token < in JSON",
      },
    );
  });
});

describe("erros do motor", () => {
  it("TurnoEmAndamento, SessaoDesconhecida e AprovacaoDesconhecida sem jargão", () => {
    assert.deepStrictEqual(explicarErro(new TurnoEmAndamento()), {
      texto: "A IA ainda está respondendo. Espere a resposta terminar ou use Interromper.",
      detalhe: "a sessão já tem um turno em andamento",
    });
    assert.match(mensagemDeErro(new SessaoDesconhecida({ id: "x" })), /^Esta conversa foi encerrada/);
    assert.match(mensagemDeErro(new AprovacaoDesconhecida({ id: "x" })), /^Este pedido de permissão não vale mais/);
  });
});
