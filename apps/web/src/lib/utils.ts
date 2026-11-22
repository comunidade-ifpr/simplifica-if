// Copiado do T3 Code (MIT, Copyright (c) 2026 T3 Tools Inc.): o `cn` de apps/web/src/lib/utils.ts,
// commit a6d9140972. Registro em docs/upstream-t3.md. Só a função usada pelos componentes de `ui/`.
import { type CxOptions, cx } from "class-variance-authority";
import { extendTailwindMerge } from "tailwind-merge";

// Register extra font sizes and background images so tailwind-merge does not
// treat text-2xs or bg-composer-seam-below as colors.
// Aqui também a escala de texto do app (`index.css`), pelo mesmo motivo.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["2xs", "3xs", "4xs", "5xs", "hero", "display", "title", "heading", "body", "quote", "small", "micro"],
    },
  },
});

export function cn(...inputs: CxOptions) {
  return twMerge(cx(inputs));
}
