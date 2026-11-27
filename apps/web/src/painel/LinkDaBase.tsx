/**
 * Um link para a página de um documento da base (`/explorar/ver?link=ifpr://…`), como as linhas do
 * Explorar: o clique passa por `abrirLink` (no Explorar, a tela; ⌥-clique ou Alt+clique, o painel ao
 * lado). Continua um `<a>` com endereço, para o leitor de tela e o foco. `semDica` tira a dica do
 * ⌥-clique de quem já tem um cartão próprio ao passar o mouse (os pontos da linha do tempo).
 */
import { Link } from "@tanstack/react-router";
import type { ComponentProps, MouseEvent } from "react";
import { CLIQUE_OUTRO_LUGAR } from "../lib/teclado.ts";
import { ondeDoClique, useAbrirLink } from "./abrirLink.ts";

export function LinkDaBase({
  link,
  semDica = false,
  ...props
}: { readonly link: string; readonly semDica?: boolean } & Pick<
  ComponentProps<"a">,
  "className" | "children" | "tabIndex" | "aria-label" | "onMouseEnter" | "onFocus"
>) {
  const abrirLink = useAbrirLink();
  return (
    <Link
      to="/explorar/ver"
      search={{ link }}
      title={semDica ? undefined : `${CLIQUE_OUTRO_LUGAR} abre ao lado`}
      {...props}
      onClick={(evento: MouseEvent<HTMLAnchorElement>) => {
        // ⌘, Ctrl e Shift ficam com o navegador (no desktop, o pedido de janela nova do Chromium vira uma
        // janela do app), salvo ⇧⌘ (Ctrl+Shift), a janela nova no desktop; o Alt, que baixaria o link, abre
        // no outro lugar.
        const onde = ondeDoClique(evento);
        if (evento.button !== 0 || (onde !== "janela" && (evento.metaKey || evento.ctrlKey || evento.shiftKey))) return;
        evento.preventDefault();
        abrirLink(link, onde);
      }}
    />
  );
}
