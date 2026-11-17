/**
 * A ponte com o desktop (`apps/desktop`), exposta pelo `preload` do Electron em `window.simplifica`.
 * No navegador ela não existe: a interface roda em desenvolvimento contra um `apps/server` iniciado à
 * mão (ver `conexao/origem.ts`).
 *
 * O contrato é o que o desktop implementa; mudar aqui pede mudar lá.
 */

/** Onde está o servidor local e com que token falar com ele. */
export interface CredenciaisServidor {
  /** `http://127.0.0.1:<porta>`, a base do `POST /ingresso` e do WebSocket `/rpc`. */
  readonly urlServidor: string;
  /** O token do processo pai; vai só no `Authorization` do `POST /ingresso`, nunca numa URL. */
  readonly token: string;
}

export interface PonteDesktop {
  /** As credenciais do servidor local que o desktop iniciou. Pode ser chamada de novo a cada reconexão. */
  conexao(): Promise<CredenciaisServidor>;
  /** Abre a URL no navegador do sistema (a página de login do provider, links externos). */
  abrirExterno?(url: string): Promise<void>;
  /** O seletor de pastas do sistema; `null` se a pessoa cancelou. */
  escolherPasta?(): Promise<string | null>;
  /** O seletor de arquivos do sistema, só `.docx`; `null` se a pessoa cancelou. */
  escolherDocx?(): Promise<string | null>;
  /** Abre no Word a cópia comentada de um `.docx` escolhido por `escolherDocx` (o desktop recusa outro arquivo). */
  abrirDocumento?(caminho: string): Promise<void>;
  /** Mostra a cópia comentada na pasta (mesma regra de `abrirDocumento`). */
  mostrarNaPasta?(caminho: string): Promise<void>;
  /**
   * O diálogo para anexar um documento à tarefa (só as `extensoes` de documento); o desktop libera o
   * arquivo no servidor, e `pasta.anexar` o copia para a pasta da tarefa. `null` se a pessoa cancelou.
   */
  escolherAnexo?(extensoes?: ReadonlyArray<string>): Promise<string | null>;
  /** Abre no programa padrão um documento da pasta de uma tarefa (o desktop recusa outro arquivo). */
  abrirArquivoTarefa?(caminho: string): Promise<void>;
  /** Mostra no Finder ou no Explorador um arquivo da pasta de uma tarefa. */
  mostrarArquivoTarefa?(caminho: string): Promise<void>;
  /** Reinicia o servidor local; a janela recarrega. A troca da base (M1.10) acontece na abertura dele. */
  reiniciarServidor?(): Promise<void>;
  /** O estado da atualização do app (`electron-updater`). */
  atualizacaoApp?(): Promise<EstadoAtualizacaoApp>;
  procurarAtualizacaoApp?(): Promise<EstadoAtualizacaoApp>;
  /** "Reiniciar para atualizar". */
  instalarAtualizacaoApp?(): Promise<void>;
  /** A janela sem a barra de título do sistema: o cabeçalho vira a barra (`barra-titulo.ts`). */
  janela?: JanelaDesktop;
}

/** O que a interface sabe da janela do desktop para desenhar a barra de título. */
export interface JanelaDesktop {
  /** `process.platform`: no `darwin`, os semáforos à esquerda; nos outros, os botões do sistema à direita. */
  readonly plataforma: string;
  telaCheia(): Promise<boolean>;
  /** Avisa ao entrar ou sair da tela cheia; devolve a função que para de avisar. */
  aoMudarTelaCheia(ouvinte: (telaCheia: boolean) => void): () => void;
}

/** O estado da atualização do app, como o desktop o informa (`apps/desktop/src/ponteDesktop.ts`). */
export interface EstadoAtualizacaoApp {
  readonly versao: string;
  /** `null`: ligada; senão, o motivo. */
  readonly desligada: string | null;
  readonly situacao: "parada" | "procurando" | "baixando" | "pronta" | "em-dia" | "erro";
  readonly nova: string | null;
  readonly progresso: number | null;
  readonly erro: string | null;
}

declare global {
  interface Window {
    simplifica?: PonteDesktop;
  }
}

/** A ponte, se a interface roda dentro do desktop. */
export function ponteDesktop(): PonteDesktop | undefined {
  return typeof window === "undefined" ? undefined : window.simplifica;
}

/**
 * Abre um link externo: no desktop, no navegador do sistema; no navegador, numa aba nova. Devolve
 * `false` se o navegador bloqueou a aba.
 */
export async function abrirExterno(url: string): Promise<boolean> {
  const ponte = ponteDesktop();
  if (ponte?.abrirExterno !== undefined) {
    await ponte.abrirExterno(url);
    return true;
  }
  return window.open(url, "_blank", "noopener,noreferrer") !== null;
}
