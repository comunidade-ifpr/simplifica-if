import { describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { DESTINO_TIPOS, gerarTipos } from "./gerar_tipos_schemas.ts";

describe("tipos dos JSON Schemas", () => {
  test("scripts/base/tipos-schemas.ts corresponde aos schemas", async () => {
    expect(await gerarTipos()).toBe(readFileSync(DESTINO_TIPOS, "utf-8"));
  });
});
