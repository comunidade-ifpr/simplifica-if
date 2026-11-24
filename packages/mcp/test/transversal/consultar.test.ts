// @effect-diagnostics nodeBuiltinImport:off -- teste: o `simplifica-mcp consultar` como processo filho, sobre bancos em disco
/**
 * O subcomando `simplifica-mcp consultar`, como processo: a saída é o
 * `structuredContent` do servidor, numa linha; a entrada inválida e o ID que não está na base saem
 * com código 1 e a mensagem do servidor no stderr; com `--todas-as-paginas`, uma resposta por linha.
 *
 * Na fixture, o invólucro da CLI: cada amostra de `AMOSTRAS` (menos a `etapa`, que o `consultar`
 * recusa) contra a resposta calculada neste processo pelo mesmo `chamador`, isto é, a leitura dos
 * argumentos, a serialização no stdout, o código de saída e a mensagem no stderr. Na base real
 * (`SIMPLIFICA_SMOKE=1`), o `listar_cursos` inteiro.
 * Com `SIMPLIFICA_MCP_EXE`, o filho é o executável.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "@effect/vitest";
import { saidaValida } from "../apoio.ts";
import { diretorioTemporario, limparTemporarios } from "../fixture.ts";
import type { Fixture } from "./amostras.ts";
import {
  ambienteMinimo,
  BANCO_REAL,
  bancosFixture,
  type Chamada,
  EXE,
  emProcesso,
  ferramenta,
  type Resultado,
  rotulo,
  SMOKE,
  SMOKE_APENAS,
} from "./apoio.ts";

const CLI = NodePath.resolve(import.meta.dirname, "../../src/cli.ts");

let bancos: Record<Fixture, string>;
beforeAll(() => {
  if (!SMOKE_APENAS) bancos = bancosFixture();
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
    [...(EXE ? [] : [CLI]), "consultar", ...argumentos, "--banco", banco, "--vigencia-na-referencia"],
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

/** A execução corresponde ao resultado esperado: o `structuredContent` numa linha, ou o erro no stderr. */
function conferir(execucao: Execucao, esperado: Resultado, descricao: string): void {
  if (esperado.isError === true) {
    expect(execucao.codigo, descricao).toBe(1);
    expect(execucao.stdout, descricao).toBe("");
    expect(execucao.stderr, descricao).toBe(`simplifica-mcp: ${esperado.content[0]!.text}\n`);
    return;
  }
  expect(execucao.codigo, `${descricao}: ${execucao.stderr}`).toBe(0);
  expect(execucao.stdout, descricao).toBe(`${JSON.stringify(esperado.structuredContent)}\n`);
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
  test.skipIf(SMOKE_APENAS)(
    "invólucro da CLI: resposta válida, erro de schema e erro de domínio saem iguais ao chamador",
    async () => {
      // todas as 84 amostras já são conferidas em memória em contrato.test.ts; aqui validamos o invólucro CLI
      const casos: Array<{ fixture: Fixture; chamada: Chamada }> = [
        {
          fixture: "normas",
          chamada: { nome: "buscar_norma", args: { consulta: "Res. CNE/CP 2/2026" }, valida: true },
        },
        { fixture: "normas", chamada: { nome: "buscar_norma", args: {}, valida: false } },
        {
          fixture: "ppcs",
          chamada: {
            nome: "pacote_contexto",
            args: { tarefa: "CT-XXXX-99", ppc: "curitiba/tecnico-em-enfermagem" },
            valida: false,
          },
        },
      ];
      await Promise.all(
        casos.map(async ({ fixture, chamada }) => {
          const [esperado] = await emProcesso(bancos[fixture], [chamada]);
          const execucao = await consultar(bancos[fixture], [chamada.nome, "--args", JSON.stringify(chamada.args)]);
          conferir(execucao, esperado!, rotulo(chamada));
        }),
      );
    },
  );

  test.skipIf(SMOKE_APENAS)("--todas-as-paginas segue o cursor e imprime uma resposta por linha", async () => {
    const [execucao, uma] = await Promise.all([
      consultar(bancos.ppcs, ["listar_cursos", "--args", '{"limite":1}', "--todas-as-paginas"]),
      consultar(bancos.ppcs, ["listar_cursos", "--args", '{"limite":1}']),
    ]);
    const respostas = paginas(execucao, "listar_cursos");
    const ids = respostas.flatMap((r) => r.dados.cursos.map((c) => c.id));
    expect(respostas.length).toBeGreaterThan(1);
    expect(ids).toHaveLength(respostas[0]!.pagina!.total);
    expect(new Set(ids).size).toBe(ids.length);
    // sem a flag, só a primeira página
    expect(uma.stdout).toBe(`${execucao.stdout.split("\n")[0]}\n`);
  });

  test.skipIf(SMOKE_APENAS)("lista vazia sai com 0 e o aviso; a etapa e o --args que não é JSON, com 1", async () => {
    const [vazia, etapa, quebrado] = await Promise.all([
      consultar(bancos.ppcs, ["listar_cursos", "--args", '{"campus":"nenhum"}']),
      consultar(bancos.ppcs, ["etapa", "--args", '{"id":"x"}']),
      consultar(bancos.ppcs, ["listar_cursos", "--args", "{campus}"]),
    ]);
    expect(vazia.codigo).toBe(0);
    expect(JSON.parse(vazia.stdout).avisos).toEqual([
      { tipo: "nao-encontrado", mensagem: "nenhum curso com esses filtros" },
    ]);
    expect(etapa).toEqual({
      stdout: "",
      stderr: "simplifica-mcp: a ferramenta etapa só faz sentido numa conversa; o consultar não a roda\n",
      codigo: 1,
    });
    expect(quebrado.codigo).toBe(1);
    expect(quebrado.stderr).toContain("--args <json>: esperava a entrada da ferramenta em JSON");
  });

  test.skipIf(!SMOKE)("base real: listar_cursos --todas-as-paginas soma todos os cursos", async () => {
    const respostas = paginas(await consultar(BANCO_REAL, ["listar_cursos", "--todas-as-paginas"]), "listar_cursos");
    const ids = respostas.flatMap((r) => r.dados.cursos.map((c) => c.id));
    expect(ids).toHaveLength(respostas[0]!.pagina!.total);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
