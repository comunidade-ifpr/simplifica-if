import { assert, describe, it } from "@effect/vitest";
import { resumir, textoDeBlocos } from "../src/eventos.ts";
import { configMcpCodex, isolamentoCodex } from "../src/drivers/codex.ts";
import { mcpServersAcp } from "../src/drivers/antigravity.ts";
import { nomeFerramentaClaude } from "../src/drivers/claude.ts";
import { limparAmbiente } from "../src/processo.ts";
import { sanitizar } from "../src/sanitizar.ts";

const SERVIDOR = {
  nome: "ifpr",
  comando: "/usr/local/bin/node",
  argumentos: ["cli.ts", "--banco", "kb.sqlite"],
  preAprovado: true,
};
const CONFIG = { provider: "codex", pastaTrabalho: "/tmp/x", servidoresMcp: [SERVIDOR] } as const;

describe("sanitizar", () => {
  it("tira e-mails, segredos e a pasta pessoal, e mantém contagens de tokens", () => {
    const entrada = {
      account: { email: "fulana@ifpr.edu.br", subscriptionType: "pro" },
      texto: "fale com fulana@ifpr.edu.br em /Users/fulana/projeto",
      headers: { Authorization: "Bearer abcdefghijklmnop" },
      refresh_token: "xyz",
      usage: { input_tokens: 10, output_tokens: 5 },
      tokenSource: "claude.ai",
      lista: ["Bearer abcdefghijklmnop"],
    };
    assert.deepStrictEqual(sanitizar(entrada, { home: "/Users/fulana" }), {
      account: { email: "<removido>", subscriptionType: "pro" },
      texto: "fale com <email> em ~/projeto",
      headers: { Authorization: "<removido>" },
      refresh_token: "<removido>",
      usage: { input_tokens: 10, output_tokens: 5 },
      tokenSource: "claude.ai",
      lista: ["<segredo>"],
    });
  });
});

describe("eventos", () => {
  it("resumir: uma linha, no máximo 300 caracteres", () => {
    assert.strictEqual(resumir("a\n  b"), "a b");
    const longo = resumir("x".repeat(500));
    assert.strictEqual(longo.length, 300);
    assert.isTrue(longo.endsWith("…"));
  });

  it("textoDeBlocos: MCP, ACP e texto puro", () => {
    assert.strictEqual(
      textoDeBlocos([{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }]),
      "ab",
    );
    assert.strictEqual(textoDeBlocos([{ type: "content", content: { type: "text", text: "c" } }]), "c");
    assert.strictEqual(textoDeBlocos("d"), "d");
  });
});

describe("configuração do MCP por provider", () => {
  it("Claude: nomes mcp__servidor__ferramenta", () => {
    assert.strictEqual(nomeFerramentaClaude("mcp__ifpr__buscar_norma"), "ifpr.buscar_norma");
    assert.strictEqual(nomeFerramentaClaude("Write"), "Write");
  });

  it("Codex: mcp_servers por thread e isolamento dos MCP do usuário", () => {
    assert.deepStrictEqual(configMcpCodex(CONFIG), {
      "mcp_servers.ifpr": {
        command: "/usr/local/bin/node",
        args: ["cli.ts", "--banco", "kb.sqlite"],
        default_tools_approval_mode: "approve",
      },
    });
    assert.deepStrictEqual(isolamentoCodex({ mcp_servers: { ifpr: {}, pessoal: {}, docs: {} } }, CONFIG), {
      "features.apps": false,
      "mcp_servers.pessoal.enabled": false,
      "mcp_servers.docs.enabled": false,
    });
  });

  it("Antigravity: mcpServers do session/new", () => {
    assert.deepStrictEqual(mcpServersAcp({ ...CONFIG, provider: "antigravity" }), [
      { name: "ifpr", command: "/usr/local/bin/node", args: ["cli.ts", "--banco", "kb.sqlite"], env: [] },
    ]);
  });

  it("ambiente: sem as variáveis de uma sessão hospedeira do Claude Code", () => {
    assert.deepStrictEqual(
      limparAmbiente({ PATH: "/bin", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "x", VAZIA: undefined }),
      {
        PATH: "/bin",
      },
    );
  });
});
