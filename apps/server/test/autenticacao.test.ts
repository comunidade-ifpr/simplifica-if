/**
 * O ingresso do WebSocket com o `TestClock`: vale até `VALIDADE_INGRESSO_MS` depois de emitido e uma
 * vez só. O `Autenticacao` de verdade, com requisições montadas (`HttpServerRequest.fromWeb`), sem
 * servidor.
 */
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { HttpServerRequest } from "effect/http";
import { Ingresso, PARAMETRO_INGRESSO, VALIDADE_INGRESSO_MS } from "@simplifica-if/contratos-app";
import * as Autenticacao from "../src/Autenticacao.ts";
import { TOKEN } from "./apoio.ts";

const PORTA = 4321;
const BASE = `http://127.0.0.1:${PORTA}`;
const decodificarIngresso = Schema.decodeEffect(Schema.fromJsonString(Ingresso));

const requisicao = (caminho: string, metodo: string, cabecalhos: Record<string, string> = {}) =>
  HttpServerRequest.fromWeb(
    new Request(`${BASE}${caminho}`, { method: metodo, headers: { host: `127.0.0.1:${PORTA}`, ...cabecalhos } }),
  );

const servicos = Layer.mergeAll(NodeCrypto.layerDigest, NodeCrypto.layerSecureRandom);

/** Um ingresso novo, comprado com o token. */
const comprar = (autenticacao: Autenticacao.Autenticacao["Service"]) =>
  Effect.gen(function* () {
    const resposta = yield* autenticacao.emitirIngresso(
      requisicao("/ingresso", "POST", { authorization: `Bearer ${TOKEN}` }),
    );
    assert.strictEqual(resposta.status, 200);
    if (resposta.body._tag !== "Uint8Array") return assert.fail("corpo inesperado");
    return yield* decodificarIngresso(new TextDecoder().decode(resposta.body.body));
  });

/** Se o upgrade com o ingresso passaria (nenhuma recusa). */
const abre = (autenticacao: Autenticacao.Autenticacao["Service"], ingresso: string) =>
  Effect.map(
    autenticacao.conferir(requisicao(`/rpc?${PARAMETRO_INGRESSO}=${encodeURIComponent(ingresso)}`, "GET")),
    Option.isNone,
  );

describe("ingresso do WebSocket", () => {
  it.effect("vale até o fim da validade, uma vez só", () =>
    Effect.gen(function* () {
      const autenticacao = yield* Autenticacao.make({ token: Redacted.make(TOKEN), origens: [], porta: PORTA });

      const primeiro = yield* comprar(autenticacao);
      assert.strictEqual(primeiro.expiraEm, VALIDADE_INGRESSO_MS);
      yield* TestClock.adjust(VALIDADE_INGRESSO_MS - 1);
      assert.isTrue(yield* abre(autenticacao, primeiro.ingresso));
      assert.isFalse(yield* abre(autenticacao, primeiro.ingresso));

      const segundo = yield* comprar(autenticacao);
      yield* TestClock.adjust(VALIDADE_INGRESSO_MS);
      assert.isFalse(yield* abre(autenticacao, segundo.ingresso));
    }).pipe(Effect.provide(servicos)),
  );
});
