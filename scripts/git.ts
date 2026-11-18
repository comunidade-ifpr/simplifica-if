/**
 * O `git` dos scripts Effect: roda um subcomando numa pasta e devolve o stdout.
 *
 * A saída de erro do git não vira atributo nem mensagem (pode trazer caminho, URL ou conteúdo do
 * repositório): fica só em `cause` do `GitFalhou`.
 */
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

export class GitFalhou extends Schema.TaggedError<GitFalhou>()("GitFalhou", {
  subcomando: Schema.String,
  /** Código de saída; ausente quando o git nem chegou a rodar. */
  codigo: Schema.optional(Schema.Int),
  /** O stderr do git, quando ele saiu com erro; o erro da plataforma, quando não rodou. */
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return this.codigo === undefined
      ? `git ${this.subcomando} não rodou`
      : `git ${this.subcomando} falhou (código ${this.codigo})`;
  }
}

export interface OpcoesGit {
  /** Pasta em que o git roda. */
  readonly cwd: string;
}

/** Roda `git <args>` em `cwd` e lê o stdout com `ler`; saída diferente de zero é `GitFalhou`. */
const rodar = <A>(
  args: ReadonlyArray<string>,
  opcoes: OpcoesGit,
  ler: (
    stdout: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
  ) => Effect.Effect<A, PlatformError.PlatformError>,
) => {
  const subcomando = args[0] ?? "";
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const processo = yield* spawner.spawn(ChildProcess.make("git", args, { cwd: opcoes.cwd, stdin: "ignore" }));
        const [saida, erro, codigo] = yield* Effect.all(
          [ler(processo.stdout), Stream.mkString(Stream.decodeText(processo.stderr)), processo.exitCode],
          { concurrency: "unbounded" },
        );
        if (codigo !== 0) return yield* new GitFalhou({ subcomando, codigo, cause: erro.trim() });
        return saida;
      }),
    );
  }).pipe(Effect.catchTags({ PlatformError: (cause) => Effect.fail(new GitFalhou({ subcomando, cause })) }));
};

/** Roda `git <args>` em `cwd` e devolve o stdout; saída diferente de zero é `GitFalhou`. */
export const executar = Effect.fn("git.executar")(function* (args: ReadonlyArray<string>, opcoes: OpcoesGit) {
  return yield* rodar(args, opcoes, (stdout) => Stream.mkString(Stream.decodeText(stdout)));
});

/** Como `executar`, com o stdout em bytes (o `git archive`, por exemplo). */
export const executarBytes = Effect.fn("git.executarBytes")(function* (args: ReadonlyArray<string>, opcoes: OpcoesGit) {
  return yield* rodar(args, opcoes, Stream.mkUint8Array);
});

/** Como `executar`, para quando a falha do git não importa: o stdout, ou `None` se ele falhou. */
export const tentar = Effect.fn("git.tentar")(function* (args: ReadonlyArray<string>, opcoes: OpcoesGit) {
  return yield* Effect.option(executar(args, opcoes));
});
