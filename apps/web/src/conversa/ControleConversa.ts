/**
 * A conversa corrente: as ações da pessoa (iniciar, enviar, responder, interromper, nova) viram
 * chamadas ao servidor pela `Api`, e cada item da conversa vira uma ação de `reduzir`. Fica fora do React,
 * para que a conversa sobreviva à troca de tela e para que os testes a usem sem navegador; a interface lê
 * o estado com `useSyncExternalStore` (`obter` e `observar`).
 *
 * Uma conversa por vez, seguida por um `conversa.acompanhar` só, aberto enquanto ela é a corrente: os
 * turnos (os desta tela e os de outra), o texto parcial e o estado que o servidor diz. `enviar` só pede ao
 * servidor que abra o turno; a resposta chega por esse acompanhamento. Se a conexão cai, a interface volta
 * a acompanhar da última `ordem` que viu (o turno segue no servidor); a resposta aberta se refaz pelo texto
 * parcial acumulado. As conversas ficam gravadas no servidor (M1.2): `abrir` carrega uma pelo id
 * (`conversa.carregar`) e passa a acompanhá-la. A sessão do provider é do servidor: liberada ociosa e
 * reaberta por retomada na próxima mensagem, sem nada a fazer aqui.
 */
import type { Decisao, NotaResposta, Provider } from "@simplifica-if/contratos-app";
import type { EscolhaDaIa } from "../tarefas/modelos.ts";
import type { Acompanhamento, Api } from "../conexao/api.ts";
import { explicarErro } from "../conexao/erros.ts";
import { type Acao, type EstadoConversa, estadoInicial, type FaseConversa, reduzir } from "./estado.ts";

/** A conexão com o servidor caiu no meio do stream (o `RpcClientError` do cliente `effect/rpc`). */
const ehQuedaDaConexao = (erro: unknown): boolean =>
  typeof erro === "object" && erro !== null && (erro as { _tag?: unknown })._tag === "RpcClientError";

export class ControleConversa {
  private estado: EstadoConversa;
  private readonly observadores = new Set<() => void>();
  /** O `conversa.acompanhar` da conversa corrente. */
  private acompanhamento: Acompanhamento | undefined;
  /** Para de esperar a conexão voltar (depois de quedas seguidas). */
  private pararEspera: (() => void) | undefined;
  /** Quedas seguidas sem nenhum item recebido: da segunda em diante, espera a conexão voltar. */
  private quedasSeguidas = 0;
  private readonly api: Api;

  constructor(api: Api) {
    this.api = api;
    this.estado = estadoInicial();
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

  /**
   * Acompanha a conversa `sessao` a partir da última `ordem` vista. Numa queda da conexão, volta a
   * acompanhar de onde parou: na hora, na primeira; depois, quando a conexão voltar.
   */
  private seguir(sessao: string): void {
    const acompanhamento = this.api.acompanhar(
      (cliente) => cliente["conversa.acompanhar"]({ sessao, depois: this.estado.ordem }),
      (item) => {
        if (this.acompanhamento !== acompanhamento) return;
        this.quedasSeguidas = 0;
        this.despachar({ tipo: "aoVivo", item });
      },
    );
    this.acompanhamento = acompanhamento;
    acompanhamento.fim.then(
      () => {
        // Só termina quando a conversa é apagada.
        if (this.acompanhamento === acompanhamento) this.acompanhamento = undefined;
      },
      (erro: unknown) => {
        if (this.acompanhamento !== acompanhamento) return;
        this.acompanhamento = undefined;
        if (!ehQuedaDaConexao(erro)) {
          this.despachar({ tipo: "naoAcompanhou", erro: explicarErro(erro) });
          return;
        }
        this.despachar({ tipo: "retomando" });
        this.quedasSeguidas += 1;
        if (this.quedasSeguidas === 1) this.seguir(sessao);
        else this.quandoConectar(() => this.seguir(sessao));
      },
    );
  }

  /** Roda `acao` quando a conexão estiver aberta de novo, se a conversa ainda for a corrente. */
  private quandoConectar(acao: () => void): void {
    const sessao = this.estado.sessao;
    const parar = this.api.estado.observar(() => {
      if (this.api.estado.obter().fase !== "conectada") return;
      parar();
      this.pararEspera = undefined;
      if (this.estado.sessao === sessao) acao();
    });
    this.pararEspera = parar;
  }

  /** Deixa de acompanhar a conversa corrente. */
  private soltar(): void {
    this.acompanhamento?.cancelar();
    this.acompanhamento = undefined;
    this.pararEspera?.();
    this.pararEspera = undefined;
    this.quedasSeguidas = 0;
  }

  escolher(provider: Provider): void {
    this.despachar({ tipo: "escolher", provider });
  }

  /**
   * Começa a conversa de uma tarefa (M1.9): a pasta já criada pelo servidor (`pasta.criar`), com os
   * anexos, e o pedido montado pelo formulário ou escrito na caixa do Início, enviado em seguida.
   * Devolve o id da conversa; a falha vira `erroInicio` e a promessa rejeita.
   */
  async comecarTarefa(tarefa: {
    readonly ia: EscolhaDaIa;
    readonly pasta: string;
    readonly tarefa: string;
    readonly pedido: string;
  }): Promise<string> {
    this.soltar();
    this.despachar({ tipo: "nova" });
    this.despachar({ tipo: "escolher", provider: tarefa.ia.provider, pastaTrabalho: tarefa.pasta });
    this.despachar({ tipo: "iniciando" });
    try {
      const { sessao } = await this.api.chamar((cliente) =>
        cliente["conversa.iniciar"]({ ...tarefa.ia, pastaTrabalho: tarefa.pasta, tarefa: tarefa.tarefa }),
      );
      if (this.fase() !== "iniciando") {
        void this.encerrarNoServidor(sessao);
        throw new Error("A conversa foi trocada antes de abrir.");
      }
      this.despachar({ tipo: "iniciada", sessao, tarefa: tarefa.tarefa });
      this.seguir(sessao);
      this.enviar(tarefa.pedido);
      return sessao;
    } catch (erro) {
      const mensagem = explicarErro(erro);
      if (this.fase() === "iniciando") this.despachar({ tipo: "naoIniciou", erro: mensagem });
      throw erro;
    }
  }

  /** 👍/👎 na resposta do turno; `null` retira. Muda na tela já e volta atrás se o servidor recusar. */
  async avaliar(turno: number, nota: NotaResposta | null): Promise<void> {
    const sessao = this.estado.sessao;
    if (sessao === undefined) return;
    const anterior = this.estado.avaliacoes[turno] ?? null;
    this.despachar({ tipo: "avaliada", turno, nota });
    try {
      await this.api.chamar((cliente) => cliente["conversa.avaliar"]({ sessao, turno, nota }));
    } catch (erro) {
      if (this.estado.sessao === sessao) {
        this.despachar({ tipo: "avaliada", turno, nota: anterior });
        this.despachar({ tipo: "aviso", erro: explicarErro(erro) });
      }
    }
  }

  /**
   * Abre a conversa gravada `sessao`: o histórico e, daí em diante, a conversa ao vivo (o resto do turno em
   * andamento, se há). Não faz nada se ela já é a conversa corrente.
   */
  async abrir(sessao: string): Promise<void> {
    if (this.estado.sessao === sessao && this.estado.fase !== "configurando") return;
    this.soltar();
    this.despachar({ tipo: "abrindo", sessao });
    try {
      const gravada = await this.api.chamar((cliente) => cliente["conversa.carregar"]({ sessao }));
      // A pessoa pode ter aberto outra (ou começado uma nova) enquanto esta carregava.
      if (this.estado.sessao !== sessao || this.fase() !== "carregando") return;
      this.despachar({ tipo: "carregada", gravada });
      this.seguir(sessao);
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

  /**
   * Envia a mensagem: ela aparece já (pendente), e o servidor abre o turno; a resposta chega pelo
   * acompanhamento da conversa. Se o servidor recusar, a mensagem sai e o erro aparece.
   */
  enviar(texto: string): void {
    const sessao = this.estado.sessao;
    const limpo = texto.trim();
    if (sessao === undefined || this.estado.fase !== "pronta" || limpo.length === 0) return;
    this.despachar({ tipo: "enviada", texto: limpo });
    if (this.acompanhamento === undefined && this.pararEspera === undefined) this.seguir(sessao);
    this.api
      .chamar((cliente) => cliente["conversa.enviar"]({ sessao, texto: limpo }))
      .catch((erro: unknown) => {
        if (this.estado.sessao === sessao) this.despachar({ tipo: "naoEnviou", erro: explicarErro(erro) });
      });
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
    this.soltar();
    this.despachar({ tipo: "nova" });
    if (sessao !== undefined && !emTurno) void this.encerrarNoServidor(sessao);
  }

  /**
   * A conversa `sessao` foi apagada: se é a corrente, a tela volta ao começo, sem pedir ao servidor que
   * a encerre (ela não existe mais).
   */
  apagada(sessao: string): void {
    if (this.estado.sessao !== sessao) return;
    this.soltar();
    this.despachar({ tipo: "nova" });
  }

  private async encerrarNoServidor(sessao: string): Promise<void> {
    try {
      await this.api.chamar((cliente) => cliente["conversa.encerrar"]({ sessao }));
    } catch {
      // A conexão caiu: o servidor libera a sessão ociosa sozinho.
    }
  }
}
