/**
 * Popover (o do Base UI): um botão que abre um painel ancorado nele, com foco preso enquanto aberto e Esc
 * para fechar. É o único lugar, com os menus e a caixa de pedido, em que vai sombra.
 */
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "~/lib/utils";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverClose = PopoverPrimitive.Close;
const PopoverTitle = PopoverPrimitive.Title;
const PopoverDescription = PopoverPrimitive.Description;

function PopoverContent({
  className,
  children,
  align = "end",
  side = "bottom",
  sideOffset = 6,
  ...props
}: PopoverPrimitive.Popup.Props & {
  align?: PopoverPrimitive.Positioner.Props["align"];
  side?: PopoverPrimitive.Positioner.Props["side"];
  sideOffset?: PopoverPrimitive.Positioner.Props["sideOffset"];
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner align={align} side={side} sideOffset={sideOffset} className="z-[130]">
        <PopoverPrimitive.Popup
          // O arrasto da janela do Electron ignora o z-index; sem isto, a barra de título engole os cliques.
          className={cn(
            "max-h-(--available-height) w-80 max-w-(--available-width) origin-(--transform-origin) overflow-y-auto rounded-xl border border-border bg-popover p-4 text-body text-popover-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] outline-none [-webkit-app-region:no-drag] dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]",
            className,
          )}
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent, PopoverClose, PopoverTitle, PopoverDescription };
