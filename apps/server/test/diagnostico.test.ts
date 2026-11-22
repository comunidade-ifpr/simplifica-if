/**
 * O código do erro (`codigoDoErro`): o span da chamada no cliente e o do handler no servidor têm o mesmo
 * `traceId`, e o log da falha no servidor traz o código tirado dele.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Redacted from "effect/Redacted";
import * as References from "effect/References";
import { codigoDoErro } from "@simplifica-if/contratos-app";
import * as Servidor from "../src/servidor.ts";
import { bancoFixture, cliente, layerDriversFalsos, limparTemporarios, novoRegistro, TOKEN } from "./apoio.ts";

afterAll(limparTemporarios);

interface Registro {
  readonly mensagem: unknown;
  readonly nivel: string;
  readonly anotacoes: Readonly<Record<string, unknown>>;
}

const registros: Array<Registro> = [];

const capturar = Logger.make((opcoes) => {
  registros.push({
    mensagem: opcoes.message,
    nivel: opcoes.logLevel,
    anotacoes: opcoes.fiber.getRef(References.CurrentLogAnnotations),
  });
});

const camada = Servidor.layer({ banco: bancoFixture(), token: Redacted.make(TOKEN) }).pipe(
  Layer.provide(layerDriversFalsos(novoRegistro())),
  Layer.provide(Logger.layer([capturar])),
  Layer.provide(NodeServices.layer),
);

layer(camada, { excludeTestServices: true })("código do erro", (it) => {
  it.effect("a falha de uma chamada vai ao log do servidor com o código do traceId do cliente", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, { authorization: `Bearer ${TOKEN}` });
      // Sem o aviso de uso aceito, `conversa.iniciar` falha com `AvisoNaoAceito`.
      const traceId = yield* Effect.flatMap(Effect.orDie(Effect.currentSpan), (span) =>
        Effect.as(Effect.flip(rpc["conversa.iniciar"]({ provider: "claude", pastaTrabalho: "/" })), span.traceId),
      ).pipe(Effect.withSpan("teste"));

      const falha = registros.find(
        (registro) => Array.isArray(registro.mensagem) && registro.mensagem[0] === "RPC conversa.iniciar falhou",
      );
      assert.isDefined(falha);
      assert.strictEqual(falha.nivel, "Warn");
      assert.strictEqual(falha.anotacoes.codigo, codigoDoErro(traceId));
      assert.match(codigoDoErro(traceId), /^[0-9A-F]{8}$/);
    }),
  );
});
