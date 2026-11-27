/**
 * O modo compacto da janela (`docs/plans/multitarefa.md`, "Modo compacto ao lado do Word", decisões 6 e
 * 10): a janela vira uma coluna estreita encostada à direita da área útil da tela em que está, com a altura
 * toda e sempre por cima, para ficar ao lado do Word. É capacidade da janela, não da revisão: a interface
 * pede pelo canal `janelaCompacta` da ponte.
 *
 * - Ao ligar: guarda as medidas (e se estava maximizada ou em tela cheia), sai da tela cheia (esperando o
 *   fim da animação do macOS; se ela não termina na reserva, o modo não liga) e do maximizado, impede o
 *   maximizar e a tela cheia, troca o tamanho mínimo, encosta a coluna e liga o "sempre por cima" (nível
 *   "floating"). Não mexe nas mesas do macOS: o `setVisibleOnAllWorkspaces` com `visibleOnFullScreen`
 *   esconde o ícone do Dock e o app do ⌘Tab enquanto vale, e sem isso (`skipTransformProcessType`) a
 *   janela não aparece por cima de um app em tela cheia; a coluna fica por cima do Word em janela, não do
 *   Word em tela cheia (a decidir no piloto, decisão 10).
 * - O alfinete (`naFrente`) solta e prende o "sempre por cima", só no modo compacto.
 * - Ao desligar: sai da tela cheia ou do maximizado em que a janela tenha entrado mesmo assim, desfaz tudo
 *   e restaura as medidas (dentro de uma tela que ainda existe), o maximizado e a tela cheia de antes.
 * - A página que recarrega (o servidor reiniciado, a interface nova) volta sem o estado do modo: o
 *   `main.ts` desliga-o na navegação, e a janela volta ao normal com ela.
 *
 * Sem o `electron`: o `main.ts` passa a janela e a tela, e os testes, as falsas.
 */

/** A largura da coluna compacta, em px. */
export const LARGURA_COMPACTA = 380;

/** O tamanho mínimo no modo compacto e fora dele (o da janela criada em `main.ts`). */
export const MINIMO_COMPACTO = { largura: 320, altura: 400 } as const;
export const MINIMO_NORMAL = { largura: 800, altura: 560 } as const;

/** Quanto se espera o fim da saída da tela cheia (a animação do macOS) antes de encolher assim mesmo. */
export const ESPERA_TELA_CHEIA_MS = 1500;

export interface Retangulo {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** O que o modo usa da `BrowserWindow`. */
export interface JanelaCompactavel {
  isDestroyed(): boolean;
  isMaximized(): boolean;
  isFullScreen(): boolean;
  isMaximizable(): boolean;
  isFullScreenable(): boolean;
  getBounds(): Retangulo;
  /** As medidas da janela fora do maximizado (no maximizado, as de antes de maximizar). */
  getNormalBounds(): Retangulo;
  setBounds(medidas: Retangulo): void;
  setMinimumSize(largura: number, altura: number): void;
  maximize(): void;
  unmaximize(): void;
  setFullScreen(telaCheia: boolean): void;
  setMaximizable(maximizavel: boolean): void;
  setFullScreenable(telaCheiavel: boolean): void;
  setAlwaysOnTop(sempre: boolean, nivel?: "floating"): void;
  once(evento: "leave-full-screen", ouvinte: () => void): unknown;
  removeListener(evento: "leave-full-screen", ouvinte: () => void): unknown;
}

/** O que o modo usa do `screen` do Electron. */
export interface TelaDoSistema {
  getDisplayMatching(retangulo: Retangulo): { readonly workArea: Retangulo };
  getAllDisplays(): ReadonlyArray<{ readonly workArea: Retangulo }>;
}

export interface DependenciasCompacta {
  readonly janela: () => JanelaCompactavel | undefined;
  readonly tela: TelaDoSistema;
  /** O `setTimeout` (a espera da tela cheia), devolvendo o que o cancela; os testes passam um que guarda. */
  readonly adiar: (acao: () => void, ms: number) => () => void;
}

/** A coluna compacta: `largura` px na borda direita da área útil, com a altura toda. */
export function retanguloCompacto(areaUtil: Retangulo, largura = LARGURA_COMPACTA): Retangulo {
  const ajustada = Math.min(largura, areaUtil.width);
  return { x: areaUtil.x + areaUtil.width - ajustada, y: areaUtil.y, width: ajustada, height: areaUtil.height };
}

/** Quanto da janela, ao menos, precisa cair numa tela para ela ser alcançável (a barra de título). */
const PARTE_VISIVEL = { largura: 100, altura: 40 } as const;

/**
 * As medidas guardadas, se uma parte delas ainda cai numa das áreas úteis (`areas`); senão (a tela em que
 * a janela estava saiu), as mesmas medidas, cabendo, no centro de `reserva` (a tela em que a coluna está).
 */
export function medidasNumaTela(medidas: Retangulo, areas: ReadonlyArray<Retangulo>, reserva: Retangulo): Retangulo {
  const alcancavel = areas.some((area) => {
    const largura = Math.min(medidas.x + medidas.width, area.x + area.width) - Math.max(medidas.x, area.x);
    const altura = Math.min(medidas.y + medidas.height, area.y + area.height) - Math.max(medidas.y, area.y);
    return (
      largura >= Math.min(PARTE_VISIVEL.largura, medidas.width) &&
      altura >= Math.min(PARTE_VISIVEL.altura, medidas.height)
    );
  });
  if (alcancavel) return medidas;
  const width = Math.min(medidas.width, reserva.width);
  const height = Math.min(medidas.height, reserva.height);
  return {
    x: reserva.x + Math.round((reserva.width - width) / 2),
    y: reserva.y + Math.round((reserva.height - height) / 2),
    width,
    height,
  };
}

/** O que se guarda ao ligar, para desfazer ao desligar. */
interface Guardado {
  readonly medidas: Retangulo;
  readonly maximizada: boolean;
  readonly telaCheia: boolean;
  readonly maximizavel: boolean;
  readonly telaCheiavel: boolean;
}

export function criarJanelaCompacta(dependencias: DependenciasCompacta) {
  let guardado: Guardado | undefined;
  /** O alfinete: no modo compacto, a janela está sempre por cima. */
  let porCima = false;
  // Um pedido por vez: ligar no meio da saída da tela cheia e desligar logo depois não se cruzam.
  let fila: Promise<unknown> = Promise.resolve();
  /** Desiste da espera da tela cheia em curso (a janela fechou): o relógio e o ouvinte saem. */
  let desistirDaEspera: (() => void) | undefined;

  const viva = (): JanelaCompactavel | undefined => {
    const janela = dependencias.janela();
    return janela === undefined || janela.isDestroyed() ? undefined : janela;
  };

  const sempreNaFrente = (janela: JanelaCompactavel, ligar: boolean) => {
    if (ligar) janela.setAlwaysOnTop(true, "floating");
    else janela.setAlwaysOnTop(false);
    porCima = ligar;
  };

  /** Sai da tela cheia e espera o fim da animação, até a reserva; devolve se a janela saiu dela. */
  const sairDaTelaCheia = (janela: JanelaCompactavel): Promise<boolean> =>
    new Promise((resolver) => {
      let cancelar = (): void => {};
      const terminar = (saiu: boolean) => {
        desistirDaEspera = undefined;
        cancelar();
        if (!janela.isDestroyed()) janela.removeListener("leave-full-screen", ouvinte);
        resolver(saiu);
      };
      const ouvinte = () => terminar(true);
      janela.once("leave-full-screen", ouvinte);
      cancelar = dependencias.adiar(
        () => terminar(janela.isDestroyed() || !janela.isFullScreen()),
        ESPERA_TELA_CHEIA_MS,
      );
      desistirDaEspera = () => terminar(false);
      janela.setFullScreen(false);
    });

  /** Devolve se o modo ficou ligado. */
  const ligar = async (): Promise<boolean> => {
    const janela = viva();
    if (janela === undefined) return false;
    if (guardado !== undefined) return true;
    const telaCheia = janela.isFullScreen();
    const maximizada = janela.isMaximized();
    // A tela é a da janela como está agora, antes de sair do maximizado ou da tela cheia.
    const { workArea } = dependencias.tela.getDisplayMatching(janela.getBounds());
    const medidas = janela.getNormalBounds();
    // Se a animação não termina na reserva, o macOS ignoraria as medidas da coluna: o modo não liga, e a
    // interface avisa.
    if (telaCheia && !(await sairDaTelaCheia(janela))) return false;
    if (janela.isDestroyed()) return false;
    guardado = {
      medidas,
      maximizada,
      telaCheia,
      maximizavel: janela.isMaximizable(),
      telaCheiavel: janela.isFullScreenable(),
    };
    if (janela.isMaximized()) janela.unmaximize();
    // A coluna não se maximiza nem vai à tela cheia (o botão da barra, o duplo clique): cobriria o Word.
    janela.setMaximizable(false);
    janela.setFullScreenable(false);
    janela.setMinimumSize(MINIMO_COMPACTO.largura, MINIMO_COMPACTO.altura);
    janela.setBounds(retanguloCompacto(workArea));
    sempreNaFrente(janela, true);
    return true;
  };

  const desligar = async (): Promise<boolean> => {
    const antes = guardado;
    guardado = undefined;
    porCima = false;
    const janela = viva();
    if (antes === undefined || janela === undefined) return false;
    sempreNaFrente(janela, false);
    janela.setMaximizable(antes.maximizavel);
    janela.setFullScreenable(antes.telaCheiavel);
    // A coluna que entrou no maximizado ou na tela cheia mesmo assim sai dele antes: as medidas de antes só
    // valem com a janela normal.
    if (janela.isFullScreen()) {
      await sairDaTelaCheia(janela);
      if (janela.isDestroyed()) return false;
    }
    if (janela.isMaximized()) janela.unmaximize();
    const coluna = dependencias.tela.getDisplayMatching(janela.getBounds()).workArea;
    const areas = dependencias.tela.getAllDisplays().map((tela) => tela.workArea);
    janela.setBounds(medidasNumaTela(antes.medidas, areas, coluna));
    janela.setMinimumSize(MINIMO_NORMAL.largura, MINIMO_NORMAL.altura);
    if (antes.telaCheia) janela.setFullScreen(true);
    else if (antes.maximizada) janela.maximize();
    return false;
  };

  const naVez = <A>(acao: () => A | Promise<A>): Promise<A> => {
    const vez = fila.then(acao);
    fila = vez.catch(() => undefined);
    return vez;
  };

  return {
    /** A janela está no modo compacto. */
    ligada: (): boolean => guardado !== undefined,
    /** A janela está no modo compacto com o alfinete preso: sempre à vista, por cima das outras. */
    porCima: (): boolean => guardado !== undefined && porCima,
    /**
     * Liga (`true`) ou desliga (`false`) o modo; pedir o estado em que já está não muda nada. Devolve se o
     * modo ficou ligado (ligar falha com a janela que não sai da tela cheia a tempo).
     */
    compactar: (ligada: boolean): Promise<boolean> => naVez(ligada ? ligar : desligar),
    /** O alfinete: solta ou prende o "sempre por cima". Fora do modo compacto, nada muda. */
    naFrente: (sempre: boolean): Promise<void> =>
      naVez(() => {
        const janela = viva();
        if (janela !== undefined && guardado !== undefined) sempreNaFrente(janela, sempre);
      }),
    /** A janela fechou: o que estava guardado era dela, e a espera da tela cheia em curso acaba. */
    esquecer: (): void => {
      guardado = undefined;
      porCima = false;
      desistirDaEspera?.();
    },
  };
}
