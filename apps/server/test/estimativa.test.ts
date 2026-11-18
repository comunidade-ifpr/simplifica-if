/** A estimativa da revisão com IA, mostrada antes de começar: a política de provider do servidor. */
import { describe, expect, test } from "vite-plus/test";
import { estimar } from "../src/revisao-ppc/estimativa.ts";

describe("estimativa", () => {
  test("cresce com o tamanho dos pedidos e cai com o paralelismo", () => {
    const pequeno = estimar([{ caracteres: 10_000, fichas: 5 }], "claude", 1);
    const grande = estimar(
      [
        { caracteres: 10_000, fichas: 5 },
        { caracteres: 30_000, fichas: 5 },
      ],
      "claude",
      1,
    );
    expect(grande.tokensEntrada).toBeGreaterThan(pequeno.tokensEntrada);
    expect(grande.custoUsd).toBeGreaterThan(pequeno.custoUsd!);
    expect(estimar([{ caracteres: 10_000, fichas: 5 }], "codex", 1).custoUsd).toBeNull();
    const paralelo = estimar(
      Array.from({ length: 6 }, () => ({ caracteres: 10_000, fichas: 6 })),
      "claude",
      3,
    );
    const serial = estimar(
      Array.from({ length: 6 }, () => ({ caracteres: 10_000, fichas: 6 })),
      "claude",
      1,
    );
    expect(paralelo.minutos).toBeLessThan(serial.minutos);
  });
});
