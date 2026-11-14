/**
 * O roteador (TanStack Router, rotas por arquivo em `src/routes/`; o `routeTree.gen.ts` sai do plugin
 * do Vite). Num arquivo local (`file:`), como o desktop pode carregar a interface, o histórico vai no
 * `#`, que não depende do servidor de arquivos.
 */
import { createBrowserHistory, createHashHistory, createRouter, type RouterHistory } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen.ts";

export function historicoPadrao(): RouterHistory {
  return window.location.protocol === "file:" ? createHashHistory() : createBrowserHistory();
}

export function criarRoteador(historico: RouterHistory = historicoPadrao()) {
  return createRouter({ routeTree, history: historico, defaultPreload: "intent", scrollRestoration: false });
}

export type Roteador = ReturnType<typeof criarRoteador>;

declare module "@tanstack/react-router" {
  interface Register {
    router: Roteador;
  }
}
