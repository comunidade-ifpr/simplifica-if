/**
 * Acompanhamento da rolagem (scroll-spy) do leitor: mede qual destino do índice já passou do alto da área
 * de rolagem e mantém o item marcado visível na barra lateral. Usado pelo sumário das normas (`Sumario.tsx`)
 * e pelo índice de seções dos PPCs (`IndiceSecoes.tsx`).
 */
import { useEffect, useRef, useState } from "react";
import type { InstanciaLeitor } from "./instancia.ts";
import type { Destino } from "./sumario.ts";

/** A distância do topo da área de rolagem até onde um item passa a ser "o em leitura". */
const MARGEM_DE_LEITURA = 96;

/** O elemento que rola o texto: o ancestral mais próximo com rolagem vertical. */
function areaDeRolagem(elemento: Element): Element | null {
  for (let pai = elemento.parentElement; pai !== null; pai = pai.parentElement) {
    if (/^(auto|scroll)$/.test(getComputedStyle(pai).overflowY)) return pai;
  }
  return null;
}

/** A área rolável dentro do `<aside>` da lateral, sem nunca alcançar a rolagem do texto. */
function rolagemDaLateral(elemento: Element): Element | null {
  const aside = elemento.closest("aside");
  if (aside === null) return null;
  for (let pai = elemento.parentElement; pai !== null; pai = pai.parentElement) {
    if (/^(auto|scroll)$/.test(getComputedStyle(pai).overflowY)) return pai;
    if (pai === aside) break;
  }
  return null;
}

/**
 * O destino em leitura: o último cujo começo já passou do alto da área de rolagem. `null` antes do
 * primeiro. Mede de novo quando o texto rola e quando um bloco se monta.
 */
export function useEmLeitura(destinos: ReadonlyArray<Destino>, ligado: boolean, instancia: InstanciaLeitor) {
  const nav = useRef<HTMLElement>(null);
  const [ativo, setAtivo] = useState<number | null>(null);
  useEffect(() => {
    const texto = nav.current?.closest("article")?.querySelector<HTMLElement>(".documento-leitor");
    if (!ligado || texto == null || destinos.length === 0) return;
    let quadro = 0;
    const medir = () => {
      quadro = 0;
      const limite = (areaDeRolagem(texto)?.getBoundingClientRect().top ?? 0) + MARGEM_DE_LEITURA;
      const blocos = [...texto.querySelectorAll<HTMLElement>(":scope > [data-linha]")];
      const blocoDa = (linha: number) => blocos.findLast((bloco) => Number(bloco.dataset["linha"]) <= linha);
      let atual: number | null = null;
      destinos.forEach((destino, i) => {
        const elemento =
          texto.querySelector(`[id="${CSS.escape(instancia.id(destino.id))}"]`) ?? blocoDa(destino.linha);
        if (elemento != null && elemento.getBoundingClientRect().top <= limite) atual = i;
      });
      setAtivo(atual);
    };
    const agendar = () => {
      if (quadro === 0) quadro = requestAnimationFrame(medir);
    };
    // a rolagem não borbulha: a captura no documento vê a de qualquer área
    document.addEventListener("scroll", agendar, { capture: true, passive: true });
    const blocos = new MutationObserver(agendar);
    blocos.observe(texto, { childList: true });
    agendar();
    return () => {
      document.removeEventListener("scroll", agendar, { capture: true });
      blocos.disconnect();
      cancelAnimationFrame(quadro);
    };
  }, [destinos, ligado, instancia]);

  // O item marcado sempre à vista na lateral, sem mexer na rolagem do texto.
  useEffect(() => {
    if (ativo === null || nav.current === null) return;
    const marcado = nav.current.querySelector<HTMLElement>("[aria-current]");
    const lateral = rolagemDaLateral(nav.current);
    if (marcado == null || lateral == null || lateral.scrollHeight <= lateral.clientHeight) return;
    const item = marcado.getBoundingClientRect();
    const area = lateral.getBoundingClientRect();
    if (item.top < area.top) lateral.scrollTop -= area.top - item.top + 8;
    else if (item.bottom > area.bottom) lateral.scrollTop += item.bottom - area.bottom + 8;
  }, [ativo]);

  return { nav, ativo };
}
