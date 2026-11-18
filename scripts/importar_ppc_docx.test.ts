import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { conversorAtual } from "./importar_ppc_docx.ts";

describe("importar_ppc_docx", () => {
  // processo filho real: `it.live`, sem o TestClock
  it.live("fora de um checkout git, a versão do conversor é ForaDeCheckout", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const pasta = yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-conversor-" });
        const erro = yield* Effect.flip(conversorAtual(pasta));
        assert.strictEqual(erro._tag, "ForaDeCheckout");
        assert.strictEqual(erro.raiz, pasta);
        assert.match(erro.message, /não é um checkout git do Simplifica IF/u);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});
