/**
 * O indicador de etapas da tarefa (M1.9): ✓ feita, ◐ em andamento (com a barra de progresso quando a
 * skill a informa), ○ pendente. As etapas vêm do manifesto da skill; o avanço, da ferramenta `etapa`
 * (`conversa/etapas.ts`).
 */
import { CheckIcon, CircleDashedIcon, CircleIcon } from "lucide-react";
import type { EtapaVista } from "../conversa/etapas.ts";
import { cn } from "../lib/utils.ts";

const SITUACOES = { feita: "feita", atual: "em andamento", pendente: "a fazer" } as const;

export function IndicadorEtapas({
  titulo,
  etapas,
}: {
  readonly titulo: string;
  readonly etapas: ReadonlyArray<EtapaVista>;
}) {
  return (
    <section aria-label={`Etapas: ${titulo}`} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
      <p className="mb-2 font-semibold">{titulo}</p>
      <ol className="flex flex-col gap-1.5">
        {etapas.map((etapa) => (
          <li
            key={etapa.id}
            className={cn(
              "flex flex-wrap items-center gap-2",
              etapa.situacao === "pendente" && "text-muted-foreground",
            )}
            aria-current={etapa.situacao === "atual" ? "step" : undefined}
          >
            <span className="flex size-4 items-center justify-center" aria-hidden>
              {etapa.situacao === "feita" ? (
                <CheckIcon className="size-4 text-success" />
              ) : etapa.situacao === "atual" ? (
                <CircleDashedIcon className="size-4 animate-[spin_3s_linear_infinite] text-primary" />
              ) : (
                <CircleIcon className="size-3.5" />
              )}
            </span>
            <span className={cn(etapa.situacao === "atual" && "font-medium")}>{etapa.rotulo}</span>
            <span className="sr-only">({SITUACOES[etapa.situacao]})</span>
            {etapa.progresso === undefined ? null : (
              <span className="flex items-center gap-2">
                <progress
                  className="h-1.5 w-28 overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary"
                  max={etapa.progresso.total}
                  value={etapa.progresso.feito}
                  aria-label={`${etapa.rotulo}: ${etapa.progresso.feito} de ${etapa.progresso.total}`}
                />
                <span className="text-muted-foreground text-xs">
                  {etapa.progresso.feito} de {etapa.progresso.total}
                </span>
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
