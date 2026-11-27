/**
 * Uma instância do leitor: o painel do app, a página do Explorar. Com mais de um documento na janela
 * (a mesma norma na tela e no painel), cada leitor fala só com o seu:
 *
 * - os pedidos ao `Documento` (ir a um item do índice, `irPara`; montar todos os blocos para buscar,
 *   `montarTudo`) vão só a quem ouve a instância, não pela janela;
 * - os `id` dos dispositivos e seções levam o prefixo da instância (`painel-art28`), e quem procura um
 *   deles procura dentro da raiz do leitor (`data-leitor`), com o prefixo;
 * - imprimir pela instância imprime só o que está nela, e o ⌘P, só o leitor em foco (`index.css`,
 *   `data-imprimir`).
 *
 * Sem provedor, vale a instância padrão, sem prefixo: um leitor só, como numa página.
 */
import { createContext, use } from "react";
import type { Destino } from "./sumario.ts";

/** O atributo da raiz de um leitor: as buscas por `id` e a impressão ficam dentro dela. */
export const ATRIBUTO_RAIZ = "data-leitor";

export class InstanciaLeitor {
  private readonly ouvintesIrPara = new Set<(destino: Destino) => void>();
  private readonly ouvintesMontarTudo = new Set<() => void>();
  /** O que vai antes de cada `id` do texto. */
  readonly prefixo: string;

  constructor(prefixo: string) {
    this.prefixo = prefixo;
  }

  /** O `id` do elemento no texto desta instância. */
  readonly id = (id: string): string => `${this.prefixo}${id}`;

  /** Pede ao `Documento` o bloco do destino e a rolagem até ele (o índice da norma). */
  readonly irPara = (destino: Destino): void => {
    for (const fazer of this.ouvintesIrPara) fazer(destino);
  };

  /** Pede ao `Documento` todos os blocos (só de um tratador de evento: o `Documento` usa `flushSync`). */
  readonly montarTudo = (): void => {
    for (const fazer of this.ouvintesMontarTudo) fazer();
  };

  readonly aoIrPara = (fazer: (destino: Destino) => void): (() => void) => {
    this.ouvintesIrPara.add(fazer);
    return () => this.ouvintesIrPara.delete(fazer);
  };

  readonly aoMontarTudo = (fazer: () => void): (() => void) => {
    this.ouvintesMontarTudo.add(fazer);
    return () => this.ouvintesMontarTudo.delete(fazer);
  };

  /**
   * O elemento de `id` no texto do leitor em que `origem` está (a raiz `data-leitor`, ou o documento
   * inteiro fora de uma): primeiro com o prefixo desta instância, depois como veio.
   */
  readonly elemento = (origem: Element | null, id: string): HTMLElement | null => {
    const raiz: ParentNode = origem?.closest(`[${ATRIBUTO_RAIZ}]`) ?? document;
    for (const candidato of [this.id(id), id]) {
      const achado = raiz.querySelector(`[id="${CSS.escape(candidato)}"]`);
      if (achado instanceof HTMLElement) return achado;
    }
    return null;
  };
}

const PADRAO = new InstanciaLeitor("");

export const ContextoInstancia = createContext<InstanciaLeitor>(PADRAO);

export const useInstanciaLeitor = (): InstanciaLeitor => use(ContextoInstancia);

/** Marca os artigos imprimíveis de `raiz` (`data-imprimir`) até o fim da impressão; diz se havia algum. */
function marcarParaImprimir(raiz: Element): boolean {
  const artigos = [...raiz.querySelectorAll(".leitor-impressao")];
  if (artigos.length === 0) return false;
  for (const artigo of artigos) artigo.setAttribute("data-imprimir", "");
  window.addEventListener(
    "afterprint",
    () => {
      for (const artigo of artigos) artigo.removeAttribute("data-imprimir");
    },
    { once: true },
  );
  return true;
}

/**
 * Imprime só o que está no leitor de `raiz`, e o `index.css` esconde o resto, inclusive o outro leitor.
 * Sem texto pronto nele (lendo na base, ou com erro), não imprime: sairia o outro leitor no lugar.
 */
export function imprimirLeitor(raiz: Element | null): void {
  if (raiz !== null && marcarParaImprimir(raiz)) window.print();
}

/**
 * A raiz do leitor que vai para o papel: a que pediu (`imprimirLeitor`) ou, no ⌘P/Ctrl+P e no menu do
 * navegador, `emFoco()` (o mesmo leitor do ⌘F: em foco ou o último usado), marcada aqui até o fim da
 * impressão. Chamada no `beforeprint` de cada leitor, a primeira marca e as outras acham a marca.
 * `undefined` quando nenhum se marca: sai todo artigo imprimível.
 */
export function raizAImprimir(emFoco: () => Element | undefined): Element | undefined {
  const marcado = document.querySelector("[data-imprimir]");
  if (marcado !== null) return marcado.closest(`[${ATRIBUTO_RAIZ}]`) ?? undefined;
  const raiz = emFoco();
  return raiz !== undefined && marcarParaImprimir(raiz) ? raiz : undefined;
}
