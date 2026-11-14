// @effect-diagnostics nodeBuiltinImport:off globalJsonInEffect:off -- teste: o servidor como processo filho (node:child_process), com o envelope JSON no stdin
/**
 * O servidor como o desktop vai usá-lo: `node apps/server/src/bin.ts` num processo filho, com os
 * drivers reais (nenhum provider é chamado: só a leitura passa pelo RPC). Confere a partida (o token
 * pelo stdin ou pelo ambiente, a linha JSON no stdout) e o encerramento (stdin fechado, SIGTERM e a
 * falta de token).
 */
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import { afterAll, assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { LinhaPartida, VARIAVEL_TOKEN } from "@simplifica-if/contratos-app";
import { bancoFixture, cliente, diretorioTemporario, limparTemporarios, pedirUpgrade, TOKEN } from "./apoio.ts";

afterAll(limparTemporarios);

const BIN = NodePath.resolve(import.meta.dirname, "../src/bin.ts");
const banco = bancoFixture();
const decodificarLinha = Schema.decodeUnknownEffect(Schema.fromJsonString(LinhaPartida));

/** O ambiente do filho: o do teste, sem token herdado. */
const ambiente = (extra: Record<string, string> = {}) => {
  const copia: Record<string, string | undefined> = { ...process.env, ...extra };
  if (extra[VARIAVEL_TOKEN] === undefined) delete copia[VARIAVEL_TOKEN];
  return copia;
};

/** Sobe o servidor num processo filho, morto no fim do escopo se ainda estiver vivo. */
const subir = (opcoes: { readonly stdin: "pipe" | "ignore"; readonly env?: Record<string, string> }) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      NodeChildProcess.spawn(
        process.execPath,
        [BIN, "--banco", banco, "--pasta-estado", diretorioTemporario("simplifica-servidor-estado-")],
        { stdio: [opcoes.stdin, "pipe", "pipe"], env: ambiente(opcoes.env) },
      ),
    ),
    (filho) => Effect.sync(() => filho.exitCode === null && filho.kill("SIGKILL")),
  );

/** A primeira linha do stdout do filho. */
const primeiraLinha = (filho: NodeChildProcess.ChildProcess) =>
  Effect.callback<string>((resume) => {
    let acumulado = "";
    const aoDado = (pedaco: Buffer) => {
      acumulado += pedaco.toString("utf8");
      const fim = acumulado.indexOf("\n");
      if (fim >= 0) resume(Effect.succeed(acumulado.slice(0, fim)));
    };
    filho.stdout?.on("data", aoDado);
    filho.once("exit", (codigo) => resume(Effect.die(new Error(`o servidor saiu antes de ficar pronto (${codigo})`))));
    return Effect.sync(() => filho.stdout?.off("data", aoDado));
  });

/** O código de saída do filho (ou o sinal), depois de fechados o stdout e o stderr. */
const saida = (filho: NodeChildProcess.ChildProcess) =>
  Effect.callback<number | string>((resume) => {
    filho.once("close", (codigo, sinal) => resume(Effect.succeed(codigo ?? sinal ?? -1)));
  });

/** O stderr do filho, acumulado. */
const stderrDe = (filho: NodeChildProcess.ChildProcess) => {
  const partes: Array<string> = [];
  filho.stderr?.on("data", (pedaco: Buffer) => partes.push(pedaco.toString("utf8")));
  return () => partes.join("");
};

describe("servidor como processo", () => {
  it.live("token pelo stdin: imprime a linha de partida, atende o RPC e sai quando o stdin fecha", () =>
    Effect.gen(function* () {
      const filho = yield* subir({ stdin: "pipe" });
      filho.stdin?.write(`${JSON.stringify({ token: TOKEN, origens: ["app://simplifica"] })}\n`);
      const linha = yield* decodificarLinha(yield* primeiraLinha(filho));
      assert.strictEqual(linha.servidor, "simplifica-if");
      assert.strictEqual(linha.pid, filho.pid);
      assert.strictEqual(linha.rpc, `ws://127.0.0.1:${linha.porta}/rpc`);
      assert.match(linha.mcp, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);

      assert.strictEqual(yield* pedirUpgrade(linha.rpc, {}), 401);
      assert.strictEqual(
        yield* pedirUpgrade(linha.rpc, { origin: "app://simplifica", authorization: `Bearer ${TOKEN}` }),
        101,
      );
      const c = yield* cliente(linha.rpc, { authorization: `Bearer ${TOKEN}` });
      assert.isDefined(yield* c.sobreABase({}));

      // Com o cliente ainda conectado, o stdin fechado encerra o servidor.
      filho.stdin?.end();
      assert.strictEqual(yield* saida(filho), 0);
    }).pipe(Effect.scoped),
  );

  it.live("token pelo ambiente: SIGTERM encerra o servidor", () =>
    Effect.gen(function* () {
      const filho = yield* subir({ stdin: "ignore", env: { [VARIAVEL_TOKEN]: TOKEN } });
      const linha = yield* decodificarLinha(yield* primeiraLinha(filho));
      assert.strictEqual(yield* pedirUpgrade(linha.rpc, { authorization: `Bearer ${TOKEN}` }), 101);
      filho.kill("SIGTERM");
      const codigo = yield* saida(filho);
      assert.notStrictEqual(codigo, "SIGKILL");
    }).pipe(Effect.scoped),
  );

  it.live("sem token, ou com token curto, não sobe", () =>
    Effect.gen(function* () {
      const semToken = yield* subir({ stdin: "ignore" });
      const erroSemToken = stderrDe(semToken);
      assert.strictEqual(yield* saida(semToken), 1);
      assert.include(erroSemToken(), "sem token");

      const curto = yield* subir({ stdin: "pipe" });
      const erroCurto = stderrDe(curto);
      curto.stdin?.write(`${JSON.stringify({ token: "curto" })}\n`);
      assert.strictEqual(yield* saida(curto), 1);
      assert.include(erroCurto(), "não é um envelope válido");
      assert.notInclude(erroCurto(), '"curto"');
    }).pipe(Effect.scoped),
  );
});
