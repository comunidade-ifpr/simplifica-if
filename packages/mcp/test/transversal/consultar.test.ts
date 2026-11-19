// @effect-diagnostics nodeBuiltinImport:off -- teste: o `simplifica-mcp consultar` como processo filho, sobre bancos em disco
/**
 * O subcomando `simplifica-mcp consultar` (plano da DENTEC, S0), como processo: a saída é o
 * `structuredContent` do servidor, numa linha; a entrada inválida e o ID que não está na base saem
 * com código 1 e a mensagem do servidor no stderr; com `--todas-as-paginas`, uma resposta por linha.
 *
 * Na fixture, cada amostra de `AMOSTRAS` (menos a `etapa`, que o `consultar` recusa) contra a resposta
 * calculada neste processo. Na base real (`SIMPLIFICA_SMOKE=1`), as chamadas gravadas em
 * `testes-gabarito/mcp.json`, com a máscara do `gabarito.ts --comparar`, e o `listar_cursos` inteiro.
 * Com `SIMPLIFICA_MCP_EXE`, o filho é o executável.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "@effect/vitest";
import { saidaValida } from "../apoio.ts";
import { diretorioTemporario, limparTemporarios } from "../fixture.ts";
import { mascarar } from "../mascara.ts";
import type { Fixture } from "./amostras.ts";
import {
  ambienteMinimo,
  BANCO_REAL,
  bancosFixture,
  type Chamada,
  chamadas,
  EXE,
  emProcesso,
  ferramenta,
  RAIZ,
  type Resultado,
  rotulo,
  SMOKE,
} from "./apoio.ts";

const CLI = NodePath.resolve(import.meta.dirname, "../../src/cli.ts");

let bancos: Record<Fixture, string>;
beforeAll(() => {
  bancos = bancosFixture();
});
afterAll(limparTemporarios);

interface Execucao {
  readonly stdout: string;
  readonly stderr: string;
  readonly codigo: number | null;
}

/** `simplifica-mcp consultar <argumentos>` sobre `banco`, com o ambiente mínimo, em `cwd`. */
async function consultar(banco: string, argumentos: ReadonlyArray<string>, cwd?: string): Promise<Execucao> {
  const pasta = cwd ?? diretorioTemporario("simplifica-mcp-consultar-");
  const processo = NodeChildProcess.spawn(
    EXE ?? process.execPath,
    [...(EXE ? [] : [CLI]), "consultar", ...argumentos, "--banco", banco],
    { cwd: pasta, env: ambienteMinimo(pasta), stdio: ["ignore", "pipe", "pipe"] },
  );
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

/** As execuções de uma lista, poucas por vez (cada uma é um processo). */
async function emLotes<T>(lista: ReadonlyArray<T>, rodar: (item: T) => Promise<Execucao>): Promise<Execucao[]> {
  const saida: Execucao[] = [];
  for (let i = 0; i < lista.length; i += 8) saida.push(...(await Promise.all(lista.slice(i, i + 8).map(rodar))));
  return saida;
}

/** A execução é o resultado do `tools/call`: o `structuredContent` numa linha, ou o erro no stderr. */
function conferir(execucao: Execucao, esperado: Resultado, descricao: string): void {
  if (esperado.isError === true) {
    expect(execucao.codigo, descricao).toBe(1);
    expect(execucao.stdout, descricao).toBe("");
    expect(mascarar(execucao.stderr), descricao).toBe(mascarar(`simplifica-mcp: ${esperado.content[0]!.text}\n`));
    return;
  }
  expect(execucao.codigo, `${descricao}: ${execucao.stderr}`).toBe(0);
  expect(mascarar(execucao.stdout), descricao).toBe(mascarar(`${JSON.stringify(esperado.structuredContent)}\n`));
}

/** As linhas JSONL de `--todas-as-paginas`, cada uma válida no `outputSchema` da ferramenta. */
function paginas(execucao: Execucao, nome: string) {
  expect(execucao.codigo, execucao.stderr).toBe(0);
  const linhas = execucao.stdout.trimEnd().split("\n");
  const respostas = linhas.map(
    (linha) => JSON.parse(linha) as { dados: { cursos: { id: string }[] }; pagina?: { total: number } },
  );
  for (const resposta of respostas) expect(saidaValida(ferramenta(nome), resposta)).toBe(true);
  return respostas;
}

describe("simplifica-mcp consultar", () => {
  test.each(["normas", "ppcs"] as const)("fixture %s: cada amostra, como o tools/call", async (fixture) => {
    const lista = chamadas(fixture).filter((c) => c.nome !== "etapa");
    const esperados = await emProcesso(bancos[fixture], lista);
    const execucoes = await emLotes(lista, (c: Chamada) =>
      consultar(bancos[fixture], [c.nome, "--args", JSON.stringify(c.args ?? {})]),
    );
    lista.forEach((c, i) => conferir(execucoes[i]!, esperados[i]!, rotulo(c)));
  });

  test("--todas-as-paginas segue o cursor e imprime uma resposta por linha", async () => {
    const execucao = await consultar(bancos.ppcs, ["listar_cursos", "--args", '{"limite":1}', "--todas-as-paginas"]);
    const respostas = paginas(execucao, "listar_cursos");
    const ids = respostas.flatMap((r) => r.dados.cursos.map((c) => c.id));
    expect(respostas.length).toBeGreaterThan(1);
    expect(ids).toHaveLength(respostas[0]!.pagina!.total);
    expect(new Set(ids).size).toBe(ids.length);
    // sem a flag, só a primeira página
    const uma = await consultar(bancos.ppcs, ["listar_cursos", "--args", '{"limite":1}']);
    expect(uma.stdout).toBe(`${execucao.stdout.split("\n")[0]}\n`);
  });

  test("lista vazia sai com 0 e o aviso; a etapa e o --args que não é JSON, com 1", async () => {
    const vazia = await consultar(bancos.ppcs, ["listar_cursos", "--args", '{"campus":"nenhum"}']);
    expect(vazia.codigo).toBe(0);
    expect(JSON.parse(vazia.stdout).avisos).toEqual([
      { tipo: "nao-encontrado", mensagem: "nenhum curso com esses filtros" },
    ]);
    const etapa = await consultar(bancos.ppcs, ["etapa", "--args", '{"id":"x"}']);
    expect(etapa).toEqual({
      stdout: "",
      stderr: "simplifica-mcp: a ferramenta etapa só faz sentido numa conversa; o consultar não a roda\n",
      codigo: 1,
    });
    const quebrado = await consultar(bancos.ppcs, ["listar_cursos", "--args", "{campus}"]);
    expect(quebrado.codigo).toBe(1);
    expect(quebrado.stderr).toContain("--args <json>: esperava a entrada da ferramenta em JSON");
  });

  test.skipIf(!SMOKE)("base real: as chamadas de testes-gabarito/mcp.json", async () => {
    const gravado = JSON.parse(NodeFS.readFileSync(NodePath.join(RAIZ, "testes-gabarito/mcp.json"), "utf8")) as {
      readonly chamadas: ReadonlyArray<{ readonly name: string; readonly arguments: unknown; resultado: Resultado }>;
    };
    // o `arquivo` do `pacote_contexto` é relativo à raiz, a pasta de trabalho do gabarito
    const lista = gravado.chamadas.filter((c) => c.name !== "etapa");
    const execucoes = await emLotes(lista, (c) =>
      consultar(BANCO_REAL, [c.name, "--args", JSON.stringify(c.arguments)], RAIZ),
    );
    lista.forEach((c, i) => conferir(execucoes[i]!, c.resultado, `${c.name} ${JSON.stringify(c.arguments)}`));
    expect(lista.length).toBe(gravado.chamadas.length - 2);
  });

  test.skipIf(!SMOKE)("base real: listar_cursos --todas-as-paginas soma todos os cursos", async () => {
    const respostas = paginas(await consultar(BANCO_REAL, ["listar_cursos", "--todas-as-paginas"]), "listar_cursos");
    const ids = respostas.flatMap((r) => r.dados.cursos.map((c) => c.id));
    expect(ids).toHaveLength(respostas[0]!.pagina!.total);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
