/**
 * O painel do app (`docs/plans/multitarefa.md`, "Painel do app"): a coluna à direita, montada uma vez na
 * moldura (`routes/__root.tsx`), que sobrevive à navegação e à troca de conversa. Guarda se está aberto,
 * a aba (Ler, Conversar, Pasta), a trilha dos links `ifpr://` lidos no Ler (`leitor/historico.ts`), os
 * documentos marcados (a prateleira, até `MAXIMO_MARCADOS`) e se a pessoa o prendeu como coluna quando a
 * tela é estreita. Fica fora do React, como o `ControleConversa`; a interface lê o estado com
 * `useSyncExternalStore` (`obter` e `observar`).
 *
 * Fechar recolhe o painel sem esquecer nada: o link seguinte entra depois da trilha, e "Voltar" ainda leva
 * aos de antes.
 *
 * Uma tela de trabalho (a revisão de PPC, a conversa) avisa que está na tela (`useTelaDeTrabalho`):
 * enquanto isso, os links e a paleta abrem no painel, sem tirar a pessoa de onde ela está
 * (`painel/abrirLink.ts`). O núcleo não sabe que telas são essas; cada uma se declara.
 *
 * **A conversa ao lado** (aba Conversar, "Conversa ao lado" do plano): a conversa do painel (o id, depois da
 * primeira mensagem), as fichas de contexto acima da caixa, já incluídas e removíveis, as ofertas (uma ficha
 * que só entra se a pessoa a puser, "Anexar o .docx"), o texto da caixa e a origem: quem abriu a conversa
 * (a revisão, `revisao:<lista>`), só como dado; quem a prepara a cada mensagem é o módulo dela
 * (`OrigensConversa`, posto no contexto do app pela composição). Uma conversa por origem: pedir de novo com
 * a mesma origem retoma a conversa e acrescenta as fichas (decisão 12). O pedido sem origem (o trecho do
 * leitor, o Explorar, a paleta) vai à conversa do painel, se há uma (e não foi apagada); senão, abre o
 * rascunho de uma conversa livre. A tela declara o contexto dela (`declararContexto`), que ⌘J leva ao painel.
 * A origem que ganha outro nome e os links que mudam de endereço (a revisão refeita com outro curso) seguem
 * (`trocarOrigem`, `trocarLinks`).
 *
 * O estado é só dado (sem funções): a continuidade (`continuidade/ControleContinuidade.ts`) guarda nas
 * preferências do servidor o que volta ao reabrir o app (`paraGuardar`, `restaurar`). O painel que ela reabre
 * não foi gesto da pessoa: o foco fica na tela (`abertoPelaContinuidade`).
 */
import type { FichaContexto, PainelGuardado, Provider } from "@simplifica-if/contratos-app";
import type { EscolhaDaIa } from "../tarefas/modelos.ts";
import { abrir, avancar, HISTORICO_VAZIO, type Historico, linkAtual, semLinks, voltar } from "../leitor/historico.ts";

export type AbaPainel = "ler" | "conversar" | "pasta";

/** Uma ficha acima da caixa, antes do envio. */
export interface FichaRascunho {
  /** Única entre as fichas da caixa: a mesma ficha pedida de novo não se repete. */
  readonly chave: string;
  readonly rotulo: string;
  /** O ícone: um documento (da base ou o PPC), um trecho, a pendência, um arquivo. */
  readonly tipo: "documento" | "trecho" | "pendencia" | "arquivo";
  /** O nome acessível do botão que a tira ("Tirar o PPC do contexto"). */
  readonly tirar: string;
  /** O texto que vai junto, para a pessoa conferir (a pendência, o trecho), à vista na dica. */
  readonly detalhe?: string;
  /** A ficha como vai na mensagem; sem ela, a origem a prepara no envio (o PPC, o `.docx`). */
  readonly ficha?: FichaContexto;
  /** Como oferta, o rótulo do botão que a põe ("Anexar o .docx"). */
  readonly oferta?: string;
}

/** Quem abriu a conversa ao lado (a revisão `revisao:<lista>`), só como dado. */
export interface OrigemAoLado {
  /** Uma conversa por origem: a mesma chave retoma a conversa (decisão 12). */
  readonly chave: string;
  /** A IA sugerida para a conversa nova (a da revisão, decisão 11). */
  readonly ia?: Provider;
}

/** A mensagem que vai sair do painel, para a origem a preparar. */
export interface MensagemAoLado {
  readonly conversa: string | undefined;
  readonly fichas: ReadonlyArray<FichaRascunho>;
  readonly ia: EscolhaDaIa;
  /** A mensagem (o título da pasta da conversa nova sai dela). */
  readonly texto: string;
}

/** A mensagem preparada: a conversa (aberta agora, na primeira) e as fichas como vão. */
export interface MensagemPreparada {
  readonly conversa: string;
  readonly fichas: ReadonlyArray<FichaContexto>;
}

/**
 * O que o módulo de uma origem faz com a conversa ao lado dela: prepara cada mensagem (a revisão grava o
 * PPC na pasta e abre a conversa na primeira) e diz o aviso da caixa (a leitura com IA em andamento gasta
 * a mesma assinatura), que muda quando o módulo avisa (`observar`).
 */
export interface OrigensConversa {
  /** A preparação, para a origem que o módulo conhece; `undefined` para as outras (a livre). */
  readonly preparar: (origem: OrigemAoLado, mensagem: MensagemAoLado) => Promise<MensagemPreparada> | undefined;
  readonly aviso: (origem: OrigemAoLado) => string | null;
  readonly observar: (aviso: () => void) => () => void;
}

/** Sem módulo (os testes de uma peça só): nenhuma origem se prepara, e não há aviso. */
export const SEM_ORIGENS: OrigensConversa = {
  preparar: () => undefined,
  aviso: () => null,
  observar: () => () => {},
};

/** A conversa do painel: o rascunho antes da primeira mensagem, depois a conversa pelo id. */
export interface ConversaDoPainel {
  readonly id?: string;
  readonly origem?: OrigemAoLado;
  readonly fichas: ReadonlyArray<FichaRascunho>;
  readonly ofertas: ReadonlyArray<FichaRascunho>;
  /** O texto da caixa, que sobrevive à troca de aba e de tela. */
  readonly texto: string;
  /** A conversa do painel foi apagada: a aba diz isso até a próxima. */
  readonly apagada?: true;
  /** Um pedido acabou de chegar: a caixa toma o foco (uma vez; mostrar a aba não o toma). */
  readonly focar?: true;
  /** A mensagem voltou à caixa porque o aviso de uso não foi aceito. */
  readonly avisoUso?: true;
  /** A conversa foi à tela cheia (⤢) a partir desta tela: "Trazer de volta" volta a ela. */
  readonly voltarPara?: string;
}

/** O que leva à conversa ao lado: as fichas, a pergunta já escrita e, de uma tela com conversa própria, a origem. */
export interface PedidoConversa {
  readonly fichas?: ReadonlyArray<FichaRascunho>;
  readonly ofertas?: ReadonlyArray<FichaRascunho>;
  readonly texto?: string;
  readonly origem?: OrigemAoLado;
  /** A conversa que a origem já abriu antes (a lista da revisão guarda o id). */
  readonly conversa?: string;
}

const SEM_CONVERSA: ConversaDoPainel = { fichas: [], ofertas: [], texto: "" };

/** As fichas de `novas` que ainda não estão em `atuais`, depois delas. */
const juntar = (atuais: ReadonlyArray<FichaRascunho>, novas: ReadonlyArray<FichaRascunho>) => [
  ...atuais.map((ficha) => novas.find((nova) => nova.chave === ficha.chave) ?? ficha),
  ...novas.filter((nova) => !atuais.some((ficha) => ficha.chave === nova.chave)),
];

/** A prateleira dos documentos marcados: o substituto modesto das abas. */
export const MAXIMO_MARCADOS = 5;

/** Quantos links da trilha do Ler voltam ao reabrir o app. */
export const MAXIMO_TRILHA = 50;

export interface EstadoPainel {
  readonly aberto: boolean;
  readonly aba: AbaPainel;
  readonly historico: Historico;
  /** Os links marcados, um por documento, na ordem em que entraram. */
  readonly marcados: ReadonlyArray<string>;
  /** Preso como coluna mesmo quando a tela principal ficaria estreita (senão, sobreposição). */
  readonly preso: boolean;
  readonly conversa: ConversaDoPainel;
  /** A conversa cuja pasta a aba Pasta mostra, quando alguém a pediu ("Pasta da tarefa" da tela cheia). */
  readonly pastaDe?: string;
}

export const PAINEL_FECHADO: EstadoPainel = {
  aberto: false,
  aba: "ler",
  historico: HISTORICO_VAZIO,
  marcados: [],
  preso: false,
  conversa: SEM_CONVERSA,
};

/** O documento de um link, sem o `#` do dispositivo ou do trecho. */
export const documentoDoLink = (link: string): string => link.split("#")[0]!;

export class ControlePainel {
  private estado: EstadoPainel;
  private readonly observadores = new Set<() => void>();
  private telasDeTrabalho = 0;
  private pedidos = 0;
  /** Sobe a cada troca da conversa do painel (outra origem, nova, apagada, esquecida). */
  private geracao = 0;
  private readonly contextos: Array<() => PedidoConversa> = [];
  /** O painel aberto veio da continuidade, sem gesto da pessoa: o foco fica na tela. */
  private abertoAoRestaurar = false;

  constructor() {
    this.estado = PAINEL_FECHADO;
  }

  readonly obter = (): EstadoPainel => this.estado;

  readonly observar = (aviso: () => void): (() => void) => {
    this.observadores.add(aviso);
    return () => this.observadores.delete(aviso);
  };

  private mudar(mudancas: Partial<EstadoPainel>): void {
    this.trocar({ ...this.estado, ...mudancas });
  }

  private trocar(novo: EstadoPainel): void {
    const chaves = new Set([...Object.keys(novo), ...Object.keys(this.estado)]) as Set<keyof EstadoPainel>;
    if ([...chaves].every((chave) => novo[chave] === this.estado[chave])) return;
    if (novo.aberto !== this.estado.aberto) this.abertoAoRestaurar = false;
    this.estado = novo;
    for (const aviso of this.observadores) aviso();
  }

  /**
   * Quantas vezes algo pediu o painel (`abrirLink`, `mostrar`), também quando ele já mostrava aquilo e o
   * estado não mudou: o clique que pediu o painel não é um clique fora (`PainelDoApp.tsx`).
   */
  readonly pedidosFeitos = (): number => this.pedidos;

  /** Um pedido do painel: conta, e o painel aberto passa a ser da pessoa (não mais da continuidade). */
  private pedir(): void {
    this.pedidos += 1;
    this.abertoAoRestaurar = false;
  }

  /** Abre o Ler no link, depois do atual na trilha. */
  readonly abrirLink = (link: string): void => {
    this.pedir();
    this.mudar({ aberto: true, aba: "ler", historico: abrir(this.estado.historico, link) });
  };

  readonly voltar = (): void => {
    this.mudar({ historico: voltar(this.estado.historico) });
  };

  readonly avancar = (): void => {
    this.mudar({ historico: avancar(this.estado.historico) });
  };

  /** Abre o painel na aba. */
  readonly mostrar = (aba: AbaPainel): void => {
    this.pedir();
    // A aba escolhida volta à pasta de sempre (a da conversa ao lado, senão a da tela).
    const { pastaDe: _pasta, ...resto } = this.estado;
    this.trocar({ ...resto, aberto: true, aba });
  };

  /** Abre a aba Pasta na pasta da conversa `id` (a da tela cheia, que pode não ser a da aba Conversar). */
  readonly mostrarPasta = (id: string): void => {
    this.pedir();
    this.mudar({ aberto: true, aba: "pasta", pastaDe: id });
  };

  /** O painel está aberto porque a continuidade o restaurou assim, e nada o pediu, abriu ou fechou depois. */
  readonly abertoPelaContinuidade = (): boolean => this.abertoAoRestaurar && this.estado.aberto;

  /** Mostra e esconde (⌘\), na aba em que estava. */
  readonly alternar = (): void => {
    this.mudar({ aberto: !this.estado.aberto });
  };

  readonly fechar = (): void => {
    this.mudar({ aberto: false });
  };

  readonly prender = (preso: boolean): void => {
    this.mudar({ preso });
  };

  /** Põe o documento do link na prateleira (no lugar do mesmo documento, se já estava); cheia, não entra. */
  readonly marcar = (link: string): void => {
    const documento = documentoDoLink(link);
    const outros = this.estado.marcados.filter((m) => documentoDoLink(m) !== documento);
    if (outros.length >= MAXIMO_MARCADOS) return;
    const i = this.estado.marcados.findIndex((m) => documentoDoLink(m) === documento);
    this.mudar({ marcados: i < 0 ? [...outros, link] : this.estado.marcados.with(i, link) });
  };

  /** Tira da prateleira o documento do link. */
  readonly desmarcar = (link: string): void => {
    const documento = documentoDoLink(link);
    const marcados = this.estado.marcados.filter((m) => documentoDoLink(m) !== documento);
    if (marcados.length !== this.estado.marcados.length) this.mudar({ marcados });
  };

  /**
   * Tira da trilha e da prateleira os links de `descartar` (o documento deixou de existir): "Voltar" não
   * chega mais a eles. Se o Ler mostrava um deles, o painel recolhe.
   */
  readonly esquecerLinks = (descartar: (link: string) => boolean): void => {
    const atual = linkAtual(this.estado.historico);
    const lendo = this.estado.aba === "ler" && atual !== undefined && descartar(atual);
    const marcados = this.estado.marcados.filter((m) => !descartar(m));
    this.mudar({
      aberto: this.estado.aberto && !lendo,
      historico: semLinks(this.estado.historico, descartar),
      marcados: marcados.length === this.estado.marcados.length ? this.estado.marcados : marcados,
    });
  };

  /**
   * Leva o pedido à aba Conversar. Com origem, à conversa dela: a do painel, se é a mesma origem; senão, a
   * que a origem já abriu (`conversa`) ou o rascunho de uma nova. Sem origem, à conversa do painel; sem
   * conversa no painel, ao rascunho de uma livre. Com `mostrar: false`, só prepara a caixa, sem abrir o painel
   * nem levar o foco a ela (a caixa curta da janela compacta, fora do painel).
   */
  readonly conversar = (pedido: PedidoConversa, opcoes: { readonly mostrar?: boolean } = {}): void => {
    const mostrar = opcoes.mostrar ?? true;
    if (mostrar) this.pedir();
    const atual = this.estado.conversa;
    const fichas = pedido.fichas ?? [];
    const ofertas = pedido.ofertas ?? [];
    // A apagada não recebe nada: o pedido abre o rascunho de outra.
    const mesma =
      atual.apagada !== true &&
      (pedido.origem === undefined ||
        (atual.origem !== undefined && atual.origem.chave === pedido.origem.chave) ||
        (pedido.conversa !== undefined && atual.id === pedido.conversa));
    const conversa: ConversaDoPainel = mesma
      ? {
          ...atual,
          ...(pedido.origem === undefined ? {} : { origem: pedido.origem }),
          fichas: juntar(atual.fichas, fichas),
          ofertas: juntar(
            atual.ofertas,
            ofertas.filter((oferta) => !atual.fichas.some((ficha) => ficha.chave === oferta.chave)),
          ),
          texto: pedido.texto ?? atual.texto,
          ...(mostrar ? { focar: true as const } : {}),
        }
      : {
          ...(pedido.conversa === undefined ? {} : { id: pedido.conversa }),
          ...(pedido.origem === undefined ? {} : { origem: pedido.origem }),
          fichas,
          ofertas,
          texto: pedido.texto ?? "",
          ...(mostrar ? { focar: true as const } : {}),
        };
    if (!mesma) this.geracao += 1;
    this.mudar(mostrar ? { aberto: true, aba: "conversar", conversa } : { conversa });
  };

  /**
   * Muda quando a conversa do painel dá lugar a outra (outra origem, "Nova conversa", apagada): o envio que
   * estava em curso não mexe na caixa da seguinte.
   */
  readonly geracaoDaConversa = (): number => this.geracao;

  /** A conversa `id` foi apagada: se é a do painel, a aba a solta e diz "Conversa apagada". */
  readonly conversaApagada = (id: string): void => {
    if (this.estado.conversa.id !== id) return;
    this.geracao += 1;
    this.mudar({ conversa: { ...SEM_CONVERSA, apagada: true } });
  };

  /**
   * A conversa `antiga` do painel parou no limite da assinatura e continua na `nova`, com outra IA: a aba
   * passa a ela, com a caixa que a continuação traz (o histórico, as fichas e a última pergunta). Sem
   * `caixa` (a continuação foi feita na tela cheia, que fica com a caixa dela), só o id muda: a conversa
   * segue aberta na tela cheia, com o "Trazer de volta" de antes.
   */
  readonly continuada = (
    antiga: string,
    nova: string,
    caixa?: { readonly texto: string; readonly fichas: ReadonlyArray<FichaRascunho> },
  ): void => {
    const atual = this.estado.conversa;
    if (atual.id !== antiga) return;
    this.geracao += 1;
    if (caixa === undefined) {
      this.mudar({ conversa: { ...atual, id: nova } });
      return;
    }
    this.mudar({
      // A continuação segue ao lado da mesma origem (a revisão): as mensagens dela continuam preparadas por ela.
      conversa: {
        id: nova,
        fichas: caixa.fichas,
        ofertas: [],
        texto: caixa.texto,
        focar: true,
        ...(atual.origem === undefined ? {} : { origem: atual.origem }),
      },
    });
  };

  /** "Nova conversa": a aba volta ao rascunho de uma conversa livre, sem fichas. */
  readonly novaConversa = (): void => {
    this.geracao += 1;
    this.mudar({ conversa: { ...SEM_CONVERSA, focar: true } });
  };

  /**
   * A origem `chave` deixou de existir (a revisão apagada): a conversa já aberta segue como livre, sem as
   * fichas que dependiam dela; o rascunho dela sai.
   */
  readonly esquecerOrigem = (chave: string): void => {
    const atual = this.estado.conversa;
    if (atual.origem?.chave !== chave) return;
    this.geracao += 1;
    if (atual.id === undefined) {
      this.mudar({ conversa: SEM_CONVERSA });
      return;
    }
    const { origem: _origem, ...resto } = atual;
    this.mudar({
      conversa: {
        ...resto,
        fichas: atual.fichas.filter((ficha) => ficha.ficha !== undefined),
        ofertas: atual.ofertas.filter((oferta) => oferta.ficha !== undefined),
      },
    });
  };

  /**
   * A origem `antiga` passou a se chamar `nova` (a revisão refeita com outro curso, "Qual é o curso?", ganha
   * outro id e herda a conversa): a conversa do painel segue com ela.
   */
  readonly trocarOrigem = (antiga: string, nova: string): void => {
    const atual = this.estado.conversa;
    if (atual.origem?.chave !== antiga) return;
    this.mudar({ conversa: { ...atual, origem: { ...atual.origem, chave: nova } } });
  };

  /**
   * Os links começados por `de` passam a começar por `para`, na trilha e na prateleira (o documento mudou de
   * endereço, como o PPC da revisão refeita com outro curso). Dois iguais que ficam lado a lado viram um.
   */
  readonly trocarLinks = (de: string, para: string): void => {
    const trocar = (link: string) => (link.startsWith(de) ? para + link.slice(de.length) : link);
    const { links, posicao } = this.estado.historico;
    if (!links.some((link) => link.startsWith(de)) && !this.estado.marcados.some((m) => m.startsWith(de))) return;
    const trocados = links.map(trocar);
    const historico = semLinks({ links: trocados, posicao }, () => false);
    this.mudar({ historico, marcados: this.estado.marcados.map(trocar) });
  };

  /** ⤢: a conversa vai à tela cheia, saindo de `endereco`, para onde "Trazer de volta" volta. */
  readonly levarATelaCheia = (endereco: string): void => {
    this.mudar({ conversa: { ...this.estado.conversa, voltarPara: endereco } });
  };

  /** A caixa tomou o foco que o pedido pediu. */
  readonly focou = (): void => {
    if (this.estado.conversa.focar !== true) return;
    const { focar: _focar, ...resto } = this.estado.conversa;
    this.mudar({ conversa: resto });
  };

  readonly tirarFicha = (chave: string): void => {
    const atual = this.estado.conversa;
    this.mudar({ conversa: { ...atual, fichas: atual.fichas.filter((ficha) => ficha.chave !== chave) } });
  };

  /** Põe a oferta entre as fichas ("Anexar o .docx"). */
  readonly porOferta = (chave: string): void => {
    const atual = this.estado.conversa;
    const oferta = atual.ofertas.find((o) => o.chave === chave);
    if (oferta === undefined) return;
    this.mudar({
      conversa: {
        ...atual,
        fichas: juntar(atual.fichas, [oferta]),
        ofertas: atual.ofertas.filter((o) => o.chave !== chave),
      },
    });
  };

  readonly escreverTexto = (texto: string): void => {
    if (texto === this.estado.conversa.texto) return;
    this.mudar({ conversa: { ...this.estado.conversa, texto } });
  };

  /**
   * A mensagem foi: a conversa ganha o id (na primeira), as fichas que foram saem (as que chegaram durante
   * o preparo ficam), e o texto sai se é o que foi (o que a pessoa mudou nesse meio fica).
   */
  readonly enviada = (
    conversa: string,
    enviado: { readonly texto: string; readonly chaves: ReadonlyArray<string> },
  ): void => {
    const atual = this.estado.conversa;
    const { avisoUso: _aviso, ...resto } = atual;
    this.mudar({
      conversa: {
        ...resto,
        id: conversa,
        fichas: atual.fichas.filter((ficha) => !enviado.chaves.includes(ficha.chave)),
        texto: atual.texto === enviado.texto ? "" : atual.texto,
      },
    });
  };

  /**
   * A mensagem não foi: o texto e as fichas voltam à caixa (o texto, se a pessoa não escreveu outro), e,
   * se a recusa foi o aviso de uso, a caixa o mostra.
   */
  readonly devolver = (texto: string, fichas: ReadonlyArray<FichaRascunho>, avisoUso = false): void => {
    const atual = this.estado.conversa;
    this.mudar({
      conversa: {
        ...atual,
        texto: atual.texto === "" ? texto : atual.texto,
        fichas: juntar(fichas, atual.fichas),
        ...(avisoUso ? { avisoUso: true } : {}),
      },
    });
  };

  /** A caixa mostra (ou deixa de mostrar) o aviso de uso não aceito. */
  readonly avisoDeUso = (mostrar: boolean): void => {
    const atual = this.estado.conversa;
    if ((atual.avisoUso === true) === mostrar) return;
    const { avisoUso: _aviso, ...resto } = atual;
    this.mudar({ conversa: mostrar ? { ...resto, avisoUso: true } : resto });
  };

  /**
   * A tela declara o contexto dela (o PPC e a pendência em foco, a página do Explorar); ⌘J o leva ao
   * painel. A última declarada vale; a função devolvida a tira.
   */
  readonly declararContexto = (contexto: () => PedidoConversa): (() => void) => {
    this.contextos.push(contexto);
    return () => {
      const i = this.contextos.lastIndexOf(contexto);
      if (i >= 0) this.contextos.splice(i, 1);
    };
  };

  /** O contexto da tela à vista (vazio, sem nenhum declarado). */
  readonly contextoDaTela = (): PedidoConversa => this.contextos.at(-1)?.() ?? {};

  /**
   * O que volta ao reabrir o app: a trilha (só os últimos `MAXIMO_TRILHA` links), os marcados, a aba, se
   * estava aberto e preso, e a conversa da aba Conversar já aberta (o rascunho, as fichas e o texto ficam).
   */
  readonly paraGuardar = (): PainelGuardado => {
    const { aberto, aba, historico, marcados, preso, conversa } = this.estado;
    const corte = Math.max(0, historico.links.length - MAXIMO_TRILHA);
    return {
      aberto,
      aba,
      trilha: { links: historico.links.slice(corte), posicao: Math.max(-1, historico.posicao - corte) },
      marcados,
      preso,
      ...(conversa.id === undefined || conversa.apagada === true
        ? {}
        : { conversa: { id: conversa.id, ...(conversa.origem === undefined ? {} : { origem: conversa.origem }) } }),
    };
  };

  /** O painel como estava ao fechar o app (já sem o que deixou de existir, `continuidade/conferir.ts`). */
  readonly restaurar = (guardado: PainelGuardado): void => {
    const { links, posicao } = guardado.trilha;
    this.geracao += 1;
    const abria = this.estado.aberto;
    this.mudar({
      aberto: guardado.aberto,
      aba: guardado.aba,
      historico:
        links.length === 0 ? HISTORICO_VAZIO : { links, posicao: Math.min(Math.max(0, posicao), links.length - 1) },
      marcados: guardado.marcados.slice(0, MAXIMO_MARCADOS),
      preso: guardado.preso,
      conversa:
        guardado.conversa === undefined
          ? SEM_CONVERSA
          : {
              ...SEM_CONVERSA,
              id: guardado.conversa.id,
              ...(guardado.conversa.origem === undefined ? {} : { origem: guardado.conversa.origem }),
            },
    });
    if (guardado.aberto && !abria) this.abertoAoRestaurar = true;
  };

  /** Uma tela de trabalho entrou; a função devolvida a tira. */
  readonly entrarEmTelaDeTrabalho = (): (() => void) => {
    this.telasDeTrabalho += 1;
    let saiu = false;
    return () => {
      if (saiu) return;
      saiu = true;
      this.telasDeTrabalho -= 1;
    };
  };

  /** Há uma tela de trabalho à vista: os links e a paleta abrem no painel. */
  readonly emTelaDeTrabalho = (): boolean => this.telasDeTrabalho > 0;
}
