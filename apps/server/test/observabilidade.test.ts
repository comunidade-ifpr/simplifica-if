// @effect-diagnostics globalJsonInEffect:off -- teste: lê as linhas OTLP/JSON gravadas
/**
 * A exportação dos spans e logs para arquivo (`observabilidade/`): o OTLP/JSON gravado pelo `OtlpTracer`
 * e pelo `OtlpLogger` através do `HttpClient` de arquivo, o giro, a falha de escrita que não derruba nada
 * e a caixa-preta (que traces se gravam e os limites da memória).
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as ArquivoOtlp from "../src/observabilidade/ArquivoOtlp.ts";
import { ARQUIVO_LOGS, ARQUIVO_TRACES } from "../src/observabilidade/ArquivoOtlp.ts";
import {
  CaixaPreta,
  LIMITES,
  RESUMO_SPAN_MS,
  type LogOtlp,
  type PedidoLogs,
  type PedidoTraces,
  type SpanOtlp,
} from "../src/observabilidade/CaixaPreta.ts";
import * as Observabilidade from "../src/observabilidade/Observabilidade.ts";

interface SpanLido {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly status: { readonly code: number };
}

interface LogLido {
  readonly traceId?: string;
  readonly severityText: string;
  readonly body: { readonly stringValue?: string };
}

const spansDe = (texto: string): Array<SpanLido> =>
  texto
    .split("\n")
    .filter((linha) => linha !== "")
    .flatMap((linha) =>
      (JSON.parse(linha) as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<SpanLido> }> }> }).resourceSpans
        .flatMap((r) => r.scopeSpans)
        .flatMap((s) => s.spans),
    );

const logsDe = (texto: string): Array<LogLido> =>
  texto
    .split("\n")
    .filter((linha) => linha !== "")
    .flatMap((linha) =>
      (JSON.parse(linha) as { resourceLogs: Array<{ scopeLogs: Array<{ logRecords: Array<LogLido> }> }> }).resourceLogs
        .flatMap((r) => r.scopeLogs)
        .flatMap((s) => s.logRecords),
    );

/** Roda `programa` com a exportação para `pasta`, descarrega e devolve o que foi gravado. */
const exportar = <A, E>(
  opcoes: Omit<Observabilidade.Opcoes, "pastaLogs">,
  pasta: string,
  programa: Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    yield* Effect.exit(programa);
    yield* Observabilidade.descarregar;
  }).pipe(Effect.provide(Observabilidade.layer({ ...opcoes, pastaLogs: pasta })));

const lerArquivo = (pasta: string, nome: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const caminho = path.join(pasta, nome);
    return (yield* fs.exists(caminho)) ? yield* fs.readFileString(caminho) : "";
  });

class FalhaDeTeste extends Schema.TaggedError<FalhaDeTeste>()("FalhaDeTeste", {}) {
  override get message(): string {
    return "falhou de propósito";
  }
}

/** Um trace com um filho que falha (com um log dentro) e um trace todo bem-sucedido. */
const doisTraces = Effect.gen(function* () {
  yield* Effect.logInfo("antes da falha").pipe(
    Effect.andThen(Effect.fail(new FalhaDeTeste())),
    Effect.withSpan("filho-que-falha"),
    Effect.withSpan("raiz-com-erro"),
    Effect.ignore,
  );
  yield* Effect.logInfo("tudo bem").pipe(Effect.withSpan("filho-ok"), Effect.withSpan("raiz-ok"));
});

describe("exportação para arquivo", () => {
  it.effect("completo: grava todos os spans em OTLP/JSON, com status de erro, e os logs com o traceId", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const pasta = yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-traces-" });
      yield* exportar({ modo: "completo", versao: "9.9.9" }, pasta, doisTraces);

      const texto = yield* lerArquivo(pasta, ARQUIVO_TRACES);
      const servico = (
        JSON.parse(texto.split("\n")[0] ?? "{}") as {
          resourceSpans: Array<{ resource: { attributes: Array<{ key: string; value: { stringValue: string } }> } }>;
        }
      ).resourceSpans[0]?.resource.attributes.find((a) => a.key === "service.name")?.value.stringValue;
      assert.strictEqual(servico, Observabilidade.NOME_SERVICO);

      const spans = spansDe(texto);
      assert.sameMembers(
        spans.map((s) => s.name),
        ["filho-que-falha", "raiz-com-erro", "filho-ok", "raiz-ok"],
      );
      const filho = spans.find((s) => s.name === "filho-que-falha");
      const raiz = spans.find((s) => s.name === "raiz-com-erro");
      assert.strictEqual(filho?.status.code, 2);
      assert.strictEqual(filho?.parentSpanId, raiz?.spanId);
      assert.strictEqual(filho?.traceId, raiz?.traceId);
      assert.strictEqual(spans.find((s) => s.name === "raiz-ok")?.status.code, 0);

      const logs = logsDe(yield* lerArquivo(pasta, ARQUIVO_LOGS));
      const antes = logs.find((l) => l.body.stringValue === "antes da falha");
      assert.strictEqual(antes?.traceId, filho?.traceId);
      assert.strictEqual(antes?.severityText, "Info");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("caixa-preta: grava o trace com erro inteiro, com os logs dele, e descarta o trace sem erro", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const pasta = yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-traces-" });
      yield* exportar({ modo: "caixa-preta" }, pasta, doisTraces);

      const spans = spansDe(yield* lerArquivo(pasta, ARQUIVO_TRACES));
      assert.sameMembers(
        spans.map((s) => s.name),
        ["filho-que-falha", "raiz-com-erro"],
      );
      const logs = logsDe(yield* lerArquivo(pasta, ARQUIVO_LOGS)).map((l) => l.body.stringValue);
      assert.include(logs, "antes da falha");
      assert.notInclude(logs, "tudo bem");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("o arquivo gira no limite: o anterior vira .1", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const pasta = yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-traces-" });
      const lote = (nome: string) =>
        Effect.gen(function* () {
          yield* Effect.void.pipe(Effect.withSpan(nome));
          yield* Observabilidade.descarregar;
        });
      yield* Effect.gen(function* () {
        yield* lote("primeiro");
        yield* lote("segundo");
      }).pipe(Effect.provide(Observabilidade.layer({ modo: "completo", pastaLogs: pasta, limiteArquivo: 300 })));

      assert.deepStrictEqual(
        spansDe(yield* fs.readFileString(path.join(pasta, `${ARQUIVO_TRACES}.1`))).map((s) => s.name),
        ["primeiro"],
      );
      assert.deepStrictEqual(
        spansDe(yield* lerArquivo(pasta, ARQUIVO_TRACES)).map((s) => s.name),
        ["segundo"],
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("um arquivo que não se pode gravar: um aviso só, e o outro arquivo continua sendo gravado", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const pasta = yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-traces-" });
      // Uma pasta no lugar de `traces.jsonl`: acrescentar a ela falha a cada lote.
      yield* fs.makeDirectory(path.join(pasta, ARQUIVO_TRACES));
      const resultado = yield* Effect.gen(function* () {
        yield* Effect.logInfo("primeiro").pipe(Effect.withSpan("um"));
        yield* Observabilidade.descarregar;
        yield* Effect.logInfo("segundo").pipe(Effect.withSpan("dois"));
        yield* Observabilidade.descarregar;
        yield* Observabilidade.descarregar;
        return "segue";
      }).pipe(Effect.provide(Observabilidade.layer({ modo: "completo", pastaLogs: pasta })));
      assert.strictEqual(resultado, "segue");
      const logs = logsDe(yield* lerArquivo(pasta, ARQUIVO_LOGS)).map((l) => JSON.stringify(l.body));
      assert.includeMembers(
        logs.filter((l) => !l.includes("não foi possível")),
        ['{"stringValue":"primeiro"}', '{"stringValue":"segundo"}'],
      );
      assert.lengthOf(
        logs.filter((l) => l.includes(`não foi possível gravar ${ARQUIVO_TRACES}`)),
        1,
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("uma pasta que não se pode criar não derruba quem usa os spans", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const pasta = yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-traces-" });
      const arquivo = path.join(pasta, "nao-e-pasta");
      yield* fs.writeFileString(arquivo, "x");
      const resultado = yield* Effect.gen(function* () {
        yield* Effect.void.pipe(Effect.withSpan("um"));
        yield* Observabilidade.descarregar;
        yield* Effect.void.pipe(Effect.withSpan("dois"));
        yield* Observabilidade.descarregar;
        return "segue";
      }).pipe(Effect.provide(Observabilidade.layer({ modo: "completo", pastaLogs: path.join(arquivo, "logs") })));
      assert.strictEqual(resultado, "segue");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("a falha de escrita desliga o arquivo por um intervalo; depois, a pasta se recria", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const raiz = yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-traces-" });
      const path = yield* Path.Path;
      const pasta = path.join(raiz, "logs");
      const lote = (nome: string) =>
        Effect.gen(function* () {
          yield* Effect.void.pipe(Effect.withSpan(nome));
          yield* Observabilidade.descarregar;
        });
      const nomes = yield* Effect.gen(function* () {
        yield* lote("antes");
        // A pasta some (alguém limpou os logs): a escrita seguinte falha e o arquivo se desliga.
        yield* fs.remove(pasta, { recursive: true });
        yield* lote("falha");
        yield* lote("desligado");
        yield* TestClock.adjust(Duration.sum(ArquivoOtlp.PAUSA_FALHA, Duration.seconds(1)));
        // Passada a pausa, a gravação recria a pasta.
        yield* fs.remove(pasta, { recursive: true }).pipe(Effect.ignore);
        yield* lote("depois");
        return spansDe(yield* lerArquivo(pasta, ARQUIVO_TRACES)).map((s) => s.name);
      }).pipe(Effect.provide(Observabilidade.layer({ modo: "completo", pastaLogs: pasta })));
      assert.deepStrictEqual(nomes, ["depois"]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("o giro que falha: segue acrescentando no arquivo atual e avisa uma vez", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const pasta = yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-traces-" });
      // Uma pasta com conteúdo no lugar do `.1`: o `rename` sobre ela falha.
      yield* fs.makeDirectory(path.join(pasta, `${ARQUIVO_TRACES}.1`, "ocupado"), { recursive: true });
      const lote = (nome: string) =>
        Effect.gen(function* () {
          yield* Effect.void.pipe(Effect.withSpan(nome));
          yield* Observabilidade.descarregar;
        });
      yield* Effect.gen(function* () {
        yield* lote("primeiro");
        yield* lote("segundo");
        yield* lote("terceiro");
        yield* Observabilidade.descarregar;
      }).pipe(Effect.provide(Observabilidade.layer({ modo: "completo", pastaLogs: pasta, limiteArquivo: 300 })));
      assert.deepStrictEqual(
        spansDe(yield* lerArquivo(pasta, ARQUIVO_TRACES)).map((s) => s.name),
        ["primeiro", "segundo", "terceiro"],
      );
      const avisos = logsDe(yield* lerArquivo(pasta, ARQUIVO_LOGS)).filter((l) =>
        JSON.stringify(l.body).includes("não foi possível girar"),
      );
      assert.lengthOf(avisos, 1);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("um arquivo que não termina em quebra de linha ganha uma antes da primeira gravação", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const pasta = yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-traces-" });
      yield* fs.writeFileString(path.join(pasta, ARQUIVO_TRACES), '{"cortado":');
      yield* exportar({ modo: "completo" }, pasta, Effect.void.pipe(Effect.withSpan("novo")));
      const linhas = (yield* lerArquivo(pasta, ARQUIVO_TRACES)).split("\n");
      assert.strictEqual(linhas[0], '{"cortado":');
      assert.deepStrictEqual(
        spansDe(linhas.slice(1).join("\n")).map((s) => s.name),
        ["novo"],
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

const TRACE_A = "a".repeat(32);
const TRACE_B = "b".repeat(32);

const span = (traceId: string, spanId: string, extra: Partial<SpanOtlp> = {}): SpanOtlp => ({
  traceId,
  spanId,
  parentSpanId: "pai",
  kind: 1,
  startTimeUnixNano: "0",
  endTimeUnixNano: "1000000",
  status: { code: 0 },
  ...extra,
});

const pedidoSpans = (...spans: Array<SpanOtlp>): PedidoTraces => ({
  resourceSpans: [{ resource: { r: 1 }, scopeSpans: [{ scope: { name: "effect" }, spans }] }],
});

const pedidoLogs = (...logRecords: Array<LogOtlp>): PedidoLogs => ({
  resourceLogs: [{ resource: { r: 1 }, scopeLogs: [{ scope: { name: "effect" }, logRecords }] }],
});

const idsGravados = (pedido: PedidoTraces | undefined) =>
  (pedido?.resourceSpans ?? []).flatMap((r) => r.scopeSpans).flatMap((s) => s.spans.map((x) => x.spanId));

const ns = (ms: number) => String(ms * 1_000_000);
const raizLenta = (traceId: string, spanId: string, extra: Partial<SpanOtlp> = {}) =>
  span(traceId, spanId, { parentSpanId: undefined, endTimeUnixNano: ns(LIMITES.lentoMs), ...extra });
const ERRO = { status: { code: 2 } };

describe("caixa-preta", () => {
  it("raiz lento sem erro: só o resumo (o raiz e os spans de 1 s ou mais), sem os logs", () => {
    const caixa = new CaixaPreta();
    assert.isUndefined(caixa.logs(pedidoLogs({ traceId: TRACE_A, severityNumber: 9 }), 0).logs);
    const lento = caixa.spans(
      pedidoSpans(
        span(TRACE_A, "curto"),
        span(TRACE_A, "longo", { endTimeUnixNano: ns(RESUMO_SPAN_MS) }),
        raizLenta(TRACE_A, "raiz"),
      ),
      0,
    );
    assert.deepStrictEqual(idsGravados(lento.traces), ["longo", "raiz"]);
    assert.isUndefined(lento.logs);
    // O que chega depois para ele se ignora.
    assert.isUndefined(caixa.spans(pedidoSpans(span(TRACE_A, "tarde", { endTimeUnixNano: ns(5000) })), 0).traces);
    assert.strictEqual(caixa.tracesEmCurso, 0);
  });

  it("raiz rápido descarta; o que chega depois para ele se ignora, sem abrir entrada", () => {
    const caixa = new CaixaPreta();
    // O handler do RPC (tipo servidor) é raiz, mesmo com o span da interface como pai.
    const rapido = caixa.spans(pedidoSpans(span(TRACE_B, "b1"), span(TRACE_B, "b0", { kind: 2 })), 0);
    assert.isUndefined(rapido.traces);
    assert.isUndefined(caixa.spans(pedidoSpans(span(TRACE_B, "b2", ERRO)), 0).traces);
    assert.isUndefined(caixa.logs(pedidoLogs({ traceId: TRACE_B, severityNumber: 9 }), 0).logs);
    assert.strictEqual(caixa.tracesEmCurso, 0);
  });

  it("raiz com erro: o trace inteiro, com os logs; depois, o que chega grava na hora", () => {
    const caixa = new CaixaPreta();
    caixa.logs(pedidoLogs({ traceId: TRACE_A, severityNumber: 9 }), 0);
    const gravado = caixa.spans(
      pedidoSpans(span(TRACE_A, "a1", ERRO), span(TRACE_A, "a0", { parentSpanId: undefined, ...ERRO })),
      0,
    );
    assert.deepStrictEqual(idsGravados(gravado.traces), ["a1", "a0"]);
    assert.deepStrictEqual(gravado.logs?.resourceLogs[0]?.scopeLogs[0]?.logRecords, [
      { traceId: TRACE_A, severityNumber: 9 },
    ]);
    assert.deepStrictEqual(idsGravados(caixa.spans(pedidoSpans(span(TRACE_A, "a2")), 0).traces), ["a2"]);
    assert.isDefined(caixa.logs(pedidoLogs({ traceId: TRACE_A, severityNumber: 9 }), 0).logs);
  });

  it("erro recuperado num filho, com o raiz ok: nada se rápido, só o resumo se lento", () => {
    const caixa = new CaixaPreta();
    const rapido = caixa.spans(pedidoSpans(span(TRACE_A, "a1", ERRO), span(TRACE_A, "a0", { kind: 2 })), 0);
    assert.isUndefined(rapido.traces);
    const lento = caixa.spans(pedidoSpans(span(TRACE_B, "b1", ERRO), raizLenta(TRACE_B, "b0")), 0);
    assert.deepStrictEqual(idsGravados(lento.traces), ["b0"]);
  });

  it("raiz que nunca chega: na idade, grava inteiro se teve erro e descarta se não", () => {
    const caixa = new CaixaPreta({ ...LIMITES, idadeMs: 1000 });
    caixa.spans(pedidoSpans(span(TRACE_A, "a1", ERRO), span(TRACE_A, "a2")), 0);
    caixa.logs(pedidoLogs({ traceId: TRACE_A, severityNumber: 9 }), 0);
    caixa.spans(pedidoSpans(span(TRACE_B, "b1")), 0);
    const expirado = caixa.logs(pedidoLogs(), 1000);
    assert.deepStrictEqual(idsGravados(expirado.traces), ["a1", "a2"]);
    assert.lengthOf(expirado.logs?.resourceLogs[0]?.scopeLogs[0]?.logRecords ?? [], 1);
    assert.strictEqual(caixa.tracesEmCurso, 0);
    assert.isUndefined(caixa.spans(pedidoSpans(span(TRACE_B, "b2")), 1000).traces);
    assert.strictEqual(caixa.tracesEmCurso, 0);
  });

  it("logs: sem trace, Info ou acima; com trace, Warn na hora e o resto com o trace", () => {
    const caixa = new CaixaPreta();
    const soltos = caixa.logs(pedidoLogs({ severityNumber: 5 }, { severityNumber: 9 }), 0);
    assert.deepStrictEqual(soltos.logs?.resourceLogs[0]?.scopeLogs[0]?.logRecords, [{ severityNumber: 9 }]);
    assert.isDefined(caixa.logs(pedidoLogs({ traceId: TRACE_A, severityNumber: 13 }), 0).logs);
    assert.isUndefined(caixa.logs(pedidoLogs({ traceId: TRACE_A, severityNumber: 9 }), 0).logs);
    const erro = caixa.spans(pedidoSpans(span(TRACE_A, "a0", { parentSpanId: undefined, ...ERRO })), 0);
    assert.deepStrictEqual(erro.logs?.resourceLogs[0]?.scopeLogs[0]?.logRecords, [
      { traceId: TRACE_A, severityNumber: 9 },
    ]);
  });

  it("limites: despejo pela atividade mais antiga (LRU), spans por trace e bytes", () => {
    const C = "c".repeat(32);
    const caixa = new CaixaPreta({ ...LIMITES, traces: 2, spansPorTrace: 2 });
    caixa.spans(pedidoSpans(span(TRACE_A, "a1")), 0);
    caixa.spans(pedidoSpans(span(TRACE_B, "b1")), 0);
    // A teve atividade depois de B: o terceiro trace tira B, não A.
    caixa.spans(pedidoSpans(span(TRACE_A, "a2"), span(TRACE_A, "a3")), 0);
    caixa.spans(pedidoSpans(span(C, "c1")), 0);
    assert.strictEqual(caixa.tracesEmCurso, 2);
    // B foi descartado: o raiz com erro que chega depois não abre entrada nem grava.
    assert.isUndefined(caixa.spans(pedidoSpans(span(TRACE_B, "b0", { parentSpanId: undefined, ...ERRO })), 0).traces);
    // Só os 2 últimos spans de A ficaram.
    assert.deepStrictEqual(
      idsGravados(caixa.spans(pedidoSpans(span(TRACE_A, "a0", { parentSpanId: undefined, ...ERRO })), 0).traces),
      ["a3", "a0"],
    );

    // O teto de bytes: cabem dois spans; o terceiro trace despeja o de atividade mais antiga.
    const umSpan = JSON.stringify(span(TRACE_A, "x1")).length;
    const porBytes = new CaixaPreta({ ...LIMITES, bytes: umSpan * 2 + 1 });
    porBytes.spans(pedidoSpans(span(TRACE_A, "x1")), 0);
    porBytes.spans(pedidoSpans(span(TRACE_B, "x2")), 0);
    assert.strictEqual(porBytes.tracesEmCurso, 2);
    porBytes.spans(pedidoSpans(span(C, "x3")), 0);
    assert.strictEqual(porBytes.tracesEmCurso, 2);
    assert.isAtMost(porBytes.bytesEmCurso, umSpan * 2 + 1);
    assert.isUndefined(
      porBytes.spans(pedidoSpans(span(TRACE_A, "x0", { parentSpanId: undefined, ...ERRO })), 0).traces,
    );
  });
});
