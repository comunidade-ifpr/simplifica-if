/**
 * O teclado na lista de pendências, igual na tela inteira (`Leitura.tsx`) e na coluna compacta
 * (`VistaCompacta.tsx`): ↑ e ↓ andam entre os cabeçalhos das linhas, e F marca a linha em foco como feita
 * (ou desfaz). Nada nos campos de texto. A dica (`DICA_TECLADO`) anuncia as teclas ao leitor de tela.
 */
import type { ListaPendencias } from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import type { KeyboardEvent } from "react";
import type { ControleRevisao } from "./ControleRevisao.ts";

export const DICA_TECLADO = "Seta para cima e para baixo andam entre as pendências; F marca a pendência como feita.";

export function teclasDaLista(
  evento: KeyboardEvent<HTMLUListElement>,
  lista: ListaPendencias,
  marcando: string | null,
  revisao: ControleRevisao,
): void {
  const alvo = evento.target as HTMLElement;
  const item = alvo.closest<HTMLElement>("li[data-chave]");
  if (item === null || alvo !== item.querySelector("button")) return;
  const botoes = [...evento.currentTarget.querySelectorAll<HTMLElement>("li[data-chave] > div > button")];
  const i = botoes.indexOf(alvo);
  if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
    evento.preventDefault();
    botoes[evento.key === "ArrowDown" ? Math.min(botoes.length - 1, i + 1) : Math.max(0, i - 1)]?.focus();
  } else if ((evento.key === "f" || evento.key === "F") && !evento.metaKey && !evento.ctrlKey && !evento.altKey) {
    evento.preventDefault();
    const viva = lista.pendencias.find((v) => v.chave === item.dataset.chave);
    if (viva !== undefined && marcando === null) {
      void revisao.marcar(viva.chave, viva.situacao === "resolvida" ? "aberta" : "resolvida");
    }
  }
}
