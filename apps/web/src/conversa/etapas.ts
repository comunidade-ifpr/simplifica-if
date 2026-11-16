/**
 * O indicador de etapas da tarefa (M1.9): as etapas que o manifesto da skill declara e o que a skill
 * marcou com a ferramenta `etapa` do MCP `ifpr`, lido das chamadas na conversa (`FerramentaIniciada`
 * com `{ id, progresso? }`). Função pura.
 *
 * - As etapas antes da última marcada estão feitas (✓).
 * - A última marcada está em andamento (◐), com o progresso quando a skill o informa; quando o turno
 *   termina, ela fica feita se for a última etapa, e em andamento ("parou aqui") se não for.
 * - As outras, pendentes (○).
 */
import type { EtapaTarefa } from "@simplifica-if/contratos-app";
import type { Item } from "./estado.ts";

export interface MarcaEtapa {
  readonly id: string;
  readonly progresso?: { readonly feito: number; readonly total: number };
}

export type SituacaoEtapa = "feita" | "atual" | "pendente";

export interface EtapaVista {
  readonly id: string;
  readonly rotulo: string;
  readonly situacao: SituacaoEtapa;
  readonly progresso?: { readonly feito: number; readonly total: number };
}

/** A marca de etapa da entrada de uma chamada da ferramenta `etapa`; `undefined` se não for válida. */
export function marcaDaEntrada(entrada: unknown): MarcaEtapa | undefined {
  if (typeof entrada !== "object" || entrada === null) return undefined;
  const { id, progresso } = entrada as { id?: unknown; progresso?: unknown };
  if (typeof id !== "string" || id === "") return undefined;
  if (typeof progresso === "object" && progresso !== null) {
    const { feito, total } = progresso as { feito?: unknown; total?: unknown };
    if (typeof feito === "number" && typeof total === "number" && total > 0) {
      return { id, progresso: { feito: Math.min(Math.max(feito, 0), total), total } };
    }
  }
  return { id };
}

/** A ferramenta é a `etapa` do MCP `ifpr` (`ifpr.etapa`, `mcp__ifpr__etapa`, `etapa`). */
export const ehFerramentaEtapa = (nome: string): boolean =>
  nome.replace(/^mcp__[^_]+__/, "").replace(/^[\w-]+\./, "") === "etapa";

export function etapasVistas(
  declaradas: ReadonlyArray<EtapaTarefa>,
  itens: ReadonlyArray<Item>,
  emAndamento: boolean,
): ReadonlyArray<EtapaVista> {
  let atual = -1;
  let progresso: MarcaEtapa["progresso"];
  for (const item of itens) {
    if (item.tipo !== "ferramenta" || item.etapa === undefined) continue;
    const indice = declaradas.findIndex((etapa) => etapa.id === item.etapa!.id);
    if (indice < 0) continue;
    atual = indice;
    progresso = item.etapa.progresso;
  }
  const atualFeita = !emAndamento && atual === declaradas.length - 1;
  return declaradas.map((etapa, indice): EtapaVista => {
    const situacao: SituacaoEtapa =
      indice < atual || (indice === atual && atualFeita) ? "feita" : indice === atual ? "atual" : "pendente";
    return {
      id: etapa.id,
      rotulo: etapa.rotulo,
      situacao,
      ...(situacao === "atual" && progresso !== undefined ? { progresso } : {}),
    };
  });
}
