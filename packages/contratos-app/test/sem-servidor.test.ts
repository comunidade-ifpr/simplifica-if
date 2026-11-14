// @effect-diagnostics nodeBuiltinImport:off globalJsonInEffect:off -- teste: um Node limpo num processo filho (node:child_process) mede o grafo de imports
/**
 * A interface do app (`apps/web`) importa `@simplifica-if/contratos-app`; nada do servidor pode vir
 * junto. Num Node limpo, o teste carrega o pacote e confere cada módulo que o carregamento resolveu:
 * nenhum módulo do Node (`node:sqlite`, `node:fs`, `node:crypto`…), nada do `@simplifica-if/kb`, do
 * serviço `Leitura` ou do servidor MCP, nenhum driver do motor nem os SDKs dos providers.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { assert, describe, it } from "@effect/vitest";

const AJUDANTE = NodePath.resolve(import.meta.dirname, "modulos-carregados.mjs");
const CONTRATOS = NodeURL.pathToFileURL(NodePath.resolve(import.meta.dirname, "../src/contratos.ts")).href;

/** O que não pode aparecer no grafo, com o motivo. */
const PROIBIDOS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^node:/, "módulo do Node"],
  [/\/packages\/kb\//, "@simplifica-if/kb"],
  [/\/packages\/mcp\/src\/(leitura|servidor|http|rpc|toolkit|envelope|SessaoAtual)/, "código de servidor do MCP"],
  [/\/packages\/mcp\/src\/ferramentas\/(registrar|toolkit)\.ts/, "registro de ferramentas do MCP"],
  [/\/packages\/motor\/src\/(drivers|processo|t3)\//, "driver do motor"],
  [/claude-agent-sdk|effect-acp|effect-codex-app-server|platform-node/, "SDK de provider ou plataforma Node"],
];

describe("contratos do app sem código de servidor", () => {
  it("importar o pacote não carrega node:*, o kb, a leitura do MCP nem os drivers", () => {
    const saida = NodeChildProcess.execFileSync(process.execPath, [AJUDANTE, CONTRATOS], { encoding: "utf8" });
    const urls: ReadonlyArray<string> = JSON.parse(saida);
    assert.isTrue(urls.some((url) => url.endsWith("/packages/mcp/src/grupo-leitura.ts")));
    const achados = urls.flatMap((url) =>
      PROIBIDOS.filter(([padrao]) => padrao.test(url)).map(([, motivo]) => `${motivo}: ${url}`),
    );
    assert.deepStrictEqual(achados, []);
  });
});
