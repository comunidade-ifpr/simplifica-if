/**
 * A conversa corrente: as ações da pessoa (iniciar, enviar, responder, interromper, nova) viram
 * chamadas ao servidor pela `Api`, e cada evento vira uma ação de `reduzir`. Fica fora do React, para
 * que a conversa sobreviva à troca de tela e para que os testes a usem sem navegador; a interface lê o
 * estado com `useSyncExternalStore` (`obter` e `observar`).
 *
 * Uma conversa por vez. As conversas ficam gravadas no servidor (M1.2): `abrir` carrega uma pelo id
 * (`conversa.carregar`) e, se ela tem turno em andamento (a interface recarregou no meio da resposta),
 * volta a acompanhá-lo (`conversa.acompanhar`). A sessão do provider é do servidor: liberada ociosa e
 * reaberta por retomada na próxima mensagem, sem nada a fazer aqui.
 */
import type { Decisao, ItemConversa, Provider } from "@simplifica-if/contratos-app";
import type { Acompanhamento, Api } from "../conexao/api.ts";
import { explicarErro, type MensagemErro } from "../conexao/erros.ts";
import { type Acao, type EstadoConversa, estadoInicial, type FaseConversa, reduzir } from "./estado.ts";

export class ControleConversa {
  private estado: EstadoConversa;
  private readonly observadores = new Set<() => void>();
  private turno: Acompanhamento | undefined;
  private readonly api: Api;

  constructor(api: Api, inicial: EstadoConversa = estadoInicial()) {
    this.api = api;
    this.estado = inicial;
  }

  readonly obter = (): EstadoConversa => this.estado;

  /** A fase agora (sem o estreitamento de tipo do TypeScript, que não vê as mudanças durante um `await`). */
  private fase(): FaseConversa {
    return this.estado.fase;
  }

  readonly observar = (aviso: () => void): (() => void) => {
    this.observadores.add(aviso);
    return () => this.observadores.delete(aviso);
  };

  private despachar(acao: Acao): void {
    this.estado = reduzir(this.estado, acao);
    for (const aviso of this.observadores) aviso();
  }

  escolher(escolha: { readonly provider?: Provider; readonly pastaTrabalho?: string }): void {
    this.despachar({ tipo: "escolher", ...escolha });
  }

  /** Abre a sessão com o provider e a pasta escolhidos. */
  async iniciar(): Promise<void> {
    if (this.estado.fase !== "configurando") return;
    const { provider, pastaTrabalho } = this.estado;
    const pasta = pastaTrabalho.trim();
    if (pasta.length === 0) {
      this.despachar({ tipo: "naoIniciou", erro: { texto: "Escolha a pasta de trabalho da conversa." } });
      return;
    }
    this.despachar({ tipo: "iniciando" });
    try {
      const { sessao } = await this.api.chamar((cliente) =>
        cliente["conversa.iniciar"]({ provider, pastaTrabalho: pasta }),
      );
      // A pessoa pode ter pedido "Nova conversa" enquanto a sessão abria.
      if (this.fase() !== "iniciando") {
        void this.encerrarNoServidor(sessao);
        return;
      }
      this.despachar({ tipo: "iniciada", sessao });
    } catch (erro) {
      this.despachar({ tipo: "naoIniciou", erro: explicarErro(erro) });
    }
  }

  /**
   * Abre a conversa gravada `sessao`: o histórico e, se há turno em andamento, o resto dele. Não faz
   * nada se ela já é a conversa corrente.
   */
  async abrir(sessao: string): Promise<void> {
    if (this.estado.sessao === sessao && this.estado.fase !== "configurando") return;
    this.turno?.cancelar();
    this.turno = undefined;
    this.despachar({ tipo: "abrindo", sessao });
    try {
      const gravada = await this.api.chamar((cliente) => cliente["conversa.carregar"]({ sessao }));
      // A pessoa pode ter aberto outra (ou começado uma nova) enquanto esta carregava.
      if (this.estado.sessao !== sessao || this.fase() !== "carregando") return;
      this.despachar({ tipo: "carregada", gravada });
      if (gravada.conversa.estado === "respondendo") this.acompanharTurno(sessao);
    } catch (erro) {
      if (this.estado.sessao !== sessao) return;
      const mensagem = explicarErro(erro);
      this.despachar({
        tipo: "naoCarregou",
        erro:
          (erro as { _tag?: unknown } | null)?._tag === "SessaoDesconhecida"
            ? { texto: "Esta conversa não existe mais no app." }
            : mensagem,
      });
    }
  }

  /** Volta a acompanhar o turno em andamento da conversa (depois de recarregar a interface). */
  private acompanharTurno(sessao: string): void {
    const turno = this.api.acompanhar(
      (cliente) => cliente["conversa.acompanhar"]({ sessao, depois: this.estado.ordem }),
      (item: ItemConversa) => {
        if (this.turno === turno) this.despachar({ tipo: "item", item });
      },
    );
    this.seguir(turno);
  }

  /** Envia a mensagem e acompanha o turno até o `FimTurno`. */
  enviar(texto: string): void {
    const sessao = this.estado.sessao;
    const limpo = texto.trim();
    if (sessao === undefined || this.estado.fase !== "pronta" || limpo.length === 0) return;
    this.despachar({ tipo: "enviada", texto: limpo });
    const turno = this.api.acompanhar(
      (cliente) => cliente["conversa.enviar"]({ sessao, texto: limpo }),
      (evento) => {
        if (this.turno === turno) this.despachar({ tipo: "evento", evento });
      },
    );
    this.seguir(turno);
  }

  /** Acompanha o fim do turno: sem `FimTurno`, o turno se fecha aqui; com erro, vira aviso. */
  private seguir(turno: Acompanhamento): void {
    this.turno = turno;
    turno.fim.then(
      () => {
        if (this.turno !== turno) return;
        this.turno = undefined;
        // O stream acaba depois do `FimTurno`; se acabou sem ele, o turno se fecha aqui.
        if (this.estado.fase === "respondendo" || this.estado.fase === "interrompendo") {
          this.despachar({ tipo: "evento", evento: { _tag: "FimTurno", motivo: "fim_do_stream" } });
        }
      },
      (erro: unknown) => {
        if (this.turno !== turno) return;
        this.turno = undefined;
        this.despachar({ tipo: "turnoFalhou", erro: explicarFalhaDoTurno(erro) });
      },
    );
  }

  async responder(aprovacao: string, decisao: Decisao): Promise<void> {
    const sessao = this.estado.sessao;
    if (sessao === undefined) return;
    this.despachar({ tipo: "respondendo", aprovacao });
    try {
      await this.api.chamar((cliente) => cliente["conversa.responderAprovacao"]({ sessao, aprovacao, decisao }));
      this.despachar({ tipo: "respondida", aprovacao, decisao });
    } catch (erro) {
      this.despachar({ tipo: "respostaFalhou", aprovacao, erro: explicarErro(erro) });
    }
  }

  /** Pede ao provider que pare; o turno termina com o `FimTurno` de interrupção. */
  async interromper(): Promise<void> {
    const sessao = this.estado.sessao;
    if (sessao === undefined || this.estado.fase !== "respondendo") return;
    this.despachar({ tipo: "interrompendo" });
    try {
      await this.api.chamar((cliente) => cliente["conversa.interromper"]({ sessao }));
    } catch (erro) {
      this.despachar({ tipo: "aviso", erro: explicarErro(erro) });
    }
  }

  /**
   * Volta à escolha, com o mesmo provider e pasta. A conversa anterior fica gravada; sem turno em
   * andamento, a sessão dela se libera já (o processo do provider morre) e se retoma quando ela for
   * aberta de novo. Com turno em andamento, ele termina no servidor e fica no histórico.
   */
  nova(): void {
    const sessao = this.estado.sessao;
    const emTurno = this.estado.fase === "respondendo" || this.estado.fase === "interrompendo";
    this.turno?.cancelar();
    this.turno = undefined;
    this.despachar({ tipo: "nova" });
    if (sessao !== undefined && !emTurno) void this.encerrarNoServidor(sessao);
  }

  private async encerrarNoServidor(sessao: string): Promise<void> {
    try {
      await this.api.chamar((cliente) => cliente["conversa.encerrar"]({ sessao }));
    } catch {
      // A conexão caiu: o servidor libera a sessão ociosa sozinho.
    }
  }
}

function explicarFalhaDoTurno(erro: unknown): MensagemErro {
  if (typeof erro === "object" && erro !== null && (erro as { _tag?: unknown })._tag === "RpcClientError") {
    return {
      texto:
        "A conexão com o servidor local caiu durante a resposta, e o restante dela se perdeu. Envie a mensagem de novo quando a conexão voltar.",
    };
  }
  return explicarErro(erro);
}
