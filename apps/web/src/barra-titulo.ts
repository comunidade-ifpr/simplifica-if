/**
 * A barra de título do desktop: a janela não tem a do sistema (`apps/desktop/src/janela.ts`), e o
 * cabeçalho verde faz as vezes dela. Ele vira região de arrastar (`.drag-region` no `index.css`) e
 * reserva o lugar dos botões do sistema: os semáforos à esquerda no macOS (menos em tela cheia, quando
 * somem), o overlay à direita no Windows e no Linux. No navegador, nada muda.
 */
import { useEffect, useState } from "react";
import { ponteDesktop } from "./ponte-desktop.ts";

/** A altura da barra, em px; a mesma do `ALTURA_BARRA_TITULO` do desktop (o teste do desktop confere). */
export const ALTURA_BARRA_TITULO = 48;

/** Onde ficam os botões do sistema: `semaforos` (macOS, à esquerda) ou `overlay` (Windows e Linux, à direita). */
export type BotoesJanela = "semaforos" | "overlay";

export interface BarraTitulo {
  readonly botoes: BotoesJanela;
  readonly telaCheia: boolean;
}

/** A barra de título do desktop, ou `undefined` no navegador. */
export function useBarraTitulo(): BarraTitulo | undefined {
  const janela = ponteDesktop()?.janela;
  const [telaCheia, setTelaCheia] = useState(false);
  useEffect(() => {
    if (janela === undefined) return;
    let ativo = true;
    const parar = janela.aoMudarTelaCheia(setTelaCheia);
    void janela.telaCheia().then(
      (atual) => {
        if (ativo) setTelaCheia(atual);
      },
      () => undefined,
    );
    return () => {
      ativo = false;
      parar();
    };
  }, [janela]);
  if (janela === undefined) return undefined;
  return { botoes: janela.plataforma === "darwin" ? "semaforos" : "overlay", telaCheia };
}
