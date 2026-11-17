/**
 * A marca de cada IA ao lado do nome (Claude, ChatGPT, Gemini): só decoração (`aria-hidden`), o nome
 * continua em texto. Claude e OpenAI são os ícones do T3 Code (`ui/icons.tsx`); o do Gemini é desenhado
 * aqui, a estrela de quatro pontas em degradê. Tudo SVG inline, sem carga remota; as cores se leem no
 * tema claro e no escuro (a da OpenAI segue a cor do texto).
 */
import type { Provider } from "@simplifica-if/contratos-app";
import { type SVGProps, useId } from "react";
import { cn } from "../lib/utils.ts";
import { ClaudeAI, OpenAI } from "./ui/icons.tsx";

function Gemini(props: SVGProps<SVGSVGElement>) {
  const degrade = useId();
  return (
    <svg {...props} viewBox="0 0 24 24">
      <defs>
        <linearGradient id={degrade} x1="0" y1="24" x2="24" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3f7cf4" />
          <stop offset="1" stopColor="#a56fd6" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${degrade})`}
        d="M12 0C12 6.627 17.373 12 24 12 17.373 12 12 17.373 12 24 12 17.373 6.627 12 0 12 6.627 12 12 6.627 12 0Z"
      />
    </svg>
  );
}

const MARCAS = { claude: ClaudeAI, codex: OpenAI, antigravity: Gemini } as const;

export function MarcaIa({ provider, className }: { readonly provider: Provider; readonly className?: string }) {
  const Marca = MARCAS[provider];
  return <Marca aria-hidden focusable="false" data-marca-ia={provider} className={cn("size-4 shrink-0", className)} />;
}
