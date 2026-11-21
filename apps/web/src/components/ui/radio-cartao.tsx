/**
 * Radios em cartão: uma escolha única em que cada opção tem título e, às vezes, uma descrição (o escopo
 * da IA, por exemplo). É um `radiogroup` (o `RadioGroup` do Base UI), com as setas trocando a opção.
 */
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import type * as React from "react";

import { cn } from "~/lib/utils";

export interface OpcaoRadioCartao<T extends string> {
  readonly valor: T;
  readonly titulo: React.ReactNode;
  readonly descricao?: React.ReactNode;
  readonly icone?: React.ReactNode;
}

export function RadioCartao<T extends string>({
  valor,
  opcoes,
  aoMudar,
  rotuloAria,
  className,
}: {
  readonly valor: T;
  readonly opcoes: ReadonlyArray<OpcaoRadioCartao<T>>;
  readonly aoMudar: (valor: T) => void;
  readonly rotuloAria: string;
  readonly className?: string;
}) {
  return (
    <RadioGroup<T> value={valor} onValueChange={aoMudar} aria-label={rotuloAria} className={cn("grid gap-2", className)}>
      {opcoes.map((opcao) => (
        <Radio.Root
          key={opcao.valor}
          value={opcao.valor}
          className={cn(
            "group flex cursor-pointer select-none items-start gap-3 rounded-xl border border-border bg-card p-3 text-left outline-none transition-colors",
            "hover:border-input focus-visible:ring-2 focus-visible:ring-ring data-disabled:pointer-events-none data-disabled:opacity-64",
            "data-checked:border-primary data-checked:bg-accent/40",
          )}
        >
          {/* O círculo do radio, desenhado: o `Radio.Root` do Base UI não é um input nativo. */}
          <span
            aria-hidden
            className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-input bg-background group-data-checked:border-primary"
          >
            <Radio.Indicator className="size-2 rounded-full bg-primary" />
          </span>
          {opcao.icone === undefined ? null : (
            <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-4">{opcao.icone}</span>
          )}
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-semibold text-body">{opcao.titulo}</span>
            {opcao.descricao === undefined ? null : (
              <span className="text-muted-foreground text-small">{opcao.descricao}</span>
            )}
          </span>
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
