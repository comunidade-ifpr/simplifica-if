/**
 * Radios em cartão: uma escolha única em que cada opção tem título e, às vezes, uma descrição (o escopo
 * da IA, por exemplo). É um `radiogroup` (o `RadioGroup` do Base UI), com as setas trocando a opção.
 * Sem descrição em nenhuma opção, cada uma é uma linha só: mais baixa, com o radio, o ícone e o título
 * centrados na mesma linha.
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
  const compacto = opcoes.every((opcao) => opcao.descricao === undefined);
  return (
    <RadioGroup<T>
      value={valor}
      onValueChange={aoMudar}
      aria-label={rotuloAria}
      className={cn("grid", compacto ? "gap-1.5" : "gap-2", className)}
    >
      {opcoes.map((opcao) => (
        <Radio.Root
          key={opcao.valor}
          value={opcao.valor}
          className={cn(
            "group flex cursor-pointer select-none border border-border bg-card text-left outline-none transition-colors",
            compacto ? "items-center gap-2.5 rounded-lg px-3 py-2" : "items-start gap-3 rounded-xl p-3",
            "hover:border-input focus-visible:ring-2 focus-visible:ring-ring data-disabled:pointer-events-none data-disabled:opacity-64",
            "data-checked:border-primary data-checked:bg-accent/40",
          )}
        >
          {/* O círculo do radio, desenhado: o `Radio.Root` do Base UI não é um input nativo. */}
          <span
            aria-hidden
            className={cn(
              "flex size-4 shrink-0 items-center justify-center rounded-full border border-input bg-background group-data-checked:border-primary",
              // com descrição, o radio acompanha a primeira linha (o título, de 26 px)
              compacto ? "" : "mt-[5px]",
            )}
          >
            <Radio.Indicator className="size-2 rounded-full bg-primary" />
          </span>
          {opcao.icone === undefined ? null : (
            <span className={cn("flex shrink-0 text-muted-foreground [&_svg]:size-4", compacto ? "" : "mt-[5px]")}>
              {opcao.icone}
            </span>
          )}
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className={compacto ? "font-medium text-small" : "font-semibold text-body"}>{opcao.titulo}</span>
            {opcao.descricao === undefined ? null : (
              <span className="text-muted-foreground text-small">{opcao.descricao}</span>
            )}
          </span>
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
