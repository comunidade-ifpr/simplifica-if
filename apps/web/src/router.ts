/**
 * O roteador (TanStack Router, rotas por arquivo em `src/routes/`; o `routeTree.gen.ts` sai do plugin
 * do Vite).
 */
import { createBrowserHistory, createRouter, type RouterHistory } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen.ts";

export function criarRoteador(historico: RouterHistory = createBrowserHistory()) {
  return createRouter({ routeTree, history: historico, defaultPreload: "intent", scrollRestoration: false });
}

export type Roteador = ReturnType<typeof criarRoteador>;

declare module "@tanstack/react-router" {
  interface Register {
    router: Roteador;
  }
}
