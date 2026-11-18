import { assert, describe, it } from "@effect/vitest";
import { FalhaProvider } from "../src/erros.ts";
import { erroDoTurno } from "../src/eventos.ts";
import { falhaDe } from "../src/Canal.ts";
import {
  classificarFalha,
  classificarFalhaEstado,
  diagnosticoDaFalha,
  LIMITE_TECNICO,
  sanear,
  type TipoFalha,
  type TipoFalhaEstado,
  textoTecnico,
} from "../src/falhas.ts";

describe("classificarFalha", () => {
  const casos: ReadonlyArray<readonly [operacao: string, texto: string, tipo: TipoFalha]> = [
    // sem login
    ["ler mensagens", "Invalid API key · Please run /login", "semLogin"],
    ["turn/start", "401 Unauthorized", "semLogin"],
    ["iniciar", "Not logged in", "semLogin"],
    ["login", "Antigravity sem login no app: use entrar", "semLogin"],
    ["entrar", "qualquer coisa", "semLogin"],
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
    ["", "API Error: 429 rate_limit_error: This request would exceed your account's rate limit.", "cota"],
    // os da pausa por cota da revisão com IA
    ["", "5-hour limit reached ∙ resets 3pm", "cota"],
    ["", "You exceeded your current plan, please check your plan and billing details.", "cota"],
    ["", "Weekly limit reached ∙ resets Mon 9am", "cota"],
    // "limit reached" que não é de uso não é cota
    ["", "Context limit reached", "desconhecido"],
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
    // serviço sobrecarregado ou fora do ar (a revisão com IA também pausa por ele)
    ["", 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', "indisponivel"],
    ["", "unexpected status 503 Service Unavailable", "indisponivel"],
    // limite de passos do app e queda
    ["", "turno terminou com error_max_turns", "limiteApp"],
    ["sessão", "o processo do Claude encerrou", "queda"],
    // desconhecido
    ["turn/start", "something odd happened", "desconhecido"],
  ];

  it.each(casos)("%s: %s → %s", (operacao, texto, tipo) => {
    assert.strictEqual(classificarFalha(operacao, texto), tipo);
  });
});

describe("FalhaProvider", () => {
  it("falhaDe classifica pelo texto da causa, que fica só em cause", () => {
    const causa = new Error("spawn codex ENOENT at /Users/alguem/.codex");
    const falha = falhaDe("codex", "abrir app-server")(causa);
    assert.strictEqual(falha.tipo, "cliAusente");
    assert.strictEqual(falha.cause, causa);
    assert.isUndefined(falha.tecnico);
    assert.strictEqual(falha.message, "codex: falha em abrir app-server (cliAusente)");
    assert.notInclude(falha.message, "alguem");
  });

  it("a mensagem do desconhecido não traz tipo, e a causa que não é Error não classifica", () => {
    const falha = falhaDe("claude", "ler mensagens")({ qualquer: "coisa" });
    assert.strictEqual(falha.tipo, "desconhecido");
    assert.strictEqual(falha.message, "claude: falha em ler mensagens");
    assert.strictEqual(
      new FalhaProvider({ provider: "x", operacao: "y", tipo: "cota" }).message,
      "x: falha em y (cota)",
    );
  });
});

describe("erroDoTurno", () => {
  it("classifica e saneia o texto do provider", () => {
    assert.deepStrictEqual(erroDoTurno("Claude AI usage limit reached|1763402400"), {
      _tag: "Erro",
      tipo: "cota",
      mensagem: "Claude AI usage limit reached|1763402400",
    });
    assert.deepStrictEqual(erroDoTurno("Not logged in as fulano@ifpr.edu.br"), {
      _tag: "Erro",
      tipo: "semLogin",
      mensagem: "Not logged in as <e-mail>",
    });
  });
});

describe("textoTecnico", () => {
  const casos: ReadonlyArray<readonly [texto: string, saneado: string]> = [
    ["falhou para fulano.tal@gmail.com", "falhou para <e-mail>"],
    ["ENOENT: /Users/maria/Library/x.json", "ENOENT: ~/Library/x.json"],
    ["abrir /home/joao/.codex/auth.json", "abrir ~/.codex/auth.json"],
    ["C:\\Users\\Joao Silva\\AppData", "~\\AppData"],
    ["GET https://api.exemplo.com/v1/x?token=abc&sig=def falhou", "GET https://api.exemplo.com/v1/x?<consulta> falhou"],
    ["Authorization: Bearer abcdefghijklmnop", "Authorization: <segredo>"],
    ["chave sk-ant-api03-abcdefghijklmnopqrst inválida", "chave <segredo> inválida"],
    ['{"api_key":"xyz123"}', '{"api_key":"<segredo>"}'],
    ["token eyJhbGciOiJIUzI1NiJ9abcdefghijklmnopqrstu9 recusado", "token <segredo> recusado"],
    ["429 Too Many Requests", "429 Too Many Requests"],
    // a credencial dos proxies, antes de o e-mail comer o resto
    ["proxy http://joao:s3nh4@10.0.0.1:3128 recusou", "proxy http://<credencial>@10.0.0.1:3128 recusou"],
    [
      "HTTPS_PROXY=https://maria.silva:p%40ss@proxy.ifpr.edu.br:8080",
      "HTTPS_PROXY=https://<credencial>@proxy.ifpr.edu.br:8080",
    ],
    ["socks5://user:segredo@127.0.0.1:1080 caiu", "socks5://<credencial>@127.0.0.1:1080 caiu"],
    // a chave com prefixo, o valor entre aspas inteiro e o token OAuth curto do Google
    ["ANTHROPIC_API_KEY=abcdefghijklmn", "ANTHROPIC_API_KEY=<segredo>"],
    ["password: 'my pass word' recusada", "password: '<segredo>' recusada"],
    ["OAuth recusado: ya29.a0AfH6SMBxyz", "OAuth recusado: <segredo>"],
    ["max_tokens: 4096", "max_tokens: 4096"],
  ];

  it.each(casos)("%s", (texto, saneado) => {
    assert.strictEqual(sanear(texto), saneado);
  });

  it("uma linha, com até o limite de caracteres", () => {
    const longo = textoTecnico(`linha um\n\n  linha dois ${"x ".repeat(400)}`);
    assert.isTrue(longo.startsWith("linha um linha dois x"));
    assert.strictEqual(longo.length, LIMITE_TECNICO);
    assert.isTrue(longo.endsWith("…"));
  });

  // O corte antes de sanear deixa linear o que a `CADEIA_LONGA` faria quadrático (160 mil caracteres
  // sem espaço levavam segundos); o prazo do vitest pega a regressão.
  it("uma cadeia de 160 mil caracteres sem espaço sai rápido", { timeout: 1000 }, () => {
    const longo = textoTecnico(`erro ${"a1".repeat(80_000)}`);
    assert.strictEqual(longo, "erro");
    assert.strictEqual(textoTecnico("a1".repeat(80_000)), "<segredo>");
  });

  it("corta antes de sanear no último espaço, sem deixar pedaço de segredo", () => {
    const texto = `${"palavra ".repeat(240)}token=${"x".repeat(200)}`;
    const tecnico = textoTecnico(texto);
    assert.notInclude(tecnico, "xxx");
    assert.strictEqual(tecnico.length, LIMITE_TECNICO);
  });
});

describe("diagnosticoDaFalha", () => {
  it("o texto técnico da causa, saneado", () => {
    const falha = new FalhaProvider({
      provider: "claude",
      operacao: "ler mensagens",
      tipo: "rede",
      cause: new Error("proxy http://joao:s3nh4@10.0.0.1:3128\nrecusou"),
    });
    assert.strictEqual(diagnosticoDaFalha(falha), "proxy http://<credencial>@10.0.0.1:3128 recusou");
  });

  it("a mensagem da falha quando a causa não tem texto", () => {
    const falha = new FalhaProvider({ provider: "codex", operacao: "turn/start", tipo: "queda" });
    assert.strictEqual(diagnosticoDaFalha(falha), falha.message);
  });
});

describe("classificarFalhaEstado", () => {
  const casos: ReadonlyArray<readonly [mensagem: string, tipo: TipoFalhaEstado | undefined]> = [
    [
      "Antigravity has not reached Google after 30 seconds. Check this machine's network connection. Broken IPv6 is a common cause.",
      "rede",
    ],
    ["Google requires an eligible Antigravity subscription for this account.", "plano"],
    ["The Codex download failed its size or SHA-256 check. Nothing was installed.", "incompleta"],
    ["Codex is not installed. Install it to continue.", "naoInstalado"],
    ["Google sign-in was not approved.", "naoAprovado"],
    ["The runtime crashed.", undefined],
  ];

  it.each(casos)("%s → %s", (mensagem, tipo) => {
    assert.strictEqual(classificarFalhaEstado(mensagem), tipo);
  });
});
