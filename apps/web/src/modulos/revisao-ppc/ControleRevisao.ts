/**
 * A revisão de PPC corrente: entrada, leitura inicial (`revisaoPpc.revisar`), lista viva de
 * pendências, leitura com IA bloco a bloco (`revisaoPpc.acompanharIa`) e ações por pendência. Fica
 * fora do React (espelhando `ControleConversa`) para que a revisão e a leitura com IA sobrevivam à
 * troca de tela e para que os testes a exercitem sem navegador; a interface lê o estado com
 * `useSyncExternalStore` (`obter` e `observar`).
 *
 * Recarga serializada: cada bloco pronto da IA (e o fim em `situacao === "concluida"`) agenda uma
 * recarga da lista (`revisaoPpc.lista`) numa fila de uma por vez com coalescência. Quando o último
 * bloco conclui a revisão, acontece uma única recarga e a contagem de pontos novos e a frase de
 * conclusão saem de forma determinística.
 *
 * Recuperação de arquivo: toda ação que pode receber `FalhaRevisaoPpc` com `escolherDeNovo` (lista,
 * leitura com IA ou ação de pendência) registra a repetição num ponto só (`escolherArquivoDeNovo`), que
 * aceita o arquivo que o servidor pediu (o revisado ou, no "Reconferir com a IA", o acompanhado).
 *
 * Conferência ao salvar: com a revisão acompanhando um arquivo no Word ("Acompanhar no Word"), o fluxo
 * `revisaoPpc.acompanharLista` fica aberto enquanto a lista está aberta e traz a lista a cada mudança e o
 * resultado de cada salvamento conferido: as resolvidas ganham um realce breve, as novas entram "novo".
 * O arquivo acompanhado que perdeu a liberação (o app foi fechado) é pedido de novo à parte
 * (`escolherAcompanhadoDeNovo`), porque não é o arquivo revisado. Numa queda da conexão, o fluxo volta
 * (na hora, na primeira; depois, quando a conexão voltar), e a volta à janela também o reabre.
 */
import type { Provider } from "@simplifica-if/contratos-app";
import type {
  EstadoRevisaoIa,
  EstimativaAcao,
  EtapaLeituraPpc,
  ListaPendencias,
  ModoRevisaoIa,
} from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import type { Acompanhamento, Api } from "../../conexao/api.ts";
import { ehQuedaDaConexao, explicarErro, type MensagemErro } from "../../conexao/erros.ts";
import { detectarIa } from "../../deteccao.ts";
import { ponteDesktop } from "../../ponte-desktop.ts";
import { DESCRICOES, PROVIDERS } from "../../providers.ts";
import { nomeDoArquivo } from "../../lib/texto.ts";
import { arquivoPedido, obterArquivo, pedeArquivoDeNovo, textoMesmoArquivo } from "./arquivo.ts";
import { blocosProntos, leiturasPorTerminar, textoConclusao } from "./ia.ts";
import { chavesNovas, textoArquivoNovo, type UltimaConferencia } from "./lista.ts";

/** As pendências da IA que a lista nova tem e a anterior não (as do código chegam pelo `conferido`). */
const chegaramDaIa = (antes: ListaPendencias, depois: ListaPendencias): ReadonlyArray<string> => {
  const daIa = new Set(depois.pendencias.filter((v) => v.pendencia.origem === "ia").map((v) => v.chave));
  return chavesNovas(antes, depois).filter((chave) => daIa.has(chave));
};

export type FaseRevisao = "entrada" | "lendo" | "carregando" | "resultado";

export type OrigemArquivoDeNovo = "lista" | "ia" | { readonly pendencia: string };

export interface EstadoIaRevisao {
  /** A IA escolhida pela pessoa (ou `undefined` para usar a primeira usável). */
  readonly providerEscolhido: Provider | undefined;
  /** As IAs prontas e não desligadas (`undefined` enquanto ainda detecta). */
  readonly usaveis: ReadonlyArray<Provider> | undefined;
  readonly modo: ModoRevisaoIa;
  /** A leitura (preparada, em andamento, pausada, concluída ou que falhou). */
  readonly estado: EstadoRevisaoIa | undefined;
  readonly estimando: boolean;
  /** Ainda procurando as IAs prontas ou uma leitura por terminar. */
  readonly carregando: boolean;
  /** O aviso de uso ainda não foi aceito: nada vai à IA antes. */
  readonly avisoPendente: boolean;
  readonly erro: MensagemErro | undefined;
  readonly ocupada: boolean;
}

/** Quanto tempo a pendência que o salvamento resolveu fica realçada. */
export const REALCE_MS = 4000;

/** A conferência ao salvar do arquivo acompanhado no Word. */
export interface EstadoAcompanhamento {
  /** "Acompanhar no Word" em curso (a cópia comentada gravada, depois aberta). */
  readonly abrindo: boolean;
  /** O resultado do último salvamento conferido, ou do que não pôde ser conferido. */
  readonly ultima: UltimaConferencia | undefined;
  /** O arquivo acompanhado perdeu a liberação (o app foi fechado): a pessoa o escolhe de novo. */
  readonly pedeArquivo: boolean;
  /** As pendências que o último salvamento resolveu, realçadas por `REALCE_MS`. */
  readonly realce: ReadonlySet<string>;
  /** "Reconferir com a IA" as pendências da IA marcadas "Feito", uma por vez. */
  readonly reconferindo: boolean;
  readonly erro: MensagemErro | undefined;
}

export const estadoAcompanhamentoInicial = (): EstadoAcompanhamento => ({
  abrindo: false,
  ultima: undefined,
  pedeArquivo: false,
  realce: new Set(),
  reconferindo: false,
  erro: undefined,
});

export interface EstadoRevisao {
  readonly fase: FaseRevisao;
  /** O id da lista sendo carregada ou aberta. */
  readonly listaId: string | undefined;
  /** A lista aberta (quando `fase === "resultado"`). */
  readonly lista: ListaPendencias | undefined;
  /** Quando `fase === "lendo"`: o arquivo e a etapa atual. */
  readonly arquivoLendo: string | undefined;
  readonly etapaLendo: EtapaLeituraPpc | null;
  /** Erro na tela de entrada (revisão que falhou ou lista que não abriu). */
  readonly erroEntrada: MensagemErro | undefined;

  readonly tema: number | null;
  readonly aberta: string | null;
  readonly novas: ReadonlySet<string>;
  readonly conclusao: string | null;
  readonly aviso: string | null;
  readonly erro: MensagemErro | undefined;
  /** Erro da última ação numa pendência (sugerir, discordar, reconferir). */
  readonly erroPendencia: { readonly chave: string; readonly erro: MensagemErro } | undefined;
  /** Onde oferecer "Escolher o arquivo de novo" quando o servidor pediu o arquivo outra vez. */
  readonly origemArquivoDeNovo: OrigemArquivoDeNovo | undefined;
  readonly marcando: string | null;
  readonly acaoPendencia: string | null;
  readonly abrindoWord: boolean;
  readonly caminhoCopia: string | null;
  readonly enviandoCorrigida: boolean;
  readonly trocandoCurso: boolean;
  readonly ia: EstadoIaRevisao;
  readonly acompanhamento: EstadoAcompanhamento;
}

export const estadoIaInicial = (): EstadoIaRevisao => ({
  providerEscolhido: undefined,
  usaveis: undefined,
  modo: "rapido",
  estado: undefined,
  estimando: false,
  carregando: false,
  avisoPendente: false,
  erro: undefined,
  ocupada: false,
});

export const estadoInicialRevisao = (): EstadoRevisao => ({
  fase: "entrada",
  listaId: undefined,
  lista: undefined,
  arquivoLendo: undefined,
  etapaLendo: null,
  erroEntrada: undefined,
  tema: null,
  aberta: null,
  novas: new Set(),
  conclusao: null,
  aviso: null,
  erro: undefined,
  erroPendencia: undefined,
  origemArquivoDeNovo: undefined,
  marcando: null,
  acaoPendencia: null,
  abrindoWord: false,
  caminhoCopia: null,
  enviandoCorrigida: false,
  trocandoCurso: false,
  ia: estadoIaInicial(),
  acompanhamento: estadoAcompanhamentoInicial(),
});

/** A IA efetiva da faixa (a escolhida, a primeira usável ou a padrão). */
export const providerEfetivoIa = (ia: EstadoIaRevisao): Provider =>
  ia.providerEscolhido ?? ia.usaveis?.[0] ?? PROVIDERS[0]!;

/** A IA das ações por pendência (a da lista, ou a efetiva da faixa). */
export const providerDaRevisao = (estado: EstadoRevisao): Provider =>
  estado.lista?.provider ?? providerEfetivoIa(estado.ia);

/** Nenhuma IA pronta e habilitada neste computador. */
export const semIaDisponivel = (ia: EstadoIaRevisao): boolean => ia.usaveis !== undefined && ia.usaveis.length === 0;

/** A leitura com IA está rodando neste momento. */
export const lendoComIa = (estado: EstadoRevisao): boolean => estado.ia.estado?.situacao === "em_andamento";

const ehAvisoNaoAceito = (erro: unknown) =>
  typeof erro === "object" && erro !== null && (erro as { readonly _tag?: unknown })._tag === "AvisoNaoAceito";

const mesmaOrigem = (a: OrigemArquivoDeNovo | undefined, b: OrigemArquivoDeNovo): boolean => {
  if (a === undefined) return false;
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.pendencia === b.pendencia;
};

interface AcaoPendenteArquivo {
  readonly listaId: string;
  readonly origem: OrigemArquivoDeNovo;
  /** O arquivo que o servidor pediu de novo. */
  readonly arquivo: string;
  readonly repetir: () => Promise<boolean>;
}

interface RecargaPendente {
  readonly listaId: string;
  readonly conclusaoProvider?: Provider;
}

export class ControleRevisao {
  private estado: EstadoRevisao;
  private readonly observadores = new Set<() => void>();
  private readonly api: Api;
  /** O stream de `revisaoPpc.revisar` em curso. */
  private leituraArquivo: Acompanhamento | undefined;
  /** O stream de `revisaoPpc.acompanharIa` em curso. */
  private acompanhamentoIa: Acompanhamento | undefined;
  /** Geração da inicialização da IA (descarta respostas de listas ou versões anteriores). */
  private geracaoIa = 0;
  /** Geração da estimativa (`prepararIa`), para descartar estimativas de opções antigas. */
  private geracaoEstimativa = 0;
  /** Quantos blocos prontos já foram vistos no stream da IA atual. */
  private blocosVistos = 0;
  /** Quantas pendências novas chegaram durante a leitura em curso (para a frase de conclusão). */
  private novasDaLeitura = 0;
  /** Evita emitir a frase de conclusão mais de uma vez para a mesma leitura. */
  private conclusaoEmitida = false;
  /** Fila serializada de recargas da lista (`revisaoPpc.lista`). */
  private recargaEmCurso: Promise<void> | undefined;
  private recargaPendente: RecargaPendente | undefined;
  /** A última ação que falhou com `pedeArquivoDeNovo`, pronta para repetir. */
  private acaoPendenteArquivo: AcaoPendenteArquivo | undefined;
  /** O stream de `revisaoPpc.acompanharLista` em curso, e a lista dele. */
  private acompanhamentoLista: { readonly lista: string; readonly fluxo: Acompanhamento } | undefined;
  private relogioRealce: ReturnType<typeof setTimeout> | undefined;
  /** Para de esperar a conexão voltar para reabrir o fluxo da lista. */
  private pararEsperaLista: (() => void) | undefined;

  private readonly aoTrocarLista: ((antiga: string, nova: string) => void) | undefined;
  private readonly aoApagarFora: ((lista: ListaPendencias) => void) | undefined;

  /**
   * `aoTrocarLista`: "Qual é o curso?" refez a lista com outro id (a antiga saiu). `aoApagarFora`: a lista
   * aberta foi apagada fora daqui (em outra janela, ou por falta de uso): o fluxo dela terminou. `inicial`:
   * o estado de partida (os testes de uma peça só).
   */
  constructor(
    api: Api,
    opcoes: {
      readonly inicial?: EstadoRevisao;
      readonly aoTrocarLista?: (antiga: string, nova: string) => void;
      readonly aoApagarFora?: (lista: ListaPendencias) => void;
    } = {},
  ) {
    this.api = api;
    this.estado = opcoes.inicial ?? estadoInicialRevisao();
    this.aoTrocarLista = opcoes.aoTrocarLista;
    this.aoApagarFora = opcoes.aoApagarFora;
  }

  readonly obter = (): EstadoRevisao => this.estado;

  readonly observar = (aviso: () => void): (() => void) => {
    this.observadores.add(aviso);
    return () => this.observadores.delete(aviso);
  };

  private atualizar(parcial: Partial<EstadoRevisao>): void {
    this.estado = { ...this.estado, ...parcial };
    for (const aviso of this.observadores) aviso();
  }

  private atualizarIa(parcial: Partial<EstadoIaRevisao>): void {
    this.atualizar({ ia: { ...this.estado.ia, ...parcial } });
  }

  private atualizarAcompanhamento(parcial: Partial<EstadoAcompanhamento>): void {
    this.atualizar({ acompanhamento: { ...this.estado.acompanhamento, ...parcial } });
  }

  private soltarAcompanhamento(): void {
    this.acompanhamentoLista?.fluxo.cancelar();
    this.acompanhamentoLista = undefined;
    this.pararEsperaLista?.();
    this.pararEsperaLista = undefined;
    clearTimeout(this.relogioRealce);
    this.relogioRealce = undefined;
  }

  private soltarLeituraArquivo(): void {
    this.leituraArquivo?.cancelar();
    this.leituraArquivo = undefined;
  }

  private soltarIa(): void {
    this.acompanhamentoIa?.cancelar();
    this.acompanhamentoIa = undefined;
    this.geracaoIa += 1;
    this.geracaoEstimativa += 1;
    this.blocosVistos = 0;
    this.novasDaLeitura = 0;
    this.conclusaoEmitida = false;
  }

  /** Cancela streams ativos (para encerramento do app ou testes). */
  encerrar(): void {
    this.soltarLeituraArquivo();
    this.soltarIa();
    this.soltarAcompanhamento();
  }

  /** Volta à entrada ("Revisar outro arquivo" ou depois de apagar). */
  sair(): void {
    this.soltarLeituraArquivo();
    this.soltarIa();
    this.soltarAcompanhamento();
    this.acaoPendenteArquivo = undefined;
    this.recargaPendente = undefined;
    this.estado = estadoInicialRevisao();
    for (const aviso of this.observadores) aviso();
  }

  /** Inicia a revisão de um `.docx` novo; devolve o id da lista aberta ou `undefined` se cancelou/falhou. */
  async revisar(arquivo: string): Promise<string | undefined> {
    this.soltarLeituraArquivo();
    this.soltarIa();
    this.soltarAcompanhamento();
    this.acaoPendenteArquivo = undefined;
    this.recargaPendente = undefined;
    this.atualizar({
      ...estadoInicialRevisao(),
      fase: "lendo",
      arquivoLendo: arquivo,
      etapaLendo: null,
    });
    let listaId: string | undefined;
    const acompanhamento = this.api.acompanhar(
      (c) => c["revisaoPpc.revisar"]({ arquivo }),
      (evento) => {
        if (this.leituraArquivo !== acompanhamento) return;
        if (evento.tipo === "etapa") this.atualizar({ etapaLendo: evento.etapa });
        else listaId = evento.lista;
      },
    );
    this.leituraArquivo = acompanhamento;
    try {
      const fim = await acompanhamento.fim;
      if (this.leituraArquivo === acompanhamento) this.leituraArquivo = undefined;
      if (fim === "cancelado" || this.estado.fase !== "lendo") return undefined;
      if (listaId === undefined) throw new Error("a revisão terminou sem a lista de pendências");
      const id = listaId;
      const aberta = await this.api.chamar((c) => c["revisaoPpc.lista"]({ lista: id }));
      if (this.estado.fase !== "lendo") return undefined;
      this.entrarNaLista(aberta);
      return aberta.id;
    } catch (erro) {
      if (this.leituraArquivo === acompanhamento) this.leituraArquivo = undefined;
      if (this.estado.fase === "lendo") {
        this.atualizar({
          ...estadoInicialRevisao(),
          fase: "entrada",
          erroEntrada: explicarErro(erro),
        });
      }
      return undefined;
    }
  }

  /**
   * Abre a lista pelo id (`revisaoPpc.lista`). Se ela já está aberta (ou carregando), não faz nada:
   * voltar para `/revisao-ppc?id=...` preserva o estado e o stream da IA.
   */
  async abrir(listaId: string): Promise<void> {
    if (this.estado.listaId === listaId && (this.estado.fase === "resultado" || this.estado.fase === "carregando")) {
      return;
    }
    this.soltarLeituraArquivo();
    this.soltarIa();
    this.soltarAcompanhamento();
    this.acaoPendenteArquivo = undefined;
    this.recargaPendente = undefined;
    this.atualizar({
      ...estadoInicialRevisao(),
      fase: "carregando",
      listaId,
    });
    try {
      const aberta = await this.api.chamar((c) => c["revisaoPpc.lista"]({ lista: listaId }));
      if (this.estado.listaId !== listaId || this.estado.fase !== "carregando") return;
      this.entrarNaLista(aberta);
    } catch (erro) {
      if (this.estado.listaId !== listaId) return;
      this.atualizar({
        ...estadoInicialRevisao(),
        fase: "entrada",
        erroEntrada: explicarErro(erro),
      });
    }
  }

  /** Abre uma lista já carregada (por exemplo, da tela de entrada), preservando-a se já é a corrente. */
  abrirLista(lista: ListaPendencias): void {
    if (
      this.estado.fase === "resultado" &&
      this.estado.lista?.id === lista.id &&
      this.estado.lista.sha256 === lista.sha256
    ) {
      this.atualizar({ lista });
      return;
    }
    this.soltarLeituraArquivo();
    this.soltarIa();
    this.soltarAcompanhamento();
    this.acaoPendenteArquivo = undefined;
    this.recargaPendente = undefined;
    this.entrarNaLista(lista);
  }

  private entrarNaLista(lista: ListaPendencias): void {
    this.atualizar({
      ...estadoInicialRevisao(),
      fase: "resultado",
      listaId: lista.id,
      lista,
    });
    void this.inicializarIa(lista);
    if (lista.arquivoAcompanhado !== null) this.acompanharLista(lista.id);
  }

  /* ---------------------------------------------------------------- navegação na lista */

  escolherTema(tema: number | null): void {
    this.atualizar({ tema });
  }

  alternarPendencia(chave: string): void {
    const abrindo = this.estado.aberta !== chave;
    const novas = new Set(this.estado.novas);
    novas.delete(chave);
    const limparErro = !abrindo && this.estado.erroPendencia?.chave === chave;
    const limparArquivo =
      !abrindo &&
      typeof this.estado.origemArquivoDeNovo === "object" &&
      this.estado.origemArquivoDeNovo.pendencia === chave;
    if (limparArquivo) this.acaoPendenteArquivo = undefined;
    this.atualizar({
      aberta: abrindo ? chave : null,
      novas,
      ...(limparErro ? { erroPendencia: undefined } : {}),
      ...(limparArquivo ? { origemArquivoDeNovo: undefined } : {}),
    });
  }

  fecharConclusao(): void {
    this.atualizar({ conclusao: null });
  }

  fecharAviso(): void {
    this.atualizar({ aviso: null });
  }

  limparErroPendencia(chave: string): void {
    if (this.estado.erroPendencia?.chave === chave) this.atualizar({ erroPendencia: undefined });
  }

  /* ---------------------------------------------------------------- recuperação unificada de arquivo */

  private registrarErro(origem: OrigemArquivoDeNovo, motivo: unknown, repetir?: () => Promise<boolean>): void {
    const explicado = explicarErro(motivo);
    const listaId = this.estado.lista?.id;
    const pedir = repetir !== undefined && listaId !== undefined && pedeArquivoDeNovo(motivo);
    if (pedir) {
      const arquivo = arquivoPedido(motivo) ?? this.estado.lista?.arquivoOriginal ?? "";
      this.acaoPendenteArquivo = { listaId, origem, arquivo, repetir };
    } else if (mesmaOrigem(this.acaoPendenteArquivo?.origem, origem)) {
      this.acaoPendenteArquivo = undefined;
    }
    const origemAtual = pedir
      ? origem
      : mesmaOrigem(this.estado.origemArquivoDeNovo, origem)
        ? undefined
        : this.estado.origemArquivoDeNovo;

    if (origem === "lista") {
      this.atualizar({ erro: explicado, origemArquivoDeNovo: origemAtual });
    } else if (origem === "ia") {
      this.atualizar({
        origemArquivoDeNovo: origemAtual,
        ia: { ...this.estado.ia, erro: explicado },
      });
    } else {
      this.atualizar({
        erroPendencia: { chave: origem.pendencia, erro: explicado },
        origemArquivoDeNovo: origemAtual,
      });
    }
  }

  private limparErroOrigem(origem: OrigemArquivoDeNovo): void {
    if (mesmaOrigem(this.acaoPendenteArquivo?.origem, origem)) this.acaoPendenteArquivo = undefined;
    const origemAtual = mesmaOrigem(this.estado.origemArquivoDeNovo, origem)
      ? undefined
      : this.estado.origemArquivoDeNovo;
    if (origem === "lista") {
      this.atualizar({ erro: undefined, origemArquivoDeNovo: origemAtual });
    } else if (origem === "ia") {
      this.atualizar({
        origemArquivoDeNovo: origemAtual,
        ia: { ...this.estado.ia, erro: undefined },
      });
    } else {
      const erroPendencia =
        this.estado.erroPendencia?.chave === origem.pendencia ? undefined : this.estado.erroPendencia;
      this.atualizar({ erroPendencia, origemArquivoDeNovo: origemAtual });
    }
  }

  /**
   * Escolhe o mesmo arquivo de novo (no desktop) e repete a ação que falhou com `pedeArquivoDeNovo`
   * (seja da lista, da leitura com IA ou de uma pendência). Devolve `true` se a ação repetida teve
   * sucesso.
   */
  async escolherArquivoDeNovo(escolherDocx?: () => Promise<string | null>): Promise<boolean> {
    const pendente = this.acaoPendenteArquivo;
    const lista = this.estado.lista;
    const obter = escolherDocx ?? ponteDesktop()?.escolherDocx;
    if (pendente === undefined || lista === undefined || pendente.listaId !== lista.id || obter === undefined) {
      return false;
    }
    const obtido = await obterArquivo(obter);
    if (obtido === undefined) return false;
    if ("erro" in obtido) {
      this.reportarErroDeArquivo(pendente.origem, obtido.erro);
      return false;
    }
    if (obtido.arquivo !== pendente.arquivo) {
      this.reportarErroDeArquivo(pendente.origem, textoMesmoArquivo(pendente.arquivo));
      return false;
    }
    this.limparErroOrigem(pendente.origem);
    return pendente.repetir();
  }

  private reportarErroDeArquivo(origem: OrigemArquivoDeNovo, erro: MensagemErro): void {
    if (origem === "lista") this.atualizar({ erro });
    else if (origem === "ia") this.atualizarIa({ erro });
    else this.atualizar({ erroPendencia: { chave: origem.pendencia, erro } });
  }

  /* ---------------------------------------------------------------- ações da lista */

  async marcar(chave: string, situacao: "aberta" | "resolvida"): Promise<void> {
    const lista = this.estado.lista;
    if (lista === undefined) return;
    this.limparErroOrigem("lista");
    this.atualizar({ marcando: chave });
    try {
      const nova = await this.api.chamar((c) => c["revisaoPpc.marcar"]({ lista: lista.id, chave, situacao }));
      if (this.estado.lista?.id !== lista.id) return;
      this.atualizar({
        lista: nova,
        marcando: null,
        aberta: situacao === "resolvida" && this.estado.aberta === chave ? null : this.estado.aberta,
      });
    } catch (motivo) {
      this.atualizar({ marcando: null });
      this.registrarErro("lista", motivo);
    }
  }

  async abrirNoWord(abrirDocumento?: (caminho: string) => Promise<void>): Promise<boolean> {
    const lista = this.estado.lista;
    if (lista === undefined) return false;
    const abrir = abrirDocumento ?? ponteDesktop()?.abrirDocumento;
    // Acompanhando um arquivo, "Abrir no Word" abre esse, sem gravar uma cópia da cópia.
    if (lista.arquivoAcompanhado !== null) return this.abrirAcompanhado(lista.arquivoAcompanhado, abrir);
    this.limparErroOrigem("lista");
    this.atualizar({ abrindoWord: true });
    try {
      const nova = await this.api.chamar((c) => c["revisaoPpc.gerarCopia"]({ lista: lista.id }));
      if (this.estado.lista?.id !== lista.id) return false;
      const copia = nova.resultado.arquivoComentado;
      this.atualizar({ lista: nova, ...(abrir === undefined ? { caminhoCopia: copia } : {}) });
      if (abrir !== undefined) {
        await abrir(copia).catch(() =>
          this.atualizar({
            erro: {
              texto:
                "Não foi possível abrir a cópia comentada. Ela pode estar aberta em outro programa, ou a pasta pode ter mudado; tente de novo.",
            },
          }),
        );
      }
      this.atualizar({ abrindoWord: false });
      return true;
    } catch (motivo) {
      this.atualizar({ abrindoWord: false });
      this.registrarErro("lista", motivo, () => this.abrirNoWord(abrirDocumento));
      return false;
    }
  }

  async mostrarNaPasta(mostrar: (caminho: string) => Promise<void>): Promise<void> {
    const lista = this.estado.lista;
    if (lista === undefined) return;
    this.limparErroOrigem("lista");
    try {
      await mostrar(lista.resultado.arquivoComentado);
    } catch (motivo) {
      this.registrarErro("lista", motivo);
    }
  }

  /** "Qual é o curso?": refaz a lista com o curso escolhido sem perder a leitura com IA. */
  async trocarCurso(cnct: string): Promise<boolean> {
    const lista = this.estado.lista;
    if (lista === undefined) return false;
    const forma = lista.resultado.curso.forma;
    this.limparErroOrigem("lista");
    this.atualizar({ trocandoCurso: true });
    try {
      const nova = await this.api.chamar((c) =>
        c["revisaoPpc.trocarCurso"]({ lista: lista.id, cnct, ...(forma === null ? {} : { forma }) }),
      );
      if (this.estado.lista?.id !== lista.id) return false;
      this.soltarIa();
      this.soltarAcompanhamento();
      this.acaoPendenteArquivo = undefined;
      this.atualizar({
        listaId: nova.id,
        lista: nova,
        trocandoCurso: false,
        aberta: null,
        novas: new Set(),
        conclusao: null,
        origemArquivoDeNovo: undefined,
        acompanhamento: estadoAcompanhamentoInicial(),
      });
      void this.inicializarIa(nova);
      if (nova.arquivoAcompanhado !== null) this.acompanharLista(nova.id);
      this.aoTrocarLista?.(lista.id, nova.id);
      return true;
    } catch (motivo) {
      this.atualizar({ trocandoCurso: false });
      this.registrarErro("lista", motivo, () => this.trocarCurso(cnct));
      return false;
    }
  }

  async enviarCorrigida(arquivo: string): Promise<void> {
    const lista = this.estado.lista;
    if (lista === undefined) return;
    this.limparErroOrigem("lista");
    this.atualizar({ enviandoCorrigida: true, aviso: null });
    try {
      const novo = await this.api.chamar((c) => c["revisaoPpc.revisarArquivoNovo"]({ lista: lista.id, arquivo }));
      if (this.estado.lista?.id !== lista.id) return;
      this.soltarIa();
      this.acaoPendenteArquivo = undefined;
      // O fluxo da lista continua (a mesma lista): o servidor ajusta o vigia ao acompanhado que ficou.
      clearTimeout(this.relogioRealce);
      this.atualizar({
        listaId: novo.lista.id,
        lista: novo.lista,
        enviandoCorrigida: false,
        aviso: textoArquivoNovo(novo),
        novas: new Set(),
        conclusao: null,
        origemArquivoDeNovo: undefined,
        acompanhamento: { ...estadoAcompanhamentoInicial(), reconferindo: this.estado.acompanhamento.reconferindo },
      });
      void this.inicializarIa(novo.lista);
    } catch (motivo) {
      this.atualizar({ enviandoCorrigida: false });
      this.registrarErro("lista", motivo);
    }
  }

  async exportarDiscordancias(): Promise<string | undefined> {
    this.limparErroOrigem("lista");
    try {
      return await this.api.chamar((c) => c["revisaoPpc.exportarDiscordancias"]({}));
    } catch (motivo) {
      this.registrarErro("lista", motivo);
      return undefined;
    }
  }

  async apagarLista(): Promise<void> {
    const lista = this.estado.lista;
    if (lista === undefined) return;
    // O fluxo da lista terminaria com ela: daqui, não é a revisão apagada em outra janela.
    this.soltarAcompanhamento();
    try {
      await this.api.chamar((c) => c["revisaoPpc.apagarLista"]({ lista: lista.id }));
    } catch (motivo) {
      if (this.estado.lista?.id === lista.id && lista.arquivoAcompanhado !== null) this.acompanharLista(lista.id);
      throw motivo;
    }
  }

  /* ---------------------------------------------------------------- ações por pendência */

  estimarAcao(chave: string, acao: "sugerir" | "contestar" | "revisarDeNovo"): Promise<EstimativaAcao> {
    const lista = this.estado.lista;
    if (lista === undefined) return Promise.reject(new Error("Nenhuma revisão aberta."));
    const provider = providerDaRevisao(this.estado);
    return this.api.chamar((c) => c["revisaoPpc.estimarAcao"]({ lista: lista.id, chave, acao, provider }));
  }

  private async executarAcaoPendencia(
    chave: string,
    executar: (listaId: string, provider: Provider) => Promise<ListaPendencias>,
    repetir: () => Promise<boolean>,
  ): Promise<boolean> {
    const lista = this.estado.lista;
    if (lista === undefined) return false;
    const provider = providerDaRevisao(this.estado);
    const origem: OrigemArquivoDeNovo = { pendencia: chave };
    this.limparErroOrigem(origem);
    this.atualizar({ acaoPendencia: chave });
    try {
      const nova = await executar(lista.id, provider);
      if (this.estado.lista?.id !== lista.id) return false;
      this.atualizar({ lista: nova, acaoPendencia: null });
      return true;
    } catch (motivo) {
      this.atualizar({ acaoPendencia: null });
      this.registrarErro(origem, motivo, repetir);
      return false;
    }
  }

  sugerir(chave: string): Promise<boolean> {
    return this.executarAcaoPendencia(
      chave,
      (lista, provider) => this.api.chamar((c) => c["revisaoPpc.sugerir"]({ lista, chave, provider })),
      () => this.sugerir(chave),
    );
  }

  contestar(chave: string, motivo: string): Promise<boolean> {
    return this.executarAcaoPendencia(
      chave,
      (lista, provider) => this.api.chamar((c) => c["revisaoPpc.contestar"]({ lista, chave, motivo, provider })),
      () => this.contestar(chave, motivo),
    );
  }

  revisarDeNovo(chave: string, arquivo: string): Promise<boolean> {
    return this.executarAcaoPendencia(
      chave,
      (lista, provider) => this.api.chamar((c) => c["revisaoPpc.revisarDeNovo"]({ lista, chave, arquivo, provider })),
      () => this.revisarDeNovo(chave, arquivo),
    );
  }

  /* ---------------------------------------------------------------- conferência ao salvar */

  private async abrirAcompanhado(
    arquivo: string,
    abrir: ((caminho: string) => Promise<void>) | undefined,
  ): Promise<boolean> {
    if (abrir === undefined) {
      this.atualizar({ caminhoCopia: arquivo });
      return true;
    }
    try {
      await abrir(arquivo);
      return true;
    } catch {
      this.atualizarAcompanhamento({
        erro: {
          texto: `Não foi possível abrir “${nomeDoArquivo(arquivo)}” no Word. Ele pode ter mudado de pasta; escolha o arquivo de novo pelo menu ⋯.`,
        },
      });
      return false;
    }
  }

  /**
   * "Acompanhar no Word": sem `arquivo`, a cópia comentada (regravada se a lista mudou); com `arquivo`,
   * o `.docx` escolhido. A lista passa a acompanhar o arquivo, que abre no Word, e o fluxo da lista
   * confere cada salvamento.
   */
  async acompanharNoWord(arquivo?: string, abrirDocumento?: (caminho: string) => Promise<void>): Promise<boolean> {
    const lista = this.estado.lista;
    if (lista === undefined) return false;
    const abrir = abrirDocumento ?? ponteDesktop()?.abrirDocumento;
    this.limparErroOrigem("lista");
    this.atualizarAcompanhamento({ abrindo: true, erro: undefined });
    try {
      const nova = await this.api.chamar((c) =>
        c["revisaoPpc.acompanhar"]({ lista: lista.id, ...(arquivo === undefined ? {} : { arquivo }) }),
      );
      if (this.estado.lista?.id !== lista.id) return false;
      this.atualizar({ lista: nova });
      this.atualizarAcompanhamento({ abrindo: false, pedeArquivo: false });
      this.acompanharLista(nova.id);
      return nova.arquivoAcompanhado === null ? false : this.abrirAcompanhado(nova.arquivoAcompanhado, abrir);
    } catch (motivo) {
      this.atualizarAcompanhamento({ abrindo: false });
      // Sem `arquivo`, o pedido de novo é o do original (a cópia de outra execução sai liberada com ele).
      this.registrarErro("lista", motivo, () => this.acompanharNoWord(arquivo, abrirDocumento));
      return false;
    }
  }

  /** O arquivo acompanhado, escolhido de novo depois de fechar o app (ou outro, que passa a ser o acompanhado). */
  async escolherAcompanhadoDeNovo(
    escolherDocx?: () => Promise<string | null>,
    abrirDocumento?: (caminho: string) => Promise<void>,
  ): Promise<boolean> {
    const obter = escolherDocx ?? ponteDesktop()?.escolherDocx;
    if (obter === undefined) return false;
    const obtido = await obterArquivo(obter);
    if (obtido === undefined) return false;
    if ("erro" in obtido) {
      this.atualizarAcompanhamento({ erro: obtido.erro });
      return false;
    }
    return this.acompanharNoWord(obtido.arquivo, abrirDocumento);
  }

  /**
   * A janela ganhou foco: confere o acompanhado se ele mudou (a pasta de rede, onde o vigia não vê). Sem o
   * fluxo da lista (ele caiu), o reabre, e a abertura confere.
   */
  conferirAoFocar(): void {
    const lista = this.estado.lista;
    if (lista === undefined || lista.arquivoAcompanhado === null) return;
    if (this.acompanhamentoLista?.lista !== lista.id) {
      this.acompanharLista(lista.id);
      return;
    }
    void this.api.chamar((c) => c["revisaoPpc.conferirAcompanhado"]({ lista: lista.id })).catch(() => undefined);
  }

  private acompanharLista(listaId: string, quedasSeguidas = 0): void {
    if (this.acompanhamentoLista?.lista === listaId) return;
    this.soltarAcompanhamento();
    let quedas = quedasSeguidas;
    const fluxo = this.api.acompanhar(
      (c) => c["revisaoPpc.acompanharLista"]({ lista: listaId }),
      (evento) => {
        if (this.acompanhamentoLista?.fluxo !== fluxo || this.estado.lista?.id !== listaId) return;
        quedas = 0;
        if (evento.tipo === "lista") {
          // A lista chega também pela leitura com IA (as pendências novas dela ganham "novo" e contam na
          // frase da conclusão); as do código chegam no `conferido`.
          const chegaram = chegaramDaIa(this.estado.lista, evento.lista);
          this.novasDaLeitura += chegaram.length;
          this.atualizar({
            lista: evento.lista,
            ...(chegaram.length === 0 ? {} : { novas: new Set([...this.estado.novas, ...chegaram]) }),
          });
          return;
        }
        if (evento.tipo === "falhou") {
          if (evento.escolherDeNovo) this.atualizarAcompanhamento({ pedeArquivo: true });
          else this.atualizarAcompanhamento({ ultima: { tipo: "falhou", em: evento.em, motivo: evento.motivo } });
          return;
        }
        clearTimeout(this.relogioRealce);
        this.relogioRealce = setTimeout(() => {
          if (this.acompanhamentoLista?.fluxo === fluxo) this.atualizarAcompanhamento({ realce: new Set() });
        }, REALCE_MS);
        this.atualizar({
          novas: evento.novas.length === 0 ? this.estado.novas : new Set([...this.estado.novas, ...evento.novas]),
          acompanhamento: {
            ...this.estado.acompanhamento,
            pedeArquivo: false,
            realce: new Set(evento.resolvidas),
            ultima: {
              tipo: "conferido",
              em: evento.em,
              resolvidas: evento.resolvidas.length,
              novas: evento.novas.length,
            },
          },
        });
      },
    );
    this.acompanhamentoLista = { lista: listaId, fluxo };
    fluxo.fim.then(
      (fim) => {
        if (this.acompanhamentoLista?.fluxo !== fluxo) return;
        this.acompanhamentoLista = undefined;
        // O servidor só encerra o fluxo quando a lista sai: apagada fora daqui (a troca de curso desta
        // janela solta o fluxo antes).
        const lista = this.estado.lista;
        if (fim !== "concluido" || lista?.id !== listaId || this.estado.trocandoCurso) return;
        this.sair();
        this.atualizar({ erroEntrada: { texto: "Esta revisão foi apagada." } });
        this.aoApagarFora?.(lista);
      },
      (motivo: unknown) => {
        if (this.acompanhamentoLista?.fluxo !== fluxo) return;
        this.acompanhamentoLista = undefined;
        if (!ehQuedaDaConexao(motivo)) {
          this.atualizarAcompanhamento({ erro: explicarErro(motivo) });
          return;
        }
        // A conexão caiu: o fluxo volta na hora, na primeira; depois, quando a conexão voltar.
        if (quedas === 0) {
          this.acompanharLista(listaId, 1);
          return;
        }
        const parar = this.api.estado.observar(() => {
          if (this.api.estado.obter().fase !== "conectada") return;
          parar();
          this.pararEsperaLista = undefined;
          if (this.estado.lista?.id === listaId) this.acompanharLista(listaId, quedas + 1);
        });
        this.pararEsperaLista = parar;
      },
    );
  }

  /**
   * "Reconferir com a IA" as pendências da IA marcadas "Feito", uma por vez, no arquivo acompanhado: a
   * situação passa a ser a do resultado. Para na primeira que falhar: o erro fica na linha dela e na linha
   * do acompanhamento (a pendência feita costuma estar recolhida). O acompanhado que perdeu a liberação é
   * pedido no acompanhamento.
   */
  async reconferirComIa(chaves: ReadonlyArray<string>): Promise<boolean> {
    const arquivo = this.estado.lista?.arquivoAcompanhado ?? null;
    if (arquivo === null) return false;
    this.atualizarAcompanhamento({ reconferindo: true, erro: undefined });
    try {
      for (const chave of chaves) {
        if (await this.revisarDeNovo(chave, arquivo)) continue;
        const erro = this.estado.erroPendencia?.chave === chave ? this.estado.erroPendencia.erro : undefined;
        const pedeArquivo = this.acaoPendenteArquivo?.arquivo === arquivo;
        this.atualizarAcompanhamento(pedeArquivo ? { pedeArquivo: true } : { erro });
        return false;
      }
      return true;
    } finally {
      this.atualizarAcompanhamento({ reconferindo: false });
    }
  }

  /* ---------------------------------------------------------------- leitura com IA */

  private async carregarUsaveis(): Promise<ReadonlyArray<Provider>> {
    const [prontas, preferencias] = await Promise.all([
      Promise.all(
        PROVIDERS.map((provider) =>
          detectarIa(this.api, provider).then(
            (estado) => estado.instalado && estado.autenticado,
            () => false,
          ),
        ),
      ),
      this.api.chamar((c) => c["preferencias.ler"]({})).catch(() => undefined),
    ]);
    const desligadas = preferencias?.iasDesligadas ?? [];
    return PROVIDERS.filter((provider, i) => prontas[i] === true && !desligadas.includes(provider));
  }

  private async inicializarIa(lista: ListaPendencias): Promise<void> {
    const geracao = ++this.geracaoIa;
    this.geracaoEstimativa += 1;
    this.acompanhamentoIa?.cancelar();
    this.acompanhamentoIa = undefined;
    this.blocosVistos = 0;
    this.novasDaLeitura = 0;
    this.conclusaoEmitida = false;

    if (lista.resultado.leituraIa === "completa") {
      this.atualizarIa({ ...estadoIaInicial(), usaveis: this.estado.ia.usaveis, carregando: false });
      return;
    }

    this.atualizarIa({
      estado: undefined,
      carregando: true,
      estimando: false,
      ocupada: false,
      erro: undefined,
      avisoPendente: false,
    });

    const [usaveis, leituras] = await Promise.all([
      this.carregarUsaveis(),
      this.api.chamar((c) => c["revisaoPpc.listarIa"]({})).catch(() => [] as ReadonlyArray<EstadoRevisaoIa>),
    ]);
    if (this.geracaoIa !== geracao || this.estado.lista?.id !== lista.id) return;

    const achada = leiturasPorTerminar(leituras).find((e) => e.lista === lista.id);
    if (achada !== undefined) {
      this.blocosVistos = blocosProntos(achada);
      this.atualizarIa({
        usaveis,
        carregando: false,
        estado: achada,
        providerEscolhido: achada.provider,
        modo: achada.modo,
        erro: undefined,
      });
      this.acompanharIa(achada.id, lista.id, geracao);
      return;
    }

    const escolhido =
      this.estado.ia.providerEscolhido !== undefined && usaveis.includes(this.estado.ia.providerEscolhido)
        ? this.estado.ia.providerEscolhido
        : undefined;
    this.atualizarIa({ usaveis, carregando: false, providerEscolhido: escolhido, estado: undefined });
    if (usaveis.length > 0) void this.prepararIa();
  }

  /**
   * Reconfere as IAs disponíveis (por exemplo, ao voltar de Configurações › Sua IA). Nunca perturba
   * uma leitura já em andamento ou pausada: nelas, só troca as IAs que a faixa oferece para continuar.
   */
  async atualizarIas(): Promise<void> {
    const lista = this.estado.lista;
    if (this.estado.fase !== "resultado" || lista === undefined || lista.resultado.leituraIa === "completa") return;
    if (this.estado.ia.carregando) return;
    const situacao = this.estado.ia.estado?.situacao;
    if (situacao === "em_andamento" || situacao === "pausada") {
      const geracao = this.geracaoIa;
      const usaveis = await this.carregarUsaveis();
      if (this.geracaoIa === geracao && this.estado.lista?.id === lista.id) this.atualizarIa({ usaveis });
      return;
    }
    const geracao = this.geracaoIa;
    const usaveis = await this.carregarUsaveis();
    if (this.geracaoIa !== geracao || this.estado.lista?.id !== lista.id) return;
    const anteriores = this.estado.ia.usaveis ?? [];
    const mudou = usaveis.length !== anteriores.length || usaveis.some((p, i) => p !== anteriores[i]);
    if (!mudou && !this.estado.ia.avisoPendente) return;
    const escolhido =
      this.estado.ia.providerEscolhido !== undefined && usaveis.includes(this.estado.ia.providerEscolhido)
        ? this.estado.ia.providerEscolhido
        : undefined;
    this.atualizarIa({ usaveis, providerEscolhido: escolhido });
    if (usaveis.length > 0) void this.prepararIa();
  }

  escolherProvider(provider: Provider): void {
    if (this.estado.ia.providerEscolhido === provider) return;
    this.atualizarIa({ providerEscolhido: provider });
    const situacao = this.estado.ia.estado?.situacao;
    if (situacao === undefined || situacao === "preparada") void this.prepararIa();
  }

  escolherModo(modo: ModoRevisaoIa): void {
    if (this.estado.ia.modo === modo) return;
    this.atualizarIa({ modo });
    const situacao = this.estado.ia.estado?.situacao;
    if (situacao === undefined || situacao === "preparada") void this.prepararIa();
  }

  async prepararIa(): Promise<boolean> {
    const lista = this.estado.lista;
    if (lista === undefined || lista.resultado.leituraIa === "completa") return false;
    const situacao = this.estado.ia.estado?.situacao;
    if (situacao !== undefined && situacao !== "preparada") return false;
    if (semIaDisponivel(this.estado.ia)) return false;

    const geracao = this.geracaoIa;
    const est = ++this.geracaoEstimativa;
    const provider = providerEfetivoIa(this.estado.ia);
    const modo = this.estado.ia.modo;

    this.limparErroOrigem("ia");
    this.atualizarIa({ estimando: true });
    try {
      const novo = await this.api.chamar((c) => c["revisaoPpc.prepararIa"]({ lista: lista.id, provider, modo }));
      if (this.geracaoIa !== geracao || this.geracaoEstimativa !== est) return false;
      const atual = this.estado.ia.estado?.situacao;
      if (atual !== undefined && atual !== "preparada") return false;
      this.atualizarIa({ estimando: false, avisoPendente: false, estado: novo, erro: undefined });
      return true;
    } catch (motivo) {
      if (this.geracaoIa !== geracao || this.geracaoEstimativa !== est) return false;
      this.atualizarIa({ estimando: false });
      if (ehAvisoNaoAceito(motivo)) {
        this.atualizarIa({ avisoPendente: true, erro: undefined });
      } else {
        this.registrarErro("ia", motivo, () => this.prepararIa());
      }
      return false;
    }
  }

  async iniciarIa(): Promise<boolean> {
    const lista = this.estado.lista;
    const atual = this.estado.ia.estado;
    if (lista === undefined || atual === undefined) return false;
    const geracao = this.geracaoIa;
    const id = atual.id;

    this.limparErroOrigem("ia");
    this.atualizarIa({ ocupada: true });
    try {
      const novo = await this.api.chamar((c) => c["revisaoPpc.iniciarIa"]({ revisao: id }));
      if (this.geracaoIa !== geracao || this.estado.lista?.id !== lista.id) return false;
      this.blocosVistos = blocosProntos(novo);
      this.conclusaoEmitida = false;
      this.atualizarIa({ ocupada: false, avisoPendente: false, estado: novo, erro: undefined });
      this.acompanharIa(id, lista.id, geracao);
      return true;
    } catch (motivo) {
      if (this.geracaoIa !== geracao) return false;
      this.atualizarIa({ ocupada: false });
      if (ehAvisoNaoAceito(motivo)) {
        this.atualizarIa({ avisoPendente: true, erro: undefined });
      } else {
        this.registrarErro("ia", motivo, () => this.iniciarIa());
      }
      return false;
    }
  }

  /**
   * A leitura pausada (no limite da assinatura) continua com outra IA: só os blocos que faltam vão a ela
   * (`revisaoPpc.continuarIaCom`), e cada pendência nova diz que IA a julgou.
   */
  async continuarIaCom(provider: Provider): Promise<boolean> {
    const lista = this.estado.lista;
    const atual = this.estado.ia.estado;
    if (lista === undefined || atual === undefined) return false;
    const geracao = this.geracaoIa;
    this.limparErroOrigem("ia");
    this.atualizarIa({ ocupada: true });
    try {
      const novo = await this.api.chamar((c) => c["revisaoPpc.continuarIaCom"]({ lista: lista.id, provider }));
      if (this.geracaoIa !== geracao || this.estado.lista?.id !== lista.id) return false;
      this.blocosVistos = blocosProntos(novo);
      this.conclusaoEmitida = false;
      this.atualizarIa({ ocupada: false, avisoPendente: false, estado: novo, erro: undefined });
      this.acompanharIa(novo.id, lista.id, geracao);
      return true;
    } catch (motivo) {
      if (this.geracaoIa !== geracao) return false;
      this.atualizarIa({ ocupada: false });
      if (ehAvisoNaoAceito(motivo)) this.atualizarIa({ avisoPendente: true, erro: undefined });
      else this.registrarErro("ia", motivo, () => this.continuarIaCom(provider));
      return false;
    }
  }

  async pausarIa(): Promise<void> {
    const atual = this.estado.ia.estado;
    if (atual === undefined) return;
    const geracao = this.geracaoIa;
    this.limparErroOrigem("ia");
    this.atualizarIa({ ocupada: true });
    try {
      const novo = await this.api.chamar((c) => c["revisaoPpc.pausarIa"]({ revisao: atual.id }));
      if (this.geracaoIa !== geracao) return;
      this.atualizarIa({ ocupada: false, estado: novo, erro: undefined });
    } catch (motivo) {
      if (this.geracaoIa !== geracao) return;
      this.atualizarIa({ ocupada: false });
      this.registrarErro("ia", motivo);
    }
  }

  /** "Encerrar conferência por aqui": apaga a revisão pausada, recarrega a lista e volta à estimativa. */
  async cancelarIa(): Promise<void> {
    const lista = this.estado.lista;
    const atual = this.estado.ia.estado;
    if (lista === undefined || atual === undefined) return;
    const geracao = this.geracaoIa;
    this.acompanhamentoIa?.cancelar();
    this.acompanhamentoIa = undefined;
    this.limparErroOrigem("ia");
    this.atualizarIa({ ocupada: true });
    try {
      await this.api.chamar((c) => c["revisaoPpc.apagarIa"]({ revisao: atual.id }));
      if (this.geracaoIa !== geracao || this.estado.lista?.id !== lista.id) return;
      this.blocosVistos = 0;
      this.novasDaLeitura = 0;
      this.conclusaoEmitida = false;
      this.atualizarIa({ ocupada: false, estado: undefined, erro: undefined });
      void this.agendarRecarga(lista.id);
      void this.prepararIa();
    } catch (motivo) {
      if (this.geracaoIa !== geracao) return;
      this.atualizarIa({ ocupada: false });
      this.registrarErro("ia", motivo);
    }
  }

  /** Depois de falhar: limpa o estado falho e volta à estimativa com o arquivo atual. */
  async tentarDeNovoIa(): Promise<void> {
    this.acompanhamentoIa?.cancelar();
    this.acompanhamentoIa = undefined;
    this.blocosVistos = 0;
    this.novasDaLeitura = 0;
    this.conclusaoEmitida = false;
    this.atualizarIa({ estado: undefined, erro: undefined });
    await this.prepararIa();
  }

  private acompanharIa(revisaoId: string, listaId: string, geracao: number): void {
    this.acompanhamentoIa?.cancelar();
    const acompanhamento = this.api.acompanhar(
      (c) => c["revisaoPpc.acompanharIa"]({ revisao: revisaoId }),
      (novo) => {
        if (this.acompanhamentoIa !== acompanhamento || this.geracaoIa !== geracao) return;
        const prontosAgora = blocosProntos(novo);
        const concluiu = novo.situacao === "concluida" && novo.resultado !== null && !this.conclusaoEmitida;
        const blocoNovo = prontosAgora > this.blocosVistos;
        this.blocosVistos = prontosAgora;
        this.atualizarIa({ estado: novo });

        // Quando o último bloco fecha a revisão, agenda uma única recarga com conclusão (evita recarga dupla).
        if (concluiu) {
          this.conclusaoEmitida = true;
          void this.agendarRecarga(listaId, novo.provider);
        } else if (blocoNovo) {
          void this.agendarRecarga(listaId);
        }
      },
    );
    this.acompanhamentoIa = acompanhamento;
    acompanhamento.fim.then(
      () => {
        if (this.acompanhamentoIa === acompanhamento) this.acompanhamentoIa = undefined;
      },
      (motivo: unknown) => {
        if (this.acompanhamentoIa !== acompanhamento || this.geracaoIa !== geracao) return;
        this.acompanhamentoIa = undefined;
        this.registrarErro("ia", motivo);
      },
    );
  }

  /* ---------------------------------------------------------------- recarga serializada da lista */

  private agendarRecarga(listaId: string, conclusaoProvider?: Provider): Promise<void> {
    if (this.recargaEmCurso !== undefined) {
      const conclusao = conclusaoProvider ?? this.recargaPendente?.conclusaoProvider;
      this.recargaPendente = {
        listaId,
        ...(conclusao === undefined ? {} : { conclusaoProvider: conclusao }),
      };
      return this.recargaEmCurso;
    }
    const tarefa = (async () => {
      let atual: RecargaPendente | undefined = {
        listaId,
        ...(conclusaoProvider === undefined ? {} : { conclusaoProvider }),
      };
      while (atual !== undefined) {
        await this.recarregarUmaVez(atual.listaId, atual.conclusaoProvider);
        const proxima = this.recargaPendente;
        this.recargaPendente = undefined;
        atual = proxima !== undefined && proxima.listaId === this.estado.lista?.id ? proxima : undefined;
      }
    })().finally(() => {
      if (this.recargaEmCurso === tarefa) this.recargaEmCurso = undefined;
    });
    this.recargaEmCurso = tarefa;
    return tarefa;
  }

  private async recarregarUmaVez(listaId: string, conclusaoProvider?: Provider): Promise<void> {
    if (this.estado.lista?.id !== listaId) return;
    try {
      const nova = await this.api.chamar((c) => c["revisaoPpc.lista"]({ lista: listaId }));
      if (this.estado.lista?.id !== listaId) return;
      const chegaram = chegaramDaIa(this.estado.lista, nova);
      this.novasDaLeitura += chegaram.length;

      const novas = chegaram.length === 0 ? this.estado.novas : new Set([...this.estado.novas, ...chegaram]);

      if (conclusaoProvider !== undefined) {
        const encontrados = this.novasDaLeitura;
        this.novasDaLeitura = 0;
        this.atualizar({
          lista: nova,
          novas,
          conclusao: textoConclusao(DESCRICOES[conclusaoProvider].nome, nova.resultado, encontrados),
          aberta: null,
        });
      } else {
        this.atualizar({ lista: nova, novas });
      }
    } catch (motivo) {
      if (this.estado.lista?.id === listaId) this.registrarErro("lista", motivo);
    }
  }
}
