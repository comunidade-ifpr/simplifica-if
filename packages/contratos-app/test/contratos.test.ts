/**
 * O contrato do app: os métodos do `GrupoApp` (os oito grupos, sem colisão de nome) e os envelopes da
 * partida do servidor.
 */
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import {
  EnvelopePartida,
  GrupoApp,
  GrupoAtualizacao,
  GrupoConversa,
  GrupoLeitura,
  GrupoPasta,
  GrupoPreferencias,
  GrupoProviders,
  GrupoRevisaoPpc,
  GrupoSkills,
} from "../src/contratos.ts";

const decodificarEnvelope = Schema.decodeUnknownEffect(Schema.fromJsonString(EnvelopePartida));

describe("contratos do app", () => {
  it("o GrupoApp tem os métodos dos oito grupos", () => {
    const metodos = [...GrupoApp.requests.keys()];
    const partes = [
      GrupoProviders,
      GrupoConversa,
      GrupoSkills,
      GrupoPasta,
      GrupoRevisaoPpc,
      GrupoAtualizacao,
      GrupoPreferencias,
      GrupoLeitura,
    ].map((grupo) => [...grupo.requests.keys()]);
    assert.strictEqual(metodos.length, partes.flat().length);
    assert.includeMembers(metodos, [
      "providers.detectar",
      "providers.instalar",
      "providers.entrar",
      "conversa.iniciar",
      "conversa.enviar",
      "conversa.responderAprovacao",
      "conversa.interromper",
      "conversa.encerrar",
      "conversa.avaliar",
      "skills.listar",
      "pasta.criar",
      "pasta.anexar",
      "pasta.ver",
      "pasta.desfazer",
      "revisaoPpc.analisar",
      "atualizacao.estado",
      "preferencias.ler",
      "preferencias.gravarPerfil",
      "preferencias.usarIa",
      "atualizacao.procurar",
      "atualizacao.voltar",
      "fichaNorma",
      "sobreABase",
    ]);
  });

  it.effect("o envelope de partida exige um token de 32 caracteres ou mais", () =>
    Effect.gen(function* () {
      const token = "t".repeat(32);
      assert.deepStrictEqual(yield* decodificarEnvelope(`{"token":"${token}"}`), { token });
      assert.deepStrictEqual(yield* decodificarEnvelope(`{"token":"${token}","origens":["app://simplifica"]}`), {
        token,
        origens: ["app://simplifica"],
      });
      assert.isTrue(Exit.isFailure(yield* Effect.exit(decodificarEnvelope(`{"token":"curto"}`))));
      assert.isTrue(Exit.isFailure(yield* Effect.exit(decodificarEnvelope("não é json"))));
    }),
  );
});
