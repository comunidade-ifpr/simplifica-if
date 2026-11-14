/**
 * Ponto de entrada Effect dos scripts, como o da CLI `kb` (`packages/kb/src/cli.ts`).
 *
 * `executarPrincipal(nome, programa)` roda o programa com `NodeRuntime.runMain` e os serviços do Node
 * (`FileSystem`, `Path`, `ChildProcessSpawner`, `Terminal`). O relatório padrão do `runMain` escreve
 * no stdout, então ele fica desligado e a falha é relatada aqui, no stderr:
 *
 * - `EncerrarComCodigo`: o programa já imprimiu o que tinha a dizer; só define o código de saída;
 * - erro de uso do `effect/cli` (`CliError`): o `Command.run` já imprimiu a ajuda e o erro;
 * - outro erro tipado: `<nome>: <mensagem>`;
 * - defeito: `Cause.pretty`.
 *
 * Todos terminam com código 1, ou o de `EncerrarComCodigo`.
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Cause from "effect/Cause";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";
import * as CliError from "effect/cli/CliError";

/**
 * O programa já imprimiu o resultado (um relatório com pendências, uma conferência que falhou) e só
 * falta o código de saída. O `runMain` o lê pelo marcador `Runtime.errorExitCode`.
 */
export class EncerrarComCodigo extends Schema.TaggedError<EncerrarComCodigo>()("EncerrarComCodigo", {
  codigo: Schema.Int,
}) {
  override get message(): string {
    return `encerrado com o código ${this.codigo}`;
  }

  override get [Runtime.errorExitCode](): number {
    return this.codigo;
  }
}

export const ehEncerrarComCodigo = Schema.is(EncerrarComCodigo);

/** Encerra com `codigo` quando ele não é zero; com zero, termina normalmente. */
export const sairCom = (codigo: number): Effect.Effect<void, EncerrarComCodigo> =>
  codigo === 0 ? Effect.void : Effect.fail(new EncerrarComCodigo({ codigo }));

/** Escreve no stderr o que a falha tem a dizer; o código de saída fica com o `runMain`. */
const relatarFalha =
  (nome: string) =>
  (causa: Cause.Cause<unknown>): Effect.Effect<void> => {
    if (Cause.hasInterruptsOnly(causa)) return Effect.void;
    const erro = Cause.findErrorOption(causa);
    if (Option.isNone(erro)) return Console.error(Cause.pretty(causa));
    if (ehEncerrarComCodigo(erro.value) || CliError.isCliError(erro.value)) return Effect.void;
    const mensagem = erro.value instanceof Error ? erro.value.message : String(erro.value);
    return Console.error(`${nome}: ${mensagem}`);
  };

/** Roda `programa` como ponto de entrada do processo (só em `if (import.meta.main)`). */
export function executarPrincipal<E>(nome: string, programa: Effect.Effect<void, E, NodeServices.NodeServices>): void {
  NodeRuntime.runMain(programa.pipe(Effect.tapCause(relatarFalha(nome)), Effect.provide(NodeServices.layer)), {
    disableErrorReporting: true,
  });
}
