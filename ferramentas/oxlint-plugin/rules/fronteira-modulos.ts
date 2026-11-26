// @effect-diagnostics nodeBuiltinImport:off -- regra de lint, carregada pelo oxlint fora de qualquer runtime Effect
// Regra própria do simplifica-if (não vem do T3): a fronteira dos módulos do app, com a lista dos arquivos
// de composição em `../modulos.ts`.
//
// Confere toda forma de citar um arquivo por caminho: `import`, `export … from`, `import()` (com texto ou
// template sem expressão), `import X = require()`, `type X = import("…").Y`, `require()`,
// `require.resolve()`, `import.meta.resolve()`, `vi.mock()` e parentes, e `new URL("…", import.meta.url)`.
// O especificador montado em tempo de execução (template com expressão, variável) não se confere.

import { defineRule, type ESTree } from "@oxlint/plugins";
import * as NodePath from "node:path";

import { violacaoDeFronteira } from "../modulos.ts";

/** A raiz do repositório: o plugin mora em `ferramentas/oxlint-plugin/rules/`. */
const RAIZ = NodePath.resolve(import.meta.dirname, "../../..");

/** O caminho do arquivo relativo à raiz, com `/`. */
const relativo = (arquivo: string) =>
  (NodePath.isAbsolute(arquivo) ? NodePath.relative(RAIZ, arquivo) : arquivo).split(NodePath.sep).join("/");

/** Os métodos do `vi` que recebem um caminho de módulo. */
const METODOS_VI = new Set(["mock", "doMock", "unmock", "doUnmock", "importActual", "importMock"]);

const objeto = (node: unknown): node is Record<string, unknown> & { readonly type: string } =>
  typeof node === "object" && node !== null && "type" in node && typeof node.type === "string";

/** O texto de um literal de string, ou de um template sem expressão; `undefined` para o resto. */
const textoLiteral = (node: unknown): string | undefined => {
  if (!objeto(node)) return undefined;
  if (node.type === "Literal") return typeof node["value"] === "string" ? node["value"] : undefined;
  if (node.type === "TSLiteralType") return textoLiteral(node["literal"]);
  if (node.type !== "TemplateLiteral") return undefined;
  const expressoes = node["expressions"];
  const partes = node["quasis"];
  if (!Array.isArray(expressoes) || expressoes.length > 0 || !Array.isArray(partes)) return undefined;
  const valor: unknown = objeto(partes[0]) ? partes[0]["value"] : undefined;
  return typeof valor === "object" && valor !== null && "cooked" in valor && typeof valor.cooked === "string"
    ? valor.cooked
    : undefined;
};

const ehIdentificador = (node: unknown, nome: string) =>
  objeto(node) && node.type === "Identifier" && node["name"] === nome;

/** `import.meta`. */
const ehImportMeta = (node: unknown) =>
  objeto(node) &&
  node.type === "MetaProperty" &&
  ehIdentificador(node["meta"], "import") &&
  ehIdentificador(node["property"], "meta");

/** `objeto.propriedade`, sem computar (`a.b`, não `a[b]`). */
const membro = (node: unknown): { readonly objeto: unknown; readonly propriedade: string } | undefined => {
  if (!objeto(node) || node.type !== "MemberExpression" || node["computed"] === true) return undefined;
  const propriedade = node["property"];
  return objeto(propriedade) && propriedade.type === "Identifier" && typeof propriedade["name"] === "string"
    ? { objeto: node["object"], propriedade: propriedade["name"] }
    : undefined;
};

/** A chamada recebe um caminho de módulo no primeiro argumento? */
function chamadaDeCaminho(callee: unknown): boolean {
  if (ehIdentificador(callee, "require")) return true;
  const m = membro(callee);
  if (m === undefined) return false;
  if (ehIdentificador(m.objeto, "require")) return m.propriedade === "resolve";
  if (ehIdentificador(m.objeto, "vi")) return METODOS_VI.has(m.propriedade);
  return ehImportMeta(m.objeto) && m.propriedade === "resolve";
}

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Só os arquivos de composição importam de `modulos/`, cada um só do módulo da própria camada, e um módulo não importa de outro (docs/plans/tarefas.md).",
    },
  },
  create(context) {
    const arquivo = relativo(context.filename);
    const conferir = (node: ESTree.Node, fonte: unknown) => {
      const especificador = textoLiteral(fonte);
      if (especificador === undefined) return;
      const violacao = violacaoDeFronteira(arquivo, especificador);
      if (violacao !== undefined) context.report({ node, message: violacao });
    };
    return {
      ImportDeclaration(node) {
        conferir(node, node.source);
      },
      ExportNamedDeclaration(node) {
        if (node.source !== null) conferir(node, node.source);
      },
      ExportAllDeclaration(node) {
        conferir(node, node.source);
      },
      ImportExpression(node) {
        conferir(node, node.source);
      },
      TSImportType(node) {
        // `source` no ESTree do oxlint; `argument` (um `TSLiteralType`) no do typescript-eslint.
        conferir(node, "source" in node ? node.source : (node as unknown as Record<string, unknown>)["argument"]);
      },
      TSImportEqualsDeclaration(node) {
        if (node.moduleReference.type === "TSExternalModuleReference") conferir(node, node.moduleReference.expression);
      },
      CallExpression(node) {
        if (chamadaDeCaminho(node.callee)) conferir(node, node.arguments[0]);
      },
      NewExpression(node) {
        // `new URL(<caminho>, import.meta.url)`: o caminho de um arquivo ao lado deste.
        const base = membro(node.arguments[1]);
        if (
          ehIdentificador(node.callee, "URL") &&
          base !== undefined &&
          ehImportMeta(base.objeto) &&
          base.propriedade === "url"
        )
          conferir(node, node.arguments[0]);
      },
    };
  },
});
