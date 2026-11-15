// Trecho de apps/server/src/provider/acp/AntigravityAcpSupport.ts do T3 (ver NOTICE e
// docs/upstream-t3.md): o `_meta.antigravity` do `session/new` (`systemPrompt.append` e
// `disabledTools`). `antigravitySessionMeta` recebe também `disabledTools` extras.
import * as Predicate from "effect/Predicate";
import type * as EffectAcpSchema from "@simplifica-if/effect-acp/compat";

function parseAntigravityVersion(version: string | null | undefined) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version?.trim() ?? "");
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left: ReadonlyArray<number>, right: ReadonlyArray<number>) {
  for (let index = 0; index < 3; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * 1.4.2 through 1.4.5 create or overwrite skills/system/run-workflow/SKILL.md in the workspace
 * unless `run_workflow` is disabled. Older builds offer the tool and leave the file alone.
 */
function antigravityWritesRunWorkflowSkill(version: string | null | undefined): boolean {
  const parsed = parseAntigravityVersion(version);
  return (
    parsed !== undefined &&
    compareVersions(parsed, [1, 4, 2]) >= 0 &&
    compareVersions(parsed, [1, 4, 5]) <= 0
  );
}

/**
 * Releases T3 qualified for native range reads and linked video. On 1.4.5 the client-read path
 * sends a whole file to serve one line, and the native reader keeps diff edits.
 */
export function isQualifiedAntigravityRelease(version: string | null | undefined): boolean {
  return version?.trim() === "1.4.5";
}

/**
 * 1.4.5 appends `systemPrompt.append` to its system instructions on new, load and resume, and
 * keeps none of it between processes, so every activation sends it again.
 */
export const antigravityAppendsSystemPrompt = (
  initializeResult: EffectAcpSchema.InitializeResponse,
) => {
  if (isQualifiedAntigravityRelease(initializeResult.agentInfo?.version)) return true;
  const extension = initializeResult.agentCapabilities?._meta?.antigravity;
  return (
    Predicate.isObject(extension) &&
    Predicate.isObject(extension.systemPrompt) &&
    extension.systemPrompt.append === true
  );
};

export function antigravitySessionMeta(
  initializeResult: EffectAcpSchema.InitializeResponse,
  systemPromptAppend?: string,
  extraDisabledTools: ReadonlyArray<string> = [],
): EffectAcpSchema.NewSessionRequest["_meta"] | undefined {
  const disabledTools = [
    ...(antigravityWritesRunWorkflowSkill(initializeResult.agentInfo?.version)
      ? ["run_workflow"]
      : []),
    ...extraDisabledTools,
  ];
  const antigravity = {
    ...(disabledTools.length > 0 ? { disabledTools } : {}),
    ...(systemPromptAppend !== undefined && antigravityAppendsSystemPrompt(initializeResult)
      ? { systemPrompt: { append: systemPromptAppend } }
      : {}),
  };
  return Object.keys(antigravity).length === 0 ? undefined : { antigravity };
}
