/**
 * A gravidade de uma pendência: glifo, cor e palavra juntos ("● Corrigir", "◐ Conferir"), nunca só a
 * cor. `GlifoGravidade` é só o glifo, para a coluna de temas.
 */
import { cn } from "~/lib/utils";
import type { Gravidade } from "./lista.ts";

const GLIFO: Readonly<Record<Gravidade, string>> = { corrigir: "●", conferir: "◐" };
const PALAVRA: Readonly<Record<Gravidade, string>> = { corrigir: "Corrigir", conferir: "Conferir" };
const COR: Readonly<Record<Gravidade, string>> = {
  corrigir: "text-grav-corrigir-texto",
  conferir: "text-grav-conferir-texto",
};

export function GlifoGravidade({
  gravidade,
  className,
}: {
  readonly gravidade: Gravidade;
  readonly className?: string | undefined;
}) {
  return (
    <span aria-hidden className={cn("inline-block w-4 shrink-0 text-center leading-none", COR[gravidade], className)}>
      {GLIFO[gravidade]}
    </span>
  );
}

export function IndicadorGravidade({
  gravidade,
  apagado = false,
}: {
  readonly gravidade: Gravidade;
  /** Feita ou retirada: a palavra fica, sem a cor. */
  readonly apagado?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 font-semibold text-small",
        apagado ? "text-muted-foreground" : COR[gravidade],
      )}
    >
      <GlifoGravidade gravidade={gravidade} className={apagado ? "text-muted-foreground" : undefined} />
      {PALAVRA[gravidade]}
    </span>
  );
}
