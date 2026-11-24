/**
 * O que as telas recebem do app: a `Api` (a conexão com o servidor), a conversa corrente e a
 * revisão de PPC corrente.
 */
import { createContext, type ReactNode, use, useSyncExternalStore } from "react";
import type { Api } from "./conexao/api.ts";
import type { EstadoConexao } from "./conexao/Conexao.ts";
import type { ControleConversa } from "./conversa/ControleConversa.ts";
import type { EstadoConversa } from "./conversa/estado.ts";
import type { ControleRevisao, EstadoRevisao } from "./revisao/ControleRevisao.ts";

export interface ContextoApp {
  readonly api: Api;
  readonly conversa: ControleConversa;
  readonly revisao: ControleRevisao;
}

const Contexto = createContext<ContextoApp | null>(null);

export function ProvedorApp({ valor, children }: { readonly valor: ContextoApp; readonly children: ReactNode }) {
  return <Contexto value={valor}>{children}</Contexto>;
}

export function useApp(): ContextoApp {
  const valor = use(Contexto);
  if (valor === null) throw new Error("useApp fora do ProvedorApp");
  return valor;
}

export function useApi(): Api {
  return useApp().api;
}

export function useEstadoConexao(): EstadoConexao {
  const { estado } = useApi();
  return useSyncExternalStore(estado.observar, estado.obter);
}

export function useConversa(): readonly [EstadoConversa, ControleConversa] {
  const { conversa } = useApp();
  return [useSyncExternalStore(conversa.observar, conversa.obter), conversa] as const;
}

export function useRevisao(): readonly [EstadoRevisao, ControleRevisao] {
  const { revisao } = useApp();
  return [useSyncExternalStore(revisao.observar, revisao.obter), revisao] as const;
}
