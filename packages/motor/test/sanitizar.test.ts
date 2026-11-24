import { assert, describe, it } from "@effect/vitest";
import { resumir, textoDeBlocos } from "../src/eventos.ts";
import { configMcpCodex, isolamentoCodex } from "../src/drivers/codex.ts";
import { mcpServersAcp, recusaMcpAcp } from "../src/drivers/antigravity.ts";
import { mcpServersClaude, nomeFerramentaClaude } from "../src/drivers/claude.ts";
import type { ConfigSessao } from "../src/Driver.ts";
import { POLITICA_FABRICA } from "../src/politica.ts";
import { limparAmbiente } from "../src/processo.ts";
import { sanitizar } from "../src/sanitizar.ts";

const SERVIDOR_HTTP = {
  tipo: "http",
  nome: "ifpr",
  url: "http://127.0.0.1:43210/mcp",
  cabecalhos: { Authorization: "Bearer token-da-sessao" },
  preAprovado: true,
} as const;
const CONFIG_HTTP = {
  provider: "codex",
  pastaTrabalho: "/tmp/x",
  servidoresMcp: [SERVIDOR_HTTP],
} as const satisfies ConfigSessao;

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

  it("Claude: mcpServers por HTTP", () => {
    assert.deepStrictEqual(mcpServersClaude(CONFIG_HTTP), {
      ifpr: {
        type: "http",
        url: "http://127.0.0.1:43210/mcp",
        headers: { Authorization: "Bearer token-da-sessao" },
        alwaysLoad: true,
      },
    });
  });

  it("Codex: isolamento dos MCP, conectores e plugins do usuário", () => {
    assert.deepStrictEqual(
      isolamentoCodex({ mcp_servers: { ifpr: {}, pessoal: {}, docs: {} } }, CONFIG_HTTP, [
        "/u/.codex/skills/pdf/SKILL.md",
      ]),
      {
        "features.apps": false,
        "features.plugins": false,
        "features.hooks": false,
        "skills.bundled.enabled": false,
        project_doc_max_bytes: 0,
        "mcp_servers.pessoal.enabled": false,
        "mcp_servers.docs.enabled": false,
        "skills.config": [{ path: "/u/.codex/skills/pdf/SKILL.md", enabled: false }],
      },
    );
  });

  it("Codex: mcp_servers por HTTP com url e http_headers", () => {
    assert.deepStrictEqual(configMcpCodex(CONFIG_HTTP, POLITICA_FABRICA), {
      "mcp_servers.ifpr": {
        url: "http://127.0.0.1:43210/mcp",
        http_headers: { Authorization: "Bearer token-da-sessao" },
        default_tools_approval_mode: "approve",
      },
    });
    assert.deepStrictEqual(
      configMcpCodex(
        {
          ...CONFIG_HTTP,
          servidoresMcp: [{ tipo: "http", nome: "ifpr", url: "http://127.0.0.1:43210/mcp", preAprovado: false }],
        },
        POLITICA_FABRICA,
      ),
      { "mcp_servers.ifpr": { url: "http://127.0.0.1:43210/mcp" } },
    );
  });

  it("Antigravity: mcpServers HTTP do session/new", () => {
    assert.deepStrictEqual(mcpServersAcp({ ...CONFIG_HTTP, provider: "antigravity" }, { http: true }), [
      {
        type: "http",
        name: "ifpr",
        url: "http://127.0.0.1:43210/mcp",
        headers: [{ name: "Authorization", value: "Bearer token-da-sessao" }],
      },
    ]);
  });

  it("Antigravity sem HTTP: a ponte stdio do T3, com a URL e o token no env", () => {
    const ponte = { comando: "/usr/local/bin/node", argumentos: ["ponte-mcp.ts"] };
    assert.deepStrictEqual(mcpServersAcp({ ...CONFIG_HTTP, provider: "antigravity" }, { http: false, ponte }), [
      {
        name: "ifpr",
        command: "/usr/local/bin/node",
        args: ["ponte-mcp.ts"],
        env: [
          { name: "ELECTRON_RUN_AS_NODE", value: "1" },
          { name: "T3_ACP_MCP_ENDPOINT", value: "http://127.0.0.1:43210/mcp" },
          { name: "T3_ACP_MCP_AUTHORIZATION", value: "Bearer token-da-sessao" },
        ],
      },
    ]);
  });

  it("Antigravity: HTTP só com mcpCapabilities.http no initialize", () => {
    const comHttp = { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: true, sse: true } } };
    const semHttp = {
      protocolVersion: 1,
      agentCapabilities: { mcpCapabilities: { sse: true } },
      agentInfo: { name: "antigravity-acp", version: "agy_acp_server_1.0.0" },
    };
    const ponte = { comando: "/usr/local/bin/node", argumentos: ["ponte-mcp.ts"] };
    assert.isUndefined(recusaMcpAcp(comHttp, { ...CONFIG_HTTP, provider: "antigravity" }, undefined));
    assert.isUndefined(
      recusaMcpAcp(semHttp, { ...CONFIG_HTTP, provider: "antigravity", servidoresMcp: [] }, undefined),
    );
    assert.isUndefined(recusaMcpAcp(semHttp, { ...CONFIG_HTTP, provider: "antigravity" }, ponte));
    assert.match(
      recusaMcpAcp(semHttp, { ...CONFIG_HTTP, provider: "antigravity" }, undefined) ?? "",
      /agy_acp_server_1\.0\.0.*mcpCapabilities\.http.*ifpr/,
    );
    assert.isDefined(recusaMcpAcp({ protocolVersion: 1 }, { ...CONFIG_HTTP, provider: "antigravity" }, undefined));
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
