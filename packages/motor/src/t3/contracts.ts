// Trechos de `packages/contracts/src/` do T3 Code (a6d9140972): baseSchemas.ts, providerInstance.ts,
// providerSetup.ts, resourceTelemetry.ts e server.ts. Só os contratos que as partes copiadas usam; texto igual.
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

// Hermes copies the string on every `trim()`, even when nothing changes.
// Returning the original keeps repeated IDs shared after decode.
const trim = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length === value.length ? value : trimmed;
};

export const TrimmedString = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transformEffect({
      decode: (value) => Effect.succeed(trim(value)),
      encode: (value) => Effect.succeed(trim(value)),
    }),
  ),
);
// `make` and encode see untrimmed values; `isNonEmpty` would accept whitespace that encodes to an invalid empty string.
const isNonBlank = Schema.makeFilter((value: string) => value.trim().length > 0, {
  expected: "a non-blank string",
  toJsonSchema: () => [{ minLength: 1 }, true],
  arbitraryConstraint: { minLength: 1 },
});
export const TrimmedNonEmptyString = TrimmedString.check(isNonBlank);

const PROVIDER_SLUG_MAX_CHARS = 64;
const PROVIDER_SLUG_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

const slugSchema = TrimmedNonEmptyString.check(
  Schema.isMaxLength(PROVIDER_SLUG_MAX_CHARS),
  Schema.isPattern(PROVIDER_SLUG_PATTERN),
);

export const ProviderDriverKind = slugSchema.pipe(Schema.brand("ProviderDriverKind"));
export type ProviderDriverKind = typeof ProviderDriverKind.Type;

const SetupOperationId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
const ByteCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const ProviderInstallState = Schema.Struct({
  driver: ProviderDriverKind,
  operationId: Schema.NullOr(SetupOperationId),
  phase: Schema.Literals([
    "idle",
    "downloading",
    "extracting",
    "verifying",
    "succeeded",
    "failed",
    "cancelled",
  ]),
  downloadedBytes: ByteCount,
  totalBytes: Schema.NullOr(ByteCount),
  version: Schema.NullOr(TrimmedNonEmptyString),
  installedVersion: Schema.NullOr(TrimmedNonEmptyString),
  executablePath: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  source: Schema.optionalKey(Schema.NullOr(Schema.Literals(["managed", "local"]))),
  canRemove: Schema.Boolean,
  message: Schema.NullOr(Schema.String),
});
export type ProviderInstallState = typeof ProviderInstallState.Type;

export const ShellEnvironmentPatch = Schema.Struct({
  PATH: Schema.optionalKey(Schema.NullOr(Schema.String)),
  DBUS_SESSION_BUS_ADDRESS: Schema.optionalKey(Schema.NullOr(Schema.String)),
  DISPLAY: Schema.optionalKey(Schema.NullOr(Schema.String)),
  LANG: Schema.optionalKey(Schema.NullOr(Schema.String)),
  LC_ALL: Schema.optionalKey(Schema.NullOr(Schema.String)),
  LC_CTYPE: Schema.optionalKey(Schema.NullOr(Schema.String)),
  SSH_AUTH_SOCK: Schema.optionalKey(Schema.NullOr(Schema.String)),
  HOMEBREW_PREFIX: Schema.optionalKey(Schema.NullOr(Schema.String)),
  HOMEBREW_CELLAR: Schema.optionalKey(Schema.NullOr(Schema.String)),
  HOMEBREW_REPOSITORY: Schema.optionalKey(Schema.NullOr(Schema.String)),
  XDG_CONFIG_HOME: Schema.optionalKey(Schema.NullOr(Schema.String)),
  XDG_CURRENT_DESKTOP: Schema.optionalKey(Schema.NullOr(Schema.String)),
  XDG_DATA_HOME: Schema.optionalKey(Schema.NullOr(Schema.String)),
  XDG_RUNTIME_DIR: Schema.optionalKey(Schema.NullOr(Schema.String)),
  XDG_SESSION_DESKTOP: Schema.optionalKey(Schema.NullOr(Schema.String)),
  XDG_SESSION_TYPE: Schema.optionalKey(Schema.NullOr(Schema.String)),
  WAYLAND_DISPLAY: Schema.optionalKey(Schema.NullOr(Schema.String)),
  SSL_CERT_FILE: Schema.optionalKey(Schema.NullOr(Schema.String)),
  SSL_CERT_DIR: Schema.optionalKey(Schema.NullOr(Schema.String)),
  NODE_EXTRA_CA_CERTS: Schema.optionalKey(Schema.NullOr(Schema.String)),
  T3CODE_TELEMETRY_ENABLED: Schema.optionalKey(Schema.NullOr(Schema.String)),
  T3CODE_GITHUB_APP_CLIENT_ID: Schema.optionalKey(Schema.NullOr(Schema.String)),
  __MISE_DIFF: Schema.optionalKey(Schema.NullOr(Schema.String)),
  JAVA_HOME: Schema.optionalKey(Schema.NullOr(Schema.String)),
  FNM_DIR: Schema.optionalKey(Schema.NullOr(Schema.String)),
  FNM_MULTISHELL_PATH: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type ShellEnvironmentPatch = typeof ShellEnvironmentPatch.Type;

export const ServerProviderCompatibilityStatus = Schema.Literals([
  "unknown",
  "supported",
  "graceful",
  "unsupported",
  "broken",
]);
export const ServerProviderCompatibilityAdvisory = Schema.Struct({
  status: ServerProviderCompatibilityStatus,
  latestVersionStatus: Schema.optionalKey(ServerProviderCompatibilityStatus),
  message: Schema.NullOr(TrimmedNonEmptyString),
  recommendedVersion: Schema.NullOr(TrimmedNonEmptyString),
  recommendedRange: Schema.NullOr(TrimmedNonEmptyString),
});
export type ServerProviderCompatibilityAdvisory = typeof ServerProviderCompatibilityAdvisory.Type;
