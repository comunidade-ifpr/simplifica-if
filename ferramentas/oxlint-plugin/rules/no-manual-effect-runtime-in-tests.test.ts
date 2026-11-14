// Copiado de `oxlint-plugin-t3code/rules/no-manual-effect-runtime-in-tests.test.ts` do T3 Code (commit a6d91409729be6ba854b3f16adedc08847e3b24c).
// Copyright (c) 2026 T3 Tools Inc. Licença MIT; texto integral em `ferramentas/oxlint-plugin/LICENSE-T3`.
// Adaptado: o nome do plugin passou de `t3code` para `simplifica-if`; os casos de teste e o código das fixtures não mudaram.

import { assert, describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

const rule = createOxlintRuleHarness("simplifica-if/no-manual-effect-runtime-in-tests", {
  filename: "fixture.test.ts",
});

describe("simplifica-if/no-manual-effect-runtime-in-tests", () => {
  rule.valid(
    "allows @effect/vitest effect tests",
    `
      import { it } from "@effect/vitest";
      import * as Effect from "effect/Effect";

      it.effect("runs an Effect", () => Effect.succeed("ok"));
    `,
  );

  const runtimeMethods = [
    "runCallback",
    "runCallbackWith",
    "runFork",
    "runForkWith",
    "runPromise",
    "runPromiseExit",
    "runPromiseExitWith",
    "runPromiseWith",
    "runSync",
    "runSyncExit",
    "runSyncExitWith",
    "runSyncWith",
  ] as const;

  for (const method of runtimeMethods) {
    rule.invalid(
      `reports Effect.${method}`,
      `
        import * as Effect from "effect/Effect";

        test("runs an Effect", () => {
          Effect.${method}(Effect.succeed("ok"));
        });
      `,
      (output) => {
        assert.match(output, /Use @effect\/vitest with it\.effect/);
      },
    );
  }

  rule.invalid(
    "reports ManagedRuntime.make",
    `
      import * as Layer from "effect/Layer";
      import * as ManagedRuntime from "effect/ManagedRuntime";

      test("makes a runtime", () => {
        ManagedRuntime.make(Layer.empty);
      });
    `,
  );
});

const productionRule = createOxlintRuleHarness("simplifica-if/no-manual-effect-runtime-in-tests");

productionRule.valid(
  "allows production runtime boundaries",
  `
    import * as Effect from "effect/Effect";

    export const main = () => Effect.runPromise(Effect.void);
  `,
);

const legacyRule = createOxlintRuleHarness("simplifica-if/no-manual-effect-runtime-in-tests", {
  filename: "legacy.test.ts",
  ruleOptions: [{ maxOccurrences: 2 }],
});

describe("simplifica-if/no-manual-effect-runtime-in-tests with maxOccurrences", () => {
  legacyRule.valid(
    "allows occurrences up to the ceiling",
    `
      import * as Effect from "effect/Effect";

      test("first", () => Effect.runSync(Effect.void));
      test("second", () => Effect.runSync(Effect.void));
    `,
  );

  legacyRule.invalid(
    "reports occurrences beyond the ceiling",
    `
      import * as Effect from "effect/Effect";

      test("first", () => Effect.runSync(Effect.void));
      test("second", () => Effect.runSync(Effect.void));
      test("third", () => Effect.runSync(Effect.void));
    `,
    (output) => {
      assert.equal(output.match(/no-manual-effect-runtime-in-tests/g)?.length, 1);
    },
  );
});
