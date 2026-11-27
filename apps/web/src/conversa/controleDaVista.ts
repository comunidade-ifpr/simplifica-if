/**
 * O controle da conversa que a `VistaConversa` mostra, para os itens dela (a aprovação), e o que quem
 * põe a vista faz com a conversa que continua esta com outra IA (o cartão do limite).
 */
import type { Continuacao } from "@simplifica-if/contratos-app";
import { createContext, use } from "react";
import type { ControleConversa } from "./ControleConversa.ts";

export const ContextoControle = createContext<ControleConversa | null>(null);

/** O controle da conversa da vista em que o item está. */
export function useControleDaVista(): ControleConversa {
  const controle = use(ContextoControle);
  if (controle === null) throw new Error("useControleDaVista fora da VistaConversa");
  return controle;
}

/** A conversa nova que continua a da vista, com a caixa que ela traz: quem põe a vista a abre. */
export type AoContinuar = (nova: { readonly sessao: string; readonly continuacao: Continuacao | undefined }) => void;

export const ContextoContinuar = createContext<AoContinuar | null>(null);

export function useAoContinuar(): AoContinuar {
  const aoContinuar = use(ContextoContinuar);
  if (aoContinuar === null) throw new Error("useAoContinuar fora da VistaConversa");
  return aoContinuar;
}
