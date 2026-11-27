/**
 * Os links `ifpr://<tipo>/…` que não são da base, mas de um módulo (o PPC em revisão e os critérios da
 * revisão de PPC): o módulo diz o tipo, o leitor do Ler e o nome curto, e a composição (`inicializar.ts`)
 * o registra antes da primeira tela. O núcleo despacha pelo tipo, sem conhecer o módulo: o leitor
 * (`ConteudoLink`) e o nome curto do chip (`nomeCurtoLink`).
 */
import type { ComponentType } from "react";
import type { AoAbrirLink } from "../painel/abrirLink.ts";

export interface LinkDeModulo {
  /** O tipo do link (`revisao-ppc` em `ifpr://revisao-ppc/…`). */
  readonly tipo: string;
  /** O conteúdo do link no Ler: `caminho` sem o tipo e sem o fragmento. */
  readonly Leitor: ComponentType<{
    readonly caminho: string;
    readonly fragmento: string | null;
    readonly aoAbrirLink: AoAbrirLink;
  }>;
  /** O nome curto do link (o chip, o título do Ler). */
  readonly nomeCurto: (caminho: string, fragmento: string | null) => string;
}

const registrados = new Map<string, LinkDeModulo>();

/** Registra os links de um módulo (só a composição chama; registrar de novo troca o anterior). */
export function registrarLinkDeModulo(link: LinkDeModulo): void {
  registrados.set(link.tipo, link);
}

/** Os links do módulo do tipo `tipo`, se algum módulo o registrou. */
export const linkDeModulo = (tipo: string): LinkDeModulo | undefined => registrados.get(tipo);
