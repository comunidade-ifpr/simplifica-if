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

export const make = Effect.fn("Canal.make")(function* () {
  let corrente: Fila | undefined;
  const pendentes = new Map<string, Deferred.Deferred<Decisao>>();

  const emitirAgora = (evento: Evento): void => {
    if (corrente === undefined) return;
    Queue.offerUnsafe(corrente, evento);
    if (evento._tag === "FimTurno") Queue.endUnsafe(corrente);
  };

  const emitir = (evento: Evento) => Effect.sync(() => emitirAgora(evento));

  const falhar = (erro: FalhaProvider) =>
    Effect.suspend(() => (corrente === undefined ? Effect.void : Queue.fail(corrente, erro).pipe(Effect.asVoid)));

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
        if (corrente !== undefined) return yield* new TurnoEmAndamento();
        const fila: Fila = yield* Queue.unbounded<Evento, FalhaProvider | Cause.Done>();
        corrente = fila;
        yield* iniciar;
        return Stream.fromQueue(fila).pipe(
          Stream.ensuring(
            Effect.sync(() => {
              if (corrente === fila) corrente = undefined;
            }),
          ),
        );
      }),
    );

  return { emitir, emitirAgora, falhar, pedirAprovacao, responder, turno } satisfies Canal;
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
