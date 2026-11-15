/**
 * O `Motor` sobre um driver falso feito com o mesmo `Canal` dos drivers reais: o turno, a ida e
 * volta da aprovação, o turno concorrente, a interrupção e o encerramento.
 */
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
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

  it.effect("detectar repassa o estado do driver e diz o que o app oferece", () => {
    const registro = { encerradas: 0, interrompidas: 0 };
    return Effect.gen(function* () {
      const motor = yield* Motor.Motor;
      const estado = yield* motor.detectar("codex");
      assert.deepStrictEqual(estado, {
        provider: "claude",
        instalado: true,
        autenticado: true,
        plano: "teste",
        podeInstalar: false,
        podeEntrar: false,
      });
    }).pipe(Effect.provide(camada(registro)));
  });

  it.effect("podeInstalar e podeEntrar seguem o driver ter instalar e entrar", () => {
    const registro = { encerradas: 0, interrompidas: 0 };
    const base = driverFalso(registro);
    const drivers = Motor.Drivers.of({
      claude: base,
      codex: { ...base, instalar: Stream.empty },
      antigravity: { ...base, instalar: Stream.empty, entrar: Stream.empty },
    });
    return Effect.gen(function* () {
      const motor = yield* Motor.Motor;
      const capacidades = yield* Effect.forEach(["claude", "codex", "antigravity"] as const, (provider) =>
        Effect.map(motor.detectar(provider), ({ podeInstalar, podeEntrar }) => ({ podeInstalar, podeEntrar })),
      );
      assert.deepStrictEqual(capacidades, [
        { podeInstalar: false, podeEntrar: false },
        { podeInstalar: true, podeEntrar: false },
        { podeInstalar: true, podeEntrar: true },
      ]);
    }).pipe(Effect.provide(Motor.layer.pipe(Layer.provide(Layer.succeed(Motor.Drivers, drivers)))));
  });

  it.effect("queda: o turno corrente falha, os próximos são recusados, e o motor informa o id nativo e a queda", () =>
    Effect.gen(function* () {
      const canal = yield* Canal.make;
      const queda = yield* Deferred.make<Motor.FalhaProvider>();
      const driver: Motor.Driver = {
        detectar: Effect.succeed({ provider: "claude", instalado: true, autenticado: true }),
        iniciar: (config) =>
          Effect.succeed({
            idNativo: config.retomar ?? "nativo-1",
            queda: Deferred.await(queda),
            enviar: () => canal.turno(Effect.void),
            responder: canal.responder,
            interromper: Effect.void,
          } satisfies Motor.SessaoDriver),
      };
      const camadaQueda = Motor.layer.pipe(
        Layer.provide(
          Layer.succeed(Motor.Drivers, Motor.Drivers.of({ claude: driver, codex: driver, antigravity: driver })),
        ),
      );
      yield* Effect.gen(function* () {
        const motor = yield* Motor.Motor;
        const sessao = yield* motor.iniciarSessao(CONFIG);
        const info = yield* motor.infoSessao(sessao);
        assert.strictEqual(info.idNativo, "nativo-1");
        const retomada = yield* motor.infoSessao(yield* motor.iniciarSessao({ ...CONFIG, retomar: "nativo-9" }));
        assert.strictEqual(retomada.idNativo, "nativo-9");

        const turno = yield* Stream.runCollect(motor.enviarMensagem(sessao, "olá")).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        const falha = new Motor.FalhaProvider({ provider: "claude", operacao: "sessão", detalhe: "caiu" });
        yield* canal.morrer(falha);
        yield* Deferred.succeed(queda, falha);
        const saida = yield* Fiber.await(turno);
        assert.isTrue(Exit.hasFails(saida));
        assert.strictEqual(yield* info.queda, falha);
        const depois = yield* Effect.flip(Stream.runDrain(motor.enviarMensagem(sessao, "de novo")));
        assert.strictEqual(depois, falha);
      }).pipe(Effect.provide(camadaQueda));
    }),
  );
});
