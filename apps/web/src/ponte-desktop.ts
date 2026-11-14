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
