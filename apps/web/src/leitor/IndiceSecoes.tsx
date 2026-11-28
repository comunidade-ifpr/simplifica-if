/**
 * O índice de seções de um PPC no leitor (tanto da base de conhecimento quanto do PPC em revisão): com
 * largura (`@4xl`), fica aberto na coluna lateral e acompanha a rolagem (`useEmLeitura`); no painel
 * estreito, recolhe num `<details>` antes do texto.
 */
import { useMemo } from "react";
import { type AoAbrirLink, ondeDoClique } from "../painel/abrirLink.ts";
import { useEmLeitura } from "./emLeitura.ts";
import { useInstanciaLeitor } from "./instancia.ts";
import { BotaoLink } from "./pecas.tsx";
import type { Destino } from "./sumario.ts";

export interface SecaoDoIndice {
  /** O `id` da âncora da seção no texto (sem prefixo da instância). */
  readonly id: string;
  readonly titulo: string;
  readonly link: string;
  readonly linha: number;
}

export function IndiceSecoes({
  secoes,
  secaoSelecionada = null,
  aoAbrirLink,
  rotuloRecolhido = "Seções",
  textoPronto = true,
}: {
  readonly secoes: ReadonlyArray<SecaoDoIndice>;
  /** A seção apontada pelo link atual (ou a seção que contém a pendência apontada), usada antes da rolagem. */
  readonly secaoSelecionada?: string | null;
  readonly aoAbrirLink: AoAbrirLink;
  /** Rótulo do `<summary>` quando recolhido no painel estreito. */
  readonly rotuloRecolhido?: string;
  /** Se o texto do documento já está montado para acompanhar a rolagem. */
  readonly textoPronto?: boolean;
}) {
  const destinos = useMemo<ReadonlyArray<Destino>>(() => secoes.map((s) => ({ id: s.id, linha: s.linha })), [secoes]);
  const instancia = useInstanciaLeitor();
  const { nav, ativo } = useEmLeitura(destinos, textoPronto && secoes.length > 0, instancia);
  if (secoes.length === 0) return null;

  const idAtivo = ativo !== null ? (secoes[ativo]?.id ?? null) : secaoSelecionada;

  return (
    <>
      {/* Com largura, o índice fica aberto ao lado do texto; no painel estreito, recolhido. */}
      <nav ref={nav} aria-label="Seções do PPC" className="hidden space-y-1.5 @4xl:block">
        <h3 className="font-semibold text-muted-foreground text-small">Seções ({secoes.length})</h3>
        <ul>
          {secoes.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                data-link={s.link}
                aria-current={s.id === idAtivo ? "location" : undefined}
                onClick={(evento) => {
                  const onde = ondeDoClique(evento);
                  aoAbrirLink(s.link, onde);
                  if (onde === "padrao" && s.id === secaoSelecionada) {
                    instancia.irPara({ id: s.id, linha: s.linha });
                  }
                }}
                className="block w-full rounded-md px-2 py-1 text-left text-muted-foreground text-small hover:bg-muted hover:text-foreground aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground"
              >
                {s.titulo}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <details className="rounded-md border border-border p-2 text-sm @4xl:hidden">
        <summary className="cursor-pointer font-semibold">
          {rotuloRecolhido} ({secoes.length})
        </summary>
        <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
          {secoes.map((s) => (
            <li key={s.id}>
              <BotaoLink link={s.link} aoAbrirLink={aoAbrirLink}>
                {s.titulo}
              </BotaoLink>
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
