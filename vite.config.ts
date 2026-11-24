/**
 * Configuração do Vite+ (`vp`): testes (vitest), formatação (oxfmt) e lint (oxlint), como no T3 Code.
 *
 * Os testes da raiz (`scripts/`) rodam com `vp test run` aqui; os de cada pacote rodam no
 * diretório do pacote com `vp test run --config ../../vite.config.ts --dir .`, como no T3 e como os
 * testes rodavam antes do C0 (alguns dependem do diretório atual).
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

/** Código migrado no C3, sob as regras do plugin próprio (ver `lint.overrides`). */
const ARQUIVOS_C3 = ["scripts/**"];

/** `vp test run` na raiz do repositório: os pacotes e os apps têm a própria execução (`pnpm -r test`). */
const execucaoNaRaiz = process.cwd() === import.meta.dirname;

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    include: ["**/*.test.ts"],
    exclude: execucaoNaRaiz ? [...TEST_EXCLUDE, "packages/**", "apps/**"] : TEST_EXCLUDE,
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
    // reformatam.
    ignorePatterns: [
      "**/*.md",
      "**/*.json",
      "**/*.yaml",
      "**/*.yml",
      "base-conhecimento/**",
      "avaliacao/**",
      "tmp/**",
      "outputs/**",
      ".repos/**",
      ".claude/**",
      "node_modules",
      "pnpm-lock.yaml",
      "**/dist-exe/**",
      // módulos gerados com `--check` (como as instruções do MCP): o gerador é a fonte do formato
      "**/*.gerado.ts",
      // pacotes copiados do T3 Code (docs/upstream-t3.md): ficam como no upstream, formatados pelo T3
      "packages/effect-acp/**",
      "packages/effect-codex-app-server/**",
      "packages/motor/src/t3/**",
      "apps/server/src/t3/**",
      // a interface: os componentes copiados do T3 (formatados lá, em 100 colunas) e os gerados (rotas do
      // TanStack Router, build)
      "apps/web/src/components/ui/**",
      "apps/web/src/routeTree.gen.ts",
      "apps/web/dist/**",
      "apps/desktop/scripts/t3/**",
      // builds e bundles (o apps/web e o apps/desktop)
      "**/dist/**",
      ".agents/skills/*/assets/**",
      ".agents/skills/*/references/**",
    ],
  },
  lint: {
    ignorePatterns: [
      ".repos/**",
      ".claude/**",
      "node_modules",
      "base-conhecimento/**",
      "avaliacao/**",
      "tmp/**",
      "outputs/**",
      "**/dist-exe/**",
      // a interface: as rotas geradas pelo plugin do TanStack Router e o build
      "apps/web/src/routeTree.gen.ts",
      "apps/web/dist/**",
      ".agents/skills/*/assets/**",
      // pacotes copiados do T3 Code: o lint deles é o do upstream, com o plugin `t3code/*`
      "packages/effect-acp/**",
      "packages/effect-codex-app-server/**",
      "apps/desktop/scripts/t3/**",
      // builds e bundles (o apps/web e o apps/desktop)
      "**/dist/**",
    ],
    plugins: ["eslint", "oxc", "unicorn", "typescript"],
    // Plugin próprio, com as regras de Effect copiadas do plugin do T3 (`simplifica-if/<regra>`).
    jsPlugins: ["./ferramentas/oxlint-plugin/index.ts"],
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
    // As regras do plugin próprio valem onde o código já é Effect: `packages/kb` (C1), `packages/mcp`
    // (C2), o motor, o servidor local (`apps/server`) e os contratos do app e, desde o C3, `scripts/`,
    // as skills e o gabarito. As exceções reproduzem as do T3. A ordem importa: cada override
    // posterior sobrescreve o anterior para os arquivos em comum.
    overrides: [
      {
        files: [
          "packages/kb/**",
          "packages/mcp/**",
          "packages/motor/**",
          "packages/contratos-app/**",
          "packages/docx/**",
          "packages/ppc/**",
          "apps/server/**",
          "apps/web/**",
          ...ARQUIVOS_C3,
        ],
        rules: {
          "simplifica-if/namespace-node-imports": "error",
          "simplifica-if/no-global-process-runtime": "error",
          "simplifica-if/no-inline-schema-compile": "error",
          // Estas só agem em arquivos de teste (a própria regra confere o nome do arquivo).
          "simplifica-if/no-dom-test-environment": "error",
          "simplifica-if/no-frame-waits-in-browser-tests": "error",
          "simplifica-if/no-manual-effect-runtime-in-tests": "error",
          "simplifica-if/no-polling-loop-in-tests": "error",
          "simplifica-if/no-real-time-wait-in-tests": "error",
          // Aviso: 14 testes antigos registram casos num `for` (docs/internals/servicos-effect.md, "Testes").
          "simplifica-if/no-test-in-loop": "warn",
          "simplifica-if/no-wall-clock-in-tests": "error",
          "simplifica-if/prefer-catch-tags": "error",
          "simplifica-if/prefer-effect-fn": "error",
          "simplifica-if/require-suppression-reason": "error",
        },
      },
      {
        // Como no T3: testes e utilitários de teste montam programas inline, sem `Effect.fn`.
        files: ["**/*.test.ts", "**/{test,tests,testes,fixtures}/**"],
        rules: { "simplifica-if/prefer-effect-fn": "off" },
      },
      {
        // Pontos de entrada (a CLI `kb` e os scripts do pacote) leem o processo do Node diretamente,
        // como `scripts/npm-launcher/**` no T3; o resto do pacote recebe o que precisar por injeção.
        files: [
          "packages/kb/scripts/**",
          "packages/mcp/src/cli.ts",
          "packages/mcp/src/kb.ts",
          "packages/mcp/scripts/**",
          // O harness do motor e o teste com providers reais passam o ambiente do processo aos drivers.
          "packages/motor/scripts/**",
          "packages/motor/test/real.test.ts",
          // O servidor local: os pontos de entrada e o teste com provider real.
          "apps/server/src/bin.ts",
          "apps/server/src/cli.ts",
          "apps/server/test/real.test.ts",
          "apps/server/test/ciclo-real.test.ts",
          "apps/server/test/skills-real.test.ts",
          // A interface: a configuração do Vite e o servidor de teste rodam no Node e leem o processo.
          "apps/web/vite.config.ts",
          "apps/web/test/servidor-teste.ts",
          // Como no T3: HostProcess é o ponto que lê o processo e entrega por Context.Reference.
          "packages/motor/src/t3/HostProcess.ts",
        ],
        rules: { "simplifica-if/no-global-process-runtime": "off" },
      },
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
          "react-in-jsx-scope": "off",
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
