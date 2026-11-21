// @effect-diagnostics nodeBuiltinImport:off -- teste: o servidor como processo filho, num diretório temporário
/**
 * Integração: o servidor como processo filho, em stdio, com `cwd` num diretório temporário vazio,
 * falando com o Client do SDK; e os erros de inicialização da CLI.
 *
 * Com `SIMPLIFICA_MCP_EXE` (o caminho do executável de `pnpm mcp:executavel`), o filho é o executável,
 * com o `PATH` reduzido a `/usr/bin:/bin`, sem Node.
 */
import * as NodeChildProcess from "node:child_process";
import { afterEach, describe, expect, test } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Client } from "@modelcontextprotocol/client";
import { VERSAO_ESQUEMA } from "@simplifica-if/kb/db/esquema";
import { FERRAMENTAS } from "../src/ferramentas/toolkit.ts";
import { INSTRUCOES, MENSAGEM_INCOMPATIVEL } from "../src/servidor.ts";
import { criarBancoFixture, diretorioTemporario, limparTemporarios } from "./fixture.ts";

afterEach(limparTemporarios);

const CLI = NodePath.resolve(import.meta.dirname, "../src/cli.ts");
const EXE = process.env.SIMPLIFICA_MCP_EXE;
/** Comando e argumentos do servidor: o executável, ou o Node deste processo com a CLI. */
const COMANDO = EXE ?? process.execPath;
const comCli = (args: string[]) => (EXE ? args : [CLI, ...args]);

/** Ambiente mínimo, sem herdar SIMPLIFICA_KB do processo de teste. */
function ambiente(extra: Record<string, string> = {}): Record<string, string> {
  return { PATH: EXE ? "/usr/bin:/bin" : (process.env.PATH ?? ""), HOME: process.env.HOME ?? "", ...extra };
}

/** O Client na revisão 2026-07-28 (`server/discover`), ou na era do `initialize` (`legacy`, 2025-11-25). */
async function conectar(
  args: string[],
  opcoes: { cwd: string; env?: Record<string, string>; negociacao?: "legacy" | "2026-07-28" },
) {
  const transporte = new StdioClientTransport({
    command: COMANDO,
    args: comCli(args),
    cwd: opcoes.cwd,
    env: opcoes.env ?? ambiente(),
    stderr: "pipe",
  });
  const cliente = new Client(
    { name: "teste-stdio", version: "0" },
    { versionNegotiation: { mode: opcoes.negociacao === "legacy" ? "legacy" : { pin: "2026-07-28" } } },
  );
  await cliente.connect(transporte);
  return cliente;
}

async function rodarCli(args: string[], env: Record<string, string> = ambiente()) {
  const processo = NodeChildProcess.spawn(COMANDO, comCli(args), {
    cwd: diretorioTemporario(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  processo.stdout.setEncoding("utf-8").on("data", (parte: string) => (stdout += parte));
  processo.stderr.setEncoding("utf-8").on("data", (parte: string) => (stderr += parte));
  const codigo = await new Promise<number | null>((resolve, reject) => {
    processo.once("error", reject);
    processo.once("close", resolve);
  });
  return { stdout, stderr, codigo };
}

describe("servidor em stdio", () => {
  test("lista as ferramentas com anotações e descrições e responde sobre_a_base", async () => {
    const banco = criarBancoFixture();
    const vazio = diretorioTemporario();
    const cliente = await conectar(["--banco", banco, "--canal", "beta"], { cwd: vazio });
    try {
      expect(cliente.getInstructions()).toBe(INSTRUCOES);
      const { tools } = await cliente.listTools();
      expect(tools.map((t) => t.name)).toEqual(FERRAMENTAS.map((f) => f.nome));
      for (const t of tools) {
        expect(t.description?.length).toBeGreaterThan(20);
        expect(t.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true, openWorldHint: false });
        expect(t.inputSchema.type).toBe("object");
        expect(t.outputSchema?.type).toBe("object");
      }

      const r = await cliente.callTool({ name: "sobre_a_base", arguments: {} });
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent).toMatchObject({
        base: { versao: "dev-ab12cd34", commit: null, data_referencia: "2026-11-13", canal: "beta" },
        dados: { niveis: ["médio", "superior"], tipos_de_secao: ["avaliacao", "estagio_praticas"] },
        avisos: [],
      });
      const texto = (r.content as { type: string; text: string }[])[0]!;
      expect(texto.type).toBe("text");
      expect(texto.text.endsWith("Base de 13/11/2026 (versão dev).")).toBe(true);
    } finally {
      await cliente.close();
    }
  });

  test("atende as duas revisões do protocolo com a mesma resposta", async () => {
    const banco = criarBancoFixture();
    const respostas: unknown[] = [];
    for (const [negociacao, versao] of [
      ["legacy", "2025-11-25"],
      ["2026-07-28", "2026-07-28"],
    ] as const) {
      const cliente = await conectar(["--banco", banco], { cwd: diretorioTemporario(), negociacao });
      try {
        expect(cliente.getNegotiatedProtocolVersion()).toBe(versao);
        expect(cliente.getInstructions()).toBe(INSTRUCOES);
        const { tools } = await cliente.listTools();
        expect(tools.map((t) => t.name)).toEqual(FERRAMENTAS.map((f) => f.nome));
        const r = await cliente.callTool({ name: "sobre_a_base", arguments: {} });
        expect(r.isError).toBeFalsy();
        respostas.push({ structuredContent: r.structuredContent, content: r.content, tools });
      } finally {
        await cliente.close();
      }
    }
    expect(respostas[1]).toEqual(respostas[0]);
  });

  test("aceita o banco por SIMPLIFICA_KB e expande ~/", async () => {
    const casa = diretorioTemporario();
    NodeFS.copyFileSync(criarBancoFixture(), NodePath.join(casa, "kb.sqlite"));
    const cliente = await conectar([], {
      cwd: diretorioTemporario(),
      env: ambiente({ HOME: casa, SIMPLIFICA_KB: "~/kb.sqlite" }),
    });
    try {
      const r = await cliente.callTool({ name: "etapa", arguments: { id: "inicio" } });
      expect(r.structuredContent).toMatchObject({ dados: { registrado: false } });
    } finally {
      await cliente.close();
    }
  });
});

/** Manda só o `initialize` com a versão pedida e devolve a versão que o servidor respondeu. */
/** A primeira linha que o servidor escreve em resposta a `mensagem`, já decodificada. */
async function primeiraResposta(
  banco: string,
  mensagem: object,
): Promise<{ readonly result: Record<string, unknown> }> {
  const processo = NodeChildProcess.spawn(COMANDO, comCli(["--banco", banco]), {
    cwd: diretorioTemporario(),
    env: ambiente(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    const linha = await new Promise<string>((resolve, reject) => {
      let saida = "";
      processo.once("error", reject);
      processo.stdout.setEncoding("utf-8").on("data", (parte: string) => {
        saida += parte;
        const fim = saida.indexOf("\n");
        if (fim >= 0) resolve(saida.slice(0, fim));
      });
      processo.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, ...mensagem })}\n`);
    });
    return JSON.parse(linha) as { readonly result: Record<string, unknown> };
  } finally {
    processo.kill();
  }
}

describe("negociação de versão", () => {
  test("server/discover anuncia a 2026-07-28 e a 2025-11-25", async () => {
    const resposta = await primeiraResposta(criarBancoFixture(), {
      method: "server/discover",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "teste", version: "0" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    });
    expect(resposta.result.supportedVersions).toEqual(["2026-07-28", "2025-11-25"]);
  });

  test.each(["2025-06-18", "2025-11-25"])("initialize com %s recebe a 2025-11-25", async (pedida) => {
    const resposta = await primeiraResposta(criarBancoFixture(), {
      method: "initialize",
      params: { protocolVersion: pedida, capabilities: {}, clientInfo: { name: "teste", version: "0" } },
    });
    expect(resposta.result.protocolVersion).toBe("2025-11-25");
  });
});

describe("erros de inicialização", () => {
  test("sem --banco nem SIMPLIFICA_KB", async () => {
    const { codigo, stderr, stdout } = await rodarCli([]);
    expect(codigo).not.toBe(0);
    expect(stderr).toContain("--banco <caminho>");
    expect(stdout).toBe("");
  });

  test("banco de outro esquema", async () => {
    const banco = criarBancoFixture({ meta: { versao_esquema: String(VERSAO_ESQUEMA + 1) } });
    const { codigo, stderr, stdout } = await rodarCli(["--banco", banco]);
    expect(codigo).toBe(1);
    expect(stderr).toContain(`simplifica-mcp: ${MENSAGEM_INCOMPATIVEL}`);
    expect(stdout).toBe("");
  });

  test("banco ausente e pasta de trabalho inexistente", async () => {
    const dir = diretorioTemporario();
    const ausente = await rodarCli(["--banco", NodePath.join(dir, "kb.sqlite")]);
    expect(ausente.codigo).toBe(1);
    expect(ausente.stderr).toContain("kb.sqlite não encontrado");

    const pasta = await rodarCli([
      "--banco",
      criarBancoFixture(),
      "--pasta-trabalho",
      NodePath.join(dir, "nao-existe"),
    ]);
    expect(pasta.codigo).toBe(1);
    expect(pasta.stderr).toContain("pasta de trabalho não encontrada");
  });

  test("canal fora da lista", async () => {
    const { codigo, stderr } = await rodarCli(["--banco", criarBancoFixture(), "--canal", "nightly"]);
    expect(codigo).not.toBe(0);
    expect(stderr).toContain("dev, beta, estavel");
  });
});
