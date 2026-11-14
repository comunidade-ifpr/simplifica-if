// Copiado de `oxlint-plugin-t3code/rules/prefer-catch-tags.ts` do T3 Code (commit a6d91409729be6ba854b3f16adedc08847e3b24c).
// Copyright (c) 2026 T3 Tools Inc. Licença MIT; texto integral em `ferramentas/oxlint-plugin/LICENSE-T3`.
// Lógica sem alterações. As mensagens e descrições da regra continuam em inglês, como vieram do T3.

import { defineRule, type ESTree } from "@oxlint/plugins";

const MESSAGE = "Catch known tags with `Effect.catchTags({ Tag: handler })`, even for one tag.";

export default defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Require `Effect.catchTags` over `Effect.catchTag`.",
    },
  },
  create(context) {
    const isEffectNamespace = (identifier: ESTree.IdentifierReference) => {
      let scope = context.sourceCode.getScope(identifier);
      while (true) {
        const variable = scope.set.get(identifier.name);
        if (variable !== undefined) {
          return variable.defs.some(
            (def) =>
              def.type === "ImportBinding" &&
              def.node.type === "ImportNamespaceSpecifier" &&
              def.parent?.type === "ImportDeclaration" &&
              def.parent.source.value === "effect/Effect",
          );
        }
        if (scope.upper === null) return false;
        scope = scope.upper;
      }
    };

    return {
      ImportDeclaration(node) {
        if (node.source.value !== "effect/Effect") return;
        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            (specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value) ===
              "catchTag"
          ) {
            context.report({ node: specifier, message: MESSAGE });
          }
        }
      },
      MemberExpression(node) {
        if (
          !node.computed &&
          node.object.type === "Identifier" &&
          node.property.type === "Identifier" &&
          node.property.name === "catchTag" &&
          isEffectNamespace(node.object)
        ) {
          context.report({ node, message: MESSAGE });
        }
      },
    };
  },
});
