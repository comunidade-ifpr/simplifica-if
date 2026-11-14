// Trecho de `packages/provider-core/src/server/auth.ts` do T3 Code (a6d9140972): a interface
// `ProviderAuthController` sem os membros do ChatGPT e das respostas interativas
// (`reconnectProfile`, `importProfile`, `respond`), que o Antigravity não implementa e cujos tipos
// ficariam de fora. Texto igual no resto.
import type { ProviderAuthState, ProviderSetupError } from "./contracts-antigravity.ts";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";

export interface ProviderAuthController {
  readonly credentialBinding?: { readonly owner: "provider" | "t3"; readonly key: string };
  readonly adoptCredentials?: (
    update: Effect.Effect<void, ProviderSetupError>,
    stopSessions: Effect.Effect<void, ProviderSetupError>,
  ) => Effect.Effect<ProviderAuthState, ProviderSetupError>;
  readonly isChangingCredentials?: Effect.Effect<boolean>;
  readonly invalidate?: Effect.Effect<void>;
  readonly refreshMethods?: Effect.Effect<void>;
  readonly removeMethod?: (
    methodId: string,
  ) => Effect.Effect<ProviderAuthState, ProviderSetupError>;
  readonly withAccess?: <A, E, R>(
    task: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | ProviderSetupError, R | Scope.Scope>;
  readonly start: (
    ownerSessionId: string,
    stopSessions?: Effect.Effect<void, ProviderSetupError>,
    methodId?: string,
    returnUrl?: string,
    callbackMode?: "server" | "client",
  ) => Effect.Effect<ProviderAuthState, ProviderSetupError>;
  readonly complete: (
    ownerSessionId: string,
    input: { readonly flowId: string; readonly callbackUrl: string },
  ) => Effect.Effect<ProviderAuthState, ProviderSetupError>;
  readonly cancel: (
    ownerSessionId: string,
    flowId: string,
  ) => Effect.Effect<ProviderAuthState, ProviderSetupError>;
  readonly logout: (
    stopSessions: Effect.Effect<void, ProviderSetupError>,
  ) => Effect.Effect<ProviderAuthState, ProviderSetupError>;
  readonly subscribe: (ownerSessionId: string) => Stream.Stream<ProviderAuthState>;
  readonly isLogoutPrompt?: (text: string, hasAttachments: boolean) => boolean;
}
