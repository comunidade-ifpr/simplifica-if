/**
 * O contêiner de uma tela: a rolagem e a coluna centrada, numa de duas larguras (`--page-narrow`, 720 px,
 * para conversa, formulários e boas-vindas; `--page-wide`, 1120 px, para Início, Explorar, revisão e
 * Configurações). Com as duas larguras fixas, o título não pula de lugar ao trocar de aba. Com `rolagem`,
 * a rolagem fica lembrada por essa chave ao sair e voltar (`lib/rolagem.ts`).
 */
import { type ReactNode, useRef } from "react";
import { useRolagemLembrada } from "~/lib/rolagem";

import { cn } from "~/lib/utils";

export type LarguraPagina = "estreita" | "larga";

/** A classe da coluna, para as telas que montam a rolagem por conta própria (o Explorar). */
export function classeColuna(largura: LarguraPagina): string {
  return cn("mx-auto w-full px-6", largura === "larga" ? "max-w-(--page-wide)" : "max-w-(--page-narrow)");
}

export function Pagina({
  largura,
  children,
  className,
  rolagem,
}: {
  readonly largura: LarguraPagina;
  readonly children: ReactNode;
  /** Classes da coluna (o espaço entre as seções, por exemplo). */
  readonly className?: string;
  /** A chave da rolagem lembrada (a revisão, `revisao:<id>`). */
  readonly rolagem?: string;
}) {
  const rolante = useRef<HTMLDivElement>(null);
  useRolagemLembrada(rolagem, () => rolante.current, { topo: true });
  return (
    <div ref={rolante} className="h-full overflow-y-auto">
      <div className={cn(classeColuna(largura), "flex flex-col gap-6 py-8", className)}>{children}</div>
    </div>
  );
}
