// Trecho de `packages/provider-acp/src/server/AcpSessionRuntime.ts` do T3 Code (a6d9140972): só os
// tipos que o perfil, a instalação e o login do Antigravity usam (`AcpSpawnInput`,
// `AcpSessionRuntimeStartResult` e, do serviço `AcpSessionRuntime`, `initialize`, `start` e
// `request`). A implementação (cerca de 2.400 linhas, com grupos de processo, cgroups e o
// `AgentScope`) ficou de fora; `antigravityAcpRuntime.ts` faz o mínimo de que a instalação e o
// login precisam. Texto igual.
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as EffectAcpErrors from "@simplifica-if/effect-acp/errors";
import type * as EffectAcpSchema from "@simplifica-if/effect-acp/compat";

export interface AcpSpawnInput {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly extendEnv?: boolean;
  readonly shell?: false;
}

export interface AcpSessionRuntimeStartResult {
  readonly sessionId: string;
  readonly initializeResult: EffectAcpSchema.InitializeResponse;
  readonly sessionSetupResult:
    | EffectAcpSchema.ForkSessionResponse
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse;
  readonly modelConfigId: string | undefined;
}

export class AcpSessionRuntime extends Context.Service<
  AcpSessionRuntime,
  {
    /** Reads capabilities without authentication, session creation, or MCP startup. */
    readonly initialize: () => Effect.Effect<
      EffectAcpSchema.InitializeResponse,
      EffectAcpErrors.AcpError
    >;
    readonly start: () => Effect.Effect<AcpSessionRuntimeStartResult, EffectAcpErrors.AcpError>;
    readonly request: (
      method: string,
      payload: unknown,
    ) => Effect.Effect<unknown, EffectAcpErrors.AcpError>;
  }
>()("@simplifica-if/motor/t3/AcpSessionRuntime") {}
