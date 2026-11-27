/**
 * Os controles das conversas abertas na interface (`docs/plans/multitarefa.md`, "Controles por id"): um
 * `ControleConversa` por conversa, com contagem de referências. A tela da conversa e o painel do app pegam
 * o seu (`pegar`), e a mesma conversa nos dois é o mesmo controle. Soltar a última referência só para de
 * acompanhar a conversa; nunca encerra a sessão do provider, que se libera ociosa no servidor.
 *
 * Guarda também a IA escolhida por último (a das conversas novas, decisão 11) e as conversas apagadas
 * nesta sessão do app, para o painel dizer "Conversa apagada" e quem guardava o id dela (a conversa ao
 * lado de uma revisão) abrir outra, também as apagadas em outra janela (o acompanhamento delas termina). Guarda ainda a caixa de uma conversa que acabou de nascer de outra (a
 * continuação com outra IA), até a mensagem dela sair, e quais conversas uma vista mostra agora (`naTela`).
 * `encerrar` para tudo (o app fechando).
 */
import type { Provider } from "@simplifica-if/contratos-app";
import type { Api } from "../conexao/api.ts";
import type { RascunhoConversa } from "./continuacao.ts";
import { CONVERSA_INEXISTENTE, ControleConversa } from "./ControleConversa.ts";

interface Registro {
  readonly controle: ControleConversa;
  referencias: number;
}

export class GerenteConversas {
  private readonly api: Api;
  private readonly registros = new Map<string, Registro>();
  private readonly apagadas = new Set<string>();
  /** As solturas agendadas (`soltarSeSobrou`), que `encerrar` cancela. */
  private readonly agendadas = new Set<ReturnType<typeof setTimeout>>();
  private ia: Provider = "claude";
  private readonly rascunhos = new Map<string, RascunhoConversa>();
  /** Quantas vistas mostram cada conversa agora (a tela cheia e a aba Conversar). */
  private readonly vistas = new Map<string, number>();
  private readonly aoApagar: ((id: string) => void) | undefined;

  /** `aoApagar`: a conversa saiu (apagada, ou não existia mais ao abrir); o painel a solta. */
  constructor(api: Api, opcoes: { readonly aoApagar?: (id: string) => void } = {}) {
    this.api = api;
    this.aoApagar = opcoes.aoApagar;
  }

  /** A IA das conversas novas: a última usada. */
  readonly ultimaIa = (): Provider => this.ia;

  readonly escolherIa = (provider: Provider): void => {
    this.ia = provider;
  };

  /**
   * Um controle sem conversa, para começar uma (`comecarTarefa`), com uma referência: quando ela ganha o
   * id, o controle passa a ser o dela, e quem pegar o id recebe este mesmo (com a mensagem já enviada à
   * vista). `soltar` (depois de a tela que vai mostrá-la a pegar) solta a referência.
   */
  readonly novo = (
    provider: Provider = this.ia,
  ): { readonly controle: ControleConversa; readonly soltar: () => void } => {
    let iniciada: string | undefined;
    let solto = false;
    const controle = new ControleConversa(this.api, {
      provider,
      aoTerminar: this.apagadaFora,
      aoIniciar: (sessao) => {
        this.escolherIa(provider);
        if (solto || this.registros.has(sessao)) return;
        iniciada = sessao;
        this.registros.set(sessao, { controle, referencias: 1 });
      },
    });
    return {
      controle,
      soltar: () => {
        if (solto) return;
        solto = true;
        if (iniciada === undefined) {
          controle.parar();
          return;
        }
        const registro = this.registros.get(iniciada);
        if (registro?.controle !== controle) return;
        registro.referencias -= 1;
        this.soltarSeSobrou(iniciada);
      },
    };
  };

  /** O controle da conversa `id`, se alguém a pegou (sem pegá-la). */
  readonly controleDe = (id: string): ControleConversa | undefined => this.registros.get(id)?.controle;

  /**
   * O controle da conversa `id`, acompanhada daqui em diante (o primeiro a pegá-la a carrega); a função
   * devolvida solta a referência.
   */
  readonly pegar = (id: string): { readonly controle: ControleConversa; readonly soltar: () => void } => {
    let registro = this.registros.get(id);
    if (registro === undefined) {
      registro = { controle: new ControleConversa(this.api, { aoTerminar: this.apagadaFora }), referencias: 0 };
      this.registros.set(id, registro);
      const controle = registro.controle;
      void controle.abrir(id).then(() => {
        if (controle.obter().erroInicio?.texto === CONVERSA_INEXISTENTE) this.marcarApagada(id);
      });
    }
    registro.referencias += 1;
    const pego = registro;
    let solto = false;
    return {
      controle: pego.controle,
      soltar: () => {
        if (solto) return;
        solto = true;
        pego.referencias -= 1;
        this.soltarSeSobrou(id);
      },
    };
  };

  /**
   * Sem referência, a conversa deixa de ser acompanhada, numa tarefa à parte: a tela que se remonta na
   * mesma hora (o `StrictMode`, a troca de rota) pega o mesmo controle de volta.
   */
  private soltarSeSobrou(id: string): void {
    const agendada = setTimeout(() => {
      this.agendadas.delete(agendada);
      this.largarSemReferencia(id);
    }, 0);
    this.agendadas.add(agendada);
  }

  private largarSemReferencia(id: string): void {
    const registro = this.registros.get(id);
    if (registro === undefined || registro.referencias > 0) return;
    registro.controle.parar();
    this.registros.delete(id);
  }

  private marcarApagada(id: string): void {
    if (this.apagadas.has(id)) return;
    this.apagadas.add(id);
    this.aoApagar?.(id);
  }

  /** A conversa `id` foi apagada: quem a mostra volta ao começo, e sem ninguém ela sai daqui. */
  readonly apagada = (id: string): void => {
    this.rascunhos.delete(id);
    this.registros.get(id)?.controle.apagada();
    this.largarSemReferencia(id);
    this.marcarApagada(id);
  };

  /**
   * A conversa `id` foi apagada fora desta janela (o acompanhamento dela terminou): quem a mostra já diz que
   * ela não existe mais, e o painel e quem guarda o id ficam sabendo.
   */
  private readonly apagadaFora = (id: string): void => {
    this.rascunhos.delete(id);
    this.marcarApagada(id);
  };

  /** A caixa da conversa `id` quando a tela dela abrir (a continuação com outra IA). */
  readonly guardarRascunho = (id: string, rascunho: RascunhoConversa): void => {
    this.rascunhos.set(id, rascunho);
  };

  /**
   * A caixa guardada para a conversa `id`, como a pessoa a deixou (a tela a regrava a cada mudança); fica
   * até a mensagem sair (`esquecerRascunho`) ou a conversa ser apagada.
   */
  readonly rascunhoDe = (id: string): RascunhoConversa | undefined => this.rascunhos.get(id);

  readonly esquecerRascunho = (id: string): void => {
    this.rascunhos.delete(id);
  };

  /**
   * A vista (`VistaConversa`) mostra a conversa `id`; a função devolvida diz que deixou de mostrar. Pegar o
   * controle não basta: a aba Pasta do painel pega a conversa só para a pasta.
   */
  readonly mostrar = (id: string): (() => void) => {
    this.vistas.set(id, (this.vistas.get(id) ?? 0) + 1);
    let saiu = false;
    return () => {
      if (saiu) return;
      saiu = true;
      const restam = (this.vistas.get(id) ?? 1) - 1;
      if (restam > 0) this.vistas.set(id, restam);
      else this.vistas.delete(id);
    };
  };

  /** Alguma vista mostra a conversa `id` agora. */
  readonly naTela = (id: string): boolean => this.vistas.has(id);

  /** A conversa foi apagada nesta sessão do app (ou não existia mais ao abrir). */
  readonly foiApagada = (id: string): boolean => this.apagadas.has(id);

  /** O app fechando: as solturas agendadas não rodam, e nenhuma conversa segue acompanhada. */
  readonly encerrar = (): void => {
    for (const agendada of this.agendadas) clearTimeout(agendada);
    this.agendadas.clear();
    for (const registro of this.registros.values()) registro.controle.parar();
    this.registros.clear();
    this.rascunhos.clear();
  };
}
