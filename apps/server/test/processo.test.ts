// @effect-diagnostics nodeBuiltinImport:off globalJsonInEffect:off -- teste: o servidor como processo filho (node:child_process), com o envelope JSON no stdin
/**
 * O servidor como o desktop vai usá-lo: `node apps/server/src/bin.ts` num processo filho, com os
 * drivers reais (nenhum provider é chamado: só a leitura passa pelo RPC). Confere a partida (o token
 * pelo stdin ou pelo ambiente, a linha JSON no stdout) e o encerramento (stdin fechado, SIGTERM e a
 * falta de token).
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { afterAll, assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  CAMINHO_INGRESSO,
  CAMINHO_RPC,
  codigoDoErro,
  LinhaPartida,
  PARAMETRO_INGRESSO,
  VARIAVEL_TOKEN,
} from "@simplifica-if/contratos-app";
import {
  bancoFixture,
  cliente,
  diretorioTemporario,
  limparTemporarios,
  pedirHttp,
  pedirUpgrade,
  TOKEN,
} from "./apoio.ts";

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
const subir = (opcoes: {
  readonly stdin: "pipe" | "ignore";
  readonly env?: Record<string, string>;
  readonly argumentos?: ReadonlyArray<string>;
}) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      NodeChildProcess.spawn(
        process.execPath,
        [
          BIN,
          "--banco",
          banco,
          "--pasta-estado",
          diretorioTemporario("simplifica-servidor-estado-"),
          ...(opcoes.argumentos ?? []),
        ],
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

interface PedidoLido {
  readonly resourceSpans: ReadonlyArray<{
    readonly scopeSpans: ReadonlyArray<{
      readonly spans: ReadonlyArray<{
        readonly name: string;
        readonly kind: number;
        readonly traceId: string;
        readonly status: { readonly code: number };
        readonly attributes: unknown;
      }>;
    }>;
  }>;
  readonly resourceLogs: ReadonlyArray<{
    readonly scopeLogs: ReadonlyArray<{
      readonly logRecords: ReadonlyArray<{ readonly traceId?: string; readonly body: unknown }>;
    }>;
  }>;
}

/** As linhas OTLP/JSON de um arquivo da pasta de logs. */
const linhasJson = (arquivo: string): Array<PedidoLido> =>
  NodeFS.readFileSync(arquivo, "utf8")
    .split("\n")
    .filter((linha) => linha !== "")
    .map((linha) => JSON.parse(linha) as PedidoLido);

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

  it.live(
    "--pasta-logs: o span do handler que falhou vai a traces.jsonl com o traceId da interface; nada grava a URL do /rpc nem o ingresso",
    () =>
      Effect.gen(function* () {
        const pastaLogs = diretorioTemporario("simplifica-servidor-logs-");
        const filho = yield* subir({ stdin: "pipe", argumentos: ["--pasta-logs", pastaLogs, "--traces", "completo"] });
        const erro = stderrDe(filho);
        filho.stdin?.write(`${JSON.stringify({ token: TOKEN })}\n`);
        const linha = yield* decodificarLinha(yield* primeiraLinha(filho));
        // Por ingresso, como a interface.
        const resposta = yield* pedirHttp(`http://127.0.0.1:${linha.porta}${CAMINHO_INGRESSO}`, {
          metodo: "POST",
          cabecalhos: { authorization: `Bearer ${TOKEN}` },
        });
        assert.strictEqual(resposta.status, 200);
        const { ingresso } = JSON.parse(resposta.corpo) as { readonly ingresso: string };
        const c = yield* cliente(`${linha.rpc}?${PARAMETRO_INGRESSO}=${encodeURIComponent(ingresso)}`);
        assert.isDefined(yield* c.sobreABase({}));
        // Sem o aviso de uso aceito, `conversa.iniciar` falha com `AvisoNaoAceito`.
        const traceId = yield* Effect.flatMap(Effect.orDie(Effect.currentSpan), (span) =>
          Effect.as(Effect.flip(c["conversa.iniciar"]({ provider: "claude", pastaTrabalho: "/" })), span.traceId),
        ).pipe(Effect.withSpan("teste"));
        const codigo = codigoDoErro(traceId);

        // O encerramento descarrega o que o exportador ainda não gravou.
        filho.stdin?.end();
        assert.strictEqual(yield* saida(filho), 0);

        const textoTraces = NodeFS.readFileSync(NodePath.join(pastaLogs, "traces.jsonl"), "utf8");
        const textoLogs = NodeFS.readFileSync(NodePath.join(pastaLogs, "logs-otlp.jsonl"), "utf8");
        const spans = linhasJson(NodePath.join(pastaLogs, "traces.jsonl")).flatMap((pedido) =>
          pedido.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans)),
        );
        const handler = spans.find((s) => s.name === "conversa.iniciar" && s.kind === 2);
        assert.isDefined(handler);
        assert.strictEqual(handler.traceId, traceId.padStart(32, "0"));
        assert.strictEqual(codigoDoErro(handler.traceId), codigo);
        assert.strictEqual(handler.status.code, 2);
        // Nem o pedido nem o token vão aos atributos.
        assert.notInclude(JSON.stringify(handler.attributes), "pastaTrabalho");

        // A chamada por ingresso foi gravada (o span do handler), e o `POST /ingresso` tem o span HTTP dele;
        // o `/rpc` não tem span HTTP, e nem o ingresso nem o token vão a arquivo.
        assert.isTrue(spans.some((s) => s.name === "sobreABase" && s.kind === 2));
        const urls = spans.flatMap((s) =>
          (s.attributes as ReadonlyArray<{ readonly key: string; readonly value: unknown }>)
            .filter((a) => a.key.startsWith("url."))
            .map((a) => JSON.stringify(a.value)),
        );
        assert.isTrue(urls.some((u) => u.includes(CAMINHO_INGRESSO)));
        assert.isFalse(urls.some((u) => u.includes(CAMINHO_RPC)));
        for (const texto of [textoTraces, textoLogs]) {
          assert.notInclude(texto, ingresso);
          assert.notInclude(texto, encodeURIComponent(ingresso));
          assert.notInclude(texto, TOKEN);
        }

        const logs = linhasJson(NodePath.join(pastaLogs, "logs-otlp.jsonl")).flatMap((pedido) =>
          pedido.resourceLogs.flatMap((r) => r.scopeLogs.flatMap((s) => s.logRecords)),
        );
        const falha = logs.find((l) => JSON.stringify(l.body).includes("RPC conversa.iniciar falhou"));
        assert.isDefined(falha);
        assert.strictEqual(falha.traceId, handler.traceId);
        // O stderr (logfmt, uma linha por registro) traz o mesmo código.
        const linhaStderr = erro()
          .split("\n")
          .find((l) => l.includes("RPC conversa.iniciar falhou"));
        assert.isDefined(linhaStderr);
        assert.include(linhaStderr, `codigo=${codigo}`);
        assert.match(linhaStderr, /^timestamp=\S+ level=WARN /u);
      }).pipe(Effect.scoped),
  );

  it.live("caixa-preta: grava o trace da chamada que falhou e nada da que passou rápido", () =>
    Effect.gen(function* () {
      const pastaLogs = diretorioTemporario("simplifica-servidor-logs-");
      const filho = yield* subir({
        stdin: "pipe",
        argumentos: ["--pasta-logs", pastaLogs, "--traces", "caixa-preta"],
      });
      filho.stdin?.write(`${JSON.stringify({ token: TOKEN })}\n`);
      const linha = yield* decodificarLinha(yield* primeiraLinha(filho));
      const c = yield* cliente(linha.rpc, { authorization: `Bearer ${TOKEN}` });
      assert.isDefined(yield* c.sobreABase({}));
      // Sem o aviso de uso aceito, `conversa.iniciar` falha com `AvisoNaoAceito`.
      yield* Effect.flip(c["conversa.iniciar"]({ provider: "claude", pastaTrabalho: "/" }));

      filho.stdin?.end();
      assert.strictEqual(yield* saida(filho), 0);

      const nomes = linhasJson(NodePath.join(pastaLogs, "traces.jsonl")).flatMap((pedido) =>
        pedido.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans.map((span) => span.name))),
      );
      assert.include(nomes, "conversa.iniciar");
      assert.notInclude(nomes, "sobreABase");
    }).pipe(Effect.scoped),
  );

  it.live("sem token, não sobe: a falha fatal vai ao logs-otlp.jsonl e, uma vez, ao stderr", () =>
    Effect.gen(function* () {
      const pastaLogs = diretorioTemporario("simplifica-servidor-logs-");
      const filho = yield* subir({ stdin: "ignore", argumentos: ["--pasta-logs", pastaLogs] });
      const erro = stderrDe(filho);
      assert.strictEqual(yield* saida(filho), 1);
      assert.lengthOf(
        erro()
          .split("\n")
          .filter((l) => l.includes("sem token")),
        1,
      );
      const logs = linhasJson(NodePath.join(pastaLogs, "logs-otlp.jsonl")).flatMap((pedido) =>
        pedido.resourceLogs.flatMap((r) => r.scopeLogs.flatMap((s) => s.logRecords)),
      );
      // A causa vai nos atributos `exception.*` do registro.
      assert.isTrue(logs.some((l) => JSON.stringify(l).includes("sem token")));
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
});
