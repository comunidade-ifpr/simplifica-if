// Copiado do T3 Code (MIT, Copyright (c) 2026 T3 Tools Inc.): apps/web/src/components/ui/separator.tsx,
// commit a6d9140972. Registro e adaptações em docs/upstream-t3.md; licença em LICENSE-T3 nesta pasta.
import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";

import { cn } from "~/lib/utils";

function Separator({ className, orientation = "horizontal", ...props }: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      className={cn(
        "shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:not-[[class^='h-']]:not-[[class*='_h-']]:self-stretch",
        className,
      )}
      data-slot="separator"
      orientation={orientation}
      {...props}
    />
  );
}

export { Separator };
