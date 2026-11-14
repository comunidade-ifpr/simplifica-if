import { assert, describe, it } from "@effect/vitest";
import { FalhaProvider, OperacaoNaoSuportada, PastaTrabalhoInvalida } from "@simplifica-if/contratos-app";
import { RpcClientDefect, RpcClientError } from "effect/rpc/RpcClientError";
import { explicarErro, explicarErroDoTurno, explicarFalhaProvider, mensagemDeErro, tipoFalha } from "./erros.ts";

describe("mensagemDeErro", () => {
  it("usa a mensagem em português dos erros tipados, com maiúscula e ponto", () => {
    assert.strictEqual(
      mensagemDeErro(new PastaTrabalhoInvalida({ pasta: "x" })),
      "A pasta de trabalho precisa ser o caminho absoluto de uma pasta que existe: x.",
    );
  });

  it("explica a queda da conexão e os defeitos", () => {
    const queda = new RpcClientError({ reason: new RpcClientDefect({ message: "socket", cause: undefined }) });
    assert.strictEqual(mensagemDeErro(queda), "A conexão com o servidor local caiu durante o pedido.");
    assert.deepStrictEqual(explicarErro(new Error("boom")), {
      texto: "Algo deu errado no app. Tente de novo.",
      detalhe: "boom",
    });
  });

  it("OperacaoNaoSuportada aponta a orientação da Início", () => {
    assert.strictEqual(
      mensagemDeErro(new OperacaoNaoSuportada({ provider: "claude", operacao: "instalação" })),
      "O app ainda não instala o Claude. Siga a orientação da tela Início.",
    );
    assert.strictEqual(
      mensagemDeErro(new OperacaoNaoSuportada({ provider: "codex", operacao: "login" })),
      "O app ainda não faz o login do ChatGPT (Codex). Siga a orientação da tela Início.",
    );
  });
});

describe("tipoFalha", () => {
  const casos: ReadonlyArray<readonly [operacao: string, detalhe: string, tipo: ReturnType<typeof tipoFalha>]> = [
    // sem login
    ["ler mensagens", "Invalid API key · Please run /login", "semLogin"],
    ["turn/start", "401 Unauthorized", "semLogin"],
    ["iniciar", "Not logged in", "semLogin"],
    ["login", "Antigravity sem login no app: use entrar", "semLogin"],
    // CLI ausente
    ["iniciar", "CLI `claude` ausente", "cliAusente"],
    ["abrir app-server", "spawn codex ENOENT", "cliAusente"],
    // MCP que não subiu
    ["", "servidor MCP ifpr não iniciou: connection refused", "mcp"],
    [
      "session/new",
      "o agy (1.5.9) não anuncia MCP por HTTP (mcpCapabilities.http) e não há ponte stdio configurada",
      "mcp",
    ],
    ["", "MCP server ifpr failed to start: not found", "mcp"],
    // modelo fora da conta
    ["thread/start", "The 'gpt-5-pro' model is not supported when using Codex with a ChatGPT account.", "modelo"],
    ["ler mensagens", "model: claude-opus-x not found", "modelo"],
    ["session/new", "Unknown model gemini-9", "modelo"],
    // tempo esgotado
    ["initialize", "Request timed out after 30000ms", "tempo"],
    ["turn/start", "connect ETIMEDOUT 1.2.3.4:443", "tempo"],
    // desconhecido
    ["turn/start", "rate limit reached", undefined],
  ];

  for (const [operacao, detalhe, tipo] of casos) {
    it(`${tipo ?? "desconhecido"}: ${detalhe}`, () => {
      assert.strictEqual(tipoFalha(operacao, detalhe), tipo);
    });
  }
});

describe("explicarFalhaProvider", () => {
  it("as falhas conhecidas em português, com o nome do provider e o original nos detalhes", () => {
    assert.deepStrictEqual(
      explicarErro(new FalhaProvider({ provider: "claude", operacao: "ler mensagens", detalhe: "Not logged in" })),
      {
        texto: "O Claude está sem login. Entre na conta pela tela Início e tente de novo.",
        detalhe: "claude: falha em ler mensagens: Not logged in",
      },
    );
    assert.strictEqual(
      explicarFalhaProvider({ provider: "codex", operacao: "abrir app-server", detalhe: "spawn codex ENOENT" }).texto,
      "O ChatGPT (Codex) não está instalado neste computador. Instale-o pela tela Início e tente de novo.",
    );
    assert.match(
      explicarFalhaProvider({ provider: "antigravity", operacao: "session/new", detalhe: "mcp failed" }).texto,
      /^A base do IFPR \(o servidor MCP\) não ficou disponível para o Gemini \(Antigravity\)/,
    );
    assert.match(
      explicarFalhaProvider({ provider: "codex", operacao: "thread/start", detalhe: "model is not supported" }).texto,
      /^O modelo pedido não está disponível na sua conta do ChatGPT \(Codex\)/,
    );
    assert.strictEqual(
      explicarFalhaProvider({ provider: "claude", operacao: "initialize", detalhe: "timed out" }).texto,
      "O Claude demorou demais para responder. Tente de novo em instantes.",
    );
  });

  it("sem padrão conhecido, diz a operação em português e guarda o original", () => {
    assert.deepStrictEqual(
      explicarFalhaProvider({ provider: "codex", operacao: "turn/start", detalhe: "rate limit reached" }),
      {
        texto:
          "O ChatGPT (Codex) não conseguiu responder. Tente de novo; se o erro continuar, veja os detalhes técnicos.",
        detalhe: "codex: falha em turn/start: rate limit reached",
      },
    );
    assert.match(
      explicarFalhaProvider({ provider: "claude", operacao: "iniciar sessão", detalhe: "x" }).texto,
      /não conseguiu abrir a conversa/,
    );
    assert.match(explicarFalhaProvider({ provider: "outro", operacao: "?", detalhe: "x" }).texto, /^O outro não/);
  });
});

describe("explicarErroDoTurno", () => {
  it("traduz o que conhece e mantém o resto", () => {
    assert.deepStrictEqual(explicarErroDoTurno("codex", "servidor MCP ifpr não iniciou: boom"), {
      texto:
        "A base do IFPR (o servidor MCP) não ficou disponível para o ChatGPT (Codex). Comece uma nova conversa; se o erro continuar, reinicie o app.",
      detalhe: "servidor MCP ifpr não iniciou: boom",
    });
    assert.deepStrictEqual(explicarErroDoTurno("claude", "turno terminou com error_max_turns"), {
      texto: "Turno terminou com error_max_turns.",
    });
  });
});
