/**
 * Uma conversa: as ações da pessoa (iniciar, enviar, responder, interromper) viram chamadas ao servidor
 * pela `Api`, e cada item da conversa vira uma ação de `reduzir`. Fica fora do React, para que a conversa
 * sobreviva à troca de tela e para que os testes a usem sem navegador; a interface lê o estado com
 * `useSyncExternalStore` (`obter` e `observar`). Quem guarda os controles, um por conversa, é o
 * `GerenteConversas`: a tela da conversa e o painel do app pegam o seu, e a mesma conversa nos dois é o
 * mesmo controle.
 *
 * A conversa é seguida por um `conversa.acompanhar` só, aberto enquanto alguém a mostra (`parar` o
 * fecha, sem encerrar a sessão do provider, que se libera ociosa no servidor): os turnos (os desta tela e
 * os de outra), o texto parcial e o estado que o servidor diz. `enviar` só pede ao
 * servidor que abra o turno; a resposta chega por esse acompanhamento. Se a conexão cai, a interface volta
 * a acompanhar da última `ordem` que viu (o turno segue no servidor); a resposta aberta se refaz pelo texto
 * parcial acumulado. As conversas ficam gravadas no servidor (M1.2): `abrir` carrega uma pelo id
 * (`conversa.carregar`) e passa a acompanhá-la. A sessão do provider é do servidor: liberada ociosa e
 * reaberta por retomada na próxima mensagem, sem nada a fazer aqui.
 *
 * A mensagem leva as fichas de contexto que a pessoa deixou (`enviar`); se o servidor a recusa porque o
 * aviso de uso não foi aceito, ela sai da tela sem aviso na conversa, e quem enviou devolve o texto e as
 * fichas à caixa (`ResultadoEnvio`).
 */
import type { Continuacao, Decisao, FichaContexto, NotaResposta, Provider } from "@simplifica-if/contratos-app";
import type { EscolhaDaIa } from "../tarefas/modelos.ts";
import type { Acompanhamento, Api } from "../conexao/api.ts";
import { ehQuedaDaConexao, ehSessaoDesconhecida, explicarErro } from "../conexao/erros.ts";
import { type Acao, type EstadoConversa, estadoInicial, type FaseConversa, reduzir } from "./estado.ts";

/** O erro de `abrir` de uma conversa que o servidor não conhece (apagada). */
export const CONVERSA_INEXISTENTE = "Esta conversa não existe mais no app.";

/** O servidor recusou porque o aviso de uso não foi aceito (M1.8). */
export const ehAvisoNaoAceito = (erro: unknown): boolean =>
  typeof erro === "object" && erro !== null && (erro as { _tag?: unknown })._tag === "AvisoNaoAceito";

/** Como terminou o pedido de envio: aberto o turno, recusado pelo aviso de uso, ou outra falha (na conversa). */
export type ResultadoEnvio = "enviada" | "avisoNaoAceito" | "falhou";
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
  private readonly aoIniciar: ((sessao: string) => void) | undefined;
  private readonly aoTerminar: ((sessao: string) => void) | undefined;
  /** A carga da conversa aberta por `abrir`. */
  private carregamento: Promise<void> | undefined;
  /** Ninguém mais o mostra (`parar`): a carga que chega depois não volta a acompanhar. */
  private parado = false;

  /**
   * `aoIniciar`: a conversa que este controle começou (`comecarTarefa`) ganhou o id. `aoTerminar`: o
   * acompanhamento terminou sozinho, porque a conversa foi apagada (em outra janela, ou por outra conexão).
   */
  constructor(
    api: Api,
    opcoes: {
      readonly provider?: Provider;
      readonly aoIniciar?: (sessao: string) => void;
      readonly aoTerminar?: (sessao: string) => void;
    } = {},
  ) {
    this.api = api;
    this.estado = estadoInicial(opcoes.provider);
    this.aoIniciar = opcoes.aoIniciar;
    this.aoTerminar = opcoes.aoTerminar;
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
    if (this.parado) return;
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
      (fim) => {
        if (this.acompanhamento !== acompanhamento) return;
        this.acompanhamento = undefined;
        // O servidor só encerra o fluxo quando a conversa é apagada: quem a mostra diz que ela não existe mais.
        if (fim !== "concluido" || this.parado || this.estado.sessao !== sessao) return;
        this.despachar({ tipo: "naoCarregou", erro: { texto: CONVERSA_INEXISTENTE } });
        this.aoTerminar?.(sessao);
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

  /**
   * Deixa de acompanhar a conversa de vez (ninguém mais a mostra): nem a carga em curso volta a acompanhar.
   * A sessão do provider fica no servidor.
   */
  parar(): void {
    this.parado = true;
    this.soltar();
  }

  /** Deixa de acompanhar a conversa corrente. */
  private soltar(): void {
    this.acompanhamento?.cancelar();
    this.acompanhamento = undefined;
    this.pararEspera?.();
    this.pararEspera = undefined;
    this.quedasSeguidas = 0;
  }

  /**
   * Começa a conversa de uma tarefa (M1.9): a pasta já criada pelo servidor (`pasta.criar`), com os
   * anexos, e o pedido montado pelo formulário ou escrito na caixa do Início, enviado em seguida. Sem
   * `tarefa` (a caixa do Início), a conversa é livre.
   * Devolve o id da conversa; a falha vira `erroInicio` e a promessa rejeita.
   */
  async comecarTarefa(tarefa: {
    readonly ia: EscolhaDaIa;
    readonly pasta: string;
    readonly tarefa?: string | undefined;
    readonly pedido: string;
  }): Promise<string> {
    this.soltar();
    this.despachar({ tipo: "nova" });
    this.despachar({ tipo: "escolher", provider: tarefa.ia.provider, pastaTrabalho: tarefa.pasta });
    this.despachar({ tipo: "iniciando" });
    try {
      const { sessao } = await this.api.chamar((cliente) =>
        cliente["conversa.iniciar"]({
          ...tarefa.ia,
          pastaTrabalho: tarefa.pasta,
          ...(tarefa.tarefa === undefined ? {} : { tarefa: tarefa.tarefa }),
        }),
      );
      if (this.fase() !== "iniciando") {
        void this.encerrarNoServidor(sessao);
        throw new Error("A conversa foi trocada antes de abrir.");
      }
      this.despachar({ tipo: "iniciada", sessao, ...(tarefa.tarefa === undefined ? {} : { tarefa: tarefa.tarefa }) });
      this.aoIniciar?.(sessao);
      this.seguir(sessao);
      void this.enviar(tarefa.pedido);
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
  abrir(sessao: string): Promise<void> {
    if (this.estado.sessao === sessao && this.estado.fase !== "configurando") return this.aposAbrir();
    this.carregamento = this.carregar(sessao);
    return this.carregamento;
  }

  /** Espera a conversa aberta por `abrir` chegar (ou falhar). */
  aposAbrir(): Promise<void> {
    return this.carregamento ?? Promise.resolve();
  }

  private async carregar(sessao: string): Promise<void> {
    this.soltar();
    this.despachar({ tipo: "abrindo", sessao });
    try {
      const gravada = await this.api.chamar((cliente) => cliente["conversa.carregar"]({ sessao }));
      // A pessoa pode ter aberto outra (ou começado uma nova) enquanto esta carregava, ou ninguém mais a mostra.
      if (this.parado || this.estado.sessao !== sessao || this.fase() !== "carregando") return;
      this.despachar({ tipo: "carregada", gravada });
      this.seguir(sessao);
    } catch (erro) {
      if (this.estado.sessao !== sessao) return;
      const mensagem = explicarErro(erro);
      this.despachar({
        tipo: "naoCarregou",
        erro: ehSessaoDesconhecida(erro) ? { texto: CONVERSA_INEXISTENTE } : mensagem,
      });
    }
  }

  /**
   * Envia a mensagem, com as fichas de contexto: ela aparece já (pendente), e o servidor abre o turno; a
   * resposta chega pelo acompanhamento da conversa. Se o servidor recusar, a mensagem sai e o erro aparece
   * na conversa; se a recusa é o aviso de uso, só sai, e quem enviou mostra o aviso.
   */
  async enviar(texto: string, fichas: ReadonlyArray<FichaContexto> = []): Promise<ResultadoEnvio> {
    const sessao = this.estado.sessao;
    const limpo = texto.trim();
    if (sessao === undefined || this.estado.fase !== "pronta" || limpo.length === 0) return "falhou";
    this.despachar({ tipo: "enviada", texto: limpo, fichas });
    if (this.acompanhamento === undefined && this.pararEspera === undefined) this.seguir(sessao);
    try {
      await this.api.chamar((cliente) =>
        cliente["conversa.enviar"]({ sessao, texto: limpo, ...(fichas.length === 0 ? {} : { fichas: [...fichas] }) }),
      );
      return "enviada";
    } catch (erro) {
      const aviso = ehAvisoNaoAceito(erro);
      if (this.estado.sessao === sessao)
        this.despachar({ tipo: "naoEnviou", ...(aviso ? {} : { erro: explicarErro(erro) }) });
      return aviso ? "avisoNaoAceito" : "falhou";
    }
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
   * A tela mostrou a conversa: a resposta que terminou deixa de ser "resposta pronta" na bandeja. Sem efeito
   * na tela; a falha (a conexão caiu) só deixa a marca para a próxima vez.
   */
  async marcarVista(): Promise<void> {
    const sessao = this.estado.sessao;
    if (sessao === undefined) return;
    try {
      await this.api.chamar((cliente) => cliente["conversa.marcarVista"]({ sessao }));
    } catch {
      // A bandeja continua com a resposta pronta até a próxima vez que a conversa aparecer.
    }
  }

  /**
   * Continua a conversa com outra IA (`docs/plans/multitarefa.md`, "Limite da assinatura"): a nova, na mesma
   * pasta, e o que vai à caixa dela (o histórico, as fichas da última mensagem e a última pergunta). Esta
   * passa a dizer com que IA continuou.
   */
  async continuarCom(
    provider: Provider,
  ): Promise<{ readonly sessao: string; readonly continuacao: Continuacao | undefined }> {
    const sessao = this.estado.sessao;
    if (sessao === undefined) throw new Error("A conversa ainda não abriu.");
    const nova = await this.api.chamar((cliente) =>
      cliente["conversa.iniciar"]({ provider, pastaTrabalho: this.estado.pastaTrabalho, continuaDe: sessao }),
    );
    if (this.estado.sessao === sessao) this.despachar({ tipo: "continuada", id: nova.sessao, provider });
    return { sessao: nova.sessao, continuacao: nova.continuacao };
  }

  /** A conversa foi apagada: deixa de acompanhá-la e volta ao começo (ela não existe mais no servidor). */
  apagada(): void {
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
