/** A revisão de PPC corrente, que vive no `ContextoApp` para sobreviver à navegação entre telas. */
import { useSyncExternalStore } from "react";
import { useApp } from "../../contexto.tsx";
import type { ControleRevisao, EstadoRevisao } from "./ControleRevisao.ts";

export function useRevisao(): readonly [EstadoRevisao, ControleRevisao] {
  const { revisao } = useApp();
  return [useSyncExternalStore(revisao.observar, revisao.obter), revisao] as const;
}
