/**
 * O app montado: o contexto (a `Api` e a conversa) em volta do roteador. O `main.tsx` o monta com a
 * conexão de verdade; os testes de navegador, com a conexão do servidor de teste e um histórico na
 * memória.
 */
import { RouterProvider } from "@tanstack/react-router";
import { type ContextoApp, ProvedorApp } from "./contexto.tsx";
import type { Roteador } from "./router.ts";

export function App({ contexto, roteador }: { readonly contexto: ContextoApp; readonly roteador: Roteador }) {
  return (
    <ProvedorApp valor={contexto}>
      <RouterProvider router={roteador} />
    </ProvedorApp>
  );
}
