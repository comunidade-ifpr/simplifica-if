// @effect-diagnostics nodeBuiltinImport:off -- teste: confere a pasta isolada do servidor no disco
/**
 * Sem repositório (suíte transversal do T6): todas as ferramentas a partir de uma pasta vazia com só
 * o `kb.sqlite`, que é o diretório atual e o `HOME` do servidor, com o `PATH` mínimo:
 *
 * - com `SIMPLIFICA_MCP_EXE`, o executável de `pnpm mcp:executavel` (o job do executável no CI);
 * - sem ele, o bundle do executável no Node, com o modelo de permissões (`--permission`): o servidor só
 *   lê a pasta do banco e o próprio código, não escreve nada e não abre processos.
 *
 * Cada resposta (válidas e inválidas) é igual à calculada no processo de teste, com o repositório; o
 * stderr não registra acesso negado; e a pasta continua só com o `kb.sqlite` (nenhum arquivo de
 * journal ou WAL). Na fixture, sempre; na base real, com `SIMPLIFICA_SMOKE=1`.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "@effect/vitest";
import { FERRAMENTAS } from "../../src/ferramentas/toolkit.ts";
import { limparTemporarios } from "../fixture.ts";
import type { Fixture } from "./amostras.ts";
import {
  BANCO_REAL,
  bancosFixture,
  chamadas,
  comparavel,
  conteudoDaPasta,
  emProcesso,
  EXE,
  resultado,
  rotulo,
  servidorIsolado,
  type ServidorIsolado,
  sessaoStdio,
  SMOKE,
  SMOKE_APENAS,
} from "./apoio.ts";

let bancos: Record<Fixture, string>;
let isolado: ServidorIsolado;
beforeAll(() => {
  if (!SMOKE_APENAS) bancos = bancosFixture();
  isolado = servidorIsolado();
});
afterAll(limparTemporarios);

async function conferir(banco: string, fonte: Fixture | "real") {
  const lista = chamadas(fonte);
  const servidor = isolado.preparar(banco);
  const [sessao, esperado] = await Promise.all([sessaoStdio(servidor, lista), emProcesso(banco, lista)]);
  const { tools } = JSON.parse(sessao.tools).result as { tools: { name: string }[] };
  expect(tools.map((t) => t.name)).toEqual(FERRAMENTAS.map((f) => f.nome));
  lista.forEach((c, i) => {
    expect(comparavel(resultado(sessao.respostas[i]!)), rotulo(c)).toBe(comparavel(esperado[i]!));
  });
  expect(sessao.stderr).not.toContain("ERR_ACCESS_DENIED");
  expect(conteudoDaPasta(servidor.pasta)).toEqual(["kb.sqlite"]);
}

describe("sem repositório: só o kb.sqlite numa pasta vazia", () => {
  test.skipIf(SMOKE_APENAS).each(["normas", "ppcs"] as const)(
    "fixture %s: as respostas de todas as ferramentas",
    (fixture) => conferir(bancos[fixture], fixture),
  );

  test.skipIf(!SMOKE)("base real: as respostas de todas as ferramentas", () => conferir(BANCO_REAL, "real"), 120_000);

  // Controle negativo: sem ele, a suíte passaria também com o modelo de permissões desligado. A pasta de
  // trabalho de fora (a de outra fixture) é lida pelo `fs` e é negada. O banco não serve de controle: no
  // Node 26.12, o `node:sqlite` abre arquivos sem passar pelo modelo de permissões, então o isolamento do
  // banco vem de a pasta só ter o `kb.sqlite`. Com o executável o controle não se aplica (ver `servidorIsolado`).
  test.skipIf(EXE !== undefined || SMOKE_APENAS)(
    "o modelo de permissões está ativo: ler fora da pasta é negado",
    () => {
      expect(isolado.modo).toBe("node-com-permissoes");
      const servidor = isolado.preparar(bancos.ppcs);
      const fora = NodePath.dirname(bancos.normas);
      const r = NodeChildProcess.spawnSync(servidor.comando, [...servidor.args, "--pasta-trabalho", fora], {
        cwd: servidor.cwd,
        env: { ...servidor.env },
        input: "",
        encoding: "utf-8",
        timeout: 30_000,
      });
      expect(r.status, r.stderr).toBe(1);
      expect(r.stderr).toContain(`pasta de trabalho não encontrada: ${fora}`);
      // a mesma chamada, sem o modelo de permissões, abre normalmente
      const livre = NodeChildProcess.spawnSync(
        servidor.comando,
        [
          ...servidor.args.filter((a) => !a.startsWith("--allow-fs-read=") && a !== "--permission"),
          "--pasta-trabalho",
          fora,
        ],
        { cwd: servidor.cwd, env: { ...servidor.env }, input: "", encoding: "utf-8", timeout: 30_000 },
      );
      expect(livre.stderr).toMatch(/^simplifica-mcp \S+: base /m);
    },
  );
});
