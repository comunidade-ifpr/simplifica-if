/**
 * A ponte com o desktop (`apps/desktop`), exposta pelo `preload` do Electron em `window.simplifica`.
 * No navegador ela não existe: a interface roda em desenvolvimento contra um `apps/server` iniciado à
 * mão (ver `conexao/origem.ts`).
 *
 * O contrato (`PonteDesktop`) é o de `@simplifica-if/contratos-app/ponte`, o mesmo que o preload
 * implementa.
 */
import type { PonteDesktop } from "@simplifica-if/contratos-app/ponte";

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
  if (ponte !== undefined) {
    await ponte.abrirExterno(url);
    return true;
  }
  return window.open(url, "_blank", "noopener,noreferrer") !== null;
}
