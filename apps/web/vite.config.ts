// @effect-diagnostics nodeBuiltinImport:off -- a configuração do Vite roda no Node, antes de qualquer runtime do Effect
/**
 * O Vite+ (`vp`) da interface, como o `apps/web/vite.config.ts` do T3: React, TanStack Router com rotas
 * por arquivo e Tailwind 4 no build e no `vp dev`. Os testes daqui são os de navegador
 * (`src/**\/*.browser.test.tsx`), no Chromium headless pelo Playwright (`@vitest/browser-playwright`,
 * como o T3): o comando `iniciarServidorTeste` sobe o `test/servidor-teste.ts` num processo Node e
 * devolve as credenciais; a interface fala com ele por RPC. Os de Node (`src/**\/*.test.ts`,
 * `test/**\/*.test.ts`) são o projeto `web` do `pnpm test` da raiz.
 *
 * O lint e a formatação são os da raiz (`vite.config.ts` do repositório).
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import type * as NodeNet from "node:net";
import * as NodePath from "node:path";
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
  /** Um PPC sintético em DOCX, dentro de `pasta`. */
  readonly ppc: string;
  /** O mesmo PPC corrigido, em `pasta/salvo/`, para simular o salvamento no Word (`salvarNoWord`). */
  readonly ppcSalvo: string;
  /** Um documento em Markdown, dentro de `pasta`, para anexar às tarefas. */
  readonly parecer: string;
  /** A raiz das pastas de tarefa (no app, Documentos/Simplifica IF). */
  readonly pastaTrabalhos: string;
  /** Com `claudeAusente`, o arquivo que faz o Claude Code "aparecer" (`simularInstalacaoClaude`). */
  readonly sinalClaude: string;
}

/** Os servidores de teste abertos pelos testes de navegador, por origem do pedido. */
const servidores = new Set<NodeChildProcess.ChildProcess>();

/** Como o servidor de teste começa (`test/servidor-teste.ts`). */
export interface OpcoesServidorTeste {
  /** Quanto o login simulado fica em `aguardando`, em ms. */
  readonly atrasoLogin?: number;
  /** O primeiro uso (boas-vindas, aviso) por fazer; sem a opção, já feito. */
  readonly primeiroUso?: boolean;
  /** O Claude Code ausente até o teste simular a instalação (`simularInstalacaoClaude`). */
  readonly claudeAusente?: boolean;
  /** O repositório da curadoria (`dono/repo`) para "Isto está errado" (M1.12); sem ele, `null`. */
  readonly curadoria?: string;
  /** No lugar das tarefas do checkout, as de teste do `servidor-teste.ts` (link, módulo e duas de conversa). */
  readonly tarefasDeTeste?: boolean;
}

/** Sobe o `apps/server` de teste aceitando `origem` e devolve a linha de partida dele. */
function iniciarServidorTeste(origem: string, opcoes: OpcoesServidorTeste) {
  const processo = NodeChildProcess.spawn(
    process.execPath,
    [
      SERVIDOR_TESTE,
      "--origem",
      origem,
      "--atraso-login",
      String(opcoes.atrasoLogin ?? 1500),
      ...(opcoes.primeiroUso === true ? ["--primeiro-uso"] : []),
      ...(opcoes.claudeAusente === true ? ["--claude-ausente"] : []),
      ...(opcoes.curadoria === undefined ? [] : ["--curadoria", opcoes.curadoria]),
      ...(opcoes.tarefasDeTeste === true ? ["--tarefas-de-teste"] : []),
    ],
    { stdio: ["pipe", "pipe", "inherit"] },
  );
  servidores.add(processo);
  processo.once("exit", () => servidores.delete(processo));
  // Os servidores não seguram o processo dos testes: no fim, ele sai e os para (`pararServidores`).
  processo.unref();
  for (const fluxo of [processo.stdin, processo.stdout]) (fluxo as NodeNet.Socket | null)?.unref();
  return new Promise<ServidorTeste>((resolve, reject) => {
    const linhas = NodeReadline.createInterface({ input: processo.stdout! });
    linhas.once("line", (linha) => resolve(JSON.parse(linha)));
    processo.once("exit", (codigo) => reject(new Error(`o servidor de teste saiu com o código ${codigo}`)));
  });
}

// Os servidores de teste saem só aqui, com o processo dos testes. Os arquivos de navegador rodam em
// paralelo, cada um com o seu servidor: nenhum teste para servidores, porque pararia os dos outros arquivos
// no meio (não há comando para isso).
const pararServidores = () => {
  for (const processo of servidores) processo.kill("SIGTERM");
};
process.once("exit", pararServidores);

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
      "@base-ui/react/alert-dialog",
      "@base-ui/react/field",
      "@base-ui/react/input",
      "@base-ui/react/menu",
      "@base-ui/react/merge-props",
      "@base-ui/react/popover",
      "@base-ui/react/radio",
      "@base-ui/react/radio-group",
      "@base-ui/react/select",
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
        iniciarServidorTeste: async ({ page }, opcoes: OpcoesServidorTeste) =>
          iniciarServidorTeste(new URL(page.url()).origin, opcoes),
        /** A pessoa instalou o Claude Code e entrou na conta (o sinal do servidor de teste). */
        simularInstalacaoClaude: async (_contexto, sinal: string) => {
          if (!sinal.endsWith(`${NodePath.sep}claude-instalado`)) throw new Error(`não é o sinal do Claude: ${sinal}`);
          NodeFS.writeFileSync(sinal, "");
        },
        /**
         * Simula o Word salvando o arquivo acompanhado da revisão: o PPC corrigido do servidor de teste por
         * cima da cópia comentada (só a cópia, numa pasta temporária dos testes).
         */
        salvarNoWord: async (_contexto, de: string, para: string) => {
          if (!/[\\/]simplifica-web-pasta-[^\\/]+[\\/]salvo[\\/]PPC de teste\.docx$/.test(de))
            throw new Error(`não é o PPC corrigido do servidor de teste: ${de}`);
          if (
            !/[\\/]simplifica-web-pasta-[^\\/]+[\\/][^\\/]+ - revisão prévia \(Simplifica IF\)[^\\/]*\.docx$/.test(para)
          )
            throw new Error(`não é uma cópia comentada dos testes: ${para}`);
          NodeFS.copyFileSync(de, para);
        },
        /** Simula a pessoa editando no Word um arquivo de uma pasta de tarefa (só dentro de "Simplifica IF/"). */
        editarArquivoDeTarefa: async (_contexto, caminho: string, texto: string) => {
          if (!/[\\/]Simplifica IF[\\/][^\\/]+[\\/]/.test(caminho) || caminho.includes(".."))
            throw new Error(`fora das pastas de tarefa: ${caminho}`);
          NodeFS.writeFileSync(caminho, texto);
        },
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
    // Os pacotes de terceiros do bundle, que o build do desktop junta no `LICENCAS.md` do instalador
    // (`apps/desktop/scripts/licencas.ts`, `LICENCAS_WEB`).
    license: { fileName: ".vite/licencas.json" },
  },
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    allowOnly: !process.env.CI,
    retry: 0,
    projects: [defineProject(navegador)],
  },
});
