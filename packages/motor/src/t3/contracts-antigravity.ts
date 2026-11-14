// Trechos de `packages/contracts/src/` do T3 Code (a6d9140972): baseSchemas.ts, providerInstance.ts,
// providerSetup.ts e settings.ts. Os contratos que o login e o perfil do Antigravity usam e que
// `contracts.ts` não tem; texto igual. `TrimmedNonEmptyString` vem de `contracts.ts`.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { TrimmedNonEmptyString } from "./contracts.ts";

// baseSchemas.ts

export const IsoDateTime = Schema.String;
export type IsoDateTime = typeof IsoDateTime.Type;

export const ForwardCompatibleOptional = <Value extends Schema.Top>(value: Value) => {
  const decodeValue = Schema.decodeUnknownOption(value as never);
  return Schema.optionalKey(
    Schema.Unknown.pipe(
      Schema.decodeTo(
        Schema.UndefinedOr(value),
        SchemaTransformation.transform<Value["Encoded"] | undefined, unknown>({
          decode: (raw) =>
            Option.isSome(decodeValue(raw)) ? (raw as Value["Encoded"]) : undefined,
          encode: (raw) => raw,
        }),
      ),
    ),
  );
};

/** Prefer {@link ForwardCompatibleUnion} for tagged unions so malformed known members still fail. */
export const ForwardCompatibleArray = <Element extends Schema.Top>(element: Element) =>
  Schema.Array(
    Schema.UndefinedOr(element).pipe(
      Schema.catchDecoding(() => Effect.succeedSome(undefined)),
      Schema.catchEncoding(() => Effect.succeedSome(undefined)),
    ),
  ).pipe(
    Schema.decodeTo(
      Schema.Array(
        Schema.UndefinedOr(Schema.toType(element)).pipe(
          Schema.catchEncoding(() => Effect.succeedSome(undefined)),
        ),
      ).check(
        // Schema.is/make must reject holes; abort before later array checks.
        Schema.makeFilter(
          (values) => {
            // Every index, not `every`, which skips the holes of a sparse array.
            for (let index = 0; index < values.length; index++) {
              if (values[index] === undefined) return false;
            }
            return true;
          },
          { expected: "an array without holes" },
          true,
        ),
      ),
      SchemaTransformation.transform<
        ReadonlyArray<Element["Type"]>,
        ReadonlyArray<Element["Type"] | undefined>
      >({
        decode: (values) => values.filter((value) => value !== undefined),
        encode: (values) => values.filter((value) => value !== undefined),
      }),
    ),
  ) as unknown as ForwardCompatibleArray<Element>;
export type ForwardCompatibleArray<Element extends Schema.Top> = Schema.Codec<
  ReadonlyArray<Element["Type"]>,
  ReadonlyArray<Element["Encoded"]>,
  Element["DecodingServices"],
  Element["EncodingServices"]
>;

// providerInstance.ts

const PROVIDER_SLUG_MAX_CHARS = 64;
const PROVIDER_SLUG_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

const slugSchema = TrimmedNonEmptyString.check(
  Schema.isMaxLength(PROVIDER_SLUG_MAX_CHARS),
  Schema.isPattern(PROVIDER_SLUG_PATTERN),
);

export const ProviderInstanceId = slugSchema.pipe(Schema.brand("ProviderInstanceId"));
export type ProviderInstanceId = typeof ProviderInstanceId.Type;

// providerSetup.ts

const SetupOperationId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
// Environments supply these and clients open them, so a `javascript:` URL would run as the client.
const SignInUrl = TrimmedNonEmptyString.check(
  Schema.isMaxLength(16_384),
  Schema.isPattern(/^https?:\/\//i),
);

export const ProviderAuthMethod = Schema.Struct({
  id: SetupOperationId,
  accountEmail: Schema.optional(TrimmedNonEmptyString),
  canRemove: Schema.optionalKey(Schema.Boolean),
  name: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  type: Schema.Literals(["agent", "terminal", "credentials"]),
});
export type ProviderAuthMethod = typeof ProviderAuthMethod.Type;

export const ProviderAuthInteraction = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("browser"),
    id: SetupOperationId,
    url: SignInUrl,
    requiresConsent: Schema.Boolean,
    acceptsCallback: Schema.optionalKey(Schema.Boolean),
  }),
  Schema.Struct({
    type: Schema.Literal("deviceCode"),
    id: SetupOperationId,
    url: SignInUrl,
    userCode: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  }),
  Schema.Struct({
    type: Schema.Literal("terminal"),
    id: SetupOperationId,
    output: Schema.String.check(Schema.isMaxLength(16_384)),
    outputOffset: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  }),
  Schema.Struct({
    type: Schema.Literal("credentials"),
    id: SetupOperationId,
    fields: Schema.Array(
      Schema.Struct({
        name: SetupOperationId,
        label: TrimmedNonEmptyString,
        secret: Schema.Boolean,
      }),
    ).check(Schema.isMaxLength(16)),
  }),
]);
export type ProviderAuthInteraction = typeof ProviderAuthInteraction.Type;

export const ProviderAuthState = Schema.Struct({
  instanceId: ProviderInstanceId,
  phase: Schema.Literals([
    "idle",
    "starting",
    "waiting",
    "verifying",
    "succeeded",
    "failed",
    "cancelled",
  ]),
  flowId: Schema.NullOr(SetupOperationId),
  authorizationUrl: Schema.NullOr(SignInUrl),
  expiresAt: Schema.NullOr(IsoDateTime),
  message: Schema.NullOr(Schema.String),
  // Drop unknown auth methods rather than rejecting the entire state.
  methods: Schema.optionalKey(
    ForwardCompatibleArray(ProviderAuthMethod).check(Schema.isMaxLength(32)),
  ),
  interaction: ForwardCompatibleOptional(Schema.NullOr(ProviderAuthInteraction)),
  credentialOwner: ForwardCompatibleOptional(Schema.Literals(["provider", "t3"])),
});
export type ProviderAuthState = typeof ProviderAuthState.Type;

/** Safe setup failure text. Never include OAuth codes, URLs, or native token data. */
export class ProviderSetupError extends Schema.TaggedError<ProviderSetupError>()(
  "ProviderSetupError",
  {
    instanceId: ProviderInstanceId,
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

// settings.ts

export interface ProviderSettingsFormOption {
  readonly value: string;
  readonly label: string;
}

export const ANTIGRAVITY_AUTH_METHODS = [
  { value: "oauth-personal", label: "Google account" },
  { value: "oauth-business", label: "Gemini Enterprise" },
  { value: "gemini-api-key", label: "Gemini API key" },
  { value: "agent-platform", label: "Agent Platform (Vertex AI)" },
] as const satisfies ReadonlyArray<ProviderSettingsFormOption>;
export const AntigravityAuthMethod = Schema.Literals(
  ANTIGRAVITY_AUTH_METHODS.map((method) => method.value),
);
export type AntigravityAuthMethod = typeof AntigravityAuthMethod.Type;
