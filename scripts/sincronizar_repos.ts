#!/usr/bin/env node
/**
 * Traz o código de referência do Effect para `.repos/effect`, na tag da versão de `effect` do catalog
 * (`pnpm-workspace.yaml`), como o `sync:repos` do T3 Code (`scripts/sync-reference-repos.ts`), só para o
 * Effect. A pasta é versionada neste repositório e somente leitura: o repositório do Effect inteiro na
 * tag, sem o `.git` dele, com o `LICENSE` (MIT) do Effect. Nunca a edite nem importe dela; rode este
 * script ao subir o `effect` do catalog.
 *
 *   pnpm sync:repos              # clona a tag, substitui .repos/effect e faz o commit só dessa pasta
 *   pnpm sync:repos --dry-run    # só mostra a tag e o comando
 *
 * Clona raso num diretório temporário ao lado do destino e depois troca a pasta inteira: nunca busca o
 * repositório do Effect para dentro deste (as tags e a fronteira rasa dele quebrariam o `git fetch`).
 */
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { parse as interpretarYaml } from "yaml";
import { RAIZ_PROJETO } from "./config.ts";
import * as Git from "./git.ts";
import { executarPrincipal } from "./principal.ts";

const REPOSITORIO = "https://github.com/Effect-TS/effect.git";
const PREFIXO = ".repos/effect";

export class SincronizacaoFalhou extends Schema.TaggedError<SincronizacaoFalhou>()("SincronizacaoFalhou", {
  motivo: Schema.Literals(["sem-catalog", "sem-licenca"]),
  tag: Schema.optional(Schema.String),
}) {
  override get message(): string {
    return this.motivo === "sem-catalog" ? "pnpm-workspace.yaml sem catalog.effect" : `${this.tag} sem LICENSE na raiz`;
  }
}

/**
 * O `git clone` da tag falhou: em geral a tag não existe no repositório ou não há rede. O stderr do
 * git fica em `cause` do `GitFalhou`, fora da mensagem.
 */
export class TagNaoEncontrada extends Schema.TaggedError<TagNaoEncontrada>()("TagNaoEncontrada", {
  repositorio: Schema.String,
  tag: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return (
      `não foi possível clonar ${this.tag} de ${this.repositorio}: ` +
      "confira se a tag existe (a versão de effect no catalog) e se há rede"
    );
  }
}

/** Argumentos do `git clone` raso de `tag`, sem o destino. */
const argumentosClone = (repositorio: string, tag: string) => [
  "clone",
  "--quiet",
  "--depth=1",
  "--no-tags",
  "--single-branch",
  `--branch=${tag}`,
  repositorio,
];

/** Clona `tag` de `repositorio` em `destino`; o git que roda e falha vira `TagNaoEncontrada`. */
export const clonarTag = Effect.fn("sincronizar_repos.clonarTag")(function* (
  repositorio: string,
  tag: string,
  destino: string,
) {
  yield* Git.executar([...argumentosClone(repositorio, tag), destino], { cwd: RAIZ_PROJETO }).pipe(
    Effect.catchTags({
      GitFalhou: (erro) =>
        erro.codigo === undefined
          ? Effect.fail(erro)
          : Effect.fail(new TagNaoEncontrada({ repositorio, tag, cause: erro })),
    }),
  );
});

/** Tag do Effect correspondente ao catalog do `pnpm-workspace.yaml`. */
export const tagDoCatalog = Effect.fn("sincronizar_repos.tagDoCatalog")(function* (textoWorkspace: string) {
  const workspace = interpretarYaml(textoWorkspace) as { catalog?: Record<string, unknown> } | null;
  const versao = workspace?.catalog?.effect;
  if (typeof versao !== "string" || !versao) return yield* new SincronizacaoFalhou({ motivo: "sem-catalog" });
  return `effect@${versao}`;
});

export const comando = Command.make(
  "sincronizar_repos",
  {
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("mostra a tag e o comando, sem clonar nem fazer commit"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn("sincronizar_repos")(function* ({ dryRun }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const git = (args: ReadonlyArray<string>, cwd = RAIZ_PROJETO) => Git.executar(args, { cwd });
    const destino = path.join(RAIZ_PROJETO, PREFIXO);
    const tag = yield* tagDoCatalog(yield* fs.readFileString(path.join(RAIZ_PROJETO, "pnpm-workspace.yaml")));
    const clonar = argumentosClone(REPOSITORIO, tag);
    if (dryRun) {
      yield* Console.log(
        `tag: ${tag}\ngit ${clonar.join(" ")} <temporário>\ndestino: ${PREFIXO} (commit só dessa pasta)`,
      );
      return;
    }

    // Clona ao lado do destino para a troca ser um rename: mesmo sistema de arquivos, e os symlinks
    // relativos do Effect continuam relativos.
    yield* fs.makeDirectory(path.dirname(destino), { recursive: true });
    const commit = yield* Effect.scoped(
      Effect.gen(function* () {
        const temporario = yield* fs.makeTempDirectoryScoped({
          directory: path.dirname(destino),
          prefix: ".sync-effect-",
        });
        const checkout = path.join(temporario, "checkout");
        yield* clonarTag(REPOSITORIO, tag, checkout);
        const commit = (yield* git(["rev-parse", "HEAD"], checkout)).trim();
        yield* fs.remove(path.join(checkout, ".git"), { recursive: true, force: true });
        if (!(yield* fs.exists(path.join(checkout, "LICENSE")))) {
          return yield* new SincronizacaoFalhou({ motivo: "sem-licenca", tag });
        }
        yield* fs.remove(destino, { recursive: true, force: true });
        yield* fs.rename(checkout, destino);
        return commit;
      }),
    );

    // --force: o clone só tem arquivos rastreados na tag, e alguns (o `scratchpad/` do Effect) caem no `.gitignore` dele.
    yield* git(["add", "--all", "--force", "--", PREFIXO]);
    if ((yield* git(["status", "--porcelain", "--", PREFIXO])).trim() === "") {
      yield* Console.log(`${PREFIXO} já está em ${tag}.`);
      return;
    }
    yield* git([
      "commit",
      "--quiet",
      "--message",
      `repos: ${PREFIXO} em ${tag}\n\nOrigem: ${REPOSITORIO} ${commit}`,
      "--",
      PREFIXO,
    ]);
    yield* Console.log(`commit de ${PREFIXO} em ${tag} (${commit.slice(0, 12)})`);
  }),
).pipe(
  Command.withDescription(
    "Traz .repos/effect na tag effect@<versão do catalog de pnpm-workspace.yaml> e faz o commit da pasta.",
  ),
);

if (import.meta.main) {
  executarPrincipal("sincronizar_repos", Command.run(comando, { version: "1.0.0" }));
}
