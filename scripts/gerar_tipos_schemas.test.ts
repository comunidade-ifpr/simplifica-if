import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { DESTINO_TIPOS, gerarTipos } from "./gerar_tipos_schemas.ts";

describe("tipos dos JSON Schemas", () => {
  it.effect("scripts/base/tipos-schemas.ts corresponde aos schemas", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      expect(yield* gerarTipos()).toBe(yield* fs.readFileString(DESTINO_TIPOS));
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
