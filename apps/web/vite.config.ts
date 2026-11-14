// @effect-diagnostics nodeBuiltinImport:off -- a configuração do Vite roda no Node, antes de qualquer runtime do Effect
/**
 * O Vite+ (`vp`) da interface, como o `apps/web/vite.config.ts` do T3: React, TanStack Router com rotas
 * por arquivo e Tailwind 4 no build e no `vp dev`; nos testes, dois projetos:
 *
 * - `unidade`: Node, `src/**\/*.test.ts` e `test/**\/*.test.ts` (a conexão e a conversa contra o
 *   `apps/server` com drivers de demonstração, o tratamento dos eventos);
 * - `navegador`: Chromium headless pelo Playwright (`@vitest/browser-playwright`, como o T3),
 *   `src/**\/*.browser.test.tsx`. O comando `iniciarServidorTeste` sobe o `test/servidor-teste.ts`
 *   num processo Node e devolve as credenciais; a interface fala com ele por RPC.
 *
 * O lint e a formatação são os da raiz (`vite.config.ts` do repositório).
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeReadline from "node:readline";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import { playwright } from "vite-plus/test/browser-playwright";
import { defineProject, type TestProjectInlineConfiguration } from "vite-plus/test/config";
import "vite-plus/test/config";

/** A porta do `vp dev`; o servidor local precisa aceitar esta origem (`--origem`). */
export const PORTA_DEV = 5190;

const SERVIDOR_TESTE = new URL("./test/servidor-teste.ts", import.meta.url).pathname;

/** A linha de partida do `test/servidor-teste.ts`. */
export interface ServidorTeste {
  readonly porta: number;
  readonly urlServidor: string;
  readonly token: string;
  /** Uma pasta de trabalho temporária, que existe. */
  readonly pasta: string;
}

/** Os servidores de teste abertos pelos testes de navegador, por origem do pedido. */
const servidores = new Set<NodeChildProcess.ChildProcess>();

/** Sobe o `apps/server` de teste aceitando `origem` e devolve a linha de partida dele. */
function iniciarServidorTeste(origem: string, atrasoLogin: number) {
  const processo = NodeChildProcess.spawn(
    process.execPath,
    [SERVIDOR_TESTE, "--origem", origem, "--atraso-login", String(atrasoLogin)],
    { stdio: ["pipe", "pipe", "inherit"] },
  );
  servidores.add(processo);
  processo.once("exit", () => servidores.delete(processo));
  return new Promise<ServidorTeste>((resolve, reject) => {
    const linhas = NodeReadline.createInterface({ input: processo.stdout! });
    linhas.once("line", (linha) => resolve(JSON.parse(linha)));
    processo.once("exit", (codigo) => reject(new Error(`o servidor de teste saiu com o código ${codigo}`)));
  });
}

const pararServidores = () => {
  for (const processo of servidores) processo.kill("SIGTERM");
};
process.once("exit", pararServidores);

const unidade = {
  extends: true,
  test: {
    name: "unidade",
    environment: "node",
    pool: "forks",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["src/**/*.browser.test.{ts,tsx}"],
  },
} satisfies TestProjectInlineConfiguration;

const navegador = {
  extends: true,
  // Como no T3: as dependências pré-empacotadas antes do primeiro teste, para o Vite não recarregar a página
  // no meio da execução quando descobre uma nova.
  optimizeDeps: {
    include: [
      "vite-plus/test/browser",
      "react",
      "react-dom/client",
      "@tanstack/react-router",
      "@base-ui/react/field",
      "@base-ui/react/input",
      "@base-ui/react/merge-props",
      "@base-ui/react/use-render",
      "class-variance-authority",
      "lucide-react",
      "react-markdown",
      "remark-gfm",
      "tailwind-merge",
    ],
  },
  test: {
    name: "navegador",
    include: ["src/**/*.browser.test.{ts,tsx}"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      screenshotFailures: false,
      commands: {
        iniciarServidorTeste: async ({ page }, atrasoLogin: number) =>
          iniciarServidorTeste(new URL(page.url()).origin, atrasoLogin),
        pararServidoresTeste: async () => pararServidores(),
      },
    },
  },
} satisfies TestProjectInlineConfiguration;

export default defineConfig({
  base: "./",
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true, generatedRouteTree: "./src/routeTree.gen.ts" }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    tsconfigPaths: true,
    dedupe: ["react", "react-dom"],
  },
  server: {
    host: "localhost",
    port: PORTA_DEV,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // `main.tsx` espera a conexão com `await` no topo do módulo.
    target: "es2022",
    sourcemap: true,
  },
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    allowOnly: !process.env.CI,
    retry: 0,
    projects: [defineProject(unidade), defineProject(navegador)],
  },
});
