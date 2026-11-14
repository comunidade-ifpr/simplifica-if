// Copiado de `oxlint-plugin-t3code/rules/require-suppression-reason.test.ts` do T3 Code (commit a6d91409729be6ba854b3f16adedc08847e3b24c).
// Copyright (c) 2026 T3 Tools Inc. Licença MIT; texto integral em `ferramentas/oxlint-plugin/LICENSE-T3`.
// Adaptado: o nome do plugin passou de `t3code` para `simplifica-if`; os casos de teste e o código das fixtures não mudaram.

import { assert, describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

const rule = createOxlintRuleHarness("simplifica-if/require-suppression-reason", {
  filename: "fixture.tsx",
});

describe("simplifica-if/require-suppression-reason", () => {
  rule.valid(
    "allows a directive with a -- reason",
    `
      // oxlint-disable-next-line no-control-regex -- ANSI sequences start with ESC.
      const ansi = /\\x1b\\[/;
      /* eslint-disable no-console -- this script reports to the terminal */
    `,
  );

  rule.valid(
    "allows a directive explained by the comment above",
    `
      // Positions are stable for a given string.
      // oxlint-disable-next-line react/no-array-index-key
      const items = ["a"].map((item, index) => <li key={index}>{item}</li>);
    `,
  );

  rule.valid(
    "allows stacked directives under one explanation",
    `
      // The fixture is invalid on purpose.
      // @ts-expect-error
      // oxlint-disable-next-line no-unused-vars
      const value: number = "text";
    `,
  );

  rule.valid(
    "allows a TypeScript directive followed by its reason",
    `
      // @ts-expect-error the fixture passes a string on purpose
      const count: number = "text";
    `,
  );

  rule.valid(
    "allows a directive in a JSX comment with a reason",
    `const el = <div>{/* oxlint-disable-next-line react/no-danger -- sanitized above */}</div>;`,
  );

  rule.valid("ignores enable directives", `/* oxlint-enable no-console */`);

  rule.invalid(
    "reports a lint directive without a reason",
    `
      // oxlint-disable-next-line no-control-regex
      const ansi = /\\x1b\\[/;
    `,
    (output) => {
      assert.match(output, /end the directive with `-- reason`/);
    },
  );

  rule.invalid("reports a file-level directive without a reason", `/* oxlint-disable eslint/no-useless-escape */`);

  rule.invalid(
    "reports a TypeScript directive without a reason",
    `
      // @ts-expect-error
      const count: number = "text";
    `,
    (output) => {
      assert.match(output, /write the reason after the directive/);
    },
  );

  rule.invalid(
    "does not count a comment separated by a blank line",
    `
      // Positions are stable for a given string.

      // oxlint-disable-next-line react/no-array-index-key
      const items = ["a"].map((item, index) => <li key={index}>{item}</li>);
    `,
  );

  rule.valid(
    "allows an empty comment line between the reason and the directive",
    `
      // Positions are stable for a given string.
      //
      // oxlint-disable-next-line react/no-array-index-key
      const items = ["a"].map((item, index) => <li key={index}>{item}</li>);
    `,
  );

  rule.invalid(
    "does not count an empty comment above",
    `
      //
      /* */
      // oxlint-disable-next-line react/no-array-index-key
      const items = ["a"].map((item, index) => <li key={index}>{item}</li>);
    `,
  );

  rule.invalid(
    "does not count a trailing comment on the code line above",
    `
      const first = 1; // the first value
      const second = 2; // oxlint-disable-line no-unused-vars
    `,
  );
});
