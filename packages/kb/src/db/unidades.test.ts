/** Peças do banco sem compilar: papel da citação. */
import { describe, expect, test } from "vite-plus/test";
import { papelDaCitacao } from "./compilar.ts";

describe("papel da citação", () => {
  const linhas = [
    "## 6 EMENTÁRIO",
    "Componente: X",
    "Ementa: Lei 9.394.",
    "**Bibliografia básica**",
    "BRASIL. Lei 9.394.",
  ];
  test("depois do rótulo de bibliografia é referência; antes, fundamento", () => {
    const secao = { tipo: "ementas", linha_inicio: 1 };
    expect(papelDaCitacao(linhas, 3, secao)).toBe("fundamento");
    expect(papelDaCitacao(linhas, 5, secao)).toBe("referencia-bibliografica");
    expect(papelDaCitacao(linhas, 3, { tipo: "referencias", linha_inicio: 1 })).toBe("referencia-bibliografica");
  });
});
