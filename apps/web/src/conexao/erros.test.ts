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
import {
  explicarErro,
  explicarErroDoTurno,
  explicarFalhaProvider,
  mensagemDeErro,
  PERDEU_CONTATO,
  tipoFalha,
} from "./erros.ts";

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
    // cota ou limite de uso (Claude: `rate_limit`, `billing_error`; Codex: usage limit, 429)
    ["turn/start", "rate limit reached", "cota"],
    ["", "Claude AI usage limit reached|1763402400", "cota"],
    [
      "",
      "You've hit your usage limit. Upgrade to Pro (https://openai.com/chatgpt/pricing) or try again later.",
      "cota",
    ],
    ["", "exceeded retry limit, last status: 429 Too Many Requests", "cota"],
    ["", "Credit balance is too low", "cota"],
    ["", "RESOURCE_EXHAUSTED: Quota exceeded for quota metric", "cota"],
    // rede ou proxy
    [
      "",
      "stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)",
      "rede",
    ],
    ["", "API Error: Connection error.", "rede"],
    ["", "getaddrinfo ENOTFOUND api.anthropic.com", "rede"],
    ["", "unable to get local issuer certificate", "rede"],
    ["", "connect ECONNREFUSED 10.0.0.1:3128 (proxy)", "rede"],
    // versão antiga
    ["session/new", "o agy (1.2.0) não anuncia session/load nem session/resume", "versao"],
    ["iniciar", "This version of Codex is too old; please update to the latest version", "versao"],
    // recusa pelas regras de uso
    [
      "",
      "API Error: Claude Code is unable to respond to this request, which appears to violate our Usage Policy",
      "politica",
    ],
    ["", "Invalid prompt: your prompt was flagged as potentially violating our usage policy.", "politica"],
    ["", "Response was blocked due to SAFETY", "politica"],
    // serviço sobrecarregado ou fora do ar
    ["", 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', "indisponivel"],
    ["", "unexpected status 503 Service Unavailable", "indisponivel"],
    // limite de passos do app e queda
    ["", "turno terminou com error_max_turns", "limiteApp"],
    ["sessão", "o processo do Claude encerrou", "queda"],
    // desconhecido
    ["turn/start", "something odd happened", undefined],
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
        texto: "O Claude está sem login. Entre na conta em Configurações › Sua IA e tente de novo.",
        detalhe: "claude: falha em ler mensagens: Not logged in",
      },
    );
    assert.strictEqual(
      explicarFalhaProvider({ provider: "codex", operacao: "abrir app-server", detalhe: "spawn codex ENOENT" }).texto,
      "O ChatGPT (Codex) não está instalado neste computador. Instale-o em Configurações › Sua IA e tente de novo.",
    );
    assert.match(
      explicarFalhaProvider({ provider: "antigravity", operacao: "session/new", detalhe: "mcp failed" }).texto,
      /^A base do IFPR não ficou disponível para o Gemini \(Antigravity\)/,
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
      explicarFalhaProvider({ provider: "codex", operacao: "turn/start", detalhe: "something odd" }),
      {
        texto:
          "O ChatGPT (Codex) não conseguiu responder. Tente de novo; se o erro continuar, veja os detalhes técnicos.",
        detalhe: "codex: falha em turn/start: something odd",
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
  it("traduz pelo tipo e deixa o original nos detalhes técnicos", () => {
    assert.deepStrictEqual(explicarErroDoTurno("codex", "servidor MCP ifpr não iniciou: boom"), {
      texto:
        "A base do IFPR não ficou disponível para o ChatGPT (Codex). Comece uma nova conversa; se o erro continuar, reinicie o app.",
      detalhe: "servidor MCP ifpr não iniciou: boom",
    });
    assert.deepStrictEqual(explicarErroDoTurno("claude", "turno terminou com error_max_turns"), {
      texto:
        "A resposta passou do limite de passos que o app permite. Divida o pedido em partes menores e envie de novo.",
      detalhe: "turno terminou com error_max_turns",
    });
    assert.strictEqual(
      explicarErroDoTurno("claude", "Claude AI usage limit reached|1763402400").texto,
      "Sua conta do Claude chegou ao limite de uso. Espere o limite renovar ou escolha outra IA para esta conversa.",
    );
  });

  it("sem tipo conhecido, a frase genérica, nunca o texto da CLI", () => {
    assert.deepStrictEqual(explicarErroDoTurno("antigravity", "Unexpected token < in JSON"), {
      texto:
        "O Gemini (Antigravity) não conseguiu responder. Tente de novo; se o erro continuar, veja os detalhes técnicos.",
      detalhe: "Unexpected token < in JSON",
    });
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
