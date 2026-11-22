/**
 * O turno sem ferramentas do julgamento (M1.11, etapa 4), com um motor de teste e o `TestClock`: o
 * texto parcial avisa o andamento no máximo uma vez por `INTERVALO_ATIVIDADE`, e o tempo esgotado diz
 * o que estava sendo avaliado e se a IA chegou a responder em parte.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as Motor from "@simplifica-if/motor";
import { INTERVALO_ATIVIDADE, PausaRevisao, turnoSemFerramentas } from "../src/revisao-ppc/julgamento.ts";

/** Um motor que responde a toda mensagem com os eventos dados. */
const motorCom = (eventos: Stream.Stream<Motor.Evento>) =>
  Layer.succeed(
    Motor.Motor,
    // Só o que o turno usa: abrir, enviar, encerrar e responder aprovação.
    Motor.Motor.of({
      iniciarSessao: () => Effect.succeed("sessao"),
      enviarMensagem: () => eventos,
      encerrar: () => Effect.void,
      responderAprovacao: () => Effect.void,
    } as unknown as Motor.Motor["Service"]),
  );

const parcial: Motor.Evento = { _tag: "TextoParcial", texto: "{" };
const final: Motor.Evento = { _tag: "TextoFinal", texto: "{}" };

/** Um turno com o motor dado, contando os avisos de texto recebido. */
const turno = (eventos: Stream.Stream<Motor.Evento>, tempoTurno = Duration.minutes(6)) =>
  Effect.gen(function* () {
    let avisos = 0;
    const fibra = yield* turnoSemFerramentas({
      provider: "claude",
      modelo: null,
      instrucoes: "",
      texto: "pedido",
      tempoTurno,
      numero: 1,
      assunto: "o tema “Matriz curricular” (j-02)",
      aoReceber: () => Effect.sync(() => (avisos += 1)),
    }).pipe(Effect.provide(Layer.merge(motorCom(eventos), NodeServices.layer)), Effect.forkChild);
    return { fibra, avisos: () => avisos };
  });

/** Deixa rodar o que está pronto (a fibra do turno). */
const rodar = Effect.gen(function* () {
  for (let i = 0; i < 20; i++) yield* Effect.yieldNow;
});

describe("turno sem ferramentas", () => {
  it.effect("o texto parcial avisa o andamento no primeiro pedaço e, depois, no máximo um por intervalo", () =>
    Effect.gen(function* () {
      const espera = Stream.fromEffect(Effect.sleep(INTERVALO_ATIVIDADE)).pipe(Stream.drain);
      const eventos = Stream.make(parcial, parcial, parcial).pipe(
        Stream.concat(espera),
        Stream.concat(Stream.make(parcial, parcial, final)),
      );
      const { fibra, avisos } = yield* turno(eventos);
      yield* rodar;
      assert.strictEqual(avisos(), 1);
      yield* TestClock.adjust(INTERVALO_ATIVIDADE);
      const resultado = yield* Fiber.join(fibra);
      assert.strictEqual(resultado.texto, "{}");
      assert.strictEqual(avisos(), 2);
    }),
  );

  it.effect("o tempo esgotado diz o tema e se a IA chegou a responder em parte", () =>
    Effect.gen(function* () {
      const tempo = Duration.minutes(6);
      const comTexto = yield* turno(Stream.make(parcial).pipe(Stream.concat(Stream.never)), tempo);
      const semTexto = yield* turno(Stream.never, tempo);
      yield* rodar;
      yield* TestClock.adjust(tempo);
      const motivo = (saida: Exit.Exit<unknown, unknown>) => {
        assert.isTrue(Exit.isFailure(saida));
        const erro = Exit.isFailure(saida) ? saida.cause.reasons.find((r) => r._tag === "Fail") : undefined;
        assert.instanceOf(erro?._tag === "Fail" ? erro.error : undefined, PausaRevisao);
        const pausa = (erro as { error: PausaRevisao }).error;
        assert.isFalse(pausa.limite);
        return pausa.motivo;
      };
      const parcialMotivo = motivo(yield* Fiber.await(comTexto.fibra));
      assert.include(parcialMotivo, "demorou demais para responder sobre o tema “Matriz curricular” (j-02)");
      assert.include(parcialMotivo, "chegou a responder em parte");
      assert.include(motivo(yield* Fiber.await(semTexto.fibra)), "não chegou a mandar resposta");
    }),
  );
});
