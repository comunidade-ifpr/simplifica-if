/**
 * A aparência da janela: sem a barra de título do sistema, a barra verde da interface (o cabeçalho do
 * `apps/web`, `routes/__root.tsx`) faz as vezes dela. No macOS, os semáforos ficam dentro da barra, à
 * esquerda, centralizados na altura dela; no Windows e no Linux, os botões do sistema vêm por cima da
 * barra (`titleBarOverlay`), à direita, com a mesma altura.
 *
 * Funções puras, sem o `electron`, para os testes; o `main.ts` aplica.
 */

/** A altura da barra verde, em px. A interface usa a mesma (`ALTURA_BARRA_TITULO` em `apps/web`). */
export const ALTURA_BARRA_TITULO = 48;

/** O raio dos semáforos do macOS: a posição é a do canto de cima do botão. */
const RAIO_SEMAFORO = 7;

/**
 * A cor do overlay no Windows e no Linux: transparente, para a barra verde aparecer por baixo. O alfa
 * `01` porque `#00000000` não funciona no Linux (nota do T3).
 */
const COR_OVERLAY = "#01000000";

/** Os símbolos dos botões do sistema: brancos sobre o verde, no tema claro e no escuro. */
const COR_SIMBOLOS = "#ffffff";

/** O `--background` do `apps/web/src/index.css`, claro e escuro. */
const FUNDO_CLARO = "#fafafa";
const FUNDO_ESCURO = "#121412";

export interface OpcoesBarraTitulo {
  readonly titleBarStyle: "hiddenInset" | "hidden";
  readonly trafficLightPosition?: { readonly x: number; readonly y: number };
  readonly titleBarOverlay?: { readonly color: string; readonly symbolColor: string; readonly height: number };
}

// T3: apps/desktop/src/window/DesktopWindow.ts (getWindowTitleBarOptions) — macOS com `hiddenInset` e
// os semáforos no meio da barra; Windows e Linux com `hidden` e o overlay da altura da barra.
export function opcoesBarraTitulo(plataforma: NodeJS.Platform): OpcoesBarraTitulo {
  if (plataforma === "darwin") {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: ALTURA_BARRA_TITULO / 2 - RAIO_SEMAFORO },
    };
  }
  return {
    titleBarStyle: "hidden",
    titleBarOverlay: { color: COR_OVERLAY, symbolColor: COR_SIMBOLOS, height: ALTURA_BARRA_TITULO },
  };
}

/** O fundo da janela antes de a interface pintar, conforme o tema do sistema: não pisca branco no escuro. */
export function corFundoJanela(escuro: boolean): string {
  return escuro ? FUNDO_ESCURO : FUNDO_CLARO;
}
