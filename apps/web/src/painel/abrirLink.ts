/**
 * Onde um link `ifpr://` abre (`docs/plans/multitarefa.md`, "Onde um link abre"): numa tela de trabalho
 * (a revisão, a conversa), o clique e o ↵ da paleta abrem no painel, e a tela fica; no Início e no
 * Explorar, abrem na tela (`/explorar/ver`), porque lá não há o que manter. ⌥-clique (Alt+clique) e ⇧↵
 * abrem no outro lugar. As reuniões do Consepe não têm link `ifpr://` e continuam abrindo na tela delas.
 *
 * No modo compacto da janela, só o painel cabe na coluna: todo link abre nele, também o ⌥-clique. O botão
 * que pede a tela ("Abrir em tela cheia") ainda a abre, e o modo compacto desliga antes (`__root.tsx`).
 *
 * A rota de uma atividade (a bandeja, o aviso do sistema) que é a conversa da aba Conversar abre no painel
 * (`useAbrirRota`).
 *
 * No desktop, ⇧⌘-clique (Ctrl+Shift+clique) abre o documento numa janela nova (`janela`, "Várias
 * janelas"); sem o desktop, a opção não existe, e o clique vale como o comum.
 */
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import { useApp } from "../contexto.tsx";
import { ponteDesktop } from "../ponte-desktop.ts";

/**
 * `padrao`, o lugar da tela em que se está; `outro`, o contrário (⌥-clique, ⇧↵); `painel` e `tela`, um
 * lugar dito pelo próprio botão ("Abrir ao lado", "Abrir em tela cheia"); `janela`, uma janela nova do app
 * (⇧⌘-clique, só no desktop).
 */
export type OndeAbrir = "padrao" | "outro" | "painel" | "tela" | "janela";

/** Quem abre links: um chip, uma citação, uma relação do leitor. */
export type AoAbrirLink = (link: string, onde?: OndeAbrir) => void;

/** O clique que pede uma janela nova: ⇧⌘ (Ctrl+Shift), sem Alt. */
export const cliqueDeJanela = (evento: {
  readonly altKey: boolean;
  readonly shiftKey?: boolean;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
}): boolean => evento.shiftKey === true && (evento.metaKey === true || evento.ctrlKey === true) && !evento.altKey;

/**
 * O lugar pedido pelo clique: com ⇧⌘ (Ctrl+Shift), no desktop, uma janela nova; com Alt (⌥ no macOS), o
 * outro. Sem o desktop, o ⇧⌘-clique é o clique comum.
 */
export const ondeDoClique = (evento: {
  readonly altKey: boolean;
  readonly shiftKey?: boolean;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
}): OndeAbrir =>
  cliqueDeJanela(evento) && ponteDesktop() !== undefined ? "janela" : evento.altKey ? "outro" : "padrao";

/**
 * Abre a rota do app (`/conversa?id=…`, o `href` do roteador) numa janela nova; devolve `false` sem o
 * desktop, em que a opção não existe.
 */
export function abrirEmNovaJanela(rota: string): boolean {
  const ponte = ponteDesktop();
  if (ponte === undefined) return false;
  void ponte.janela.abrirJanela(rota).catch(() => undefined);
  return true;
}

/** A função única que abre um link no painel ou na tela. */
export function useAbrirLink(): AoAbrirLink {
  const { painel, janela } = useApp();
  const navegar = useNavigate();
  const roteador = useRouter();
  return useCallback(
    (link: string, onde: OndeAbrir = "padrao") => {
      if (onde === "janela") {
        if (abrirEmNovaJanela(roteador.buildLocation({ to: "/explorar/ver", search: { link } }).href)) return;
        onde = "padrao";
      }
      const aoLado =
        onde === "painel" ||
        (onde !== "tela" && (janela.obter().ligada || (onde === "padrao") === painel.emTelaDeTrabalho()));
      if (aoLado) painel.abrirLink(link);
      else void navegar({ to: "/explorar/ver", search: { link } });
    },
    [painel, janela, navegar, roteador],
  );
}

/**
 * Abre a rota de uma atividade (a bandeja, o aviso do sistema): a conversa que está na aba Conversar abre no
 * painel, sem tirar a pessoa da tela (nem do modo compacto); as outras rotas, na tela. A rota é opaca para o
 * servidor; quem a lê aqui é o núcleo da interface, que conhece o painel.
 */
export function useAbrirRota(): (rota: string) => void {
  const { painel } = useApp();
  const navegar = useNavigate();
  const roteador = useRouter();
  return useCallback(
    (rota: string) => {
      const url = new URL(rota, "http://app");
      const id = url.pathname === "/conversa" ? url.searchParams.get("id") : null;
      const conversa = painel.obter().conversa;
      const aqui = roteador.state.location;
      const naTelaCheia = aqui.pathname === "/conversa" && (aqui.search as { readonly id?: unknown }).id === id;
      if (id !== null && conversa.id === id && conversa.apagada !== true && !naTelaCheia) painel.mostrar("conversar");
      else void navegar({ href: rota });
    },
    [painel, navegar, roteador],
  );
}
