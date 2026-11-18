/**
 * Paridade (suíte transversal do T6): cada ferramenta × o comando correspondente da CLI `kb`, no mesmo
 * banco (`tmp/kb.sqlite`), com os mesmos IDs, textos e totais. Os casos estão em `paridade.ts`, um por
 * ferramenta (ou o motivo de não haver comando), com a raiz do repositório como pasta de trabalho.
 * Lento e dependente do checkout: roda só com `SIMPLIFICA_SMOKE=1` (`pnpm mcp:smoke`); a cobertura dos
 * casos roda sempre.
 */
import { beforeAll, describe, expect, it, test } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { FERRAMENTAS } from "../../src/ferramentas/toolkit.ts";
import { BANCO_REAL, camadaComPasta, RAIZ, SMOKE } from "./apoio.ts";
import { kb, PARIDADE, type Paridade } from "./paridade.ts";

const paridadeDe = (nome: string) => (PARIDADE as Partial<Record<string, Paridade>>)[nome];

test("toda ferramenta tem caso de paridade com a CLI kb, ou o motivo de não ter", () => {
  for (const f of FERRAMENTAS) {
    const p = paridadeDe(f.nome);
    expect(p, `${f.nome}: sem paridade em test/transversal/paridade.ts`).toBeDefined();
    if (p && "casos" in p) expect(p.casos.length, f.nome).toBeGreaterThan(0);
    else expect(p?.semCli.length ?? 0, f.nome).toBeGreaterThan(20);
  }
  expect(Object.keys(PARIDADE).sort()).toEqual(FERRAMENTAS.map((f) => f.nome as string).sort());
});

describe.skipIf(!SMOKE)("paridade com a CLI kb na base real", () => {
  beforeAll(async () => {
    await kb("buscar-norma", "LDB"); // a CLI recompila o banco, se velho, antes de ele ser aberto aqui
  }, 300_000);

  const casos = FERRAMENTAS.flatMap((f) => {
    const p = paridadeDe(f.nome);
    return p && "casos" in p ? p.casos.map((caso) => ({ nome: `${f.nome} ${caso.descricao}`, caso })) : [];
  });

  it.effect.each(casos)(
    "$nome",
    ({ caso }) => Effect.provide(caso.conferir(), camadaComPasta(BANCO_REAL, RAIZ)),
    120_000,
  );
});
