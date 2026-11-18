import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { RAIZ_PROJETO } from "./config.ts";
import * as Git from "./git.ts";
import { diffDaParte, lerManifesto, mudancasDaParte, resolverRef, type Parte } from "./upstream_t3.ts";

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
        assert.strictEqual(plugin?.origem.length, 15);
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

  // processo filho real: `it.live`, sem o TestClock
  it.live("traduz a falha do git em erro que diz o que faltou", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const upstream = yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-upstream-" });
        const git = (...args: ReadonlyArray<string>) => Git.executar(args, { cwd: upstream });
        yield* git("init", "--quiet");
        yield* fs.writeFileString(path.join(upstream, "a.ts"), "1\n");
        yield* git("add", "a.ts");
        yield* git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "um");
        const commit = (yield* git("rev-parse", "HEAD")).trim();
        const parte: Parte = {
          nome: "a",
          origem: ["a.ts"],
          aqui: ["a.ts"],
          commit,
          data: "2026-11-18",
          adaptacoes: "—",
        };

        assert.strictEqual(yield* resolverRef(upstream, "HEAD"), commit.slice(0, 10));
        assert.deepStrictEqual(yield* mudancasDaParte(upstream, parte, "HEAD"), { commits: 0, arquivos: [] });

        const ref = yield* Effect.flip(resolverRef(upstream, "origin/main"));
        assert.strictEqual(ref._tag, "RefNaoEncontrada");
        assert.match(ref.message, /ref origin\/main não encontrada/u);
        assert.instanceOf(ref.cause, Git.GitFalhou);

        const ausente = { ...parte, commit: "0123456789abcdef0123456789abcdef01234567" };
        const historico = yield* Effect.flip(mudancasDaParte(upstream, ausente, "HEAD"));
        assert.strictEqual(historico._tag, "ParteSemHistorico");
        assert.match(historico.message, /parte a: .*0123456789.*rode git fetch no checkout do upstream/u);
        const doDiff = yield* Effect.flip(diffDaParte(upstream, ausente, "HEAD", false));
        assert.strictEqual(doDiff._tag, "ParteSemHistorico");

        const inexistente = path.join(upstream, "nao-existe");
        const pasta = yield* Effect.flip(resolverRef(inexistente, "HEAD"));
        assert.strictEqual(pasta._tag, "UpstreamInexistente");
        assert.include(pasta.message, inexistente);
        const pastaParte = yield* Effect.flip(mudancasDaParte(inexistente, parte, "HEAD"));
        assert.strictEqual(pastaParte._tag, "UpstreamInexistente");
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});
