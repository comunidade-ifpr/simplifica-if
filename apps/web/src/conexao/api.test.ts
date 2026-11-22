import { assert, describe, it } from "@effect/vitest";
import * as Exit from "effect/Exit";
import { valorDaSaida } from "./api.ts";
import { explicarErro, temCodigo } from "./erros.ts";

/** O que `valorDaSaida` lança. */
const lancado = (saida: Exit.Exit<unknown, unknown>): unknown => {
  try {
    valorDaSaida(saida, "ABCDEF12");
  } catch (erro) {
    return erro;
  }
  assert.fail("devia lançar");
};

describe("valorDaSaida", () => {
  it("o sucesso é o valor; a falha e o defeito levam o código do pedido", () => {
    assert.strictEqual(valorDaSaida(Exit.succeed(1), "ABCDEF12"), 1);
    assert.strictEqual(explicarErro(lancado(Exit.fail({ _tag: "X", message: "falhou" }))).codigo, "ABCDEF12");
    assert.strictEqual(explicarErro(lancado(Exit.die(new Error("boom")))).codigo, "ABCDEF12");
  });

  it("só interrupção (o runtime encerrando) sai sem código", () => {
    assert.isFalse(temCodigo(lancado(Exit.interrupt(1))));
  });
});
