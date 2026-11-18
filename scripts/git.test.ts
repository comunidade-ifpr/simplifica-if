import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Git from "./git.ts";

// processo filho real: `it.live`, sem o TestClock
describe("git", () => {
  it.live("devolve o stdout e, na falha, guarda o stderr só em cause", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const pasta = yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-git-" });

        const erro = yield* Effect.flip(Git.executar(["rev-parse", "HEAD"], { cwd: pasta }));
        assert.strictEqual(erro._tag, "GitFalhou");
        assert.strictEqual(erro.subcomando, "rev-parse");
        assert.strictEqual(erro.codigo, 128);
        assert.strictEqual(erro.message, "git rev-parse falhou (código 128)");
        assert.match(String(erro.cause), /not a git repository/u);
        assert.isTrue(Option.isNone(yield* Git.tentar(["rev-parse", "HEAD"], { cwd: pasta })));

        yield* Git.executar(["init", "--quiet"], { cwd: pasta });
        assert.strictEqual(yield* Git.executar(["rev-parse", "--is-inside-work-tree"], { cwd: pasta }), "true\n");
        const bytes = yield* Git.executarBytes(["rev-parse", "--is-inside-work-tree"], { cwd: pasta });
        assert.deepStrictEqual(bytes, new TextEncoder().encode("true\n"));
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("git que não roda é GitFalhou sem código", () =>
    Effect.gen(function* () {
      const erro = yield* Effect.flip(Git.executar(["status"], { cwd: "/caminho/que/nao/existe" }));
      assert.strictEqual(erro.codigo, undefined);
      assert.strictEqual(erro.message, "git status não rodou");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
