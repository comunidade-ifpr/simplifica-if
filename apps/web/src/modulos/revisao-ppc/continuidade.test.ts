/** O que a revisão diz à continuidade (`continuidade.ts`), com a lista de revisões falsa: só a `viva` existe. */
import { assert, describe, it } from "@effect/vitest";
import type { Api } from "../../conexao/api.ts";
import { continuidadeDaRevisao } from "./continuidade.ts";

const api = { chamar: async () => [{ id: "viva" }] } as unknown as Api;

describe("a continuidade da revisão", () => {
  it("a rota volta se a revisão existe; sem id, ou com o id vazio, é a entrada, que não volta nem avisa", async () => {
    const conferencia = await continuidadeDaRevisao(api)();
    assert.isTrue(conferencia.rota("/revisao-ppc", { id: "viva" }));
    assert.isFalse(conferencia.rota("/revisao-ppc", { id: "apagada" }));
    assert.isUndefined(conferencia.rota("/revisao-ppc", {}));
    assert.isUndefined(conferencia.rota("/revisao-ppc", { id: "" }));
    assert.isUndefined(conferencia.rota("/explorar", {}));
  });

  it("os links e a origem da revisão", async () => {
    const conferencia = await continuidadeDaRevisao(api)();
    assert.isTrue(conferencia.link("ifpr://revisao/viva/1#p-2"));
    assert.isFalse(conferencia.link("ifpr://revisao/apagada/1"));
    assert.isUndefined(conferencia.link("ifpr://norma/a"));
    assert.isFalse(conferencia.origem("revisao:apagada"));
  });
});
