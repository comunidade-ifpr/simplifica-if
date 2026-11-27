/**
 * Ao reabrir, voltar onde se estava (`docs/plans/multitarefa.md`, "Continuidade"): a última rota e o estado
 * do painel, nas preferências do servidor (`preferencias.guardarContinuidade`).
 *
 * - **Gravar:** 1 s depois de cada navegação ou mudança do painel, e já ao fechar (`gravarAgora`: o
 *   `before-quit` do desktop, pela ponte, o `pagehide` do navegador e o `encerrar`). Uma gravação por vez,
 *   na ordem; sem conexão, não grava (nem espera).
 * - **Só grava depois de decidir:** sem ter lido o que estava guardado (as preferências que não carregaram),
 *   nada se grava nesta abertura; lido, mas sem conseguir conferir o que existe, o "Prender ao lado" volta e
 *   a gravação espera a pessoa navegar ou mexer no painel. Assim a falha ao abrir não apaga o guardado.
 * - **Voltar:** na primeira conexão, com as preferências lidas. As boas-vindas por fazer têm precedência
 *   (nada volta). O que voltou é conferido contra o que existe (`conferir.ts`); a rota só volta se o app
 *   abriu no Início e a pessoa ainda não navegou, e o painel, se ela ainda não mexeu nele (o "Prender ao
 *   lado" volta sempre). Enquanto decide, `restaurando`: o Início espera, sem piscar.
 * - **Sem voltar** (`voltar: false`, a janela do desktop aberta na rota pedida que passou a ser a principal):
 *   nada volta, nem a rota nem o painel, e grava daí em diante.
 *
 * Fica fora do React, como o `ControlePainel`; a moldura o liga ao roteador (`ligar`).
 */
import type { Continuidade } from "@simplifica-if/contratos-app";
import type { Api } from "../conexao/api.ts";
import type { ControlePainel } from "../painel/ControlePainel.ts";
import type { Roteador } from "../router.ts";
import { preferenciasCarregadas, primeiroUsoPendente } from "../tarefas/perfil.ts";
import { conferirContinuidade, continuidadeQueCabe, type ModuloContinuidade, rotaParaGuardar } from "./conferir.ts";

/** A espera depois da navegação antes de gravar. */
export const ESPERA_GRAVAR_MS = 1_000;

export interface EstadoContinuidade {
  /** Decidindo para onde voltar. */
  readonly restaurando: boolean;
  /** O que não voltou por ter deixado de existir ("Esta revisão foi apagada"), até a pessoa fechar o aviso. */
  readonly avisos: ReadonlyArray<string>;
}

export class ControleContinuidade {
  private estado: EstadoContinuidade;
  private readonly observadores = new Set<() => void>();
  private readonly api: Api;
  private readonly painel: ControlePainel;
  private readonly modulos: ReadonlyArray<ModuloContinuidade>;
  private roteador: Roteador | undefined;
  private espera: ReturnType<typeof setTimeout> | undefined;
  private ultimaGravada: string | undefined;
  /**
   * `sim`: o que havia para voltar já voltou (senão, a primeira gravação o apagaria); `depois-de-mexer`: a
   * conferência falhou, e grava a partir da primeira navegação ou mudança do painel; `nao`: não grava.
   */
  private gravando: "nao" | "depois-de-mexer" | "sim" = "nao";
  /** A gravação em curso (ou a última), para a seguinte esperar por ela. */
  private emCurso: Promise<void> = Promise.resolve();
  private encerrada = false;
  private restauracao: Promise<void> | undefined;
  /** Solta a espera pela conexão (o app fechando antes de conectar). */
  private soltarEspera: (() => void) | undefined;

  private readonly voltar: boolean;

  /**
   * Desligada (`ligada: false`), não volta nem grava: os testes de navegador que não são dela. Sem voltar
   * (`voltar: false`), só grava.
   */
  constructor(
    api: Api,
    painel: ControlePainel,
    modulos: ReadonlyArray<ModuloContinuidade>,
    opcoes: { readonly ligada?: boolean; readonly voltar?: boolean } = {},
  ) {
    this.api = api;
    this.painel = painel;
    this.modulos = modulos;
    this.voltar = opcoes.voltar !== false;
    this.estado = { restaurando: opcoes.ligada !== false && this.voltar, avisos: [] };
    if (opcoes.ligada === false) this.encerrada = true;
  }

  readonly obter = (): EstadoContinuidade => this.estado;

  readonly observar = (aviso: () => void): (() => void) => {
    this.observadores.add(aviso);
    return () => this.observadores.delete(aviso);
  };

  private trocar(mudancas: Partial<EstadoContinuidade>): void {
    this.estado = { ...this.estado, ...mudancas };
    for (const aviso of this.observadores) aviso();
  }

  readonly fecharAvisos = (): void => {
    if (this.estado.avisos.length > 0) this.trocar({ avisos: [] });
  };

  /**
   * A moldura liga o roteador ao montar; a função devolvida para de acompanhar (a moldura desmontada). Voltar
   * acontece uma vez só, na primeira; ligar de novo (o `StrictMode`) só volta a acompanhar.
   */
  readonly ligar = (roteador: Roteador): (() => void) => {
    if (this.encerrada) return () => {};
    this.roteador = roteador;
    this.restauracao ??= this.comecar(roteador);
    let ligada = true;
    const parares: Array<() => void> = [];
    void this.restauracao.then(() => {
      if (!ligada || this.encerrada) return;
      parares.push(
        roteador.subscribe("onResolved", this.agendar),
        this.painel.observar(this.agendar),
        ouvirJanela("pagehide", () => void this.gravarAgora()),
      );
    });
    return () => {
      ligada = false;
      for (const parar of parares.splice(0)) parar();
    };
  };

  private async comecar(roteador: Roteador): Promise<void> {
    if (!this.voltar) {
      this.gravando = "sim";
      return;
    }
    const inicio = roteador.state.location.href;
    const painelInicial = this.painel.obter();
    // A pessoa que saiu do Início durante a espera (mesmo de volta a ele) fica onde está. O carregamento da
    // própria rota de início (a primeira carga, um `invalidate`) não conta.
    let navegou = false;
    const pararDeOuvir = roteador.subscribe("onBeforeNavigate", (evento) => {
      if (evento.toLocation.href !== inicio) navegou = true;
    });
    const resultado = { lida: false, sumiu: false };
    let decidiu = false;
    try {
      if (await this.esperarConexao()) {
        decidiu = await this.restaurar(roteador, { inicio, painelInicial, navegou: () => navegou }, resultado);
      }
    } catch {
      // Sem conseguir conferir o que existe, nada volta: o app abre onde abriu.
    } finally {
      pararDeOuvir();
    }
    if (this.encerrada) return;
    this.gravando = decidiu ? "sim" : resultado.lida ? "depois-de-mexer" : "nao";
    if (this.estado.restaurando) this.trocar({ restaurando: false });
    // O que não voltou (a revisão apagada) sai do guardado, para o aviso não se repetir na próxima abertura.
    if (resultado.sumiu) this.agendar();
  }

  private esperarConexao(): Promise<boolean> {
    return new Promise((resolver) => {
      const fase = () => this.api.estado.obter().fase;
      const decidida = () => fase() === "conectada" || fase() === "sem-servidor";
      if (decidida()) {
        resolver(fase() === "conectada");
        return;
      }
      const soltar = (conectada: boolean) => {
        parar();
        this.soltarEspera = undefined;
        resolver(conectada);
      };
      const parar = this.api.estado.observar(() => {
        if (decidida()) soltar(fase() === "conectada");
      });
      this.soltarEspera = () => soltar(false);
    });
  }

  /**
   * Volta ao guardado; `false` se as preferências não carregaram, e falha se não conseguir conferir o que
   * existe. `resultado.lida` quando chegou a ler o guardado; `resultado.sumiu` quando algo dele não voltou.
   */
  private async restaurar(
    roteador: Roteador,
    abertura: {
      readonly inicio: string;
      readonly painelInicial: ReturnType<ControlePainel["obter"]>;
      readonly navegou: () => boolean;
    },
    resultado: { lida: boolean; sumiu: boolean },
  ): Promise<boolean> {
    const preferencias = await preferenciasCarregadas(this.api);
    if (preferencias === undefined) return false;
    resultado.lida = true;
    if (primeiroUsoPendente(preferencias) !== false) return true;
    const guardada = preferencias.continuidade;
    if (guardada === undefined) return true;
    this.ultimaGravada = JSON.stringify(guardada);
    // O "Prender ao lado" volta sempre, antes da conferência (que pode falhar).
    const painelIntocado = this.painel.obter() === abertura.painelInicial;
    this.painel.prender(guardada.painel.preso);
    const painelPreso = this.painel.obter();
    const [conversas, ...modulos] = await Promise.all([
      this.api.chamar((cliente) => cliente["conversa.listar"]({})),
      ...this.modulos.map((modulo) => modulo()),
    ]);
    if (this.encerrada) return false;
    const conferida = conferirContinuidade(guardada, {
      conversas: new Set(conversas.map((c) => c.id)),
      modulos,
    });
    if (painelIntocado && this.painel.obter() === painelPreso) this.painel.restaurar(conferida.painel);
    const aqui = roteador.state.location;
    if (!abertura.navegou() && aqui.href === abertura.inicio && aqui.pathname === "/" && conferida.rota !== "/") {
      await roteador.navigate({ href: conferida.rota, replace: true });
    }
    if (conferida.avisos.length > 0) this.trocar({ avisos: conferida.avisos });
    resultado.sumiu = conferida.avisos.length > 0;
    return true;
  }

  private readonly agendar = (): void => {
    if (this.gravando === "depois-de-mexer") this.gravando = "sim";
    if (this.espera !== undefined) clearTimeout(this.espera);
    this.espera = setTimeout(() => void this.gravarAgora(), ESPERA_GRAVAR_MS);
  };

  /** O que gravar agora: a rota em que se está e o painel. */
  private continuidade(): Continuidade | undefined {
    const local = this.roteador?.state.location;
    if (local === undefined) return undefined;
    return continuidadeQueCabe({
      rota: rotaParaGuardar(local.pathname, local.search as Record<string, unknown>),
      painel: this.painel.paraGuardar(),
    });
  }

  /**
   * Grava já (sem esperar o segundo), se mudou desde a última gravação. Espera a gravação em curso e grava o
   * estado de quando chega a vez dela: a mais nova é sempre a última.
   */
  readonly gravarAgora = (): Promise<void> => {
    if (this.espera !== undefined) clearTimeout(this.espera);
    this.espera = undefined;
    const vez = this.emCurso.then(() => this.gravarSeMudou());
    this.emCurso = vez;
    return vez;
  };

  private async gravarSeMudou(): Promise<void> {
    if (this.gravando !== "sim" || this.api.estado.obter().fase !== "conectada") return;
    const continuidade = this.continuidade();
    if (continuidade === undefined) return;
    const texto = JSON.stringify(continuidade);
    if (texto === this.ultimaGravada) return;
    try {
      await this.api.chamar((cliente) => cliente["preferencias.guardarContinuidade"]({ continuidade }));
      this.ultimaGravada = texto;
    } catch {
      // Sem conseguir gravar (a conexão caiu), a próxima mudança tenta de novo.
    }
  }

  /** Grava o que falta e para (o app fechando). */
  readonly encerrar = async (): Promise<void> => {
    if (this.encerrada) return;
    await this.gravarAgora();
    this.encerrada = true;
    this.gravando = "nao";
    this.soltarEspera?.();
    if (this.espera !== undefined) clearTimeout(this.espera);
  };
}

function ouvirJanela(evento: "pagehide", ouvinte: () => void): () => void {
  window.addEventListener(evento, ouvinte);
  return () => window.removeEventListener(evento, ouvinte);
}
