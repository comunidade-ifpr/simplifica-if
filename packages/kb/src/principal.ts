/**
 * Ponto de entrada comum das CLIs (`kb`, `simplifica-mcp`, `sei`, `revisar_ppc.ts`) e dos scripts
 * (`scripts/principal.ts`).
 *
 * `executarPrincipal(nome, programa, opcoes)` roda o programa com `NodeRuntime.runMain` e os serviços
 * do Node. O relatório padrão do `runMain` escreve no stdout (que é da saída `--json` ou do protocolo
 * MCP), então ele fica desligado e a falha é relatada aqui, no stderr:
 *
 * - interrupção (SIGINT, SIGTERM): nada; o `runMain` sai com 130;
 * - `EncerrarComCodigo`: o programa já imprimiu o que tinha a dizer; só define o código de saída;
 * - erro de uso do `effect/cli` (`CliError`): o `Command.run` já imprimiu a ajuda e o erro;
 * - outro erro tipado: `opcoes.mensagemDe(erro)`, por padrão `<nome>: <mensagem>`;
 * - defeito: `opcoes.mensagemDoDefeito(causa)`, por padrão `Cause.pretty`.
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
 * O programa já imprimiu o resultado (um relatório com pendências, "dispositivo não encontrado", um
 * lote com falhas) e só falta o código de saída. O `runMain` o lê pelo marcador `Runtime.errorExitCode`.
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

const ehEncerrarComCodigo = Schema.is(EncerrarComCodigo);

/** Encerra com `codigo` quando ele não é zero; com zero, termina normalmente. */
export const sairCom = (codigo: number): Effect.Effect<void, EncerrarComCodigo> =>
  codigo === 0 ? Effect.void : Effect.fail(new EncerrarComCodigo({ codigo }));

/** A mensagem de um erro qualquer: a de um `Error`, ou o valor como texto. */
export const mensagemDoErro = (erro: unknown): string => (erro instanceof Error ? erro.message : String(erro));

export interface OpcoesPrincipal {
  /** A linha do stderr para um erro tipado; por padrão, `<nome>: <mensagem>`. */
  readonly mensagemDe?: (erro: unknown) => string;
  /** O texto do stderr para um defeito; por padrão, `Cause.pretty`. */
  readonly mensagemDoDefeito?: (causa: Cause.Cause<unknown>) => string;
}

/** O que a falha tem a dizer no stderr; `undefined` quando não há nada a escrever. */
export const textoDaFalha =
  (nome: string, opcoes: OpcoesPrincipal = {}) =>
  (causa: Cause.Cause<unknown>): string | undefined => {
    if (Cause.hasInterruptsOnly(causa)) return undefined;
    const erro = Cause.findErrorOption(causa);
    if (Option.isNone(erro)) return (opcoes.mensagemDoDefeito ?? Cause.pretty)(causa);
    if (ehEncerrarComCodigo(erro.value) || CliError.isCliError(erro.value)) return undefined;
    return opcoes.mensagemDe ? opcoes.mensagemDe(erro.value) : `${nome}: ${mensagemDoErro(erro.value)}`;
  };

/** Roda `programa` como ponto de entrada do processo (só no módulo principal). */
export function executarPrincipal<E>(
  nome: string,
  programa: Effect.Effect<void, E, NodeServices.NodeServices>,
  opcoes: OpcoesPrincipal = {},
): void {
  const texto = textoDaFalha(nome, opcoes);
  NodeRuntime.runMain(
    programa.pipe(
      Effect.tapCause((causa) => {
        const linha = texto(causa);
        return linha === undefined ? Effect.void : Console.error(linha);
      }),
      Effect.provide(NodeServices.layer),
    ),
    { disableErrorReporting: true },
  );
}
