// Copiado de `oxlint-plugin-t3code/rules/namespace-node-imports.test.ts` do T3 Code (commit a6d91409729be6ba854b3f16adedc08847e3b24c).
// Copyright (c) 2026 T3 Tools Inc. Licença MIT; texto integral em `ferramentas/oxlint-plugin/LICENSE-T3`.
// Adaptado: o nome do plugin passou de `t3code` para `simplifica-if`; os casos de teste e o código das fixtures não mudaram.

import { assert, describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

const rule = createOxlintRuleHarness("simplifica-if/namespace-node-imports");

describe("simplifica-if/namespace-node-imports", () => {
  rule.valid(
    "allows canonical Node namespaces",
    `
      import * as NodeFS from "node:fs";
      import * as NodeFSP from "node:fs/promises";
      import * as NodeAssert from "node:assert/strict";
      import * as NodeChildProcess from "node:child_process";
      import * as NodeTimersPromises from "node:timers/promises";
      import type * as NodeStream from "node:stream";

      NodeAssert.ok(NodeChildProcess.spawn && NodeTimersPromises.setTimeout);
      export const read = NodeFS.readFileSync;
      export const readAsync = NodeFSP.readFile;
      export type Input = NodeStream.Readable;
    `,
  );

  rule.valid(
    "does not apply to non-Node packages",
    `
      import { BrowserWindow } from "electron";
    `,
  );

  rule.invalid(
    "reports named imports",
    `
      import { readFile } from "node:fs/promises";
    `,
    (output) => {
      assert.match(output, /namespace named NodeFSP/);
    },
  );

  rule.invalid(
    "reports default imports",
    `
      import path from "node:path";
    `,
    (output) => {
      assert.match(output, /namespace named NodePath/);
    },
  );

  rule.invalid(
    "reports non-canonical namespace aliases",
    `
      import * as Crypto from "node:crypto";
      import * as NodeOs from "node:os";
    `,
    (output) => {
      assert.match(output, /namespace named NodeCrypto/);
      assert.match(output, /namespace named NodeOS/);
    },
  );
});
