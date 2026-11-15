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

type Fila = Queue.Queue<Evento, FalhaProvider | Cause.Done>;

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
  readonly pedirAprovacao: (pedido: {
    readonly id: string;
    readonly ferramenta: string;
    readonly descricao: string;
    readonly entrada: unknown;
  }) => Effect.Effect<Decisao>;
  readonly responder: SessaoDriver["responder"];
  /** Abre um turno: cria a fila, roda `iniciar` (que dispara o provider) e devolve o stream. */
  readonly turno: <E>(iniciar: Effect.Effect<void, E>) => Stream.Stream<Evento, E | FalhaProvider | TurnoEmAndamento>;
}

export const make: Effect.Effect<Canal> = Effect.sync(() => {
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

  const morrer = (erro: FalhaProvider) =>
    Effect.suspend(() => {
      morta ??= erro;
      return falhar(erro);
    });

  const pedirAprovacao: Canal["pedirAprovacao"] = Effect.fnUntraced(function* (pedido) {
    const resposta = yield* Deferred.make<Decisao>();
    pendentes.set(pedido.id, resposta);
    yield* emitir({ _tag: "PedidoAprovacao", ...pedido });
    return yield* Deferred.await(resposta).pipe(Effect.ensuring(Effect.sync(() => pendentes.delete(pedido.id))));
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

  return { emitir, emitirAgora, falhar, morrer, pedirAprovacao, responder, turno } satisfies Canal;
});

/** Erro de provider a partir de uma causa qualquer, sem copiar o texto cru para atributos. */
export const falhaDe =
  (provider: string, operacao: string) =>
  (cause: unknown): FalhaProvider =>
    new FalhaProvider({
      provider,
      operacao,
      detalhe: cause instanceof Error ? cause.message.slice(0, 300) : "erro desconhecido",
      cause,
    });
