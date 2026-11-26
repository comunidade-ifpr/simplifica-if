/**
 * O aviso de uso (M1.8) no módulo: sem ele aceito, nada da revisão vai à IA. As ações com IA recusam pelo
 * RPC com a frase do aviso, como a conversa (`preferencias.test.ts`, no núcleo).
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Servidor from "../../../src/servidor.ts";
import { bancoFixture, cliente, layerDriversFalsos, limparTemporarios, novoRegistro, TOKEN } from "./apoio.ts";

afterAll(limparTemporarios);

const camada = Servidor.layer({ banco: bancoFixture(), token: Redacted.make(TOKEN) }).pipe(
  Layer.provide(layerDriversFalsos(novoRegistro())),
  Layer.provide(NodeServices.layer),
);

const AUTORIZACAO = { authorization: `Bearer ${TOKEN}` };

layer(camada, { excludeTestServices: true })("aviso de uso na revisão de PPC", (it) => {
  it.effect("sem o aviso aceito, a revisão com IA e as ações com IA recusam com a frase do aviso", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);
      const ia = yield* Effect.flip(rpc["revisaoPpc.iniciarIa"]({ revisao: "x" }));
      assert.strictEqual(ia._tag, "AvisoNaoAceito");
      const sugerir = yield* Effect.flip(rpc["revisaoPpc.sugerir"]({ lista: "x", chave: "y", provider: "claude" }));
      assert.strictEqual(sugerir._tag, "AvisoNaoAceito");
      const preparar = yield* Effect.flip(
        rpc["revisaoPpc.prepararIa"]({ lista: "x", provider: "claude", modo: "completo" }),
      );
      assert.strictEqual(preparar._tag, "AvisoNaoAceito");
      const contestar = yield* Effect.flip(
        rpc["revisaoPpc.contestar"]({ lista: "x", chave: "y", motivo: "z", provider: "claude" }),
      );
      assert.strictEqual(contestar._tag, "AvisoNaoAceito");
      const deNovo = yield* Effect.flip(
        rpc["revisaoPpc.revisarDeNovo"]({ lista: "x", chave: "y", arquivo: "/x.docx", provider: "claude" }),
      );
      assert.strictEqual(deNovo._tag, "AvisoNaoAceito");
    }),
  );
});
