/**
 * Integração: o servidor como processo filho, em stdio, com `cwd` num diretório temporário vazio,
 * falando com o Client do SDK; e os erros de inicialização da CLI.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync } from "node:fs";
import path from "node:path";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Client } from "@modelcontextprotocol/client";
import { VERSAO_ESQUEMA } from "@simplifica-if/kb/db/esquema";
import { MENSAGEM_INCOMPATIVEL } from "../src/banco.ts";
import { FERRAMENTAS } from "../src/ferramentas/index.ts";
import { INSTRUCOES } from "../src/servidor.ts";
import { criarBancoFixture, diretorioTemporario, limparTemporarios } from "./fixture.ts";

afterEach(limparTemporarios);

const CLI = path.resolve(import.meta.dir, "../src/cli.ts");

/** Ambiente mínimo, sem herdar SIMPLIFICA_KB do processo de teste. */
function ambiente(extra: Record<string, string> = {}): Record<string, string> {
  return { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...extra };
}

async function conectar(
  args: string[],
  opcoes: { cwd: string; env?: Record<string, string>; negociacao?: "legacy" | "auto" },
) {
  const transporte = new StdioClientTransport({
    command: process.execPath,
    args: ["run", CLI, ...args],
    cwd: opcoes.cwd,
    env: opcoes.env ?? ambiente(),
    stderr: "pipe",
  });
  const cliente = new Client(
    { name: "teste-stdio", version: "0" },
    { versionNegotiation: { mode: opcoes.negociacao ?? "legacy" } },
  );
  await cliente.connect(transporte);
  return cliente;
}

async function rodarCli(args: string[], env: Record<string, string> = ambiente()) {
  const processo = Bun.spawn([process.execPath, "run", CLI, ...args], {
    cwd: diretorioTemporario(),
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, codigo] = await Promise.all([
    new Response(processo.stdout).text(),
    new Response(processo.stderr).text(),
    processo.exited,
  ]);
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

  test("atende as duas eras do protocolo com a mesma resposta", async () => {
    const banco = criarBancoFixture();
    const respostas: unknown[] = [];
    for (const [negociacao, era] of [
      ["legacy", "legacy"],
      ["auto", "modern"],
    ] as const) {
      const cliente = await conectar(["--banco", banco], { cwd: diretorioTemporario(), negociacao });
      try {
        expect(cliente.getProtocolEra()).toBe(era);
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
    copyFileSync(criarBancoFixture(), path.join(casa, "kb.sqlite"));
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
    const ausente = await rodarCli(["--banco", path.join(dir, "kb.sqlite")]);
    expect(ausente.codigo).toBe(1);
    expect(ausente.stderr).toContain("kb.sqlite não encontrado");

    const pasta = await rodarCli(["--banco", criarBancoFixture(), "--pasta-trabalho", path.join(dir, "nao-existe")]);
    expect(pasta.codigo).toBe(1);
    expect(pasta.stderr).toContain("pasta de trabalho não encontrada");
  });

  test("canal fora da lista", async () => {
    const { codigo, stderr } = await rodarCli(["--banco", criarBancoFixture(), "--canal", "nightly"]);
    expect(codigo).not.toBe(0);
    expect(stderr).toContain("dev, beta, estavel");
  });
});
