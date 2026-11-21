// @effect-diagnostics nodeBuiltinImport:off -- teste: a ponte lê um stream do Node, como o stdin do processo
/**
 * A ponte stdio → HTTP do MCP (`AcpMcpStdioBridge`, do T3) na revisão 2026-07-28: cada requisição
 * sem sessão sai com `MCP-Protocol-Version`, `Mcp-Method` e, quando o método nomeia algo, `Mcp-Name`,
 * tirados da própria mensagem; a cancelação sem `_meta` herda a versão da requisição anterior.
 */
import * as NodeStream from "node:stream";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { runAcpMcpStdioBridge } from "../src/t3/AcpMcpStdioBridge.ts";

const META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "teste", version: "0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

/** Roda a ponte sobre `mensagens` e devolve os cabeçalhos de cada POST, na ordem das mensagens. */
const cabecalhosEnviados = (mensagens: ReadonlyArray<object>) =>
  Effect.gen(function* () {
    const enviados: Array<Record<string, string>> = [];
    yield* runAcpMcpStdioBridge({
      endpoint: "http://127.0.0.1:1/mcp",
      authorization: "Bearer x",
      input: NodeStream.Readable.from(mensagens.map((m) => `${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`)),
      output: { write: () => true },
      fetchImplementation: async (_url, init) => {
        enviados.push({ ...(init?.headers as Record<string, string>) });
        return new Response(null, { status: 202 });
      },
    });
    return enviados;
  });

describe("ponte MCP na revisão 2026-07-28", () => {
  it.effect("cabeçalhos de roteamento tirados da mensagem", () =>
    Effect.gen(function* () {
      const [discover, chamada, recurso, cancelada] = yield* cabecalhosEnviados([
        { id: 1, method: "server/discover", params: { _meta: META } },
        { id: 2, method: "tools/call", params: { name: "sobre_a_base", arguments: {}, _meta: META } },
        { id: 3, method: "resources/read", params: { uri: "ifpr://ficha/ação", _meta: META } },
        { method: "notifications/cancelled", params: { requestId: 2 } },
      ]);
      assert.strictEqual(discover?.["mcp-protocol-version"], "2026-07-28");
      assert.strictEqual(discover?.["mcp-method"], "server/discover");
      assert.isUndefined(discover?.["mcp-name"]);
      assert.strictEqual(chamada?.["mcp-name"], "sobre_a_base");
      // fora do ASCII visível, o nome vai em Base64
      assert.strictEqual(
        recurso?.["mcp-name"],
        `=?base64?${Buffer.from("ifpr://ficha/ação", "utf8").toString("base64")}?=`,
      );
      assert.strictEqual(cancelada?.["mcp-protocol-version"], "2026-07-28");
      assert.strictEqual(cancelada?.["mcp-method"], "notifications/cancelled");
    }),
  );

  it.effect("sem a versão no _meta, nenhum cabeçalho da 2026-07-28", () =>
    Effect.gen(function* () {
      const [inicio] = yield* cabecalhosEnviados([
        {
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } },
        },
      ]);
      assert.isUndefined(inicio?.["mcp-protocol-version"]);
      assert.isUndefined(inicio?.["mcp-method"]);
    }),
  );
});
