/**
 * Monta o que o app precisa antes da primeira tela: a conexão com o servidor (pela origem da página), a
 * `Api` e a conversa.
 */
import * as ManagedRuntime from "effect/ManagedRuntime";
import { criarApi } from "./conexao/api.ts";
import * as Conexao from "./conexao/Conexao.ts";
import type { OrigemConexao } from "./conexao/origem.ts";
import type { ContextoApp } from "./contexto.tsx";
import { ControleConversa } from "./conversa/ControleConversa.ts";

export interface AppIniciado {
  readonly contexto: ContextoApp;
  /** Fecha a conexão (o socket e o laço de reconexão). */
  readonly encerrar: () => Promise<void>;
}

export async function inicializar(origem: OrigemConexao, opcoes?: Conexao.OpcoesConexao): Promise<AppIniciado> {
  const runtime = ManagedRuntime.make(Conexao.layerGlobal(origem, opcoes));
  const api = await criarApi(runtime);
  return { contexto: { api, conversa: new ControleConversa(api) }, encerrar: () => runtime.dispose() };
}
