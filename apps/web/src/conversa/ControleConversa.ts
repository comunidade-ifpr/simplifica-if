/**
 * A conversa corrente: as ações da pessoa (iniciar, enviar, responder, interromper, nova) viram
 * chamadas ao servidor pela `Api`, e cada evento vira uma ação de `reduzir`. Fica fora do React, para
 * que a conversa sobreviva à troca de tela e para que os testes a usem sem navegador; a interface lê o
 * estado com `useSyncExternalStore` (`obter` e `observar`).
 *
 * Uma conversa por vez (M1.1). Sem persistência (M1.2): recarregar a página perde a conversa, e a
 * sessão no servidor se encerra sozinha depois da tolerância de órfã.
 */
import type { Decisao, Provider } from "@simplifica-if/contratos-app";
import type { Acompanhamento, Api } from "../conexao/api.ts";
import { mensagemDeErro } from "../conexao/erros.ts";
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
      this.despachar({ tipo: "naoIniciou", erro: "Escolha a pasta de trabalho da conversa." });
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
      this.despachar({ tipo: "naoIniciou", erro: mensagemDeErro(erro) });
    }
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
        this.despachar({ tipo: "turnoFalhou", erro: mensagemDeErroDoTurno(erro) });
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
      this.despachar({ tipo: "respostaFalhou", aprovacao, erro: mensagemDeErro(erro) });
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
      this.despachar({ tipo: "aviso", texto: mensagemDeErro(erro), gravidade: "erro" });
    }
  }

  /** Encerra a sessão (o processo do provider morre) e volta à escolha, com o mesmo provider e pasta. */
  nova(): void {
    const sessao = this.estado.sessao;
    this.turno?.cancelar();
    this.turno = undefined;
    this.despachar({ tipo: "nova" });
    if (sessao !== undefined) void this.encerrarNoServidor(sessao);
  }

  private async encerrarNoServidor(sessao: string): Promise<void> {
    try {
      await this.api.chamar((cliente) => cliente["conversa.encerrar"]({ sessao }));
    } catch {
      // Já encerrada, ou a conexão caiu: o servidor encerra a órfã sozinho.
    }
  }
}

function mensagemDeErroDoTurno(erro: unknown): string {
  if (typeof erro === "object" && erro !== null && (erro as { _tag?: unknown })._tag === "RpcClientError") {
    return "A conexão com o servidor local caiu durante a resposta, e o restante dela se perdeu. Envie a mensagem de novo quando a conexão voltar.";
  }
  return mensagemDeErro(erro);
}
