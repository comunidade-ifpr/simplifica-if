import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { RAIZ_PROJETO } from "./config.ts";
import { lerManifesto } from "./upstream_t3.ts";

describe("upstream_t3", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("lê a tabela de docs/upstream-t3.md", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const texto = yield* fs.readFileString(path.join(RAIZ_PROJETO, "docs", "upstream-t3.md"));
        const partes = yield* lerManifesto(texto);
        const nomes = partes.map((parte) => parte.nome);
        assert.include(nomes, "effect-acp");
        assert.include(nomes, "effect-codex-app-server");
        assert.include(nomes, "nodeSqliteClient");
        const plugin = partes.find((parte) => parte.nome === "plugin de lint");
        assert.strictEqual(plugin?.origem.length, 11);
        for (const parte of partes) {
          assert.match(parte.commit, /^[0-9a-f]{40}$/);
          assert.match(parte.data, /^\d{4}-\d{2}-\d{2}$/);
          assert.isAbove(parte.aqui.length, 0);
          for (const caminho of parte.aqui) assert.isTrue(yield* fs.exists(path.join(RAIZ_PROJETO, caminho)), caminho);
        }
      }),
    );
  });

  it.effect("recusa linha sem caminho de origem ou com commit inválido", () =>
    Effect.gen(function* () {
      const cabecalho = "## Partes copiadas\n\n| a | b | c | d | e | f |\n|---|---|---|---|---|---|\n";
      const semOrigem = yield* Effect.exit(
        lerManifesto(`${cabecalho}| x | sem crase | \`y\` | abc1234 | 2026-11-14 | — |\n`),
      );
      assert.isTrue(Exit.isFailure(semOrigem));
      const commit = yield* Effect.exit(lerManifesto(`${cabecalho}| x | \`a\` | \`y\` | HEAD | 2026-11-14 | — |\n`));
      assert.isTrue(Exit.isFailure(commit));
    }),
  );
});
