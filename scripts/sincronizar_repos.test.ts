import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Git from "./git.ts";
import { clonarTag, tagDoCatalog } from "./sincronizar_repos.ts";

describe("sincronizar_repos", () => {
  it.effect("tag do catalog", () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* tagDoCatalog("catalog:\n  effect: 4.0.0-beta.1\n"), "effect@4.0.0-beta.1");
      const erro = yield* Effect.flip(tagDoCatalog("packages: []\n"));
      assert.strictEqual(erro.motivo, "sem-catalog");
    }),
  );

  // processo filho real: `it.live`, sem o TestClock
  it.live("tag inexistente vira TagNaoEncontrada, sem o stderr do git na mensagem", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const origem = yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-sync-" });
        const git = (...args: ReadonlyArray<string>) => Git.executar(args, { cwd: origem });
        yield* git("init", "--quiet");
        yield* fs.writeFileString(path.join(origem, "LICENSE"), "MIT\n");
        yield* git("add", "LICENSE");
        yield* git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "um");

        const erro = yield* Effect.flip(clonarTag(origem, "effect@0.0.0", path.join(origem, "..", "nada")));
        assert.strictEqual(erro._tag, "TagNaoEncontrada");
        if (erro._tag !== "TagNaoEncontrada") return;
        assert.strictEqual(erro.tag, "effect@0.0.0");
        assert.strictEqual(erro.repositorio, origem);
        assert.match(erro.message, /confira se a tag existe .* e se há rede$/u);
        assert.notMatch(erro.message, /not found|fatal/u);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});
