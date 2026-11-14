/**
 * Runtime ACP mínimo do Antigravity, no lugar do `makeAntigravityAcpRuntime` do T3
 * (`apps/server/src/provider/acp/AntigravityAcpSupport.ts`, sobre o `AcpSessionRuntime` de
 * `packages/provider-acp`). Não é cópia: faz só o que a instalação (validação do runtime baixado) e
 * o login precisam.
 *
 * - Sobe o processo pela `AcpSpawnInput` de `buildAntigravityAcpSpawnInput`, com o
 *   `ChildProcessSpawner` recebido.
 * - Põe o `makeAntigravityStdoutTransform` no stdout e o `makeAntigravityStderrHandler` no stderr,
 *   como o T3: a URL de autorização vai para `onAuthorizationUrl`; sem ele, a tentativa de login
 *   interativo vira o erro de "sign-in required".
 * - `initialize` é memoizado; `start` faz `initialize`, `authenticate` (como o
 *   `authenticateEagerly` do T3) e `session/new`; `request` manda um método qualquer.
 * - Quando o processo morre, o erro `AcpProcessExitedError` leva o fim do stderr (com URLs de login
 *   apagadas), que a validação da instalação usa para explicar falhas conhecidas.
 *
 * Não tem grupos de processo, cgroups, retomada de sessão, modos, nem o tratamento de
 * `session/update` do T3: as sessões de conversa continuam no driver.
 */
import * as AcpClient from "@simplifica-if/effect-acp/client";
import type * as AcpSchema from "@simplifica-if/effect-acp/compat";
import * as AcpErrors from "@simplifica-if/effect-acp/errors";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import type * as AcpSessionRuntime from "./AcpSessionRuntime.ts";
import { makeAntigravityStderrHandler, makeAntigravityStdoutTransform } from "./antigravityAuthSupport.ts";
import type { AntigravityAuthMethod } from "./contracts-antigravity.ts";
import { resolveSpawnCommand } from "./shell.ts";

/** Quanto do fim do stderr o erro de saída do processo carrega. */
const MAXIMO_STDERR = 4_096;
const URL_LOGIN = /https?:\/\/accounts\.google\.com[^\s]*/gi;

export interface AntigravityAcpRuntimeInput {
  readonly spawn: AcpSessionRuntime.AcpSpawnInput;
  readonly cwd: string;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly onAuthorizationUrl?: (url: string) => Effect.Effect<void, AcpErrors.AcpError>;
  /** Método do `authenticate` em `start`; o padrão é `oauth-personal`. */
  readonly authMethod?: AntigravityAuthMethod;
  /** Aceito para manter a chamada do T3; aqui não muda nada (no T3 escolhe o `clientInfo`). */
  readonly runtimeVersion?: string | null;
  readonly clientInfo?: AcpSchema.InitializeRequest["clientInfo"];
  /** Servidores MCP do `session/new` de `start`; o padrão é nenhum, como no login do T3. */
  readonly mcpServers?: ReadonlyArray<AcpSchema.McpServer>;
}

export const makeAntigravityAcpRuntime = Effect.fn("makeAntigravityAcpRuntime")(function* (
  input: AntigravityAcpRuntimeInput,
): Effect.fn.Return<AcpSessionRuntime.AcpSessionRuntime["Service"], AcpErrors.AcpError, Scope.Scope> {
  const comando =
    input.spawn.shell === false
      ? { command: input.spawn.command, args: input.spawn.args, shell: false }
      : yield* resolveSpawnCommand(input.spawn.command, input.spawn.args, {
          ...(input.spawn.env ? { env: input.spawn.env } : {}),
          extendEnv: input.spawn.extendEnv ?? true,
        });
  const filho = yield* input.childProcessSpawner
    .spawn(
      ChildProcess.make(comando.command, [...comando.args], {
        cwd: input.spawn.cwd ?? input.cwd,
        ...(input.spawn.env ? { env: input.spawn.env } : {}),
        extendEnv: input.spawn.extendEnv ?? true,
        shell: comando.shell,
        forceKillAfter: "2 seconds",
      }),
    )
    .pipe(Effect.mapError((cause) => new AcpErrors.AcpSpawnError({ command: input.spawn.command, cause })));

  const callbacks = input.onAuthorizationUrl ? { onAuthorizationUrl: input.onAuthorizationUrl } : {};
  const tratarStderr = makeAntigravityStderrHandler(callbacks);
  const fimStderr = yield* Ref.make("");
  const stderrLido = yield* Deferred.make<void>();
  const falhaStderr = yield* Deferred.make<never, AcpErrors.AcpError>();
  yield* filho.stderr.pipe(
    Stream.decodeText(),
    Stream.runForEach((pedaco) =>
      Ref.update(fimStderr, (atual) => `${atual}${pedaco}`.slice(-MAXIMO_STDERR)).pipe(
        Effect.andThen(tratarStderr(pedaco)),
        Effect.catch((erro) =>
          Deferred.fail(falhaStderr, erro).pipe(
            Effect.andThen(filho.kill({ forceKillAfter: "1 second" }).pipe(Effect.ignore)),
          ),
        ),
      ),
    ),
    Effect.ensuring(Deferred.succeed(stderrLido, undefined)),
    Effect.ignore,
    Effect.forkScoped,
  );

  const contexto = yield* Layer.build(
    AcpClient.layerChildProcess(filho, { transformStdout: makeAntigravityStdoutTransform(callbacks) }),
  );
  const cliente = yield* Effect.service(AcpClient.AcpClient).pipe(Effect.provide(contexto));

  const comStderr = (erro: AcpErrors.AcpError): Effect.Effect<AcpErrors.AcpError> =>
    erro._tag !== "AcpProcessExitedError" || (erro.stderr?.trim().length ?? 0) > 0
      ? Effect.succeed(erro)
      : Deferred.await(stderrLido).pipe(
          Effect.timeout("250 millis"),
          Effect.ignore,
          Effect.andThen(Ref.get(fimStderr)),
          Effect.map((fim) => {
            const stderr = fim.replaceAll("\0", "").replace(URL_LOGIN, "[sign-in-url]").trim();
            return stderr.length === 0
              ? erro
              : new AcpErrors.AcpProcessExitedError({
                  ...(erro.code !== undefined ? { code: erro.code } : {}),
                  ...(erro.signal !== undefined ? { signal: erro.signal } : {}),
                  ...(erro.pid !== undefined ? { pid: erro.pid } : {}),
                  stderr,
                  ...(erro.cause !== undefined ? { cause: erro.cause } : {}),
                });
          }),
        );
  const executar = <A>(efeito: Effect.Effect<A, AcpErrors.AcpError>): Effect.Effect<A, AcpErrors.AcpError> =>
    Effect.raceFirst(efeito, Deferred.await(falhaStderr)).pipe(
      Effect.catch((erro) => comStderr(erro).pipe(Effect.flatMap(Effect.fail))),
    );

  const initialize = yield* Effect.cached(
    executar(
      cliente.agent.initialize({
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: input.clientInfo ?? { name: "simplifica-if", title: "Simplifica IF", version: "0.1.0" },
      }),
    ),
  );

  return {
    initialize: () => initialize,
    start: Effect.fn("AntigravityAcpRuntime.start")(function* () {
        const initializeResult = yield* initialize;
        yield* executar(cliente.agent.authenticate({ methodId: input.authMethod ?? "oauth-personal" }));
        const sessionSetupResult = yield* executar(
          cliente.agent.createSession({ cwd: input.cwd, mcpServers: [...(input.mcpServers ?? [])] }),
        );
        return {
          sessionId: sessionSetupResult.sessionId,
          initializeResult,
          sessionSetupResult,
          modelConfigId: undefined,
        } satisfies AcpSessionRuntime.AcpSessionRuntimeStartResult;
    }),
    request: (method, payload) => executar(cliente.raw.request(method, payload)),
  };
});
