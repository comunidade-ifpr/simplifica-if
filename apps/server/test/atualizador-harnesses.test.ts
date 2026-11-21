/**
 * O serviço `AtualizadorHarnesses` do servidor: agenda silenciosa (atraso inicial, re-tentativa
 * curta quando ocupado e intervalo normal), limpeza na abertura e após atualização, respeito às IAs
 * desligadas, serialização pelo semáforo e integração via `Servidor.layer`.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as Motor from "@simplifica-if/motor";
import * as AtualizadorHarnesses from "../src/AtualizadorHarnesses.ts";
import * as Servidor from "../src/servidor.ts";
import { bancoFixture, limparTemporarios } from "./apoio.ts";

afterEach(limparTemporarios);

interface Registro {
  readonly atualizacoes: Array<Motor.Provider>;
  readonly limpezas: Array<Motor.Provider>;
}

const montarDrivers = (
  registro: Registro,
  respostas: Partial<Record<Motor.Provider, Effect.Effect<Motor.ResultadoAtualizacaoHarness>>>,
  aoLimpar?: (provider: Motor.Provider) => Effect.Effect<void>,
) => {
  const criar = (provider: Motor.Provider): Motor.Driver => ({
    detectar: Effect.succeed({ provider, instalado: true, autenticado: true }),
    iniciar: () =>
      Effect.succeed({
        enviar: () => Stream.empty,
        responder: () => Effect.void,
        interromper: Effect.void,
      }),
    ...(respostas[provider] === undefined
      ? {}
      : {
          atualizarHarness: Effect.gen(function* () {
            registro.atualizacoes.push(provider);
            return yield* respostas[provider]!;
          }),
          limparVersoesAntigas: Effect.gen(function* () {
            registro.limpezas.push(provider);
            if (aoLimpar !== undefined) yield* aoLimpar(provider);
            return 1;
          }),
        }),
  });
  return Layer.succeed(
    Motor.Drivers,
    Motor.Drivers.of({
      claude: criar("claude"),
      codex: criar("codex"),
      antigravity: criar("antigravity"),
    }),
  );
};

describe("AtualizadorHarnesses (serviço)", () => {
  it.effect("atualiza Antigravity e Codex, limpa apenas os atualizados e pula IAs desligadas", () =>
    Effect.gen(function* () {
      const registro: Registro = { atualizacoes: [], limpezas: [] };
      const desligadas = yield* Ref.make<ReadonlyArray<Motor.Provider>>([]);
      const drivers = montarDrivers(registro, {
        antigravity: Effect.succeed({ status: "atualizado", de: "1.5.12", para: "1.5.14" }),
        codex: Effect.succeed({ status: "em-dia", versao: "0.169.0" }),
      });
      const camada = AtualizadorHarnesses.layer({
        ocupado: Effect.succeed(false),
        desligados: Ref.get(desligadas),
        automatico: false,
      }).pipe(Layer.provide(Motor.layer), Layer.provide(drivers), Layer.provide(NodeServices.layer));

      yield* Effect.gen(function* () {
        const atualizador = yield* AtualizadorHarnesses.AtualizadorHarnesses;
        const primeiro = yield* atualizador.conferirAgora;
        assert.deepStrictEqual(primeiro, {
          antigravity: { status: "atualizado", de: "1.5.12", para: "1.5.14" },
          codex: { status: "em-dia", versao: "0.169.0" },
        });
        assert.deepStrictEqual(registro.atualizacoes, ["antigravity", "codex"]);
        // Só o Antigravity atualizou, então só ele dispara limpeza pós-atualização.
        assert.deepStrictEqual(registro.limpezas, ["antigravity"]);

        // Desligando o Codex, só o Antigravity é conferido.
        yield* Ref.set(desligadas, ["codex"]);
        const segundo = yield* atualizador.conferirAgora;
        assert.deepStrictEqual(segundo.codex, { status: "ignorado", motivo: "desligada" });
        assert.deepStrictEqual(registro.atualizacoes, ["antigravity", "codex", "antigravity"]);
      }).pipe(Effect.provide(camada));
    }),
  );

  it.effect("pula enquanto ocupado e tenta novamente após intervaloOcupado em vez de esperar 12 h", () =>
    Effect.gen(function* () {
      const registro: Registro = { atualizacoes: [], limpezas: [] };
      const ocupado = yield* Ref.make(true);
      const rodou = yield* Deferred.make<void>();
      const drivers = montarDrivers(registro, {
        antigravity: Effect.succeed({ status: "em-dia", versao: "1.5.14" }),
        codex: Deferred.succeed(rodou, undefined).pipe(
          Effect.as({ status: "em-dia", versao: "0.169.0" } satisfies Motor.ResultadoAtualizacaoHarness),
        ),
      });
      const camada = AtualizadorHarnesses.layer({
        ocupado: Ref.get(ocupado),
        desligados: Effect.succeed([]),
        atrasoInicial: Duration.seconds(15),
        intervaloOcupado: Duration.minutes(10),
        intervalo: Duration.hours(12),
        automatico: true,
      }).pipe(Layer.provide(Motor.layer), Layer.provide(drivers), Layer.provide(NodeServices.layer));

      yield* Effect.gen(function* () {
        yield* AtualizadorHarnesses.AtualizadorHarnesses;
        // Aos 15 s: ocupado = true, pula sem chamar os drivers.
        yield* TestClock.adjust(Duration.seconds(15));
        assert.deepStrictEqual(registro.atualizacoes, []);

        // Libera o servidor e avança só os 10 min de `intervaloOcupado`: já confere!
        yield* Ref.set(ocupado, false);
        yield* TestClock.adjust(Duration.minutes(10));
        yield* Deferred.await(rodou);
        assert.deepStrictEqual(registro.atualizacoes, ["antigravity", "codex"]);

        // Depois de uma rodada normal, volta a esperar 12 h (10 min não dispara de novo).
        yield* TestClock.adjust(Duration.minutes(10));
        assert.deepStrictEqual(registro.atualizacoes, ["antigravity", "codex"]);
      }).pipe(Effect.provide(camada));
    }),
  );

  it.effect("modo automático: limpa na abertura, espera o atraso inicial e repete no intervalo", () =>
    Effect.gen(function* () {
      const registro: Registro = { atualizacoes: [], limpezas: [] };
      const primeiraRodada = yield* Deferred.make<void>();
      const segundaRodada = yield* Deferred.make<void>();
      let ciclosCodex = 0;
      const drivers = montarDrivers(registro, {
        antigravity: Effect.succeed({ status: "em-dia", versao: "1.5.14" }),
        codex: Effect.gen(function* () {
          ciclosCodex += 1;
          if (ciclosCodex === 1) yield* Deferred.succeed(primeiraRodada, undefined);
          if (ciclosCodex === 2) yield* Deferred.succeed(segundaRodada, undefined);
          return { status: "em-dia", versao: "0.169.0" } satisfies Motor.ResultadoAtualizacaoHarness;
        }),
      });
      const camada = AtualizadorHarnesses.layer({
        ocupado: Effect.succeed(false),
        desligados: Effect.succeed([]),
        atrasoInicial: Duration.seconds(15),
        intervalo: Duration.hours(12),
        automatico: true,
      }).pipe(Layer.provide(Motor.layer), Layer.provide(drivers), Layer.provide(NodeServices.layer));

      yield* Effect.gen(function* () {
        yield* AtualizadorHarnesses.AtualizadorHarnesses;
        // Antes dos 15 s: nenhuma conferência remota, mas a limpeza de abertura já rodou.
        yield* TestClock.adjust(Duration.seconds(10));
        assert.deepStrictEqual(registro.limpezas, ["antigravity", "codex"]);
        assert.deepStrictEqual(registro.atualizacoes, []);

        // Aos 15 s: primeira conferência automática.
        yield* TestClock.adjust(Duration.seconds(5));
        yield* Deferred.await(primeiraRodada);
        assert.deepStrictEqual(registro.atualizacoes, ["antigravity", "codex"]);

        // 12 h depois: segunda conferência automática.
        yield* TestClock.adjust(Duration.hours(12));
        yield* Deferred.await(segundaRodada);
        assert.deepStrictEqual(registro.atualizacoes, ["antigravity", "codex", "antigravity", "codex"]);
      }).pipe(Effect.provide(camada));
    }),
  );

  it.effect("um defeito num provider não derruba o outro nem o laço; chamadas concorrentes serializam", () =>
    Effect.gen(function* () {
      const registro: Registro = { atualizacoes: [], limpezas: [] };
      const entrouPrimeira = yield* Deferred.make<void>();
      const liberarPrimeira = yield* Deferred.make<void>();
      let emExecucao = 0;
      let picoConcorrencia = 0;
      const drivers = montarDrivers(registro, {
        antigravity: Effect.die(new Error("boom")),
        codex: Effect.gen(function* () {
          emExecucao += 1;
          picoConcorrencia = Math.max(picoConcorrencia, emExecucao);
          if (registro.atualizacoes.filter((p) => p === "codex").length === 1) {
            yield* Deferred.succeed(entrouPrimeira, undefined);
            yield* Deferred.await(liberarPrimeira);
          }
          emExecucao -= 1;
          return { status: "atualizado", de: "0.166.0", para: "0.169.0" } satisfies Motor.ResultadoAtualizacaoHarness;
        }),
      });
      const camada = AtualizadorHarnesses.layer({
        ocupado: Effect.succeed(false),
        desligados: Effect.succeed([]),
        automatico: false,
      }).pipe(Layer.provide(Motor.layer), Layer.provide(drivers), Layer.provide(NodeServices.layer));

      yield* Effect.gen(function* () {
        const atualizador = yield* AtualizadorHarnesses.AtualizadorHarnesses;
        const primeira = yield* atualizador.conferirAgora.pipe(Effect.forkChild);
        yield* Deferred.await(entrouPrimeira);
        const segunda = yield* atualizador.conferirAgora.pipe(Effect.forkChild);
        yield* Deferred.succeed(liberarPrimeira, undefined);
        const resultado1 = yield* Fiber.join(primeira);
        const resultado2 = yield* Fiber.join(segunda);
        assert.strictEqual(picoConcorrencia, 1);
        assert.strictEqual(resultado1.antigravity?.status, "falhou");
        assert.deepStrictEqual(resultado1.codex, { status: "atualizado", de: "0.166.0", para: "0.169.0" });
        assert.deepStrictEqual(resultado2.codex, { status: "atualizado", de: "0.166.0", para: "0.169.0" });
        assert.deepStrictEqual(registro.limpezas, ["codex", "codex"]);
      }).pipe(Effect.provide(camada));
    }),
  );

  it.effect("Servidor.layer sobe o AtualizadorHarnesses e dispara a conferência em segundo plano", () =>
    Effect.gen(function* () {
      const registro: Registro = { atualizacoes: [], limpezas: [] };
      const limpezaFeita = yield* Deferred.make<void>();
      const atualizacaoFeita = yield* Deferred.make<void>();
      const drivers = montarDrivers(
        registro,
        {
          antigravity: Effect.succeed({ status: "em-dia", versao: "1.5.14" }),
          codex: Deferred.succeed(atualizacaoFeita, undefined).pipe(
            Effect.as({ status: "em-dia", versao: "0.169.0" } satisfies Motor.ResultadoAtualizacaoHarness),
          ),
        },
        (provider) =>
          provider === "codex" ? Deferred.succeed(limpezaFeita, undefined).pipe(Effect.asVoid) : Effect.void,
      );
      const banco = bancoFixture();
      const camadaServidor = Servidor.layer({
        banco,
        token: Redacted.make("t".repeat(32)),
        atualizacaoHarnesses: {
          automatico: true,
          atrasoInicial: Duration.seconds(15),
          intervalo: Duration.hours(12),
        },
      }).pipe(Layer.provide(drivers), Layer.provide(NodeServices.layer));

      yield* Effect.gen(function* () {
        yield* Servidor.ServidorApp;
        yield* Deferred.await(limpezaFeita);
        assert.deepStrictEqual(registro.limpezas, ["antigravity", "codex"]);
        yield* TestClock.adjust(Duration.seconds(15));
        yield* Deferred.await(atualizacaoFeita);
        assert.deepStrictEqual(registro.atualizacoes, ["antigravity", "codex"]);
      }).pipe(Effect.provide(camadaServidor));
    }),
  );
});
