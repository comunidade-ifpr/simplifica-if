/**
 * As atividades do app (`docs/plans/multitarefa.md`, "Em andamento"): o que está rodando ou espera a
 * pessoa, para a bandeja do cabeçalho, a lista de conversas e o aviso do sistema.
 *
 * O serviço só guarda e distribui. Quem sabe de cada atividade a publica explicitamente: as `Conversas`
 * (o turno que começa e termina, o pedido de aprovação e a decisão, a cota, a conversa vista ou apagada)
 * e o módulo da revisão (a leitura com IA), que o núcleo não importa. Uma atividade igual à que já está
 * não se republica: o andamento da leitura muda a cada sinal da IA, e a bandeja não precisa de cada um.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import type { Atividade, EventoAtividades } from "@simplifica-if/contratos-app";

export class Atividades extends Context.Service<
  Atividades,
  {
    /** Põe a atividade, ou troca a de mesmo `id`. */
    readonly publicar: (atividade: Atividade) => Effect.Effect<void>;
    /** Tira a atividade `id`, se está. */
    readonly retirar: (id: string) => Effect.Effect<void>;
    /**
     * Põe a atividade `id` como `calcular` a dá agora, ou a tira (`undefined`). O cálculo roda na mesma
     * vez das outras mudanças: quem lê o estado por último publica por último, e uma atualização atrasada
     * não recoloca o que já saiu (a conversa apagada, a leitura que terminou). `calcular` não publica.
     */
    readonly atualizar: <E, R>(
      id: string,
      calcular: Effect.Effect<Atividade | undefined, E, R>,
    ) => Effect.Effect<void, E, R>;
    /** O retrato de agora e, daí em diante, cada mudança; não termina sozinho. */
    readonly acompanhar: Stream.Stream<EventoAtividades>;
  }
>()("@simplifica-if/server/Atividades") {}

/** As duas atividades dizem o mesmo (os campos são dados simples, na mesma ordem de quem as monta). */
const iguais = (a: Atividade, b: Atividade): boolean => JSON.stringify(a) === JSON.stringify(b);

const make = Effect.gen(function* () {
  const atuais = new Map<string, Atividade>();
  const mudancas = yield* PubSub.unbounded<EventoAtividades>();
  // Mudar e tirar o retrato, um de cada vez: nenhuma mudança cai entre o retrato e a inscrição.
  const trava = yield* Semaphore.make(1);

  /** Com a `trava`. */
  const por = (atividade: Atividade) =>
    Effect.suspend(() => {
      const anterior = atuais.get(atividade.id);
      if (anterior !== undefined && iguais(anterior, atividade)) return Effect.void;
      atuais.set(atividade.id, atividade);
      return PubSub.publish(mudancas, { _tag: "Mudou", atividade });
    });

  /** Com a `trava`. */
  const tirar = (id: string) =>
    Effect.suspend(() => (atuais.delete(id) ? PubSub.publish(mudancas, { _tag: "Saiu", id }) : Effect.void));

  const publicar = Effect.fn("Atividades.publicar")(function* (atividade: Atividade) {
    yield* trava.withPermits(1)(por(atividade));
  });

  const retirar = Effect.fn("Atividades.retirar")(function* (id: string) {
    yield* trava.withPermits(1)(tirar(id));
  });

  const atualizar = <E, R>(id: string, calcular: Effect.Effect<Atividade | undefined, E, R>) =>
    trava
      .withPermits(1)(
        calcular.pipe(Effect.flatMap((atividade) => (atividade === undefined ? tirar(id) : por(atividade)))),
      )
      .pipe(Effect.asVoid, Effect.withSpan("Atividades.atualizar"));

  const acompanhar = Stream.unwrap(
    trava.withPermits(1)(
      Effect.gen(function* () {
        const inscricao = yield* PubSub.subscribe(mudancas);
        const retrato: EventoAtividades = { _tag: "Retrato", atividades: [...atuais.values()] };
        return Stream.concat(Stream.make(retrato), Stream.fromSubscription(inscricao));
      }),
    ),
  );

  return Atividades.of({ publicar, retirar, atualizar, acompanhar });
});

export const layer = Layer.effect(Atividades, make);
