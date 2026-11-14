/**
 * O comando da ponte MCP (`ponte-mcp`) em cada forma de rodar o servidor: o Node com o `bin.ts` no
 * desenvolvimento, o Electron como Node com o bundle no app empacotado e o executável único (SEA).
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HostProcess from "@simplifica-if/motor/t3/HostProcess";
import { SUBCOMANDO_PONTE } from "../src/constantes.ts";
import { comandoPonte } from "../src/ponte.ts";

const comArgv = (executavel: string, argv: ReadonlyArray<string>, sea = false) =>
  comandoPonte().pipe(
    Effect.provideService(HostProcess.ExecutablePath, executavel),
    Effect.provideService(HostProcess.Arguments, argv),
    Effect.provideService(HostProcess.IsExecutable, sea),
    Effect.provide(NodeServices.layer),
  );

describe("comandoPonte", () => {
  it.effect("desenvolvimento: o Node e o bin.ts, em caminho absoluto", () =>
    Effect.gen(function* () {
      const ponte = yield* comArgv("/usr/local/bin/node", [
        "/usr/local/bin/node",
        "/repo/apps/server/src/bin.ts",
        "--banco",
        "x",
      ]);
      assert.deepStrictEqual(ponte, {
        comando: "/usr/local/bin/node",
        argumentos: ["/repo/apps/server/src/bin.ts", SUBCOMANDO_PONTE],
      });
    }),
  );

  it.effect("app empacotado: o executável do Electron e o bundle do servidor", () =>
    Effect.gen(function* () {
      const electron = "/Applications/Simplifica IF.app/Contents/MacOS/Simplifica IF";
      const bundle = "/Applications/Simplifica IF.app/Contents/Resources/servidor/bin.mjs";
      const ponte = yield* comArgv(electron, [electron, bundle, "--banco", "kb.sqlite"]);
      assert.deepStrictEqual(ponte, { comando: electron, argumentos: [bundle, SUBCOMANDO_PONTE] });
    }),
  );

  it.effect("executável único: só o subcomando", () =>
    Effect.gen(function* () {
      const ponte = yield* comArgv("/opt/simplifica", ["/opt/simplifica", "/opt/simplifica"], true);
      assert.deepStrictEqual(ponte, { comando: "/opt/simplifica", argumentos: [SUBCOMANDO_PONTE] });
    }),
  );
});
