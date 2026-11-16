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
  /** O diálogo de arquivo do sistema, só `.docx`; `null` se a pessoa cancelar. */
  escolherDocx?(): Promise<string | null>;
  /**
   * Abre no programa padrão (o Word) a cópia comentada de um `.docx` escolhido por `escolherDocx`;
   * outro arquivo é recusado.
   */
  abrirDocumento?(caminho: string): Promise<void>;
  /** Mostra a cópia comentada na pasta (Finder, Explorador); mesma regra de `abrirDocumento`. */
  mostrarNaPasta?(caminho: string): Promise<void>;
  /**
   * O diálogo de arquivo para anexar à tarefa (M1.9), filtrado por `extensoes` (só documentos; ver
   * `EXTENSOES_DOCUMENTO`); o processo principal libera o arquivo escolhido no servidor, que o copia
   * para a pasta da tarefa. `null` se a pessoa cancelar.
   */
  escolherAnexo?(extensoes?: ReadonlyArray<string>): Promise<string | null>;
  /** Abre no programa padrão um documento da pasta de uma tarefa (`Documentos/Simplifica IF/<tarefa>/`). */
  abrirArquivoTarefa?(caminho: string): Promise<void>;
  /** Mostra no Finder ou no Explorador um arquivo da pasta de uma tarefa. */
  mostrarArquivoTarefa?(caminho: string): Promise<void>;
}

/** O nome em `window`. */
export const NOME_PONTE = "simplifica";

/** Os canais do IPC entre o preload e o processo principal. */
export const CANAIS = {
  conexao: "simplifica:conexao",
  abrirExterno: "simplifica:abrir-externo",
  escolherPasta: "simplifica:escolher-pasta",
  escolherDocx: "simplifica:escolher-docx",
  abrirDocumento: "simplifica:abrir-documento",
  mostrarNaPasta: "simplifica:mostrar-na-pasta",
  escolherAnexo: "simplifica:escolher-anexo",
  abrirArquivoTarefa: "simplifica:abrir-arquivo-tarefa",
  mostrarArquivoTarefa: "simplifica:mostrar-arquivo-tarefa",
} as const;
