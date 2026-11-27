/**
 * O vigia da conferência ao salvar (`vigia.ts`), com o `TestClock` e um `FileSystem.watch` falso: a
 * verificação ao começar, os temporários do Word ignorados, a espera sem novas mudanças, os salvamentos
 * do meio juntados num só, o intervalo mínimo depois de uma conferência, a pasta que não pode ser vigiada
 * (com o log sem o caminho) e o `watch` fechado ao parar o vigia.
 *
 * Sem "deixar rodar": o `watch` falso avisa cada vez que o vigia pede o próximo evento (o anterior já foi
 * visto), e cada verificação avisa numa fila. A verificação esperada é tirada da fila; a que não deve
 * acontecer é a fila vazia depois de `TestClock.adjust`, já que só o relógio a dispara.
 */
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ehTemporario, ESPERA, INTERVALO_MINIMO, vigiar } from "../../../src/modulos/revisao-ppc/vigia.ts";

const ARQUIVO = "/docs/PPC - revisão prévia (Simplifica IF) 2026-11-27 10h00.docx";
const NOME = "PPC - revisão prévia (Simplifica IF) 2026-11-27 10h00.docx";

/**
 * O vigia sobre uma pasta falsa. `mudar` emite um evento do `watch` e volta quando o vigia já o viu;
 * `verificou` espera a próxima verificação começar; `nenhuma` confere que nenhuma começou. `verificar`
 * responde com `estado.conferiu` (e espera `estado.portao`, se houver).
 */
const montar = Effect.fn(function* (
  opcoes: { readonly falharWatch?: boolean; readonly conferiu?: boolean; readonly logs?: Array<string> } = {},
) {
  const eventos = yield* Queue.unbounded<FileSystem.WatchEvent>();
  const puxadas = yield* Queue.unbounded<void>();
  const fechou = yield* Deferred.make<void>();
  const pastas: Array<string> = [];
  const fs = FileSystem.layerNoop({
    watch: (pasta) => {
      pastas.push(pasta);
      return opcoes.falharWatch
        ? Stream.fail(
            PlatformError.systemError({
              module: "FileSystem",
              _tag: "Unknown",
              method: "watch",
              pathOrDescriptor: pasta,
            }),
          )
        : Stream.fromEffectRepeat(Queue.offer(puxadas, undefined).pipe(Effect.andThen(Queue.take(eventos)))).pipe(
            Stream.ensuring(Deferred.succeed(fechou, undefined)),
          );
    },
  });
  const logs = opcoes.logs;
  const registrar = Logger.make((o) => {
    logs?.push(String(o.message));
  });
  const verificacoes = yield* Queue.unbounded<void>();
  const estado = { conferiu: opcoes.conferiu ?? true, portao: undefined as Deferred.Deferred<void> | undefined };
  const verificar = Effect.gen(function* () {
    const conferiu = estado.conferiu;
    const portao = estado.portao;
    yield* Queue.offer(verificacoes, undefined);
    if (portao !== undefined) yield* Deferred.await(portao);
    return conferiu;
  });
  const fibra = yield* vigiar(ARQUIVO, verificar).pipe(
    Effect.provide(Layer.mergeAll(fs, Path.layer, Logger.layer([registrar]))),
    Effect.forkChild,
  );
  // O vigia assinou a pasta e espera o primeiro evento.
  if (!opcoes.falharWatch) yield* Queue.take(puxadas);
  const mudar = (nome: string, tag: FileSystem.WatchEvent["_tag"] = "Update") =>
    Queue.offer(eventos, { _tag: tag, path: nome }).pipe(Effect.andThen(Queue.take(puxadas)));
  const verificou = Queue.take(verificacoes);
  const nenhuma = Effect.map(Queue.size(verificacoes), (n) => assert.strictEqual(n, 0, "nenhuma verificação"));
  return { estado, fibra, mudar, pastas, verificou, nenhuma, fechou };
});

describe("o vigia do arquivo acompanhado", () => {
  it("os temporários do Word e dos editores", () => {
    for (const nome of [
      `~$${NOME}`,
      "~WRL0001.tmp",
      "~WRD0003.tmp",
      "~WRF1234.TMP",
      ".DS_Store",
      `.${NOME}.0f1e.tmp`,
      `.~lock.${NOME}#`,
      "Word Work File L_1234.tmp",
      "Backup of PPC.wbk",
      "",
    ])
      assert.isTrue(ehTemporario(nome), nome);
    for (const nome of [NOME, "PPC.docx", "PPC (2).docx"]) assert.isFalse(ehTemporario(nome), nome);
  });

  it.effect("vigia a pasta e verifica ao começar; ignora os temporários; espera a rajada acabar", () =>
    Effect.gen(function* () {
      const { mudar, pastas, fibra, verificou, nenhuma } = yield* montar({ conferiu: false });
      // Ao abrir, a verificação compara o sha256 (o arquivo pode ter mudado com o fluxo fechado).
      yield* verificou;
      assert.deepStrictEqual(pastas, ["/docs"]);

      // O Word cria o dono e os temporários do salvamento: nada a verificar.
      yield* mudar(`~$${NOME}`, "Create");
      yield* mudar("~WRD0001.tmp", "Create");
      yield* mudar("~WRL0001.tmp", "Remove");
      yield* TestClock.adjust(Duration.seconds(10));
      yield* nenhuma;

      // A troca por renomeação: o arquivo some e volta. Só depois de `ESPERA` sem mudanças, uma vez.
      yield* mudar(NOME, "Remove");
      yield* TestClock.adjust(Duration.seconds(1));
      yield* mudar(NOME, "Create");
      yield* TestClock.adjust(Duration.millis(Duration.toMillis(ESPERA) - 100));
      yield* nenhuma;
      yield* TestClock.adjust(Duration.millis(200));
      yield* verificou;
      yield* TestClock.adjust(Duration.minutes(1));
      yield* nenhuma;
      yield* Fiber.interrupt(fibra);
    }),
  );

  it.effect("uma verificação por vez; os salvamentos do meio viram um; depois de conferir, espera 15 s", () =>
    Effect.gen(function* () {
      const { estado, mudar, fibra, verificou, nenhuma } = yield* montar();
      yield* verificou;
      yield* TestClock.adjust(INTERVALO_MINIMO);

      // Uma conferência longa; três salvamentos chegam no meio dela.
      const portao = yield* Deferred.make<void>();
      estado.portao = portao;
      yield* mudar(NOME);
      yield* TestClock.adjust(ESPERA);
      yield* verificou;
      estado.portao = undefined;
      for (let i = 0; i < 3; i++) {
        yield* mudar(NOME);
        yield* TestClock.adjust(ESPERA);
      }
      yield* nenhuma;
      yield* Deferred.succeed(portao, undefined);
      // A conferência começou há 6 s (três esperas): a próxima espera os 15 s dela, e é uma só.
      yield* TestClock.adjust(Duration.seconds(8));
      yield* nenhuma;
      yield* TestClock.adjust(Duration.seconds(1));
      yield* verificou;
      yield* TestClock.adjust(Duration.minutes(1));
      yield* nenhuma;

      // A verificação que não conferiu (o sha256 não mudou) não segura a próxima.
      estado.conferiu = false;
      yield* TestClock.adjust(INTERVALO_MINIMO);
      yield* mudar(NOME);
      yield* TestClock.adjust(ESPERA);
      yield* verificou;
      yield* mudar(NOME);
      yield* TestClock.adjust(ESPERA);
      yield* verificou;
      yield* Fiber.interrupt(fibra);
    }),
  );

  it.effect("parar o vigia fecha o `watch` da pasta", () =>
    Effect.gen(function* () {
      const { fibra, verificou, fechou } = yield* montar();
      yield* verificou;
      assert.isFalse(yield* Deferred.isDone(fechou));
      yield* Fiber.interrupt(fibra);
      assert.isTrue(yield* Deferred.isDone(fechou));
    }),
  );

  it.effect(
    "a pasta que não pode ser vigiada (rede, OneDrive): o vigia verifica ao começar e segue de pé; o log não traz o caminho",
    () =>
      Effect.gen(function* () {
        const logs: Array<string> = [];
        const { fibra, verificou, nenhuma } = yield* montar({ falharWatch: true, logs });
        yield* verificou;
        yield* TestClock.adjust(Duration.minutes(1));
        yield* nenhuma;
        assert.isUndefined(fibra.pollUnsafe());
        const aviso = logs.find((l) => l.includes("não pode ser vigiada"));
        assert.isDefined(aviso);
        assert.notInclude(aviso!, "/docs");
        yield* Fiber.interrupt(fibra);
      }),
  );
});
