/**
 * Controle segmentado: uma escolha única entre poucas opções (modo, filtro), no lugar de uma fileira de
 * botões. É um `radiogroup` (o `RadioGroup` do Base UI): as setas trocam a opção, e Tab entra e sai do
 * grupo de uma vez.
 */
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import type * as React from "react";

import { cn } from "~/lib/utils";

export interface OpcaoSegmented<T extends string> {
  readonly valor: T;
  readonly rotulo: React.ReactNode;
  readonly icone?: React.ReactNode;
}

export function Segmented<T extends string>({
  valor,
  opcoes,
  aoMudar,
  rotuloAria,
  className,
}: {
  readonly valor: T;
  readonly opcoes: ReadonlyArray<OpcaoSegmented<T>>;
  readonly aoMudar: (valor: T) => void;
  readonly rotuloAria: string;
  readonly className?: string;
}) {
  return (
    <RadioGroup<T>
      value={valor}
      onValueChange={aoMudar}
      aria-label={rotuloAria}
      className={cn("inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5", className)}
    >
      {opcoes.map((opcao) => (
        <Radio.Root
          key={opcao.valor}
          value={opcao.valor}
          className={cn(
            "inline-flex h-7 cursor-pointer select-none items-center gap-1.5 rounded-md px-3 font-medium text-muted-foreground text-small outline-none transition-colors",
            "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-disabled:pointer-events-none data-disabled:opacity-64",
            "data-checked:bg-background data-checked:text-foreground data-checked:ring-1 data-checked:ring-border",
            "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
          )}
        >
          {opcao.icone}
          {opcao.rotulo}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
