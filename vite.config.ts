/**
 * Configuração do Vite+ (`vp`): testes (vitest), formatação (oxfmt) e lint (oxlint), como no T3 Code.
 *
 * Os testes da raiz (`scripts/` e skills) rodam com `vp test run` aqui; os de cada pacote rodam no
 * diretório do pacote com `vp test run --config ../../vite.config.ts --dir .`, como no T3 e como os
 * testes rodavam antes do C0 (alguns dependem do diretório atual).
 */
import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

// `.claude/skills` é um symlink para `.agents/skills`: sem a exclusão, os testes das skills rodariam duas vezes.
const TEST_EXCLUDE = [
  "**/.repos/**",
  "**/.claude/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/dist-exe/**",
  "**/.{idea,git,cache,output,temp}/**",
];

/** `vp test run` na raiz do repositório: os pacotes têm a própria execução (`pnpm -r test`). */
const execucaoNaRaiz = process.cwd() === import.meta.dirname;

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    include: ["**/*.test.ts"],
    exclude: execucaoNaRaiz ? [...TEST_EXCLUDE, "packages/**"] : TEST_EXCLUDE,
    // Como no T3: no Node, os testes que percorrem a base inteira passam dos 5 s do prazo padrão.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    allowOnly: !process.env.CI,
    // Testes instáveis se corrigem, não se repetem.
    retry: 0,
  },
  fmt: {
    printWidth: 120,
    // Markdown, JSON e YAML da base são textos normativos ou saídas de geradores, e não se
    // reformatam. O Python fica com as ferramentas do Python.
    ignorePatterns: [
      "**/*.md",
      "**/*.json",
      "**/*.yaml",
      "**/*.yml",
      "**/*.py",
      "base-conhecimento/**",
      "dados/**",
      "avaliacao/**",
      "site/**",
      "tmp/**",
      "outputs/**",
      ".repos/**",
      ".claude/**",
      "node_modules",
      "pnpm-lock.yaml",
      "**/dist-exe/**",
      // módulos gerados com `--check` (como as instruções do MCP): o gerador é a fonte do formato
      "**/*.gerado.ts",
      ".agents/skills/*/assets/**",
      ".agents/skills/*/base-analise/**",
      ".agents/skills/*/config/**",
      ".agents/skills/*/prompts/**",
      ".agents/skills/*/output/**",
      ".agents/skills/*/references/**",
    ],
  },
  lint: {
    ignorePatterns: [
      ".repos/**",
      ".claude/**",
      "node_modules",
      "base-conhecimento/**",
      "dados/**",
      "avaliacao/**",
      "site/**",
      "tmp/**",
      "outputs/**",
      "**/dist-exe/**",
      ".agents/skills/*/assets/**",
      ".agents/skills/*/base-analise/**",
      ".agents/skills/*/output/**",
    ],
    plugins: ["eslint", "oxc", "unicorn", "typescript"],
    categories: {
      correctness: "warn",
      suspicious: "warn",
      perf: "warn",
    },
    // As regras do lint do T3 Code, sem as de React e sem as do plugin próprio (essas entram no C1).
    rules: {
      "oxc/no-accumulating-spread": "error",
      "eslint/no-control-regex": "off",
      "typescript/no-this-alias": "off",
      "unicorn/prefer-add-event-listener": "off",
      "unicorn/prefer-string-starts-ends-with": "off",
      "unicorn/prefer-set-has": "off",
      "unicorn/prefer-array-find": "off",
      "unicorn/no-new-array": "off",
      "unicorn/no-array-reverse": "off",
      "typescript/no-extraneous-class": "error",
      "eslint/no-empty-pattern": "error",
      "eslint/no-new": "error",
      "unicorn/no-useless-spread": "error",
      "eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "eslint/no-unsafe-optional-chaining": "error",
      "eslint/no-unneeded-ternary": "error",
      "unicorn/no-useless-fallback-in-spread": "error",
      "unicorn/require-module-specifiers": "error",
      "unicorn/no-array-sort": "off",
      "unicorn/consistent-function-scoping": "off",
      "oxc/no-map-spread": "off",
      "eslint/no-shadow": "off",
      "eslint/no-await-in-loop": "off",
      "eslint/no-underscore-dangle": "off",
      "typescript/consistent-return": "off",
      "typescript/no-base-to-string": "off",
      "typescript/no-duplicate-type-constituents": "off",
      "typescript/no-floating-promises": "off",
      "typescript/no-implied-eval": "off",
      "typescript/no-meaningless-void-operator": "off",
      "typescript/no-redundant-type-constituents": "off",
      "typescript/no-unnecessary-boolean-literal-compare": "off",
      "typescript/no-unnecessary-type-conversion": "off",
      "typescript/no-unnecessary-type-arguments": "off",
      "typescript/no-unnecessary-type-assertion": "off",
      "typescript/no-unnecessary-type-parameters": "off",
      "typescript/no-unsafe-type-assertion": "off",
      "typescript/await-thenable": "off",
      "typescript/require-array-sort-compare": "off",
      "typescript/restrict-template-expressions": "off",
      "typescript/unbound-method": "off",
    },
    options: {
      reportUnusedDisableDirectives: "error",
      typeAware: false,
      typeCheck: false,
    },
  },
});
