/**
 * As várias janelas do app (`docs/plans/multitarefa.md`, "Depois" › "Várias janelas"): o conjunto das
 * janelas abertas, na ordem de uso, a regra de quem fala pelo IPC e a rota que abre uma janela nova.
 *
 * - **O conjunto:** a primeira janela é a principal (a da partida); as outras saem só por "Abrir em nova
 *   janela" (o canal `abrirJanela`), nunca por `window.open`, que continua negado (`main.ts`): a janela
 *   nova que o Chromium pede para um link do app (⇧-clique, ⌘-clique) vira uma janela do app pelo mesmo
 *   caminho, e a de outro endereço vai ao navegador.
 * - **A última usada:** a que teve foco por último (ou, sem foco nenhum ainda, a mais nova). É a que o
 *   `second-instance` traz à frente, a que recebe os atalhos do menu e o clique do aviso do sistema sem
 *   janela certa. O aviso, que todas pedem, sai uma vez só (`avisos.ts`).
 * - **Quantas e onde:** no máximo `MAXIMO_JANELAS` abertas (a tecla repetida, um laço, não enchem a tela);
 *   a nova abre em cascata a partir da que pediu, dentro da área útil da tela dela, e no centro dessa área
 *   quando a que pediu está no modo compacto, maximizada ou em tela cheia (`medidasDaJanelaNova`).
 * - **A continuidade** é só da principal: ela grava onde a pessoa estava (também ao fechar, mesmo com
 *   outras abertas) e é ela que volta ao reabrir. As outras não gravam nem voltam. Fechada a principal, as
 *   que ficam seguem sem gravar, e a próxima janela aberta passa a ser a principal e grava daí em diante,
 *   mas não volta: abre na rota que a pessoa pediu, sem o painel da principal que fechou. Voltar é só da
 *   janela que abre com o app (`continuidadeDaJanelaNova`, lida pelo preload em `JanelaDesktop.continuidade`).
 *
 * Sem o `electron`: o `main.ts` passa a `BrowserWindow`, e os testes, as falsas.
 */
import type { ContinuidadeDaJanela } from "@simplifica-if/contratos-app/ponte";
import type { Retangulo } from "./compacta.ts";

/** O argumento do renderer com o que a janela faz da continuidade (`webPreferences.additionalArguments`). */
const PREFIXO_CONTINUIDADE = "--simplifica-continuidade=";

/**
 * O que a janela nova faz da continuidade: com a principal aberta, nada; sem ela, a que abre com o app
 * (sem rota) grava e volta, e a de "Abrir em nova janela" (com rota) grava sem voltar.
 */
export function continuidadeDaJanelaNova(principalAberta: boolean, comRota: boolean): ContinuidadeDaJanela {
  return principalAberta ? "nenhuma" : comRota ? "so-grava" : "completa";
}

/** Os `additionalArguments` do renderer: a completa vai sem argumento. */
export const argumentosDaContinuidade = (modo: ContinuidadeDaJanela): Array<string> =>
  modo === "completa" ? [] : [`${PREFIXO_CONTINUIDADE}${modo}`];

/** O que o preload lê do `process.argv`; sem o argumento, a completa. */
export function continuidadeDoArgv(argv: ReadonlyArray<string>): ContinuidadeDaJanela {
  const valor = argv
    .find((argumento) => argumento.startsWith(PREFIXO_CONTINUIDADE))
    ?.slice(PREFIXO_CONTINUIDADE.length);
  return valor === "so-grava" || valor === "nenhuma" ? valor : "completa";
}

/** Quantas janelas podem estar abertas ao mesmo tempo. */
export const MAXIMO_JANELAS = 10;

/** O tamanho da janela nova (cabendo na área útil). */
export const TAMANHO_JANELA = { largura: 1280, altura: 820 } as const;

/** O deslocamento da cascata. */
const DESLOCAMENTO_JANELA = 28;

/**
 * As medidas da janela nova, na área útil (`areaUtil`) da tela da que pediu (`referencia`): em cascata, 28
 * px abaixo e à direita dela (voltando à borda da área quando não cabe), ou, com `centro` (a que pediu no
 * modo compacto, maximizada ou em tela cheia), no centro da área. Sempre o tamanho normal, cabendo na área.
 */
export function medidasDaJanelaNova(referencia: Retangulo, areaUtil: Retangulo, centro: boolean): Retangulo {
  const width = Math.min(TAMANHO_JANELA.largura, areaUtil.width);
  const height = Math.min(TAMANHO_JANELA.altura, areaUtil.height);
  if (centro)
    return {
      x: areaUtil.x + Math.round((areaUtil.width - width) / 2),
      y: areaUtil.y + Math.round((areaUtil.height - height) / 2),
      width,
      height,
    };
  const dentro = (inicio: number, tamanho: number, areaInicio: number, areaTamanho: number) =>
    inicio >= areaInicio && inicio + tamanho <= areaInicio + areaTamanho ? inicio : areaInicio;
  return {
    x: dentro(referencia.x + DESLOCAMENTO_JANELA, width, areaUtil.x, areaUtil.width),
    y: dentro(referencia.y + DESLOCAMENTO_JANELA, height, areaUtil.y, areaUtil.height),
    width,
    height,
  };
}

/** O tamanho máximo da rota de uma janela nova: o da rota guardada na continuidade (`MAXIMO_TEXTO_CONTINUIDADE`). */
export const MAXIMO_ROTA_JANELA = 4_000;

/** Uma origem qualquer, só para conferir que a rota não leva a outro host. */
const ORIGEM_DO_APP = "http://simplifica.invalid";

/**
 * Uma rota do app, conferida: `/…`, sem outro host (`//`), sem barra invertida (que o analisador de URL lê
 * como `/`) nem caractere de controle, até `maximo` caracteres. É o formato da rota que a interface guarda
 * na continuidade e manda no aviso do sistema.
 */
export function rotaValida(rota: unknown, maximo: number): string | undefined {
  if (typeof rota !== "string" || !rota.startsWith("/") || rota.startsWith("//") || rota.length > maximo)
    return undefined;
  if (/[\u0000-\u001f\u007f\\]/.test(rota)) return undefined;
  return new URL(rota, ORIGEM_DO_APP).origin === ORIGEM_DO_APP ? rota : undefined;
}

/** A URL da janela nova: a rota sobre a origem da interface (`Configuracao.urlJanela`). */
export function urlDaRota(urlJanela: string, rota: string): string {
  return new URL(rota, urlJanela).href;
}

/**
 * A rota que a página mostra (o caminho e a busca da URL dela), sem o `compacto=1`: a revisão no modo
 * compacto é a mesma revisão. `undefined` para a página fora da origem da interface.
 */
export function rotaDaPagina(urlPagina: string, urlJanela: string): string | undefined {
  try {
    const pagina = new URL(urlPagina);
    const app = new URL(urlJanela);
    if (pagina.protocol !== app.protocol || pagina.host !== app.host) return undefined;
    pagina.searchParams.delete("compacto");
    return `${pagina.pathname}${pagina.search}`;
  } catch {
    return undefined;
  }
}

/** O que o conjunto usa da `BrowserWindow`. */
export interface JanelaDoConjunto {
  isDestroyed(): boolean;
}

export function criarConjuntoJanelas<J extends JanelaDoConjunto>() {
  /** Da menos à mais recentemente usada. */
  const ordem: Array<J> = [];
  let principal: J | undefined;

  const tirar = (janela: J) => {
    const i = ordem.indexOf(janela);
    if (i >= 0) ordem.splice(i, 1);
  };

  return {
    /** Uma janela nova: entra como a última usada; a primeira (ou a primeira depois de todas fecharem) é a principal. */
    adicionar(janela: J): void {
      tirar(janela);
      ordem.push(janela);
      if (principal === undefined || principal.isDestroyed()) principal = janela;
    },
    /** A janela fechou. */
    remover(janela: J): void {
      tirar(janela);
      if (principal === janela) principal = undefined;
    },
    /** A janela ganhou o foco: passa a ser a última usada. */
    usada(janela: J): void {
      if (!ordem.includes(janela)) return;
      tirar(janela);
      ordem.push(janela);
    },
    /** A janela é do app (está no conjunto e não foi destruída). */
    tem: (janela: J | null | undefined): janela is J =>
      janela !== null && janela !== undefined && ordem.includes(janela) && !janela.isDestroyed(),
    /** Cabe mais uma janela (`MAXIMO_JANELAS`). */
    cabeMais: (): boolean => ordem.filter((janela) => !janela.isDestroyed()).length < MAXIMO_JANELAS,
    /** As janelas abertas, da menos à mais recentemente usada. */
    todas: (): ReadonlyArray<J> => ordem.filter((janela) => !janela.isDestroyed()),
    /** A que teve foco por último, ou a mais nova. */
    ultimaUsada: (): J | undefined => ordem.findLast((janela) => !janela.isDestroyed()),
    /** A janela da partida, enquanto aberta: só ela grava a continuidade. */
    principal: (): J | undefined => (principal === undefined || principal.isDestroyed() ? undefined : principal),
  };
}

export type ConjuntoJanelas<J extends JanelaDoConjunto> = ReturnType<typeof criarConjuntoJanelas<J>>;

/**
 * Um valor por janela, criado no primeiro uso (o modo compacto de cada uma) e esquecido quando ela fecha
 * (com `aoEsquecer`, que solta o que o valor ainda segura: a espera da tela cheia).
 */
export function porJanela<J extends object, V>(criar: (janela: J) => V, aoEsquecer?: (valor: V) => void) {
  const valores = new Map<J, V>();
  return {
    de(janela: J): V {
      const atual = valores.get(janela);
      if (atual !== undefined) return atual;
      const novo = criar(janela);
      valores.set(janela, novo);
      return novo;
    },
    /** O valor, só se já existe (sem criar). */
    existente: (janela: J): V | undefined => valores.get(janela),
    esquecer(janela: J): void {
      const valor = valores.get(janela);
      valores.delete(janela);
      if (valor !== undefined) aoEsquecer?.(valor);
    },
  };
}

/** O remetente de um pedido do IPC, como o `ipc.ts` o vê. */
export interface Remetente<J> {
  /** A janela do `webContents` que mandou (`BrowserWindow.fromWebContents`). */
  readonly janela: J | null | undefined;
  /** O `webContents` que mandou e o da janela achada, para conferir que são o mesmo. */
  readonly conteudo: unknown;
  readonly conteudoDaJanela: unknown;
  /** O quadro que mandou e o principal daquele `webContents`. */
  readonly quadro: unknown;
  readonly quadroPrincipal: unknown;
  /** A URL do quadro que mandou. */
  readonly urlQuadro: string | undefined;
}

/** O que o IPC usa do evento (`IpcMainInvokeEvent`). */
export interface EventoIpc<C> {
  readonly sender: C;
  readonly senderFrame: { readonly url: string } | null | undefined;
}

/**
 * O remetente de um pedido, lido do evento: `undefined` com o `webContents` ou a janela destruídos (a janela
 * fechando), em que ler deles lança, e com o quadro que já se foi.
 */
export function remetenteDoEvento<
  C extends { isDestroyed(): boolean; readonly mainFrame: unknown },
  J extends JanelaDoConjunto & { readonly webContents: unknown },
>(evento: EventoIpc<C>, janelaDe: (conteudo: C) => J | null): Remetente<J> | undefined {
  try {
    if (evento.sender.isDestroyed()) return undefined;
    const janela = janelaDe(evento.sender);
    if (janela === null || janela.isDestroyed()) return undefined;
    return {
      janela,
      conteudo: evento.sender,
      conteudoDaJanela: janela.webContents,
      quadro: evento.senderFrame,
      quadroPrincipal: evento.sender.mainFrame,
      urlQuadro: evento.senderFrame?.url,
    };
  } catch {
    return undefined;
  }
}

/**
 * Só uma janela do conjunto, no quadro principal e na origem da interface, é atendida (e recebe o token).
 * `mesmaOrigem` é `isSameOriginRendererNavigation` (`seguranca.ts`), com a origem da interface.
 */
export function remetenteConfiavel<J extends JanelaDoConjunto>(
  remetente: Remetente<J>,
  conjunto: Pick<ConjuntoJanelas<J>, "tem">,
  mesmaOrigem: (url: string) => boolean,
): remetente is Remetente<J> & { readonly janela: J } {
  return (
    conjunto.tem(remetente.janela) &&
    remetente.conteudo === remetente.conteudoDaJanela &&
    remetente.quadro !== null &&
    remetente.quadro !== undefined &&
    remetente.quadro === remetente.quadroPrincipal &&
    remetente.urlQuadro !== undefined &&
    mesmaOrigem(remetente.urlQuadro)
  );
}
