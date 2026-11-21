/**
 * Uma linha de lista que abre e fecha: divisória de 1 px embaixo, sem cartão, e um chevron. O cabeçalho
 * inteiro é o botão (`aria-expanded`, `aria-controls`), então ele não deve ter outro controle dentro;
 * as ações ficam no conteúdo aberto. Quem usa decide quantas ficam abertas (a revisão abre uma por vez).
 */
import { ChevronDownIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "~/lib/utils";

export function LinhaExpansivel({
  id,
  aberta,
  aoAlternar,
  cabecalho,
  children,
  className,
}: {
  /** Prefixo dos ids do botão e da região; único na página. */
  readonly id: string;
  readonly aberta: boolean;
  readonly aoAlternar: () => void;
  readonly cabecalho: React.ReactNode;
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  const regiao = `${id}-conteudo`;
  return (
    <div className={cn("border-border border-b", className)} data-aberta={aberta ? "" : undefined}>
      <button
        type="button"
        id={`${id}-botao`}
        aria-expanded={aberta}
        aria-controls={regiao}
        onClick={aoAlternar}
        className="flex w-full cursor-pointer items-start gap-3 py-3 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <div className="min-w-0 flex-1">{cabecalho}</div>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "mt-1 size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
            aberta && "rotate-180",
          )}
        />
      </button>
      <div id={regiao} role="region" aria-labelledby={`${id}-botao`} hidden={!aberta} className="pb-4">
        {children}
      </div>
    </div>
  );
}
