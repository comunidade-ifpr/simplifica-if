/**
 * Primitiva de formatação: número com casas fixas. Os valores esperados são gabaritos fixos.
 */
import { describe, expect, test } from "vite-plus/test";
import { formatoFixo } from "./valores.ts";

const CASOS_FIXOS: Array<[number, string]> = [
  [0.125, "0.12"],
  [0.375, "0.38"],
  [0.625, "0.62"],
  [0.875, "0.88"],
  [0.005, "0.01"],
  [0.015, "0.01"],
  [0.995, "0.99"],
  [1.0, "1.00"],
  [0.0, "0.00"],
  [-0.0, "-0.00"],
  [-0.001, "-0.00"],
  [0.33333, "0.33"],
  [2.675, "2.67"],
  [1e-10, "0.00"],
  [123.456, "123.46"],
];

describe("formatoFixo", () => {
  test("empate para o par sobre o valor binário e -0.00", () => {
    for (const [valor, esperado] of CASOS_FIXOS) expect(formatoFixo(valor, 2)).toBe(esperado);
  });
});
