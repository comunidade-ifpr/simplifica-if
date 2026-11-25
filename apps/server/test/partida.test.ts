/**
 * A partida do servidor (`partida.ts`): o token pelo ambiente ou pelo envelope no stdin, e as recusas,
 * cujas mensagens nunca trazem o que veio. O servidor como processo está em `processo.test.ts`.
 */
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { VARIAVEL_TOKEN } from "@simplifica-if/contratos-app";
import * as Partida from "../src/partida.ts";
import { TOKEN } from "./apoio.ts";

const cordao = (linha?: string): Partida.Cordao => ({
  primeiraLinha: Effect.succeed(Option.fromNullishOr(linha)),
  fim: Effect.never,
});

describe("partida", () => {
  it.effect("o envelope no stdin: token, origens e o segredo do desktop", () =>
    Effect.gen(function* () {
      const partida = yield* Partida.lerPartida(
        {},
        cordao(JSON.stringify({ token: TOKEN, origens: ["app://simplifica"], tokenDesktop: TOKEN })),
      );
      assert.strictEqual(Redacted.value(partida.token), TOKEN);
      assert.deepStrictEqual(partida.origens, ["app://simplifica"]);
      assert.strictEqual(Redacted.value(partida.tokenDesktop!), TOKEN);
    }),
  );

  it.effect("o token pelo ambiente vale no lugar do stdin", () =>
    Effect.gen(function* () {
      const partida = yield* Partida.lerPartida({ [VARIAVEL_TOKEN]: TOKEN }, cordao());
      assert.strictEqual(Redacted.value(partida.token), TOKEN);
    }),
  );

  it.effect("sem token, ou com token curto, recusa sem repetir o que veio", () =>
    Effect.gen(function* () {
      assert.include((yield* Effect.flip(Partida.lerPartida({}, cordao()))).message, "sem token");
      const curto = yield* Effect.flip(Partida.lerPartida({}, cordao(JSON.stringify({ token: "curto" }))));
      assert.include(curto.message, "não é um envelope válido");
      assert.notInclude(curto.message, '"curto"');
      const curtoNoAmbiente = yield* Effect.flip(Partida.lerPartida({ [VARIAVEL_TOKEN]: "curto" }, cordao()));
      assert.include(curtoNoAmbiente.message, "pelo menos");
      assert.notInclude(curtoNoAmbiente.message, 'curto"');
    }),
  );
});
