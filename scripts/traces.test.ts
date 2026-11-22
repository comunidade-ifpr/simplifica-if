import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ARQUIVO_LOGS, ARQUIVO_TRACES, executar } from "./traces.ts";

const TRACE_ERRO = "abcd1234".padEnd(32, "0");
const TRACE_OK = "ffff0000".padEnd(32, "1");
const TRACE_SO_LOGS = "dead0000".padEnd(32, "2");
const S = 1_700_000_000_000_000_000n;
const ns = (ms: number) => String(S + BigInt(ms) * 1_000_000n);

const texto = (valor: string) => ({ stringValue: valor });

const spanOtlp = (campos: {
  traceId: string;
  spanId: string;
  pai?: string;
  nome: string;
  kind?: number;
  de: number;
  ate: number;
  erro?: string;
  tipoErro?: string;
  atributos?: Array<{ key: string; value: { stringValue: string } }>;
}) => ({
  traceId: campos.traceId,
  spanId: campos.spanId,
  ...(campos.pai === undefined ? {} : { parentSpanId: campos.pai }),
  name: campos.nome,
  kind: campos.kind ?? 1,
  startTimeUnixNano: ns(campos.de),
  endTimeUnixNano: ns(campos.ate),
  attributes: [{ key: "rpc.method", value: texto(campos.nome) }, ...(campos.atributos ?? [])],
  events:
    campos.erro === undefined
      ? []
      : [
          {
            name: "exception",
            attributes: [
              ...(campos.tipoErro === undefined ? [] : [{ key: "exception.type", value: texto(campos.tipoErro) }]),
              { key: "exception.message", value: texto(campos.erro) },
              { key: "exception.stacktrace", value: texto(`AvisoNaoAceito: ${campos.erro}\n    at handler`) },
            ],
          },
        ],
  status: campos.erro === undefined ? { code: 0 } : { code: 2, message: campos.erro },
});

const pedidoTraces = (...spans: Array<ReturnType<typeof spanOtlp>>) =>
  JSON.stringify({ resourceSpans: [{ resource: {}, scopeSpans: [{ scope: { name: "effect" }, spans }] }] });

const pedidoLogs = (...logRecords: Array<unknown>) =>
  JSON.stringify({ resourceLogs: [{ resource: {}, scopeLogs: [{ scope: { name: "effect" }, logRecords }] }] });

/** Uma pasta de logs: o trace com erro no `.1` (girado), o trace ok no atual, e um log do trace com erro. */
const pastaDeFixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const pasta = yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-traces-script-" });
  yield* fs.writeFileString(
    path.join(pasta, `${ARQUIVO_TRACES}.1`),
    `${pedidoTraces(
      spanOtlp({
        traceId: TRACE_ERRO,
        spanId: "s2",
        pai: "s1",
        nome: "Conversas.iniciar",
        de: 2,
        ate: 5,
        erro: "aviso de uso não aceito",
        tipoErro: "AvisoNaoAceito",
      }),
    )}\n${pedidoTraces(
      spanOtlp({ traceId: TRACE_ERRO, spanId: "s1", pai: "cliente", nome: "conversa.iniciar", kind: 2, de: 1, ate: 6 }),
      spanOtlp({
        traceId: TRACE_ERRO,
        spanId: "s3",
        pai: "s1",
        nome: "sql.execute",
        de: 2,
        ate: 3,
        atributos: [{ key: "db.query.text", value: texto(`SELECT ${"coluna, ".repeat(30)}\n  fim FROM tabela`) }],
      }),
    )}\n`,
  );
  yield* fs.writeFileString(
    path.join(pasta, ARQUIVO_TRACES),
    `${pedidoTraces(spanOtlp({ traceId: TRACE_OK, spanId: "o1", nome: "leitura.sobreABase", kind: 2, de: 10, ate: 3010 }))}\nlinha quebrada\n`,
  );
  yield* fs.writeFileString(
    path.join(pasta, ARQUIVO_LOGS),
    `${pedidoLogs({
      traceId: TRACE_ERRO,
      spanId: "s1",
      timeUnixNano: ns(5),
      severityText: "Warn",
      body: { arrayValue: { values: [texto("RPC conversa.iniciar falhou")] } },
      attributes: [{ key: "codigo", value: texto("ABCD1234") }],
    })}\n${pedidoLogs(
      { timeUnixNano: ns(0), severityText: "Info", body: texto("servidor pronto") },
      {
        traceId: "0000000000000000000000000000noop",
        timeUnixNano: ns(20),
        severityText: "Warn",
        body: texto("traces: não foi possível gravar traces.jsonl"),
      },
      { traceId: TRACE_SO_LOGS, timeUnixNano: ns(30), severityText: "Warn", body: texto("descartado, mas avisou") },
    )}\n`,
  );
  return pasta;
});

describe("traces", () => {
  it.effect("--codigo: a árvore do trace, com o erro e os logs, juntando o arquivo girado", () =>
    Effect.gen(function* () {
      const pasta = yield* pastaDeFixture;
      const saida = yield* executar({
        pasta,
        arquivo: undefined,
        consulta: { codigo: "abcd1234", ultimos: 20 },
        json: false,
      });
      const linhas = saida.split("\n");
      assert.match(linhas[0] ?? "", /^trace abcd1234\S+ \(código ABCD1234\) .* 5\.0 ms erro$/u);
      assert.strictEqual(linhas[1], "  conversa.iniciar [servidor] 5.0 ms ok");
      assert.strictEqual(linhas[2], "    Conversas.iniciar [interno] 3.0 ms ERRO  exception.type=AvisoNaoAceito");
      assert.strictEqual(linhas[3], "      | AvisoNaoAceito: aviso de uso não aceito");
      // A consulta SQL vai na linha, numa linha só e cortada.
      const sql = linhas.find((l) => l.startsWith("    sql.execute")) ?? "";
      assert.match(sql, /^ {4}sql\.execute \[interno\] 1\.0 ms ok {2}db\.query\.text=SELECT coluna, coluna, /u);
      assert.isTrue(sql.endsWith("…"));
      assert.notInclude(sql, "fim FROM");
      // O traces.jsonl atual tem uma linha quebrada: a saída avisa.
      assert.isTrue(saida.endsWith("\n\n1 linha ilegível ignorada"));
      assert.include(saida, "  logs:\n");
      assert.match(saida, /WARN RPC conversa\.iniciar falhou$/mu);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("--erros e --lentos filtram; --json devolve a forma achatada", () =>
    Effect.gen(function* () {
      const pasta = yield* pastaDeFixture;
      const erros = yield* executar({ pasta, arquivo: undefined, consulta: { erros: true, ultimos: 20 }, json: false });
      assert.match(erros, /^ABCD1234 .* erro +conversa\.iniciar {2}— AvisoNaoAceito: aviso de uso não aceito$/mu);
      // O trace só de logs não entra nas listas.
      assert.notInclude(erros, "DEAD0000");
      const lentos = yield* executar({
        pasta,
        arquivo: undefined,
        consulta: { lentosMs: 1000, ultimos: 20 },
        json: false,
      });
      assert.match(lentos, /^FFFF0000 .*3\.00 s/mu);
      assert.notInclude(lentos, "ABCD1234");

      const json = JSON.parse(
        yield* executar({ pasta, arquivo: undefined, consulta: { codigo: "ABCD1234", ultimos: 20 }, json: true }),
      ) as Array<{
        codigo: string;
        status: string;
        spans: Array<{ nome: string; paiId: string | null; atributos: unknown }>;
        logs: Array<{ nivel: string }>;
      }>;
      assert.strictEqual(json.length, 1);
      assert.strictEqual(json[0]?.codigo, "ABCD1234");
      assert.strictEqual(json[0]?.status, "erro");
      assert.deepStrictEqual(
        json[0]?.spans.map((s) => [s.nome, s.paiId]),
        [
          ["conversa.iniciar", "cliente"],
          ["Conversas.iniciar", "s1"],
          ["sql.execute", "s1"],
        ],
      );
      assert.deepStrictEqual(json[0]?.spans[0]?.atributos, { "rpc.method": "conversa.iniciar" });
      assert.strictEqual(json[0]?.logs[0]?.nivel, "WARN");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("--logs: os logs sem trace gravado; --codigo de um trace só de logs mostra os logs", () =>
    Effect.gen(function* () {
      const pasta = yield* pastaDeFixture;
      const soltos = yield* executar({
        pasta,
        arquivo: undefined,
        consulta: { logs: true, ultimos: 20 },
        json: false,
      });
      const linhas = soltos.split("\n");
      // Os mais recentes primeiro; o "noop" do exportador conta como sem trace; o do trace com spans fica fora.
      assert.match(linhas[0] ?? "", /WARN +DEAD0000 {2}descartado, mas avisou$/u);
      assert.match(linhas[1] ?? "", /WARN +traces: não foi possível gravar traces\.jsonl$/u);
      assert.match(linhas[2] ?? "", /INFO +servidor pronto$/u);
      assert.notInclude(soltos, "RPC conversa.iniciar falhou");

      const soDeLogs = yield* executar({
        pasta,
        arquivo: undefined,
        consulta: { codigo: "DEAD0000", ultimos: 20 },
        json: false,
      });
      assert.match(soDeLogs, /^trace dead0000\S+ \(código DEAD0000\) /u);
      assert.include(soDeLogs, "(nenhum span gravado: só os logs)");
      assert.match(soDeLogs, /WARN descartado, mas avisou$/mu);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("sem arquivo, diz onde procurou", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const pasta = yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-traces-script-" });
      const saida = yield* executar({ pasta, arquivo: undefined, consulta: { ultimos: 20 }, json: false });
      assert.match(saida, /^nenhum trace em .*traces\.jsonl\.1 nem .*traces\.jsonl$/u);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
