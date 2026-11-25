// @effect-diagnostics nodeBuiltinImport:off -- teste: o servidor como processo filho, num diretório temporário
/**
 * Integração: o servidor como processo filho, em stdio, com `cwd` num diretório temporário vazio,
 * falando com o Client do SDK; e os erros de inicialização da CLI (código 1 e a mensagem no stderr).
 * As regras de abertura do banco estão em `abertura.test.ts`, e a negociação de versão do protocolo,
 * em memória, em `ferramentas.test.ts`: aqui ficam só o transporte e o processo.
 *
 * Com `SIMPLIFICA_MCP_EXE` (o caminho do executável de `pnpm mcp:executavel`), o filho é o executável,
 * com o `PATH` reduzido a `/usr/bin:/bin`, sem Node.
 */
import * as NodeChildProcess from "node:child_process";
import { afterAll, describe, expect, test } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Client } from "@modelcontextprotocol/client";
import { VERSAO_ESQUEMA } from "@simplifica-if/kb/db/esquema";
import { FERRAMENTAS } from "../src/ferramentas/toolkit.ts";
import { INSTRUCOES, MENSAGEM_INCOMPATIVEL } from "../src/servidor.ts";
import { criarBancoFixture, diretorioTemporario, limparTemporarios } from "./fixture.ts";

afterAll(limparTemporarios);

const CLI = NodePath.resolve(import.meta.dirname, "../src/cli.ts");
const EXE = process.env.SIMPLIFICA_MCP_EXE;
/** Comando e argumentos do servidor: o executável, ou o Node deste processo com a CLI. */
const COMANDO = EXE ?? process.execPath;
const comCli = (args: string[]) => (EXE ? args : [CLI, ...args]);

/** Ambiente mínimo, sem herdar SIMPLIFICA_KB do processo de teste. */
function ambiente(extra: Record<string, string> = {}): Record<string, string> {
  return { PATH: EXE ? "/usr/bin:/bin" : (process.env.PATH ?? ""), HOME: process.env.HOME ?? "", ...extra };
}

async function rodarCli(args: string[]) {
  const processo = NodeChildProcess.spawn(COMANDO, comCli(args), {
    cwd: diretorioTemporario(),
    env: ambiente(),
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
  test("banco por SIMPLIFICA_KB com ~/: lista as ferramentas e responde sobre_a_base e etapa", async () => {
    const casa = diretorioTemporario();
    NodeFS.copyFileSync(criarBancoFixture(), NodePath.join(casa, "kb.sqlite"));
    const cliente = new Client(
      { name: "teste-stdio", version: "0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    await cliente.connect(
      new StdioClientTransport({
        command: COMANDO,
        args: comCli(["--canal", "beta"]),
        cwd: diretorioTemporario(),
        env: ambiente({ HOME: casa, SIMPLIFICA_KB: "~/kb.sqlite" }),
        stderr: "pipe",
      }),
    );
    try {
      expect(cliente.getInstructions()).toBe(INSTRUCOES);
      const { tools } = await cliente.listTools();
      expect(tools.map((t) => t.name)).toEqual(FERRAMENTAS.map((f) => f.nome));
      for (const t of tools) {
        expect(t.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true, openWorldHint: false });
        expect(t.outputSchema?.type).toBe("object");
      }

      const r = await cliente.callTool({ name: "sobre_a_base", arguments: {} });
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent).toMatchObject({
        base: { versao: "dev-ab12cd34", data: null, commit: null, canal: "beta" },
        avisos: [],
      });
      const texto = (r.content as { type: string; text: string }[])[0]!;
      expect(texto.text.endsWith("Base de desenvolvimento (versão `dev-ab12cd34`).")).toBe(true);

      const etapa = await cliente.callTool({ name: "etapa", arguments: { id: "inicio" } });
      expect(etapa.structuredContent).toMatchObject({ dados: { registrado: false } });
    } finally {
      await cliente.close();
    }
  });

  test("erros de inicialização: sem banco e banco de outro esquema", async () => {
    const [semBanco, outroEsquema] = await Promise.all([
      rodarCli([]),
      rodarCli(["--banco", criarBancoFixture({ meta: { versao_esquema: String(VERSAO_ESQUEMA + 1) } })]),
    ]);
    expect(semBanco.codigo).toBe(1);
    expect(semBanco.stderr).toContain("--banco <caminho>");
    expect(semBanco.stdout).toBe("");
    expect(outroEsquema.codigo).toBe(1);
    expect(outroEsquema.stderr).toContain(`simplifica-mcp: ${MENSAGEM_INCOMPATIVEL}`);
    expect(outroEsquema.stdout).toBe("");
  });
});
