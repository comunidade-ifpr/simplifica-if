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
  /**
   * Reinicia o servidor local (novo token e nova porta; a janela recarrega). A atualização da base usa
   * para trocar o arquivo: a troca só acontece na abertura do servidor (M1.10).
   */
  reiniciarServidor?(): Promise<void>;
  /** O estado da atualização do app (`electron-updater`). */
  atualizacaoApp?(): Promise<EstadoAtualizacaoApp>;
  /** Procura uma versão nova do app agora. */
  procurarAtualizacaoApp?(): Promise<EstadoAtualizacaoApp>;
  /** "Reiniciar para atualizar": fecha o app e instala a versão baixada. */
  instalarAtualizacaoApp?(): Promise<void>;
}

/** O estado da atualização do app, como a seção "Atualizações" mostra. */
export interface EstadoAtualizacaoApp {
  readonly versao: string;
  /** `null`: ligada; senão, o motivo (sem assinatura de código, sem feed, desenvolvimento). */
  readonly desligada: string | null;
  readonly situacao: "parada" | "procurando" | "baixando" | "pronta" | "em-dia" | "erro";
  /** A versão nova, baixando ou pronta para instalar. */
  readonly nova: string | null;
  readonly progresso: number | null;
  readonly erro: string | null;
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
  reiniciarServidor: "simplifica:reiniciar-servidor",
  atualizacaoApp: "simplifica:atualizacao-app",
  procurarAtualizacaoApp: "simplifica:procurar-atualizacao-app",
  instalarAtualizacaoApp: "simplifica:instalar-atualizacao-app",
  escolherAnexo: "simplifica:escolher-anexo",
  abrirArquivoTarefa: "simplifica:abrir-arquivo-tarefa",
  mostrarArquivoTarefa: "simplifica:mostrar-arquivo-tarefa",
} as const;
