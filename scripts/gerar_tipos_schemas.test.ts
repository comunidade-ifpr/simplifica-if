// @effect-diagnostics nodeBuiltinImport:off -- compara o arquivo gerado lido com node:fs síncrono
import { describe, expect, test } from "vite-plus/test";
import * as NodeFS from "node:fs";
import { DESTINO_TIPOS, gerarTipos } from "./gerar_tipos_schemas.ts";

describe("tipos dos JSON Schemas", () => {
  test("scripts/base/tipos-schemas.ts corresponde aos schemas", async () => {
    expect(await gerarTipos()).toBe(NodeFS.readFileSync(DESTINO_TIPOS, "utf-8"));
  });
});
