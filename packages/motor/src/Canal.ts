/**
 * Encanamento comum aos drivers: a fila de eventos do turno corrente e os pedidos de aprovação
 * pendentes. O driver emite eventos à medida que o provider fala; `turno` devolve o stream que o
 * `Motor` entrega, do primeiro evento até `FimTurno`.
 */
import type * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { AprovacaoDesconhecida, type Decisao, FalhaProvider, type SessaoDriver, TurnoEmAndamento } from "./Driver.ts";
import type { Evento } from "./eventos.ts";
import { classificarFalha, textoDaCausa } from "./falhas.ts";
import { type Avaliacao, type ClassePedido, type Politica, avaliar } from "./politica.ts";

type Fila = Queue.Queue<Evento, FalhaProvider | Cause.Done>;

/** Um pedido de aprovação como o driver o recebe do provider, já com nome, descrição e entrada. */
export interface Pedido {
  readonly id: string;
  readonly ferramenta: string;
  readonly descricao: string;
  readonly entrada: unknown;
}

/** A resposta a um pedido; `motivo` vem quando a política decidiu sozinha. */
export interface RespostaAprovacao {
  readonly decisao: Decisao;
  readonly motivo?: string;
}

export interface Canal {
  /** Emite no turno corrente; fora de turno, o evento se perde (o provider falou sozinho). */
  readonly emitir: (evento: Evento) => Effect.Effect<void>;
  /** O mesmo, para callbacks síncronos do SDK. */
  readonly emitirAgora: (evento: Evento) => void;
  /** Termina o turno corrente com erro (o processo do provider caiu, por exemplo). */
  readonly falhar: (erro: FalhaProvider) => Effect.Effect<void>;
  /**
   * O processo do provider acabou: termina o turno corrente com `erro` e recusa os próximos com o
   * mesmo erro. A sessão não volta; quem a usa abre outra (por retomada).
   */
  readonly morrer: (erro: FalhaProvider) => Effect.Effect<void>;
  /**
   * Emite `PedidoAprovacao` e espera a resposta de `responder`. Se o turno acabar antes (interrupção),
   * a espera é interrompida junto com quem a chamou.
   */
  readonly pedirAprovacao: (pedido: Pedido) => Effect.Effect<Decisao>;
  /**
   * Aplica a política ao pedido classificado: `permitir` e `negar` se respondem aqui, sem evento;
   * `perguntar` segue como `pedirAprovacao`. Sem política (`make`), sempre pergunta.
   */
  readonly aprovar: (pedido: Pedido & { readonly classe: ClassePedido }) => Effect.Effect<RespostaAprovacao>;
  readonly responder: SessaoDriver["responder"];
  /** Abre um turno: cria a fila, roda `iniciar` (que dispara o provider) e devolve o stream. */
  readonly turno: <E>(iniciar: Effect.Effect<void, E>) => Stream.Stream<Evento, E | FalhaProvider | TurnoEmAndamento>;
}

/** O canal de uma sessão; `decidir` é a política já presa à pasta da sessão. */
const criar = (decidir: ((classe: ClassePedido) => Avaliacao) | undefined): Effect.Effect<Canal> =>
  Effect.sync(() => {
    let corrente: Fila | undefined;
    let morta: FalhaProvider | undefined;
    const pendentes = new Map<string, Deferred.Deferred<Decisao>>();

    // O turno fica em andamento até o provider terminá-lo (`FimTurno` ou falha), mesmo que quem lê o
    // stream pare antes: o provider continua trabalhando, e um segundo envio seria misturado a ele.
    const emitirAgora = (evento: Evento): void => {
      if (corrente === undefined) return;
      Queue.offerUnsafe(corrente, evento);
      if (evento._tag === "FimTurno") {
        Queue.endUnsafe(corrente);
        corrente = undefined;
      }
    };

    const emitir = (evento: Evento) => Effect.sync(() => emitirAgora(evento));

    const falhar = (erro: FalhaProvider) =>
      Effect.suspend(() => {
        const fila = corrente;
        corrente = undefined;
        return fila === undefined ? Effect.void : Queue.fail(fila, erro).pipe(Effect.asVoid);
      });

    // `fnUntraced`: roda a cada pedido de aprovação, dentro do span do turno.
    const pedirAprovacao: Canal["pedirAprovacao"] = Effect.fnUntraced(function* (pedido) {
      const resposta = yield* Deferred.make<Decisao>();
      pendentes.set(pedido.id, resposta);
      yield* emitir({ _tag: "PedidoAprovacao", ...pedido });
      return yield* Deferred.await(resposta).pipe(Effect.ensuring(Effect.sync(() => pendentes.delete(pedido.id))));
    });

    const morrer = (erro: FalhaProvider) =>
      Effect.suspend(() => {
        morta ??= erro;
        return falhar(erro);
      });

    const responder: Canal["responder"] = (id, decisao) =>
      Effect.suspend(() => {
        const resposta = pendentes.get(id);
        if (resposta === undefined) return Effect.fail(new AprovacaoDesconhecida({ id }));
        return Deferred.succeed(resposta, decisao).pipe(Effect.asVoid);
      });

    const turno: Canal["turno"] = (iniciar) =>
      Stream.unwrap(
        Effect.gen(function* () {
          if (morta !== undefined) return yield* morta;
          if (corrente !== undefined) return yield* new TurnoEmAndamento();
          const fila: Fila = yield* Queue.unbounded<Evento, FalhaProvider | Cause.Done>();
          corrente = fila;
          // Se o provider recusar o envio, não há turno.
          yield* iniciar.pipe(Effect.onError(() => Effect.sync(() => (corrente = undefined))));
          return Stream.fromQueue(fila);
        }),
      );

    const aprovar: Canal["aprovar"] = ({ classe, ...pedido }) =>
      Effect.suspend(() => {
        const avaliacao = decidir?.(classe);
        if (avaliacao === undefined || avaliacao.regra === "perguntar") {
          return Effect.map(pedirAprovacao(pedido), (decisao): RespostaAprovacao => ({ decisao }));
        }
        return Effect.succeed<RespostaAprovacao>({ decisao: avaliacao.regra, motivo: avaliacao.motivo });
      });

    return { emitir, emitirAgora, falhar, morrer, pedirAprovacao, aprovar, responder, turno } satisfies Canal;
  });

/** Canal sem política: todo pedido vira `PedidoAprovacao` (drivers de teste). */
export const make: Effect.Effect<Canal> = criar(undefined);

/** Canal com a política aplicada aos pedidos da sessão na `pasta` de trabalho. */
export const comPolitica = (politica: Politica, pasta: string): Effect.Effect<Canal> =>
  criar((classe) => avaliar(politica, classe, pasta));

/**
 * Erro de provider a partir de uma causa qualquer: o tipo sai do classificador sobre o texto da causa,
 * que fica só em `cause`, sem ir para atributo.
 */
export const falhaDe =
  (provider: string, operacao: string) =>
  (cause: unknown): FalhaProvider =>
    new FalhaProvider({ provider, operacao, tipo: classificarFalha(operacao, textoDaCausa(cause)), cause });
