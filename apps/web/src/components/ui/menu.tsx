/**
 * Menu suspenso com grupos de escolha única (o `Menu` do Base UI): um botão que abre uma lista com um
 * ou mais grupos de opções marcáveis, cada grupo com seu valor. O `Select` desta pasta guarda um valor
 * só; este serve quando o mesmo botão reúne duas escolhas (o modelo e o raciocínio).
 */
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { CheckIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "~/lib/utils";

const Menu = MenuPrimitive.Root;
const MenuTrigger = MenuPrimitive.Trigger;
const MenuRadioGroup = MenuPrimitive.RadioGroup;
const MenuGroup = MenuPrimitive.Group;

function MenuPopup({
  className,
  children,
  align = "end",
  sideOffset = 4,
  ...props
}: MenuPrimitive.Popup.Props & {
  align?: MenuPrimitive.Positioner.Props["align"];
  sideOffset?: MenuPrimitive.Positioner.Props["sideOffset"];
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner align={align} sideOffset={sideOffset} className="z-[130] select-none">
        <MenuPrimitive.Popup
          // O arrasto da janela do Electron ignora o z-index; sem isto, a barra de título engole os cliques.
          className={cn(
            "max-h-(--available-height) min-w-56 origin-(--transform-origin) overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] outline-none [-webkit-app-region:no-drag] dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]",
            className,
          )}
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function MenuGroupLabel({ className, ...props }: MenuPrimitive.GroupLabel.Props) {
  return (
    <MenuPrimitive.GroupLabel
      className={cn("px-2 py-1.5 font-medium text-muted-foreground text-xs", className)}
      {...props}
    />
  );
}

/** Uma opção do grupo: a marca de escolhida, o nome e, à direita, uma observação curta. */
function MenuRadioItem({
  className,
  children,
  dica,
  ...props
}: MenuPrimitive.RadioItem.Props & { readonly dica?: React.ReactNode }) {
  return (
    <MenuPrimitive.RadioItem
      className={cn(
        "flex min-h-8 cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-base outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground sm:min-h-7 sm:text-sm",
        className,
      )}
      {...props}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        <MenuPrimitive.RadioItemIndicator>
          <CheckIcon aria-hidden className="size-4" />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      <span className="min-w-0 flex-1">{children}</span>
      {dica === undefined ? null : <span className="text-muted-foreground text-xs">{dica}</span>}
    </MenuPrimitive.RadioItem>
  );
}

function MenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return <MenuPrimitive.Separator className={cn("mx-1 my-1 h-px bg-border", className)} {...props} />;
}

export { Menu, MenuTrigger, MenuPopup, MenuGroup, MenuGroupLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator };
