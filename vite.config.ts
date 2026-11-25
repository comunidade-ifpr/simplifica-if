/**
 * Configuração do Vite+ (`vp`): testes (vitest), formatação (oxfmt) e lint (oxlint), como no T3 Code.
 *
 * Na raiz do repositório, `pnpm test` roda todos os projetos Node num único processo Vitest
 * (`test.projects`) e `pnpm test:base` roda o projeto `base` (testes sobre a base completa).
 * Nos pacotes individuais, `pnpm --filter <pacote> test` continua herdando a configuração base.
 */
import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

// `.claude/` tem o symlink `.claude/skills` e os worktrees dos agentes: fora dos testes.
const TEST_EXCLUDE = [
  "**/.repos/**",
  "**/.claude/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/dist-exe/**",
  "**/.{idea,git,cache,output,temp}/**",
];

/** Testes que percorrem ou compilam a `base-conhecimento/` inteira; rodam em `pnpm test:base`. */
const TESTES_BASE = [
  "packages/ppc/test/precisao-base.test.ts",
  "packages/ppc/test/identificacao-medicao.test.ts",
  "packages/ppc/test/revisao-ia-conversa-base.test.ts",
  "packages/kb/src/db/base.test.ts",
  "packages/kb/src/ppcs/secoes-base.test.ts",
  "packages/kb/src/avaliacao/resolvedor.test.ts",
  "apps/server/test/revisao-ppc-base.test.ts",
];

/** Caminhos ignorados tanto na formatação quanto no lint (dados, builds e código verbatim do T3). */
const IGNORAR_COMUM = [
  ".repos/**",
  ".claude/**",
  "node_modules",
  "base-conhecimento/**",
  "avaliacao/**",
  "tmp/**",
  "outputs/**",
  "**/dist-exe/**",
  "**/dist/**",
  "apps/web/src/routeTree.gen.ts",
  // pacotes copiados do T3 Code (docs/upstream-t3.md): ficam como no upstream
  "packages/effect-acp/**",
  "packages/effect-codex-app-server/**",
  "apps/desktop/scripts/t3/**",
];

const TEST_BASE = {
  environment: "node" as const,
  pool: "threads" as const,
  // No Node, alguns testes de integração/base passam dos 5 s do prazo padrão.
  testTimeout: 60_000,
  hookTimeout: 60_000,
  allowOnly: !process.env.CI,
  // Testes instáveis se corrigem, não se repetem.
  retry: 0,
};

/** `vp test run` na raiz do repositório: orquestra todos os projetos Node num único processo. */
const execucaoNaRaiz = process.cwd() === import.meta.dirname;

export default defineConfig({
  test: execucaoNaRaiz
    ? {
        ...TEST_BASE,
        projects: [
          {
            test: {
              ...TEST_BASE,
              name: "raiz",
              include: ["scripts/**/*.test.ts", "ferramentas/oxlint-plugin/**/*.test.ts"],
              exclude: TEST_EXCLUDE,
            },
          },
          {
            test: {
              ...TEST_BASE,
              name: "pacotes",
              include: [
                "packages/atualizacao/**/*.test.ts",
                "packages/contratos-app/**/*.test.ts",
                "packages/docx/**/*.test.ts",
                "packages/kb/**/*.test.ts",
                "packages/mcp/test/*.test.ts",
                "packages/motor/**/*.test.ts",
                "packages/pdf/**/*.test.ts",
                "apps/desktop/**/*.test.ts",
                "apps/server/**/*.test.ts",
              ],
              exclude: [...TEST_EXCLUDE, ...TESTES_BASE],
            },
          },
          {
            test: {
              ...TEST_BASE,
              name: "ppc",
              include: ["packages/ppc/test/**/*.test.ts"],
              exclude: [...TEST_EXCLUDE, ...TESTES_BASE],
              globalSetup: ["./packages/ppc/test/banco-fresco.ts"],
            },
          },
          {
            test: {
              ...TEST_BASE,
              name: "mcp-transversal",
              include: ["packages/mcp/test/transversal/*.test.ts"],
              exclude: TEST_EXCLUDE,
              globalSetup: ["./packages/mcp/test/transversal/preparar-bundle.ts"],
            },
          },
          {
            root: "apps/web",
            resolve: { tsconfigPaths: true },
            test: {
              ...TEST_BASE,
              name: "web",
              include: ["src/**/*.test.ts", "test/**/*.test.ts"],
              exclude: [...TEST_EXCLUDE, "src/**/*.browser.test.{ts,tsx}"],
            },
          },
          {
            test: {
              ...TEST_BASE,
              name: "base",
              include: TESTES_BASE,
              exclude: TEST_EXCLUDE,
              globalSetup: ["./packages/ppc/test/banco-fresco.ts"],
            },
          },
        ],
      }
    : {
        ...TEST_BASE,
        include: ["**/*.test.ts"],
        exclude: TEST_EXCLUDE,
      },
  fmt: {
    printWidth: 120,
    // Markdown, JSON e YAML da base são textos normativos ou saídas de geradores, e não se
    // reformatam.
    ignorePatterns: [
      ...IGNORAR_COMUM,
      "**/*.md",
      "**/*.json",
      "**/*.yaml",
      "**/*.yml",
      "pnpm-lock.yaml",
      // código copiado do T3 Code formatado no upstream (100 colunas)
      "packages/motor/src/t3/**",
      "apps/server/src/t3/**",
      "apps/web/src/components/ui/**",
    ],
  },
  lint: {
    ignorePatterns: IGNORAR_COMUM,
    plugins: ["eslint", "oxc", "unicorn", "typescript"],
    // Plugin próprio, com as regras de Effect copiadas do plugin do T3 (`simplifica-if/<regra>`).
    jsPlugins: ["./ferramentas/oxlint-plugin/index.ts"],
    categories: {
      correctness: "warn",
      suspicious: "warn",
      perf: "warn",
    },
    // As regras do lint do T3 Code (sem as de React, que entram no override do apps/web) e as do
    // plugin próprio (`simplifica-if/*`). As do T3 que dependem de tipos ficam de fora: com
    // `typeAware: false` não rodam.
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
      "simplifica-if/namespace-node-imports": "error",
      "simplifica-if/no-inline-schema-compile": "error",
      // Estas só agem em arquivos de teste (a própria regra confere o nome do arquivo).
      "simplifica-if/no-dom-test-environment": "error",
      "simplifica-if/no-frame-waits-in-browser-tests": "error",
      "simplifica-if/no-manual-effect-runtime-in-tests": "error",
      "simplifica-if/no-polling-loop-in-tests": "error",
      "simplifica-if/no-real-time-wait-in-tests": "error",
      "simplifica-if/no-wall-clock-in-tests": "error",
      "simplifica-if/prefer-catch-tags": "error",
      "simplifica-if/require-suppression-reason": "error",
    },
    overrides: [
      {
        // A interface (React): as regras de React do lint do T3 Code, que a raiz deixa de fora.
        files: ["apps/web/**/*.{ts,tsx}"],
        plugins: ["eslint", "oxc", "react", "unicorn", "typescript"],
        rules: {
          "react/no-object-type-as-default-prop": "off",
          "react/jsx-no-constructed-context-values": "off",
          "react/memo-dependencies": "error",
          "react/purity": "error",
          "react/refs": "error",
          "react/exhaustive-effect-dependencies": "error",
          "react/set-state-in-effect": "error",
          "react/immutability": "error",
          "react/no-array-index-key": "error",
          "react/no-unstable-nested-components": "error",
          "react/static-components": "error",
          "react/capitalized-calls": "error",
          "react-hooks/exhaustive-deps": "off",
        },
      },
    ],
    options: {
      reportUnusedDisableDirectives: "error",
      typeAware: false,
      typeCheck: false,
    },
  },
});
