/**
 * A rolagem lembrada por documento (`docs/plans/multitarefa.md`, "Continuidade"): ao sair de um documento
 * (ou da revisão) e voltar, a rolagem volta onde estava. O roteador não restaura rolagem
 * (`scrollRestoration: false`, `router.ts`); cada rolagem guarda a sua, pela chave do documento, só na
 * memória desta janela.
 *
 * O texto chega aos poucos (a carga, os blocos do leitor que se montam), e o trecho pedido rola sozinho:
 * enquanto a pessoa não mexe (roda, toque, clique, tecla, em qualquer lugar da janela: o botão voltar, a
 * busca, um link da conversa) e o link aberto não muda, a rolagem lembrada se reaplica a cada vez que o
 * conteúdo muda de tamanho. O link com `#` (um dispositivo, um trecho) só volta à rolagem lembrada se é o
 * mesmo link de quando ela foi guardada; outro alvo no mesmo documento vai ao alvo.
 */
import { useLayoutEffect, useRef } from "react";

interface Lembrada {
  readonly link: string | undefined;
  readonly topo: number;
}

/** Quantas rolagens ficam lembradas (as mais antigas saem). */
const MAXIMO = 100;
const lembradas = new Map<string, Lembrada>();
/** As rolagens montadas agora: a que foi esquecida não se lembra ao desmontar. */
const montadas = new Set<{ readonly chave: string; esquecida: boolean }>();

function lembrar(chave: string, lembrada: Lembrada): void {
  lembradas.delete(chave);
  lembradas.set(chave, lembrada);
  if (lembradas.size > MAXIMO) lembradas.delete(lembradas.keys().next().value!);
}

/** Esquece as rolagens de um documento que deixou de existir (a revisão apagada), também as montadas. */
export function esquecerRolagens(descartar: (chave: string) => boolean): void {
  for (const chave of lembradas.keys()) if (descartar(chave)) lembradas.delete(chave);
  for (const montada of montadas) if (descartar(montada.chave)) montada.esquecida = true;
}

const INTERACOES = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/**
 * Lembra a rolagem de `elemento` sob `chave` (`undefined`: não lembra). `link` é o link aberto (com o `#`);
 * com `topo`, o documento sem rolagem lembrada nem alvo começa do topo (a rolagem é de várias páginas).
 */
export function useRolagemLembrada(
  chave: string | undefined,
  elemento: () => HTMLElement | null | undefined,
  opcoes: { readonly link?: string | undefined; readonly topo?: boolean } = {},
): void {
  const link = useRef(opcoes.link);
  const acharElemento = useRef(elemento);
  const pararRestauracao = useRef<(() => void) | undefined>(undefined);
  const topo = opcoes.topo === true;
  // Antes do efeito de baixo: as limpezas rodam antes de todo efeito, e a dele ainda vê o link de antes.
  useLayoutEffect(() => {
    // Outro link (outro alvo no mesmo documento) vai ao alvo, não à rolagem lembrada.
    if (link.current !== opcoes.link) pararRestauracao.current?.();
    link.current = opcoes.link;
    acharElemento.current = elemento;
  });

  useLayoutEffect(() => {
    const el = acharElemento.current();
    if (chave === undefined || el == null) return;
    const montada = { chave, esquecida: false };
    montadas.add(montada);
    const guardada = lembradas.get(chave);
    const aberto = link.current;
    const alvo = aberto?.includes("#") === true;
    const voltar = guardada !== undefined && (!alvo || guardada.link === aberto) ? guardada.topo : undefined;
    // No topo não há o que reaplicar (e o `StrictMode`, que monta duas vezes, lembra o topo da primeira).
    let restaurando = voltar !== undefined && voltar > 0;
    if (voltar !== undefined) el.scrollTop = voltar;
    else if (topo && !alvo) el.scrollTop = 0;
    let ultimo = el.scrollTop;
    const aoRolar = () => {
      if (!restaurando) ultimo = el.scrollTop;
    };
    el.addEventListener("scroll", aoRolar, { passive: true });

    let pararDeReaplicar = () => {};
    if (restaurando && voltar !== undefined) {
      const reaplicar = () => {
        el.scrollTop = voltar;
        ultimo = el.scrollTop;
      };
      const tamanhos = new ResizeObserver(reaplicar);
      const observarFilhos = () => {
        tamanhos.disconnect();
        for (const filho of el.children) tamanhos.observe(filho);
      };
      observarFilhos();
      const filhos = new MutationObserver(() => {
        observarFilhos();
        reaplicar();
      });
      filhos.observe(el, { childList: true });
      const mexeu = () => pararDeReaplicar();
      for (const evento of INTERACOES) document.addEventListener(evento, mexeu, { capture: true, passive: true });
      pararDeReaplicar = () => {
        restaurando = false;
        ultimo = el.scrollTop;
        tamanhos.disconnect();
        filhos.disconnect();
        for (const evento of INTERACOES) document.removeEventListener(evento, mexeu, { capture: true });
        pararDeReaplicar = () => {};
      };
    }
    pararRestauracao.current = () => pararDeReaplicar();
    return () => {
      const lembrada = restaurando && voltar !== undefined ? voltar : ultimo;
      pararDeReaplicar();
      el.removeEventListener("scroll", aoRolar);
      montadas.delete(montada);
      if (!montada.esquecida) lembrar(chave, { link: link.current, topo: lembrada });
    };
  }, [chave, topo]);
}
