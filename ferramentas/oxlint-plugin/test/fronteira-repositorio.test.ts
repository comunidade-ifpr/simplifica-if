// @effect-diagnostics nodeBuiltinImport:off -- teste: lê os arquivos do repositório pelo node:fs
/**
 * O critério de desacoplamento dos módulos (`docs/plans/tarefas.md`), no repositório inteiro: fora de
 * `modulos/<nome>/` e dos arquivos de composição (`../modulos.ts`), nenhum arquivo `.ts`, `.tsx`, `.mts`,
 * `.cts`, `.js`, `.mjs` ou `.cjs` cita um módulo por caminho, e nenhum módulo cita outro. É a mesma
 * conferência da regra `fronteira-modulos`, sobre todos os arquivos, inclusive os que o lint ignora; falha
 * com a lista das violações. Também confere que os arquivos de composição existem.
 *
 * Varre os arquivos da raiz e as pastas de código (`apps/`, `packages/`, `scripts/`, `ferramentas/`),
 * inclusive o código copiado do T3 (`t3/`). Fica de fora:
 *
 * - o que não é do repositório ou é gerado: `node_modules`, `dist*`, `.repos`, `.git`, `tmp`, `outputs`;
 * - as pastas de dados (`base-conhecimento/`, `catalogo/`, `curadoria/`, `avaliacao/`, `docs/`): não têm
 *   código, o que o último teste confere;
 * - os testes da regra (`FIXTURES`), cujos casos são imports de `modulos/` dentro de textos.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";

import { ARQUIVOS_DE_COMPOSICAO, PASTAS_QUE_IMPORTAM, violacaoDeFronteira } from "../modulos.ts";

const RAIZ = NodePath.resolve(import.meta.dirname, "../../..");
const PASTAS = ["apps", "packages", "scripts", "ferramentas"];
const PASTAS_DE_DADOS = ["base-conhecimento", "catalogo", "curadoria", "avaliacao", "docs"];
const FORA = new Set(["node_modules", "dist", "dist-exe", ".repos", ".git", "tmp", "outputs"]);
const FIXTURES = new Set(["ferramentas/oxlint-plugin/rules/fronteira-modulos.test.ts"]);
const EXTENSOES = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;

/** Um caminho literal: entre aspas, ou num template sem expressão. */
const LITERAL = String.raw`(?:"([^"\n]*)"|'([^'\n]*)'|` + "`([^`$\\n]*)`)";
/**
 * As formas de citar um arquivo por caminho, as mesmas da regra: `from "x"` (import, export e
 * `import type`), `import "x"`, `import("x")` (também em tipo), `require("x")` (também em
 * `import X = require`), `require.resolve`, `import.meta.resolve`, `vi.mock` e parentes, e
 * `new URL("x", import.meta.url)`.
 */
const FORMAS = [
  String.raw`\bfrom\s*${LITERAL}`,
  String.raw`\bimport\s*\(?\s*${LITERAL}`,
  String.raw`\brequire(?:\.resolve)?\s*\(\s*${LITERAL}`,
  String.raw`\bimport\.meta\.resolve\s*\(\s*${LITERAL}`,
  String.raw`\bvi\.(?:mock|doMock|unmock|doUnmock|importActual|importMock)\s*\(\s*${LITERAL}`,
  String.raw`\bnew\s+URL\s*\(\s*${LITERAL}\s*,\s*import\.meta\.url\b`,
].map((forma) => new RegExp(forma, "g"));

/** Os caminhos que um texto cita, nas formas de `FORMAS`. */
const caminhosCitados = (texto: string): ReadonlyArray<string> =>
  FORMAS.flatMap((forma) =>
    [...texto.matchAll(forma)].flatMap((achado) => {
      const caminho = achado[1] ?? achado[2] ?? achado[3];
      return caminho === undefined ? [] : [caminho];
    }),
  );

function arquivos(pasta: string): ReadonlyArray<string> {
  return NodeFS.readdirSync(pasta, { withFileTypes: true }).flatMap((entrada) => {
    if (FORA.has(entrada.name) || entrada.name.startsWith("dist")) return [];
    const caminho = NodePath.join(pasta, entrada.name);
    if (entrada.isDirectory()) return arquivos(caminho);
    return entrada.isFile() && EXTENSOES.test(entrada.name) ? [caminho] : [];
  });
}

const relativo = (caminho: string) => NodePath.relative(RAIZ, caminho).split(NodePath.sep).join("/");

describe("fronteira dos módulos no repositório", () => {
  it("a varredura acha as mesmas formas que a regra", () => {
    const texto = [
      `import a from "./a.ts";`,
      `export * from './b.ts';`,
      `import "./c.ts";`,
      `const d = import("./d.ts");`,
      "const e = import(`./e.ts`);",
      "const f = import(`./${x}.ts`);",
      `import G = require("./g.ts");`,
      `type H = import("./h.ts").H;`,
      `const i = require.resolve("./i.ts");`,
      `const j = import.meta.resolve("./j.ts");`,
      `vi.mock("./k.ts"); vi.importActual("./l.ts");`,
      `const m = new URL("./m.ts", import.meta.url);`,
      `const n = new URL("./n.ts", "https://exemplo.org/");`,
    ].join("\n");
    assert.deepStrictEqual([...caminhosCitados(texto)].sort(), [
      "./a.ts",
      "./b.ts",
      "./c.ts",
      "./d.ts",
      "./e.ts",
      "./g.ts",
      "./h.ts",
      "./i.ts",
      "./j.ts",
      "./k.ts",
      "./l.ts",
      "./m.ts",
    ]);
  });

  it("só os arquivos de composição citam um módulo, e um módulo não cita outro", () => {
    const daRaiz = NodeFS.readdirSync(RAIZ, { withFileTypes: true })
      .filter((entrada) => entrada.isFile() && EXTENSOES.test(entrada.name))
      .map((entrada) => NodePath.join(RAIZ, entrada.name));
    const todos = [...daRaiz, ...PASTAS.flatMap((pasta) => arquivos(NodePath.join(RAIZ, pasta)))];
    // A varredura passa pelo código copiado do T3 e pelos arquivos da raiz.
    assert.isTrue(todos.some((caminho) => relativo(caminho).includes("/t3/")));
    assert.isTrue(todos.some((caminho) => relativo(caminho) === "vite.config.ts"));
    const violacoes = todos.flatMap((caminho) => {
      const arquivo = relativo(caminho);
      if (FIXTURES.has(arquivo)) return [];
      return caminhosCitados(NodeFS.readFileSync(caminho, "utf8")).flatMap((especificador) => {
        const violacao = violacaoDeFronteira(arquivo, especificador);
        return violacao === undefined ? [] : [`${arquivo}: ${violacao}`];
      });
    });
    assert.deepStrictEqual(violacoes, []);
  });

  it("as pastas de dados não têm código", () => {
    const codigo = PASTAS_DE_DADOS.filter((pasta) => NodeFS.existsSync(NodePath.join(RAIZ, pasta))).flatMap((pasta) =>
      arquivos(NodePath.join(RAIZ, pasta)).map(relativo),
    );
    assert.deepStrictEqual(codigo, []);
  });

  it("os arquivos de composição existem", () => {
    assert.deepStrictEqual(
      [...ARQUIVOS_DE_COMPOSICAO, ...PASTAS_QUE_IMPORTAM].filter(
        (caminho) => !NodeFS.existsSync(NodePath.join(RAIZ, caminho)),
      ),
      [],
    );
  });
});
