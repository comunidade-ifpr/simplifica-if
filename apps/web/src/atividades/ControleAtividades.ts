/**
 * O que está rodando ou espera a pessoa (`docs/plans/multitarefa.md`, "Em andamento"), acompanhado do
 * servidor (`atividades.acompanhar`): o retrato ao abrir (e a cada reconexão) e cada mudança depois. Fica
 * fora do React, como o `ControleConversa`; a bandeja do cabeçalho e a lista de conversas o leem com
 * `useSyncExternalStore` (`obter` e `observar`).
 *
 * Uma atividade que passa a "resposta pronta" ou a "a IA pede permissão" (depois do retrato) é anunciada:
 * o texto vai à região `aria-live` da bandeja (salvo a de uma conversa que está na tela) e ao aviso do
 * sistema (`aoAvisar`, que o desktop só mostra com a janela sem foco). `aoContar` recebe a contagem do
 * que espera a pessoa (pronta, permissão, limite), para o selo do Dock.
 */
import type { Atividade, EventoAtividades } from "@simplifica-if/contratos-app";
import type { AvisoSistema } from "@simplifica-if/contratos-app/ponte";
import type { Acompanhamento, Api } from "../conexao/api.ts";
import { ehQuedaDaConexao } from "../conexao/erros.ts";

export interface EstadoAtividades {
  /** Da mais antiga para a mais nova (`desde`). */
  readonly atividades: ReadonlyArray<Atividade>;
  /** O último anúncio para o leitor de tela, com um número que muda a cada um (o mesmo texto repetido). */
  readonly anuncio: { readonly texto: string; readonly numero: number } | undefined;
}

export interface OpcoesAtividades {
  /** O aviso do sistema (no desktop). */
  readonly aoAvisar?: (aviso: AvisoSistema) => void;
  /** A contagem do que espera a pessoa, a cada mudança dela. */
  readonly aoContar?: (contagem: number) => void;
  /** A conversa `id` está na tela agora: a região `aria-live` não anuncia o que a pessoa já vê. */
  readonly naTela?: (conversa: string) => boolean;
}

/** As situações que esperam a pessoa (o selo conta estas). */
const esperaAPessoa = (atividade: Atividade): boolean => atividade.situacao !== "andamento";

/** O id da conversa de uma atividade de conversa (`conversa:<id>`), ou nada. */
export const conversaDaAtividade = (atividade: Atividade): string | undefined =>
  atividade.id.startsWith("conversa:") ? atividade.id.slice("conversa:".length) : undefined;

const ANUNCIOS: Readonly<Partial<Record<Atividade["situacao"], string>>> = {
  pronta: "Resposta pronta",
  permissao: "A IA pede permissão",
};

export class ControleAtividades {
  private estado: EstadoAtividades = { atividades: [], anuncio: undefined };
  private readonly observadores = new Set<() => void>();
  private readonly api: Api;
  private readonly opcoes: OpcoesAtividades;
  private acompanhamento: Acompanhamento | undefined;
  private pararConexao: (() => void) | undefined;
  /** Ainda nenhuma: o primeiro retrato manda a contagem, mesmo 0 (o selo de antes de recarregar a janela). */
  private contagem: number | undefined;
  private encerrado = false;
  /** O acompanhamento já recomeçou uma vez nesta conexão sem receber mudança: o próximo espera outra conexão. */
  private recomecou = false;

  constructor(api: Api, opcoes: OpcoesAtividades = {}) {
    this.api = api;
    this.opcoes = opcoes;
    // Acompanha a cada conexão aberta: o retrato recomeça a lista depois de uma queda.
    this.pararConexao = api.estado.observar(() => {
      if (api.estado.obter().fase !== "conectada") this.recomecou = false;
      this.seguirSeConectado();
    });
    this.seguirSeConectado();
  }

  readonly obter = (): EstadoAtividades => this.estado;

  readonly observar = (aviso: () => void): (() => void) => {
    this.observadores.add(aviso);
    return () => this.observadores.delete(aviso);
  };

  private trocar(estado: EstadoAtividades): void {
    this.estado = estado;
    for (const aviso of this.observadores) aviso();
    const contagem = estado.atividades.filter(esperaAPessoa).length;
    if (contagem !== this.contagem) {
      this.contagem = contagem;
      this.opcoes.aoContar?.(contagem);
    }
  }

  private seguirSeConectado(): void {
    if (this.encerrado || this.acompanhamento !== undefined) return;
    if (this.api.estado.obter().fase !== "conectada") return;
    const acompanhamento = this.api.acompanhar(
      (cliente) => cliente["atividades.acompanhar"]({}),
      (evento) => {
        if (this.acompanhamento !== acompanhamento) return;
        if (evento._tag !== "Retrato") this.recomecou = false;
        this.aplicar(evento);
      },
    );
    this.acompanhamento = acompanhamento;
    const terminou = (erro?: unknown) => {
      if (this.acompanhamento !== acompanhamento) return;
      this.acompanhamento = undefined;
      // Outra falha que não a queda (um defeito no servidor) não volta: espera a próxima conexão. A queda (ou
      // o fim) recomeça uma vez na hora; se acontecer de novo sem mudança nenhuma no meio (o socket ainda
      // aberto, um evento que não se lê), espera a próxima conexão, em vez de repetir sem fim.
      if (erro !== undefined && !ehQuedaDaConexao(erro)) return;
      if (this.recomecou) return;
      this.recomecou = true;
      queueMicrotask(() => this.seguirSeConectado());
    };
    acompanhamento.fim.then(() => terminou(), terminou);
  }

  private aplicar(evento: EventoAtividades): void {
    const atuais = this.estado.atividades;
    switch (evento._tag) {
      case "Retrato":
        this.trocar({ ...this.estado, atividades: ordenar(evento.atividades) });
        return;
      case "Saiu":
        this.trocar({ ...this.estado, atividades: atuais.filter((a) => a.id !== evento.id) });
        return;
      case "Mudou": {
        const nova = evento.atividade;
        const anterior = atuais.find((a) => a.id === nova.id);
        const atividades = ordenar([...atuais.filter((a) => a.id !== nova.id), nova]);
        // O pedido seguinte da mesma conversa (outro na fila) também se anuncia.
        const mesma = anterior?.situacao === nova.situacao && anterior.aprovacao?.id === nova.aprovacao?.id;
        const anuncio = mesma ? undefined : ANUNCIOS[nova.situacao];
        if (anuncio === undefined) {
          this.trocar({ ...this.estado, atividades });
          return;
        }
        const conversa = conversaDaAtividade(nova);
        const vista = conversa !== undefined && this.opcoes.naTela?.(conversa) === true;
        this.trocar({
          atividades,
          anuncio: vista
            ? this.estado.anuncio
            : { texto: `${anuncio}: ${nova.titulo}`, numero: (this.estado.anuncio?.numero ?? 0) + 1 },
        });
        this.opcoes.aoAvisar?.({ tipo: nova.situacao === "pronta" ? "resposta" : "permissao", rota: nova.rota });
      }
    }
  }

  /** O app fechando: para de acompanhar. */
  readonly encerrar = (): void => {
    this.encerrado = true;
    this.pararConexao?.();
    this.pararConexao = undefined;
    this.acompanhamento?.cancelar();
    this.acompanhamento = undefined;
  };
}

const ordenar = (atividades: ReadonlyArray<Atividade>): ReadonlyArray<Atividade> =>
  [...atividades].sort((a, b) => a.desde.localeCompare(b.desde));
