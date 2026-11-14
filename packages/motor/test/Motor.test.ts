/**
 * O `Motor` sobre um driver falso feito com o mesmo `Canal` dos drivers reais: o turno, a ida e
 * volta da aprovação, o turno concorrente, a interrupção e o encerramento.
 */
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Canal from "../src/Canal.ts";
import * as Motor from "../src/Motor.ts";

interface Registro {
  encerradas: number;
  interrompidas: number;
}

/** Driver falso: pede aprovação para "escrever" e conclui conforme a decisão. */
const driverFalso = (registro: Registro): Motor.Driver => ({
  detectar: Effect.succeed({ provider: "claude", instalado: true, autenticado: true, plano: "teste" }),
  iniciar: () =>
    Effect.gen(function* () {
      const canal = yield* Canal.make;
      const escopo = yield* Effect.scope;
      yield* Effect.addFinalizer(() => Effect.sync(() => registro.encerradas++));
      const responder = (texto: string) =>
        Effect.gen(function* () {
          yield* canal.emitir({ _tag: "TextoParcial", texto: "Vou " });
          yield* canal.emitir({ _tag: "FerramentaIniciada", id: "f1", nome: "escrever", entrada: { texto } });
          const decisao = yield* canal.pedirAprovacao({
            id: "f1",
            ferramenta: "escrever",
            descricao: "escrever um arquivo",
            entrada: { texto },
          });
          yield* canal.emitir({
            _tag: "FerramentaConcluida",
            id: "f1",
            nome: "escrever",
            resumo: decisao,
            falhou: decisao === "negar",
          });
          yield* canal.emitir({ _tag: "TextoFinal", texto: `Vou ${decisao}` });
          yield* canal.emitir({ _tag: "FimTurno", motivo: "end_turn" });
        });
      return {
        enviar: (texto) => canal.turno(Effect.asVoid(Effect.forkIn(responder(texto), escopo))),
        responder: canal.responder,
        interromper: Effect.sync(() => registro.interrompidas++),
      } satisfies Motor.SessaoDriver;
    }),
});

const camada = (registro: Registro) => {
  const driver = driverFalso(registro);
  return Motor.layer.pipe(
    Layer.provide(
      Layer.succeed(Motor.Drivers, Motor.Drivers.of({ claude: driver, codex: driver, antigravity: driver })),
    ),
  );
};

const CONFIG = { provider: "claude", pastaTrabalho: "/tmp", servidoresMcp: [] } satisfies Motor.ConfigSessao;

/** Consome o turno respondendo ao pedido de aprovação com `decisao`. */
const turnoRespondendo = (sessao: string, decisao: Motor.Decisao) =>
  Effect.gen(function* () {
    const motor = yield* Motor.Motor;
    return yield* motor.enviarMensagem(sessao, "olá").pipe(
      Stream.tap((evento) =>
        evento._tag === "PedidoAprovacao" ? motor.responderAprovacao(sessao, evento.id, decisao) : Effect.void,
      ),
      Stream.runCollect,
    );
  });

describe("Motor", () => {
  it.effect("ida e volta da aprovação: negar e depois permitir", () => {
    const registro = { encerradas: 0, interrompidas: 0 };
    return Effect.gen(function* () {
      const motor = yield* Motor.Motor;
      const sessao = yield* motor.iniciarSessao(CONFIG);
      assert.strictEqual(sessao, "claude-1");

      const negado = yield* turnoRespondendo(sessao, "negar");
      assert.deepStrictEqual(
        negado.map((evento) => evento._tag),
        ["TextoParcial", "FerramentaIniciada", "PedidoAprovacao", "FerramentaConcluida", "TextoFinal", "FimTurno"],
      );
      assert.deepInclude(negado[3], { falhou: true, resumo: "negar" });

      const permitido = yield* turnoRespondendo(sessao, "permitir");
      assert.deepInclude(permitido[3], { falhou: false, resumo: "permitir" });

      yield* motor.encerrar(sessao);
      assert.strictEqual(registro.encerradas, 1);
    }).pipe(Effect.provide(camada(registro)));
  });

  it.effect("erros tipados: aprovação desconhecida, turno em andamento, sessão encerrada", () => {
    const registro = { encerradas: 0, interrompidas: 0 };
    return Effect.gen(function* () {
      const motor = yield* Motor.Motor;
      const sessao = yield* motor.iniciarSessao(CONFIG);

      const desconhecida = yield* Effect.exit(motor.responderAprovacao(sessao, "nada", "permitir"));
      assert.isTrue(Exit.hasFails(desconhecida));

      // Um turno parado no pedido de aprovação; um segundo envio na mesma sessão é recusado.
      const primeiro = yield* motor.enviarMensagem(sessao, "um").pipe(
        Stream.takeUntil((evento) => evento._tag === "PedidoAprovacao"),
        Stream.runCollect,
        Effect.forkChild,
      );
      const eventos = yield* Fiber.join(primeiro);
      assert.strictEqual(eventos.at(-1)?._tag, "PedidoAprovacao");
      const segundo = yield* Effect.exit(Stream.runDrain(motor.enviarMensagem(sessao, "dois")));
      assert.isTrue(Exit.hasFails(segundo));
      // Respondido o pedido, o provider termina o turno, e a sessão aceita um novo envio.
      yield* motor.responderAprovacao(sessao, "f1", "negar");
      const terceiro = yield* turnoRespondendo(sessao, "permitir");
      assert.strictEqual(terceiro.at(-1)?._tag, "FimTurno");

      yield* motor.interromper(sessao);
      assert.strictEqual(registro.interrompidas, 1);

      yield* motor.encerrar(sessao);
      const depois = yield* Effect.exit(motor.encerrar(sessao));
      assert.isTrue(Exit.hasFails(depois));
    }).pipe(Effect.provide(camada(registro)));
  });

  it.effect("encerrar a layer encerra as sessões abertas", () => {
    const registro = { encerradas: 0, interrompidas: 0 };
    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const motor = yield* Motor.Motor;
        yield* motor.iniciarSessao(CONFIG);
        yield* motor.iniciarSessao({ ...CONFIG, provider: "codex" });
        assert.strictEqual(registro.encerradas, 0);
      }).pipe(Effect.provide(camada(registro)));
      assert.strictEqual(registro.encerradas, 2);
    });
  });

  it.effect("detectar repassa o estado do driver", () => {
    const registro = { encerradas: 0, interrompidas: 0 };
    return Effect.gen(function* () {
      const motor = yield* Motor.Motor;
      const estado = yield* motor.detectar("codex");
      assert.deepStrictEqual(estado, { provider: "claude", instalado: true, autenticado: true, plano: "teste" });
    }).pipe(Effect.provide(camada(registro)));
  });
});
