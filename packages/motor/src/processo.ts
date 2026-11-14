/**
 * Processos dos providers: onde está a CLI, a versão dela e o ambiente com que ela roda.
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

export type Ambiente = Readonly<Record<string, string | undefined>>;

/** Procura `nome` nas pastas do `PATH` do ambiente; devolve o caminho absoluto. */
export const localizar = Effect.fn("processo.localizar")(function* (nome: string, ambiente: Ambiente) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (path.isAbsolute(nome)) {
    return (yield* fs.exists(nome).pipe(Effect.orElseSucceed(() => false))) ? Option.some(nome) : Option.none();
  }
  for (const pasta of (ambiente.PATH ?? "").split(path.sep === "\\" ? ";" : ":")) {
    if (pasta === "") continue;
    const candidato = path.join(pasta, nome);
    if (yield* fs.exists(candidato).pipe(Effect.orElseSucceed(() => false))) return Option.some(candidato);
  }
  return Option.none<string>();
});

/** Primeira linha do stdout de `<executavel> <args>`, ou nada se o comando falhar. */
export const primeiraLinha = Effect.fn("processo.primeiraLinha")(function* (
  executavel: string,
  args: ReadonlyArray<string>,
  ambiente: Ambiente,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const filho = yield* spawner.spawn(
        ChildProcess.make(executavel, args, { env: limparAmbiente(ambiente), stdin: "ignore", stderr: "ignore" }),
      );
      const saida = yield* Stream.mkString(Stream.decodeText(filho.stdout));
      const codigo = yield* filho.exitCode;
      return codigo === 0 ? Option.some(saida.trim().split("\n")[0] ?? "") : Option.none<string>();
    }),
  ).pipe(
    Effect.timeout("10 seconds"),
    Effect.orElseSucceed(() => Option.none<string>()),
  );
});

/**
 * Variáveis que uma sessão do Claude Code exporta para os filhos. Um `claude` iniciado com elas se
 * comporta como parte daquela sessão (lista copiada de `ClaudeHome.ts` do T3).
 */
const VARIAVEIS_DE_SESSAO_HOSPEDEIRA = [
  "CLAUDECODE",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_HOST_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_DESKTOP_APP_VERSION",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_EFFORT",
  "CLAUDE_PID",
  "CLAUDE_AGENT_SDK_VERSION",
  // O app desktop roda como Node pelo Electron; um Electron que o provider abrisse sairia na hora.
  "ELECTRON_RUN_AS_NODE",
];

/** Ambiente herdado sem as variáveis de sessão hospedeira e sem valores indefinidos. */
export function limparAmbiente(ambiente: Ambiente): Record<string, string> {
  const limpo: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(ambiente)) {
    if (valor !== undefined && !VARIAVEIS_DE_SESSAO_HOSPEDEIRA.includes(chave)) limpo[chave] = valor;
  }
  return limpo;
}
