/**
 * O registro dos handlers (`traduzir`, `traduzirStream`): o defeito vai ao log como erro, com o código do
 * pedido (`codigoDoErro`, do span do handler), e a interrupção não vai. Como o `RpcServer` roda o handler:
 * dentro do span dele, o stream consumido por `Stream.runForEachArray`.
 */
import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as PlatformError from "effect/PlatformError";
import * as Logger from "effect/Logger";
import * as References from "effect/References";
import * as Stream from "effect/Stream";
import { codigoDoErro, FalhaDiagnostico, FalhaPasta } from "@simplifica-if/contratos-app";
import * as Motor from "@simplifica-if/motor";
import { traduzir, traduzirStream } from "../src/handlers.ts";

interface Registro {
  readonly mensagem: unknown;
  readonly nivel: string;
  readonly codigo: unknown;
  /** A causa como o logger a escreve (`Cause.pretty`, com o `cause` de cada erro). */
  readonly causa: string;
}

/** Roda `efeito` no span de um handler, com um logger que captura; devolve o código e os registros. */
const noHandler = <A, E>(efeito: Effect.Effect<A, E>) => {
  const registros: Array<Registro> = [];
  const capturar = Logger.make((opcoes) => {
    registros.push({
      mensagem: opcoes.message,
      nivel: opcoes.logLevel,
      codigo: opcoes.fiber.getRef(References.CurrentLogAnnotations).codigo,
      causa: Cause.pretty(opcoes.cause),
    });
  });
  return Effect.flatMap(Effect.orDie(Effect.currentSpan), (span) =>
    Effect.as(Effect.exit(efeito), codigoDoErro(span.traceId)),
  ).pipe(
    Effect.withSpan("RpcServer.teste", { kind: "server" }),
    Effect.provide(Logger.layer([capturar])),
    Effect.map((codigo) => ({ codigo, registros })),
  );
};

const primeira = (mensagem: unknown) => (Array.isArray(mensagem) ? mensagem[0] : mensagem);

describe("traduzir", () => {
  it.effect("o defeito vai ao log como erro, com o código", () =>
    Effect.gen(function* () {
      const { codigo, registros } = yield* noHandler(traduzir("teste.efeito", Effect.die(new Error("boom"))));
      assert.strictEqual(registros.length, 1);
      assert.strictEqual(primeira(registros[0]!.mensagem), "RPC teste.efeito: defeito");
      assert.strictEqual(registros[0]!.nivel, "Error");
      assert.strictEqual(registros[0]!.codigo, codigo);
    }),
  );

  it.effect("o erro tipado vai ao log com o resumo do cause: sem a pasta da tarefa, o anexo nem o pedido", () =>
    Effect.gen(function* () {
      const pastaTarefa = "/Users/fulana/Documents/Simplifica IF/Parecer sobre o PAD do servidor João";
      const plataforma = PlatformError.systemError({
        _tag: "NotFound",
        module: "FileSystem",
        method: "copyFile",
        syscall: "copyfile",
        pathOrDescriptor: `${pastaTarefa}/anexo sigiloso.pdf`,
        description: `ENOENT: no such file or directory, copyfile '${pastaTarefa}/anexo sigiloso.pdf'`,
      });
      const falhas = [
        new FalhaPasta({ motivo: "Não foi possível copiar o arquivo para a pasta da tarefa.", cause: plataforma }),
        new FalhaDiagnostico({ motivo: "Não foi possível gravar o diagnóstico.", cause: plataforma }),
        new Motor.FalhaProvider({
          provider: "claude",
          operacao: "enviar",
          tipo: "desconhecido",
          cause: new Error(`cwd '${pastaTarefa}' inválido ao responder ao pedido`),
        }),
      ];
      for (const falha of falhas) {
        const { registros } = yield* noHandler(traduzir("teste.efeito", Effect.fail(falha)));
        assert.strictEqual(registros.length, 1);
        assert.strictEqual(registros[0]!.nivel, "Warn");
        const causa = registros[0]!.causa;
        assert.include(causa, falha._tag);
        assert.notInclude(causa, "Parecer sobre o PAD", causa);
        assert.notInclude(causa, "anexo sigiloso", causa);
      }
      const { registros } = yield* noHandler(traduzir("teste.efeito", Effect.fail(falhas[0]!)));
      assert.include(registros[0]!.causa, "PlatformError NotFound em FileSystem.copyFile (copyfile)");
    }),
  );

  it.effect("a interrupção não vai ao log", () =>
    Effect.gen(function* () {
      const { registros } = yield* noHandler(traduzir("teste.efeito", Effect.interrupt));
      assert.strictEqual(registros.length, 0);
    }),
  );
});

describe("traduzirStream", () => {
  it.effect("o stream que termina num defeito vai ao log como erro, com o código do handler", () =>
    Effect.gen(function* () {
      const stream = Stream.concat(Stream.make(1, 2), Stream.die(new Error("boom")));
      const { codigo, registros } = yield* noHandler(
        Stream.runForEachArray(traduzirStream("teste.stream", stream), () => Effect.void),
      );
      assert.strictEqual(registros.length, 1);
      assert.strictEqual(primeira(registros[0]!.mensagem), "RPC teste.stream: defeito");
      assert.strictEqual(registros[0]!.nivel, "Error");
      assert.strictEqual(registros[0]!.codigo, codigo);
    }),
  );

  it.effect("o stream interrompido não vai ao log", () =>
    Effect.gen(function* () {
      const stream = Stream.concat(Stream.make(1), Stream.fromEffect(Effect.interrupt));
      const { registros } = yield* noHandler(
        Stream.runForEachArray(traduzirStream("teste.stream", stream), () => Effect.void),
      );
      assert.strictEqual(registros.length, 0);
    }),
  );
});
