/**
 * Apoio dos testes de unidade: o `apps/server` de verdade, no próprio processo, com os drivers de
 * demonstração e o banco de fixture do MCP, em portas efêmeras de `127.0.0.1`.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Servidor from "@simplifica-if/server";
import { criarBancoFixture, diretorioTemporario } from "../../../packages/mcp/test/fixture.ts";
import { inserirNormas } from "../../../packages/mcp/test/fixture-normas.ts";
import * as Demonstracao from "./drivers-demonstracao.ts";

export { diretorioTemporario, limparTemporarios } from "../../../packages/mcp/test/fixture.ts";
export { LINK_DEMONSTRACAO, URL_LOGIN_GOOGLE } from "./drivers-demonstracao.ts";

export const TOKEN = "token-de-teste-da-interface-0123456789abcdef";

let banco: string | undefined;

/** O banco de fixture, criado uma vez por arquivo de teste. */
function bancoFixture(): string {
  if (banco === undefined) {
    banco = criarBancoFixture({}, diretorioTemporario("simplifica-web-"));
    inserirNormas(banco);
  }
  return banco;
}

/** O servidor local com os drivers de demonstração (passos curtos). */
export const layerServidor = (opcoes: { readonly porta?: number } = {}) =>
  Servidor.layer({
    banco: bancoFixture(),
    token: Redacted.make(TOKEN),
    ...(opcoes.porta === undefined ? {} : { porta: opcoes.porta }),
  }).pipe(
    Layer.provide(Demonstracao.layer({ atrasoLogin: "100 millis", passo: "5 millis" })),
    Layer.provide(NodeServices.layer),
  );

export const urlServidor = (porta: number) => `http://127.0.0.1:${porta}`;
