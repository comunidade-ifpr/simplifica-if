/**
 * A navegação do leitor entre links `ifpr://` (M1.6): voltar e avançar, como num navegador. Abrir um
 * link novo depois de voltar descarta o que estava à frente. Funções puras; o estado fica no painel do app
 * (`painel/ControlePainel.ts`).
 */

export interface Historico {
  /** Os links visitados, na ordem. */
  readonly links: ReadonlyArray<string>;
  /** O índice do link aberto; -1 com o leitor fechado. */
  readonly posicao: number;
}

export const HISTORICO_VAZIO: Historico = { links: [], posicao: -1 };

export const linkAtual = (h: Historico): string | undefined => h.links[h.posicao];
export const podeVoltar = (h: Historico): boolean => h.posicao > 0;
export const podeAvancar = (h: Historico): boolean => h.posicao >= 0 && h.posicao < h.links.length - 1;

/** Abre `link` depois do atual. O mesmo link do atual não duplica a entrada. */
export function abrir(h: Historico, link: string): Historico {
  if (linkAtual(h) === link) return h;
  const links = [...h.links.slice(0, h.posicao + 1), link];
  return { links, posicao: links.length - 1 };
}

export function voltar(h: Historico): Historico {
  return podeVoltar(h) ? { ...h, posicao: h.posicao - 1 } : h;
}

export function avancar(h: Historico): Historico {
  return podeAvancar(h) ? { ...h, posicao: h.posicao + 1 } : h;
}

/**
 * A trilha sem os links de `descartar` (um documento que deixou de existir). O atual, se fica, continua
 * o atual; se sai, o de antes dele toma o lugar (ou, sem nenhum antes, o primeiro que ficou). Dois iguais
 * que ficam lado a lado viram um.
 */
export function semLinks(h: Historico, descartar: (link: string) => boolean): Historico {
  const links: string[] = [];
  let posicao = -1;
  h.links.forEach((link, i) => {
    if (!descartar(link) && links.at(-1) !== link) links.push(link);
    if (i === h.posicao) posicao = links.length - 1;
  });
  if (links.length === h.links.length) return h;
  return { links, posicao: links.length === 0 ? -1 : Math.max(0, posicao) };
}
