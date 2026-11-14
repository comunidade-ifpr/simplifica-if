/**
 * O contrato entre o preload e a interface: o que `window.simplifica` oferece no app desktop. No
 * navegador (o `apps/web` fora do Electron), `window.simplifica` não existe.
 *
 * O token só sai por `conexao()`, e só para a janela do app (o processo principal confere quem pede).
 */
export interface Conexao {
  /** `http://127.0.0.1:<porta>`: o `POST /ingresso` e o WebSocket `/rpc` ficam nela. */
  readonly urlServidor: string;
  /** O token do RPC desta execução do servidor; muda quando o servidor reinicia. */
  readonly token: string;
}

export interface PonteDesktop {
  /** A conexão com o servidor local; espera o servidor ficar pronto. */
  conexao(): Promise<Conexao>;
  /** Abre um link http(s) no navegador do sistema; outros esquemas são recusados. */
  abrirExterno?(url: string): Promise<void>;
  /** O diálogo de pasta do sistema; `null` se a pessoa cancelar. */
  escolherPasta?(): Promise<string | null>;
}

/** O nome em `window`. */
export const NOME_PONTE = "simplifica";

/** Os canais do IPC entre o preload e o processo principal. */
export const CANAIS = {
  conexao: "simplifica:conexao",
  abrirExterno: "simplifica:abrir-externo",
  escolherPasta: "simplifica:escolher-pasta",
} as const;
