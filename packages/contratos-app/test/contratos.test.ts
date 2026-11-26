/**
 * O contrato do app: os métodos do `GrupoApp` (os grupos do núcleo, sem colisão de nome) e os envelopes
 * da partida do servidor.
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
  GrupoDiagnostico,
  GrupoLeitura,
  GrupoPasta,
  GrupoPreferencias,
  GrupoProviders,
  GrupoRelato,
  GrupoTarefas,
} from "../src/contratos.ts";

const decodificarEnvelope = Schema.decodeUnknownEffect(Schema.fromJsonString(EnvelopePartida));

describe("contratos do app", () => {
  it("o GrupoApp tem os métodos dos grupos do núcleo, sem colisão de nome entre eles", () => {
    const metodos = [...GrupoApp.requests.keys()];
    const partes = [
      GrupoProviders,
      GrupoConversa,
      GrupoRelato,
      GrupoDiagnostico,
      GrupoTarefas,
      GrupoPasta,
      GrupoAtualizacao,
      GrupoPreferencias,
      GrupoLeitura,
    ].map((grupo) => [...grupo.requests.keys()]);
    // Os grupos dos módulos completam a conta (`modulos/*.test.ts`).
    assert.strictEqual(new Set(partes.flat()).size, partes.flat().length);
    assert.includeMembers(metodos, partes.flat());
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
      "tarefas.listar",
      "pasta.criar",
      "pasta.anexar",
      "relato.preparar",
      "relato.registrar",
      "diagnostico.preparar",
      "diagnostico.gerar",
      "pasta.ver",
      "pasta.desfazer",
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
