/**
 * O modo compacto da janela, do lado da interface (`docs/plans/multitarefa.md`, "Modo compacto ao lado do
 * Word"): o estado `janelaCompacta`, que a moldura segue (`routes/__root.tsx`: só o título, ⤢ e o alfinete),
 * e não a rota. A janela é do desktop (`PonteDesktop.janela.compacta`); no navegador o modo não existe, e
 * `disponivel` diz isso a quem oferece a entrada.
 *
 * Quem liga dá o título da moldura (a revisão: "Acompanhando o PPC") e os endereços da vista compacta: sair
 * do compacto é a resposta para qualquer navegação para fora dela (um link aberto na tela, a paleta, o
 * aviso do sistema, Voltar no histórico), que a moldura avisa antes de navegar (`navegando`). A página que
 * recarrega começa fora do modo, e o desktop devolve a janela ao normal com ela: a rota lembrada
 * (`?compacto=1`) não religa nada.
 */
import type { JanelaDesktop } from "@simplifica-if/contratos-app/ponte";

export interface EstadoJanelaCompacta {
  readonly ligada: boolean;
  /** O alfinete: a janela compacta fica sempre por cima. */
  readonly naFrente: boolean;
  /** O título na moldura compacta. */
  readonly titulo: string;
}

/** Um endereço do roteador, como `onBeforeNavigate` o dá. */
export interface EnderecoDaRota {
  readonly pathname: string;
  readonly search: Readonly<Record<string, unknown>>;
}

/**
 * Como terminou o pedido de ligar: `ligada`; `recusada` pelo desktop (a janela não saiu da tela cheia a
 * tempo, ou a ponte falhou), que quem pediu avisa; `desistiu`, desligado ou navegado no meio do pedido.
 */
export type ResultadoLigar = "ligada" | "recusada" | "desistiu";

const DESLIGADA: EstadoJanelaCompacta = { ligada: false, naFrente: true, titulo: "" };

export class ControleJanelaCompacta {
  private estado: EstadoJanelaCompacta = DESLIGADA;
  private readonly observadores = new Set<() => void>();
  private readonly janela: Pick<JanelaDesktop, "compacta" | "naFrente"> | undefined;
  /** Onde o modo vale (a vista compacta de quem o ligou); a navegação para fora dele desliga o modo. */
  private fica: ((endereco: EnderecoDaRota) => boolean) | undefined;
  /** Sobe a cada desligar: o pedido de ligar ainda sem resposta desiste. */
  private geracao = 0;
  private ligando = false;

  /** `janela` é a da ponte do desktop; sem ela (no navegador), o modo não existe. */
  constructor(janela: Pick<JanelaDesktop, "compacta" | "naFrente"> | undefined) {
    this.janela = janela;
  }

  /** O modo existe aqui (no desktop). */
  get disponivel(): boolean {
    return this.janela !== undefined;
  }

  readonly obter = (): EstadoJanelaCompacta => this.estado;

  readonly observar = (aviso: () => void): (() => void) => {
    this.observadores.add(aviso);
    return () => this.observadores.delete(aviso);
  };

  private mudar(estado: EstadoJanelaCompacta): void {
    this.estado = estado;
    for (const aviso of this.observadores) aviso();
  }

  /**
   * Encolhe a janela e mostra a moldura compacta com `titulo`. `fica` diz os endereços da vista compacta:
   * navegar para outro (um link na tela, o aviso do sistema, Voltar no histórico) desliga o modo antes.
   * Com o modo já ligado, só troca o título e o lugar, e o alfinete fica como está.
   */
  readonly ligar = async (titulo: string, fica: (endereco: EnderecoDaRota) => boolean): Promise<ResultadoLigar> => {
    if (this.janela === undefined) return "recusada";
    if (this.estado.ligada) {
      this.fica = fica;
      if (this.estado.titulo !== titulo) this.mudar({ ...this.estado, titulo });
      return "ligada";
    }
    const geracao = this.geracao;
    this.ligando = true;
    let ligou: boolean;
    try {
      ligou = await this.janela.compacta(true);
    } catch {
      ligou = false;
    } finally {
      if (geracao === this.geracao) this.ligando = false;
    }
    if (geracao !== this.geracao) return "desistiu";
    if (!ligou) return "recusada";
    this.fica = fica;
    this.mudar({ ligada: true, naFrente: true, titulo });
    return "ligada";
  };

  /** ⤢: a moldura inteira volta já, e a janela, às medidas de antes. Também desiste do pedido de ligar. */
  readonly desligar = async (): Promise<void> => {
    if (!this.estado.ligada && !this.ligando) return;
    this.geracao += 1;
    this.ligando = false;
    this.fica = undefined;
    if (this.estado.ligada) this.mudar(DESLIGADA);
    // O desktop atende um pedido por vez: este vem depois do de ligar, se ele ainda corre.
    await this.janela?.compacta(false).catch(() => undefined);
  };

  /** A rota vai mudar (`onBeforeNavigate`): para fora da vista compacta, o modo desliga antes. */
  readonly navegando = (para: EnderecoDaRota): void => {
    if (this.ligando || (this.estado.ligada && this.fica !== undefined && !this.fica(para))) void this.desligar();
  };

  /** O alfinete: solta ou prende o "sempre por cima". */
  readonly fixarNaFrente = async (naFrente: boolean): Promise<void> => {
    if (!this.estado.ligada || this.janela === undefined) return;
    const geracao = this.geracao;
    try {
      await this.janela.naFrente(naFrente);
    } catch {
      return;
    }
    // Desligado (e talvez religado) no meio: o modo novo começa com o alfinete preso.
    if (this.estado.ligada && geracao === this.geracao) this.mudar({ ...this.estado, naFrente });
  };
}
