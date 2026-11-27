/** A revisão de PPC corrente, que vive no `ContextoApp` para sobreviver à navegação entre telas. */
import { useEffect, useSyncExternalStore } from "react";
import { useApp } from "../../contexto.tsx";
import { pedidoDaRevisao } from "./conversa.ts";
import type { ControleRevisao, EstadoRevisao } from "./ControleRevisao.ts";
import { idDaLinha, type PrefixoLinha } from "./lista.ts";

export function useRevisao(): readonly [EstadoRevisao, ControleRevisao] {
  const { revisao } = useApp();
  return [useSyncExternalStore(revisao.observar, revisao.obter), revisao] as const;
}

/**
 * A revisão à vista (a tela inteira ou a coluna ao lado do Word): ⌘J leva o PPC e a pendência aberta à
 * conversa ao lado, e a volta à janela confere o arquivo acompanhado (na pasta do OneDrive ou de rede, o
 * vigia do servidor pode não ver o salvamento).
 */
export function useRevisaoNaTela(): void {
  const app = useApp();
  const { revisao } = app;
  useEffect(
    () => app.painel.declararContexto(() => pedidoDaRevisao(app, revisao.obter().aberta) ?? {}),
    [app, revisao],
  );
  useEffect(() => {
    const aoFocar = () => revisao.conferirAoFocar();
    window.addEventListener("focus", aoFocar);
    return () => window.removeEventListener("focus", aoFocar);
  }, [revisao]);
}

/**
 * "Ir à pendência" na lista à vista: quando a pendência de `focar` está na tela (a linha dela, de id
 * `idDaLinha(chave, prefixo)`), rola até ela e foca o botão dela; achando ou não, o pedido se cumpre.
 */
export function useFocoNaPendencia(prefixo: PrefixoLinha): void {
  const [estado, revisao] = useRevisao();
  const focar = estado.focar;
  useEffect(() => {
    if (focar === null) return;
    const botao = document.getElementById(`${idDaLinha(focar, prefixo)}-botao`);
    botao?.scrollIntoView({ block: "center" });
    botao?.focus({ preventScroll: true });
    revisao.focou();
  }, [focar, prefixo, revisao]);
}
