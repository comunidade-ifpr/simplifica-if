// Copiado de `oxlint-plugin-t3code/rules/no-dom-test-environment.test.ts` do T3 Code (commit a6d91409729be6ba854b3f16adedc08847e3b24c).
// Copyright (c) 2026 T3 Tools Inc. Licença MIT; texto integral em `ferramentas/oxlint-plugin/LICENSE-T3`.
// Adaptado: o nome do plugin passou de `t3code` para `simplifica-if`, e o pragma das fixtures é montado em `PRAGMA`, porque o
// vitest daqui leria o texto literal como o ambiente deste arquivo (e procuraria o `jsdom`). Os casos não mudaram.

import { describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

const PRAGMA = ["@vitest", "environment"].join("-");

const rule = createOxlintRuleHarness("simplifica-if/no-dom-test-environment");

describe("simplifica-if/no-dom-test-environment", () => {
  rule.valid("allows browser tests", 'import { page } from "vite-plus/test/browser";');
  rule.valid("allows similarly named packages", 'import "jsdom-helper";');
  rule.invalid("rejects line pragmas", `// ${PRAGMA} jsdom\nexport {};`);
  rule.invalid("rejects block pragmas for any environment", `/** ${PRAGMA} node */`);
  rule.invalid("rejects jsdom imports", 'import { JSDOM } from "jsdom";');
  rule.invalid("rejects happy-dom imports", 'import "happy-dom";');
  rule.invalid("rejects emulator subpaths", 'import "jsdom/lib/api.js";');
  rule.invalid("rejects dynamic imports", 'const dom = import("happy-dom");');
  rule.invalid("rejects template imports", "const dom = import(`jsdom`);");
  rule.invalid("rejects CommonJS imports", 'const dom = require("jsdom");');
  rule.invalid("rejects TypeScript require imports", 'import dom = require("happy-dom");');
  rule.invalid("rejects re-exports", 'export { JSDOM } from "jsdom";');
});
