/**
 * A política de fábrica e a classificação dos pedidos de aprovação: funções puras e os pedidos reais
 * das gravações (`test/fixtures/*-aprovacao.jsonl`), decididos para a pasta da gravação e para outra.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { classificarAcp } from "../src/drivers/antigravity.ts";
import { classificarClaude } from "../src/drivers/claude.ts";
import { classificarComandoCodex } from "../src/drivers/codex.ts";
import {
  ambienteSemTelemetria,
  avaliar,
  buscaWebLigada,
  caminhosDoComando,
  type ClassePedido,
  dentroDaPasta,
  Politica,
  POLITICA_FABRICA,
} from "../src/politica.ts";

const PASTA = "/Users/servidor/Documentos/tarefa";
const decodificarPolitica = Schema.decodeSync(Politica);
const regra = (classe: ClassePedido, pasta = PASTA) => avaliar(POLITICA_FABRICA, classe, pasta).regra;

const lerLinhas = Effect.fn("teste.lerLinhas")(function* (nome: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const texto = yield* fs.readFileString(path.join(import.meta.dirname, "fixtures", nome));
  return texto
    .split("\n")
    .filter((linha) => linha.trim() !== "")
    .map((linha) => JSON.parse(linha) as { readonly mensagem: Record<string, unknown> });
});

describe("política de fábrica", () => {
  it("é um Politica válido, congelado, com os três providers", () => {
    assert.deepStrictEqual(decodificarPolitica(POLITICA_FABRICA), POLITICA_FABRICA);
    assert.deepStrictEqual(POLITICA_FABRICA.providers, ["claude", "codex", "antigravity"]);
    assert.isTrue(Object.isFrozen(POLITICA_FABRICA));
    assert.isTrue(Object.isFrozen(POLITICA_FABRICA.ferramentas.escrita));
    assert.deepStrictEqual(POLITICA_FABRICA.codex, { sandbox: "read-only", aprovacao: "on-request" });
    assert.strictEqual(POLITICA_FABRICA.telemetria, "desligada");
  });

  it("busca web: desligada na de fábrica mesmo pedida; a pedido numa política que permite", () => {
    assert.isFalse(buscaWebLigada(POLITICA_FABRICA, true));
    const aPedido = {
      ...POLITICA_FABRICA,
      isolamento: { ...POLITICA_FABRICA.isolamento, buscaWeb: "a-pedido" as const },
      ferramentas: { ...POLITICA_FABRICA.ferramentas, web: "perguntar" as const },
    };
    assert.isTrue(buscaWebLigada(aPedido, true));
    assert.isFalse(buscaWebLigada(aPedido, undefined));
  });

  it("dentro da pasta: relativo, absoluto, subida, pasta pessoal e /tmp do macOS", () => {
    assert.isTrue(dentroDaPasta("notas.md", PASTA));
    assert.isTrue(dentroDaPasta(`${PASTA}/sub/a.txt`, PASTA));
    assert.isTrue(dentroDaPasta(PASTA, PASTA));
    assert.isFalse(dentroDaPasta("../fora.txt", PASTA));
    assert.isFalse(dentroDaPasta(`${PASTA}-irma/a.txt`, PASTA));
    assert.isFalse(dentroDaPasta("/etc/passwd", PASTA));
    assert.isFalse(dentroDaPasta("~/.ssh/id_rsa", PASTA));
    assert.isTrue(dentroDaPasta("/tmp/simplifica-x/a.txt", "/private/tmp/simplifica-x"));
    assert.isTrue(dentroDaPasta("/private/tmp/simplifica-x/a.txt", "/tmp/simplifica-x"));
  });

  it("caminhos de um comando: absolutos, pasta pessoal e subida; sem executáveis do sistema nem /dev/null", () => {
    assert.deepStrictEqual(caminhosDoComando("ls -la"), []);
    assert.deepStrictEqual(caminhosDoComando("cat /etc/hosts > saida.txt 2>/dev/null"), ["/etc/hosts"]);
    assert.deepStrictEqual(caminhosDoComando("cp ~/segredo.txt ../copia.txt"), ["~/segredo.txt", "../copia.txt"]);
    assert.deepStrictEqual(caminhosDoComando("/bin/zsh -lc 'printf ok > teste.txt'"), []);
    assert.deepStrictEqual(caminhosDoComando('echo x >"/Users/outro/a.txt"'), ["/Users/outro/a.txt"]);
  });

  it("avalia por tipo e lugar", () => {
    assert.strictEqual(regra({ tipo: "mcp-app", caminhos: [] }), "permitir");
    assert.strictEqual(regra({ tipo: "mcp-outro", caminhos: [] }), "negar");
    assert.strictEqual(regra({ tipo: "web", caminhos: [] }), "negar");
    assert.strictEqual(regra({ tipo: "outra", caminhos: [] }), "perguntar");
    assert.strictEqual(regra({ tipo: "leitura", caminhos: ["a.md"] }), "permitir");
    assert.strictEqual(regra({ tipo: "leitura", caminhos: ["/etc/hosts"] }), "negar");
    assert.strictEqual(regra({ tipo: "escrita", caminhos: [`${PASTA}/a.md`] }), "perguntar");
    assert.strictEqual(regra({ tipo: "escrita", caminhos: [`${PASTA}/a.md`, "/tmp/b.md"] }), "negar");
    assert.strictEqual(regra({ tipo: "comando", caminhos: [] }), "perguntar");
    assert.strictEqual(regra({ tipo: "comando", caminhos: ["~/x"] }), "negar");
    assert.match(
      avaliar(POLITICA_FABRICA, { tipo: "escrita", caminhos: ["/tmp/b.md"] }, PASTA).motivo,
      /não permite alterar arquivos fora da pasta de trabalho/,
    );
  });

  it("telemetria: sem OTEL_* herdadas; variáveis do Claude e do Antigravity", () => {
    const ambiente = { PATH: "/bin", OTEL_EXPORTER_OTLP_ENDPOINT: "https://coletor", OTEL_SERVICE_NAME: "x" };
    const claude = ambienteSemTelemetria("claude", ambiente);
    assert.strictEqual(claude.PATH, "/bin");
    assert.isUndefined(claude.OTEL_EXPORTER_OTLP_ENDPOINT);
    assert.strictEqual(claude.DISABLE_TELEMETRY, "1");
    assert.strictEqual(claude.CLAUDE_CODE_ENABLE_TELEMETRY, "0");
    assert.strictEqual(claude.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1");
    assert.deepStrictEqual(ambienteSemTelemetria("codex", ambiente), { PATH: "/bin" });
    assert.strictEqual(ambienteSemTelemetria("antigravity", ambiente).ANTIGRAVITY_SENTRY_SAMPLE_RATE, "0");
  });
});

describe("classificação por provider", () => {
  it("Claude: nomes do Claude Code e MCP", () => {
    const app = ["ifpr"];
    assert.deepStrictEqual(classificarClaude("mcp__ifpr__buscar_norma", {}, app), { tipo: "mcp-app", caminhos: [] });
    assert.deepStrictEqual(classificarClaude("mcp__pessoal__x", {}, app), { tipo: "mcp-outro", caminhos: [] });
    assert.deepStrictEqual(classificarClaude("ReadMcpResourceTool", { server: "ifpr", uri: "ifpr://x" }, app), {
      tipo: "mcp-app",
      caminhos: [],
    });
    assert.deepStrictEqual(classificarClaude("Read", { file_path: "/etc/hosts" }, app), {
      tipo: "leitura",
      caminhos: ["/etc/hosts"],
    });
    assert.deepStrictEqual(classificarClaude("Grep", { pattern: "x" }, app), { tipo: "leitura", caminhos: [] });
    assert.deepStrictEqual(classificarClaude("Edit", { file_path: "a.md" }, app), {
      tipo: "escrita",
      caminhos: ["a.md"],
    });
    assert.deepStrictEqual(classificarClaude("Bash", { command: "rm -rf ~/x" }, app), {
      tipo: "comando",
      caminhos: ["~/x"],
    });
    assert.deepStrictEqual(classificarClaude("WebFetch", { url: "https://x" }, app), { tipo: "web", caminhos: [] });
    assert.deepStrictEqual(classificarClaude("Task", {}, app), { tipo: "outra", caminhos: [] });
  });

  it("Codex: comando com cwd e caminhos citados; rede é web", () => {
    assert.deepStrictEqual(classificarComandoCodex({ command: "/bin/zsh -lc 'cat /etc/hosts'", cwd: PASTA }), {
      tipo: "comando",
      caminhos: [PASTA, "/etc/hosts"],
    });
    assert.deepStrictEqual(
      classificarComandoCodex({ command: "curl x", cwd: PASTA, networkApprovalContext: { host: "x" } }),
      { tipo: "web", caminhos: [] },
    );
  });

  it("Antigravity: kind do ACP, locations, entrada e MCP do app", () => {
    const app = ["ifpr"];
    assert.deepStrictEqual(classificarAcp({ name: "mcp_ifpr_buscar_norma", kind: "other" }, app), {
      tipo: "mcp-app",
      caminhos: [],
    });
    assert.deepStrictEqual(
      classificarAcp({ name: "read_resource", kind: "read", rawInput: { ServerName: "ifpr", Uri: "ifpr://x" } }, app),
      { tipo: "mcp-app", caminhos: [] },
    );
    assert.deepStrictEqual(classificarAcp({ name: "mcp_pessoal_x", kind: "other" }, app), {
      tipo: "mcp-outro",
      caminhos: [],
    });
    assert.deepStrictEqual(
      classificarAcp(
        { name: "run_command", kind: "execute", rawInput: { CommandLine: "cat /etc/hosts", Cwd: PASTA } },
        app,
      ),
      { tipo: "comando", caminhos: [PASTA, "/etc/hosts"] },
    );
    assert.deepStrictEqual(classificarAcp({ name: "search_web", kind: "fetch" }, app), { tipo: "web", caminhos: [] });
  });

  it.layer(NodeServices.layer)((it) => {
    it.effect("pedidos reais das gravações: pergunta na pasta da sessão, nega fora dela", () =>
      Effect.gen(function* () {
        // Claude: o `canUseTool` do Write em teste.txt.
        const claude = (yield* lerLinhas("claude-aprovacao.jsonl"))
          .map((linha) => linha.mensagem)
          .filter((m) => m.type === "can_use_tool");
        assert.strictEqual(claude.length, 2);
        for (const pedido of claude) {
          const classe = classificarClaude(String(pedido.toolName), pedido.input as Record<string, unknown>, ["ifpr"]);
          assert.strictEqual(classe.tipo, "escrita");
          assert.strictEqual(regra(classe, "/private/tmp/simplifica-poc-eKZkgv"), "perguntar");
          assert.strictEqual(regra(classe), "negar");
        }

        // Codex: o `fileChange` (os caminhos vêm do item) e o comando que grava teste.txt.
        const codex = (yield* lerLinhas("codex-aprovacao.jsonl")).map((linha) => linha.mensagem);
        const itens = codex
          .filter((m) => m.metodo === "item/started")
          .map((m) => (m.parametros as { item: Record<string, unknown> }).item);
        const arquivo = itens.find((item) => item.type === "fileChange") as { changes: Array<{ path: string }> };
        const escrita: ClassePedido = { tipo: "escrita", caminhos: arquivo.changes.map((mudanca) => mudanca.path) };
        assert.strictEqual(regra(escrita, "/private/tmp/simplifica-poc-zbMkpj"), "perguntar");
        assert.strictEqual(regra(escrita), "negar");
        const comando = itens.find(
          (item) => item.type === "commandExecution" && String(item.command).includes("printf"),
        ) as { command: string; cwd: string };
        const classeComando = classificarComandoCodex(comando);
        assert.strictEqual(classeComando.tipo, "comando");
        assert.strictEqual(regra(classeComando, "/private/tmp/simplifica-poc-zbMkpj"), "perguntar");
        assert.strictEqual(regra(classeComando), "negar");

        // Antigravity: o `session/request_permission` do write_file.
        const acp = (yield* lerLinhas("antigravity-aprovacao.jsonl"))
          .map((linha) => linha.mensagem)
          .filter((m) => m.tipo === "session/request_permission" && m.pedido !== undefined);
        assert.isAbove(acp.length, 0);
        for (const { pedido } of acp) {
          const classe = classificarAcp((pedido as { toolCall: Record<string, unknown> }).toolCall, ["ifpr"]);
          assert.strictEqual(classe.tipo, "escrita");
          assert.strictEqual(regra(classe, "/private/tmp/simplifica-poc-UtCcAk"), "perguntar");
          assert.strictEqual(regra(classe), "negar");
        }
      }),
    );
  });
});
