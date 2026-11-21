// @effect-diagnostics nodeBuiltinImport:off globalJsonInEffect:off -- teste: um Node limpo num processo filho (node:child_process) mede o grafo de imports
/**
 * A interface do app (`apps/web`) importa `@simplifica-if/contratos-app`; nada do servidor pode vir
 * junto. Num Node limpo, o teste carrega o pacote e confere cada módulo que o carregamento resolveu:
 * nenhum módulo do Node (`node:sqlite`, `node:fs`, `node:crypto`…), nada do `@simplifica-if/kb` (salvo `canal.ts` e
 * `normas/fonte.ts`, abaixo), do serviço `Leitura` ou do servidor MCP, nem a implementação do motor (o serviço `Motor`, os drivers; só
 * os schemas de `erros.ts`, `eventos.ts`, `estados-provider.ts` e `falhas.ts`) nem os SDKs dos providers.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { assert, describe, it } from "@effect/vitest";

const AJUDANTE = NodePath.resolve(import.meta.dirname, "modulos-carregados.mjs");
const CONTRATOS = NodeURL.pathToFileURL(NodePath.resolve(import.meta.dirname, "../src/contratos.ts")).href;
/** `@simplifica-if/contratos-app/ponte`, que o processo principal do desktop (sem Effect) importa. */
const PONTE = NodeURL.pathToFileURL(NodePath.resolve(import.meta.dirname, "../src/ponte.ts")).href;

/**
 * As exceções do kb, módulos folha que o `mcp/contratos.ts` e as ferramentas usam nos schemas:
 * `@simplifica-if/kb/canal` (a lista de canais de `Base.canal`, sem import) e `@simplifica-if/kb/normas/fonte`
 * (o schema `UrlOficial` da `ficha_norma`, que só importa o Effect). O último teste confere que elas não importam
 * nada além de `effect/*`, para a exceção não crescer.
 */
const EXCECOES_KB = ["canal.ts", "normas/fonte.ts"].map((arquivo) =>
  NodePath.resolve(import.meta.dirname, "../../kb/src", arquivo),
);
const PERMITIDOS: ReadonlyArray<string> = EXCECOES_KB.map((caminho) => NodeURL.pathToFileURL(caminho).href);

/** O que não pode aparecer no grafo, com o motivo. */
const PROIBIDOS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^node:/, "módulo do Node"],
  [/\/packages\/kb\//, "@simplifica-if/kb"],
  [/\/packages\/mcp\/src\/(leitura|servidor|http|rpc|envelope|SessaoAtual)/, "código de servidor do MCP"],
  [/\/packages\/mcp\/src\/ferramentas\/(registrar|toolkit)\.ts/, "registro de ferramentas do MCP"],
  [/\/packages\/motor\/src\/(drivers|processo|t3)\//, "driver do motor"],
  [/\/packages\/motor\/src\/(Motor|Driver|Canal|resultados|estados)\.ts$/, "implementação do motor"],
  [/claude-agent-sdk|effect-acp|effect-codex-app-server|platform-node/, "SDK de provider ou plataforma Node"],
];

describe("contratos do app sem código de servidor", () => {
  it("importar o pacote não carrega node:*, o kb, a leitura do MCP nem o motor", () => {
    const saida = NodeChildProcess.execFileSync(process.execPath, [AJUDANTE, CONTRATOS], { encoding: "utf8" });
    const urls: ReadonlyArray<string> = JSON.parse(saida);
    assert.isTrue(urls.some((url) => url.endsWith("/packages/mcp/src/grupo-leitura.ts")));
    const achados = urls
      .filter((url) => !PERMITIDOS.includes(url))
      .flatMap((url) => PROIBIDOS.filter(([padrao]) => padrao.test(url)).map(([, motivo]) => `${motivo}: ${url}`));
    assert.deepStrictEqual(achados, []);
  });

  it("o módulo ponte não carrega nada além dele: o bundle do desktop não arrasta o Effect", () => {
    const saida = NodeChildProcess.execFileSync(process.execPath, [AJUDANTE, PONTE], { encoding: "utf8" });
    assert.deepStrictEqual(JSON.parse(saida), [PONTE]);
  });

  it("as exceções do kb são módulos folha: não importam nada além de effect/*", () => {
    for (const caminho of EXCECOES_KB) {
      const imports = [
        ...NodeFS.readFileSync(caminho, "utf8").matchAll(/^\s*(?:import|export)\s[^;]*?\bfrom\s+"([^"]+)"/gm),
      ];
      assert.deepStrictEqual(
        imports.map(([, origem]) => origem).filter((origem) => !origem!.startsWith("effect/")),
        [],
        caminho,
      );
    }
  });
});
