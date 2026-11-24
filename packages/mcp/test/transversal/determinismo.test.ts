/**
 * Determinismo (suíte transversal do T6): mesma entrada e mesmo banco dão a mesma saída, byte a byte,
 * em duas execuções do servidor como processo (stdio). Compara as linhas de resposta como o servidor
 * as escreveu: `initialize`, `tools/list` e uma chamada por amostra (válidas e inválidas) de todas as
 * ferramentas. Na fixture, sempre; na base real, com `SIMPLIFICA_SMOKE=1`. Com `SIMPLIFICA_MCP_EXE`, os
 * dois processos são o executável.
 */
import { afterAll, beforeAll, describe, expect, test } from "@effect/vitest";
import { FERRAMENTAS } from "../../src/ferramentas/toolkit.ts";
import { limparTemporarios } from "../fixture.ts";
import type { Fixture } from "./amostras.ts";
import {
  BANCO_REAL,
  bancosFixture,
  type Chamada,
  chamadas,
  rotulo,
  servidorPadrao,
  sessaoStdio,
  SMOKE,
  SMOKE_APENAS,
} from "./apoio.ts";

let bancos: Record<Fixture, string>;
beforeAll(() => {
  if (!SMOKE_APENAS) bancos = bancosFixture();
});
afterAll(limparTemporarios);

async function duasExecucoes(banco: string, lista: ReadonlyArray<Chamada>) {
  const [a, b] = await Promise.all([
    sessaoStdio(servidorPadrao(banco), lista),
    sessaoStdio(servidorPadrao(banco), lista),
  ]);
  expect(b.initialize).toBe(a.initialize);
  expect(b.tools).toBe(a.tools);
  lista.forEach((c, i) => expect(b.respostas[i], rotulo(c)).toBe(a.respostas[i]));
}

describe("determinismo: dois processos, a mesma saída byte a byte", () => {
  test.skipIf(SMOKE_APENAS)("as amostras cobrem todas as ferramentas", () => {
    const nomes = new Set([...chamadas("normas"), ...chamadas("ppcs")].map((c) => c.nome as string));
    expect([...nomes].sort()).toEqual(FERRAMENTAS.map((f) => f.nome as string).sort());
  });

  test.skipIf(SMOKE_APENAS).each(["normas", "ppcs"] as const)("fixture %s", (fixture) =>
    duasExecucoes(bancos[fixture], chamadas(fixture)),
  );

  test.skipIf(!SMOKE)("base real", () => duasExecucoes(BANCO_REAL, chamadas("real")));
});
