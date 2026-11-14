import { assert, describe, it } from "@effect/vitest";
import { FalhaProvider, PastaTrabalhoInvalida } from "@simplifica-if/contratos-app";
import { RpcClientDefect, RpcClientError } from "effect/rpc/RpcClientError";
import { mensagemDeErro } from "./erros.ts";

describe("mensagemDeErro", () => {
  it("usa a mensagem em português dos erros tipados, com maiúscula e ponto", () => {
    assert.strictEqual(
      mensagemDeErro(new PastaTrabalhoInvalida({ pasta: "x" })),
      "A pasta de trabalho precisa ser o caminho absoluto de uma pasta que existe: x.",
    );
    assert.strictEqual(
      mensagemDeErro(new FalhaProvider({ provider: "claude", operacao: "iniciar sessão", detalhe: "sem login" })),
      "Claude: falha em iniciar sessão: sem login.",
    );
  });

  it("explica a queda da conexão e os defeitos", () => {
    const queda = new RpcClientError({ reason: new RpcClientDefect({ message: "socket", cause: undefined }) });
    assert.strictEqual(mensagemDeErro(queda), "A conexão com o servidor local caiu durante o pedido.");
    assert.strictEqual(mensagemDeErro(new Error("boom")), "Algo deu errado no app. Tente de novo.");
  });
});
