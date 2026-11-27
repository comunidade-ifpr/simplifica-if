/**
 * O aviso do sistema (`docs/plans/multitarefa.md`, "Em andamento", decisão 8): a interface pede, e o
 * processo principal mostra a `Notification` do Electron, só com a janela sem foco; no modo compacto com o
 * alfinete preso (`compacta.ts`), a janela fica sempre à vista, e o aviso vale só com ela oculta ou minimizada. As permissões
 * de notificação do Chromium continuam negadas (`main.ts`): a página não mostra aviso nenhum por conta própria.
 *
 * - O texto é fixo e não leva o título da conversa, que é texto da pessoa e apareceria na tela bloqueada.
 * - Com várias janelas (`janelas.ts`), todas acompanham as mesmas atividades e pedem o mesmo aviso: vale o
 *   primeiro pedido, de qualquer janela, e os iguais (o mesmo tipo e a mesma rota) que chegam em seguida,
 *   por `REPETIDO_MS`, saem descartados. Assim o aviso não depende de uma janela certa estar conectada (a
 *   que recarrega, a que acabou de abrir). Sai só se nenhuma janela está à vista.
 * - O clique traz à frente a janela que já mostra a rota (a conversa, a revisão, também no modo compacto),
 *   sem navegar: navegar tiraria a revisão do compacto. Sem ela, traz a última usada e manda a rota à
 *   interface dela (`CANAIS.abrirRota`).
 * - O selo com a contagem do que espera a pessoa é só do macOS (`app.dock.setBadge`), um só para o app.
 *
 * Sem o `electron`: o `main.ts` passa a fábrica da notificação e a janela, e os testes, as falsas.
 */
import { type AvisoSistema, CANAIS } from "@simplifica-if/contratos-app/ponte";
import { rotaDaPagina, rotaValida } from "./janelas.ts";

/**
 * O identificador do app, o do empacotamento (`scripts/empacotar.ts`). No Windows, a notificação só sai
 * com ele (`app.setAppUserModelId`).
 */
export const ID_DO_APP = "io.github.comunidade-ifpr.simplifica";

/** O texto de cada aviso, sem nada da conversa. */
export const TEXTOS_AVISO: Readonly<Record<AvisoSistema["tipo"], string>> = {
  resposta: "Uma resposta está pronta",
  permissao: "A IA pede uma permissão",
};

/** O que o aviso usa de uma `Notification` do Electron. */
export interface NotificacaoSistema {
  on(evento: "click" | "close" | "failed", ouvinte: () => void): unknown;
  show(): void;
}

/** O que o aviso usa da `BrowserWindow`. */
export interface JanelaDoAviso {
  isDestroyed(): boolean;
  isFocused(): boolean;
  isMinimized(): boolean;
  isVisible(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  readonly webContents: { send(canal: string, ...argumentos: Array<unknown>): void; getURL(): string };
}

export interface DependenciasAvisos<J extends JanelaDoAviso> {
  readonly criar: (opcoes: { readonly title: string; readonly body: string }) => NotificacaoSistema;
  /** O sistema mostra notificações (`Notification.isSupported()`). */
  readonly suportado: () => boolean;
  /** As janelas abertas (`janelas.ts`). */
  readonly janelas: () => ReadonlyArray<J>;
  /** A que teve foco por último. */
  readonly ultimaUsada: () => J | undefined;
  /** A janela está no modo compacto com o alfinete preso (`compacta.ts`): sempre por cima, à vista. */
  readonly sempreAVista: (janela: J) => boolean;
  /** A origem da interface (`Configuracao.urlJanela`), para saber que rota cada janela mostra. */
  readonly urlJanela: string;
  readonly nome: string;
  /** O relógio, em ms (`Date.now`), para descartar os pedidos repetidos. */
  readonly agora: () => number;
}

/** Por quanto tempo um pedido igual ao último que valeu (das outras janelas) sai descartado. */
export const REPETIDO_MS = 2_000;

/** O tamanho máximo da rota de um aviso. */
const MAXIMO_ROTA_AVISO = 500;

/**
 * O aviso pedido pela interface, conferido: o tipo conhecido e uma rota do app (`/…`, sem outro host, sem
 * barra invertida, que o analisador de URL lê como `/`, nem caractere de controle).
 */
export function avisoValido(pedido: unknown): AvisoSistema | undefined {
  if (typeof pedido !== "object" || pedido === null) return undefined;
  const { tipo, rota } = pedido as { tipo?: unknown; rota?: unknown };
  if (tipo !== "resposta" && tipo !== "permissao") return undefined;
  const valida = rotaValida(rota, MAXIMO_ROTA_AVISO);
  return valida === undefined ? undefined : { tipo, rota: valida };
}

/** Quantas notificações ficam guardadas para o clique: as do macOS que ficam na Central não avisam o fim. */
const MAXIMO_GUARDADAS = 20;

/** A contagem do selo: um inteiro de 0 a 999. */
export function contagemValida(pedido: unknown): number | undefined {
  return typeof pedido === "number" && Number.isInteger(pedido) && pedido >= 0 && pedido < 1000 ? pedido : undefined;
}

/** O texto do selo do Dock: vazio tira o selo. */
export const textoDoSelo = (contagem: number): string => (contagem === 0 ? "" : String(contagem));

export function criarAvisos<J extends JanelaDoAviso>(dependencias: DependenciasAvisos<J>) {
  // A notificação sem referência pode ser recolhida antes do clique: fica aqui até ser clicada, fechada ou
  // falhar, ou até passar das `MAXIMO_GUARDADAS`.
  const abertas = new Set<NotificacaoSistema>();
  /** Quando valeu o último pedido de cada aviso (`tipo rota`). */
  const vistos = new Map<string, number>();
  /** O pedido é o primeiro deste aviso, e não a cópia de outra janela (anota-o). */
  const primeiro = (aviso: AvisoSistema): boolean => {
    const agora = dependencias.agora();
    for (const [chave, quando] of vistos) if (agora - quando >= REPETIDO_MS) vistos.delete(chave);
    const chave = `${aviso.tipo} ${aviso.rota}`;
    if (vistos.has(chave)) return false;
    vistos.set(chave, agora);
    return true;
  };
  return {
    /**
     * Mostra o aviso, se o pedido é válido e o primeiro dele (as outras janelas pedem o mesmo), o sistema
     * avisa e a pessoa não vê nenhuma janela: todas sem foco e, no modo compacto com o alfinete preso (sempre
     * à vista ao lado do Word), ocultas ou minimizadas. Devolve se mostrou.
     */
    avisar(pedido: unknown): boolean {
      const aviso = avisoValido(pedido);
      if (aviso === undefined || !primeiro(aviso)) return false;
      const aVista = (janela: J) =>
        dependencias.sempreAVista(janela) ? janela.isVisible() && !janela.isMinimized() : janela.isFocused();
      if (dependencias.janelas().some(aVista)) return false;
      if (!dependencias.suportado()) return false;
      const notificacao = dependencias.criar({ title: dependencias.nome, body: TEXTOS_AVISO[aviso.tipo] });
      abertas.add(notificacao);
      // A mais antiga sai: o clique nela já não traz a janela, mas a memória não cresce sem teto.
      if (abertas.size > MAXIMO_GUARDADAS) abertas.delete(abertas.values().next().value!);
      notificacao.on("close", () => abertas.delete(notificacao));
      notificacao.on("failed", () => abertas.delete(notificacao));
      notificacao.on("click", () => {
        abertas.delete(notificacao);
        const naRota = dependencias
          .janelas()
          .findLast((janela) => rotaDaPagina(janela.webContents.getURL(), dependencias.urlJanela) === aviso.rota);
        const destino = naRota ?? dependencias.ultimaUsada();
        if (destino === undefined || destino.isDestroyed()) return;
        if (destino.isMinimized()) destino.restore();
        destino.show();
        destino.focus();
        if (naRota === undefined) destino.webContents.send(CANAIS.abrirRota, aviso.rota);
      });
      notificacao.show();
      return true;
    },
    /** Quantas notificações estão guardadas para o clique (o teste confere o teto). */
    guardadas: (): number => abertas.size,
  };
}
