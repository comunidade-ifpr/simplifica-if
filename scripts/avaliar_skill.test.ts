import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { lerCaso } from "./avaliar_skill.ts";

describe("avaliar_skill", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("caso.yaml com sintaxe errada é CasoMalformado com linha e coluna", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const pasta = yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-caso-" });
          yield* fs.writeFileString(path.join(pasta, "caso.yaml"), "skill: x\npedido: [aberto\n");

          const erro = yield* Effect.flip(lerCaso(pasta));
          assert.strictEqual(erro._tag, "CasoMalformado");
          if (erro._tag !== "CasoMalformado") return;
          assert.isNumber(erro.linha);
          assert.isNumber(erro.coluna);
          assert.strictEqual(
            erro.message,
            `YAML inválido no caso ${pasta} (caso.yaml, linha ${erro.linha}, coluna ${erro.coluna})`,
          );
        }),
      ),
    );

    it.effect("caso.yaml ausente é CasoIlegivel com o código do sistema", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const pasta = yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-caso-" });
          const erro = yield* Effect.flip(lerCaso(pasta));
          assert.strictEqual(erro._tag, "CasoIlegivel");
          if (erro._tag !== "CasoIlegivel") return;
          assert.strictEqual(erro.codigo, "ENOENT");
        }),
      ),
    );
  });
});
