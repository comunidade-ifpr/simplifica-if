// Copiado do T3 Code (MIT, Copyright (c) 2026 T3 Tools Inc.): apps/web/src/components/ui/spinner.tsx,
// commit a6d9140972. Registro e adaptações em docs/upstream-t3.md; licença em LICENSE-T3 nesta pasta.
import { LoaderCircleIcon } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "~/lib/utils";

// No default size: inside a Button the parent's svg rule sizes the glyph.
const spinnerVariants = cva("motion-safe:animate-spin", {
  variants: {
    size: {
      xs: "size-3",
      sm: "size-3.5",
      md: "size-4",
      lg: "size-5",
    },
    tone: {
      current: "",
      muted: "text-muted-foreground",
    },
  },
  defaultVariants: { tone: "current" },
});

function Spinner({
  className,
  size,
  tone,
  ...props
}: React.ComponentPropsWithoutRef<typeof LoaderCircleIcon> & VariantProps<typeof spinnerVariants>) {
  return (
    <LoaderCircleIcon
      aria-label="Carregando"
      className={cn(spinnerVariants({ size, tone }), className)}
      role="status"
      {...props}
    />
  );
}

export { Spinner };
