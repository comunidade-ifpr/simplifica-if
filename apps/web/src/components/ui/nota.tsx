/**
 * A nota recolhida: as ressalvas de uma tela num lugar só ("Sobre esta revisão"), fechadas por padrão.
 * É um `<details>`, então abre pelo teclado e o leitor de tela anuncia aberta ou fechada.
 */
import { ChevronRightIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "~/lib/utils";

export function Nota({
  titulo,
  children,
  aberta,
  className,
}: {
  readonly titulo: React.ReactNode;
  readonly children: React.ReactNode;
  /** Aberta ao montar; depois, a pessoa abre e fecha. */
  readonly aberta?: boolean;
  readonly className?: string;
}) {
  return (
    <details open={aberta} className={cn("group text-muted-foreground text-small", className)}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm font-semibold outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon aria-hidden className="size-4 shrink-0 transition-transform group-open:rotate-90" />
        {titulo}
      </summary>
      <div className="mt-2 flex max-w-[68ch] flex-col gap-2 pl-5">{children}</div>
    </details>
  );
}
