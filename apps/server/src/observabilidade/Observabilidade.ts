/**
 * A observabilidade do servidor local: os spans e os logs pelos exportadores oficiais do Effect
 * (`OtlpTracer`, `OtlpLogger`, OTLP/JSON) e o log de uma linha no stderr.
 *
 * - **Arquivo** (o padrão, com a pasta de logs): o `HttpClient` de `ArquivoOtlp.ts` grava os pedidos
 *   de exportação em `traces.jsonl` e `logs-otlp.jsonl`, ao lado do `simplifica-if.log`. Nada sai do
 *   computador. Modo `completo` (desenvolvimento) ou `caixa-preta` (app empacotado).
 * - **Rede** (só no desenvolvimento): com `OTEL_EXPORTER_OTLP_ENDPOINT` e o modo `completo`, os mesmos
 *   exportadores mandam ao coletor (Jaeger, otel-tui…) por OTLP/HTTP, no lugar do arquivo. Na caixa-preta
 *   a variável não vale: no app empacotado, nada sai do computador.
 * - **Desligado:** sem pasta de logs (o servidor rodado à mão, os testes) ou com `desligado`; os spans
 *   ficam no tracer nativo, que não exporta.
 *
 * O stderr (`loggerStderr`) é logfmt, uma linha por registro, com o `codigo` do trace em curso
 * (`codigoDoErro`): o mesmo código da interface, que liga o `simplifica-if.log` ao `traces.jsonl`.
 */
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import type * as Path from "effect/Path";
import * as References from "effect/References";
import { FetchHttpClient } from "effect/http";
import { OtlpExporter, OtlpLogger, OtlpSerialization, OtlpTracer } from "effect/observability";
import { codigoDoErro } from "@simplifica-if/contratos-app";
import * as ArquivoOtlp from "./ArquivoOtlp.ts";
import type { CaixaPreta } from "./CaixaPreta.ts";

export const MODOS = ["completo", "caixa-preta", "desligado"] as const;
export type Modo = (typeof MODOS)[number];

export const NOME_SERVICO = "simplifica-if-servidor";

/** O endereço dos pedidos de exportação ao arquivo: o `HttpClient` de arquivo só lê o caminho. */
const BASE_ARQUIVO = "http://arquivo.simplifica.local";

export interface Opcoes {
  /** A pasta de logs do app; sem ela, nada vai a arquivo. */
  readonly pastaLogs: string | undefined;
  readonly modo: Modo;
  /** `OTEL_EXPORTER_OTLP_ENDPOINT`: com ele, a exportação vai por rede a esse coletor, não ao arquivo. */
  readonly endpoint?: string | undefined;
  readonly versao?: string | undefined;
  /** Para os testes: o tamanho de giro dos arquivos e a caixa-preta com limites próprios. */
  readonly limiteArquivo?: number;
  readonly caixaPreta?: CaixaPreta;
}

/**
 * O tracer e o logger OTLP sobre um `HttpClient` e um `OtlpSerialization` (os de arquivo, ou o da rede
 * com o JSON do Effect), com um `Flusher` só.
 */
const exportadores = (base: string, versao: string | undefined) => {
  const recurso = { serviceName: NOME_SERVICO, ...(versao === undefined ? {} : { serviceVersion: versao }) };
  const url = (sinal: string) => `${base.replace(/\/+$/u, "")}/v1/${sinal}`;
  return Layer.mergeAll(
    OtlpTracer.layer({ url: url("traces"), resource: recurso }),
    OtlpLogger.layer({ url: url("logs"), resource: recurso, mergeWithExisting: true }),
  );
};

/**
 * A exportação de spans e logs conforme as opções. Sempre fornece o `OtlpExporter.Flusher` (vazio quando
 * desligada): o fim do escopo descarrega o que falta, e os testes descarregam com `flush`.
 */
export const layer = (opcoes: Opcoes): Layer.Layer<OtlpExporter.Flusher, never, FileSystem.FileSystem | Path.Path> => {
  // O coletor só no modo `completo` (o do desenvolvimento): a caixa-preta do app empacotado nunca usa a rede.
  if (opcoes.modo === "completo" && opcoes.endpoint !== undefined && opcoes.endpoint.trim() !== "") {
    return exportadores(opcoes.endpoint.trim(), opcoes.versao).pipe(
      Layer.provide(Layer.mergeAll(FetchHttpClient.layer, OtlpSerialization.layerJson)),
    );
  }
  if (opcoes.pastaLogs === undefined || opcoes.modo === "desligado") return OtlpExporter.layerFlusher;
  const arquivo = ArquivoOtlp.layer({
    pasta: opcoes.pastaLogs,
    modo: opcoes.modo,
    ...(opcoes.limiteArquivo === undefined ? {} : { limite: opcoes.limiteArquivo }),
    ...(opcoes.caixaPreta === undefined ? {} : { caixaPreta: opcoes.caixaPreta }),
  });
  return exportadores(BASE_ARQUIVO, opcoes.versao).pipe(Layer.provide(arquivo));
};

/**
 * O log do stderr: logfmt (`Logger.formatLogFmt`), uma linha por registro, mais o `codigo` do trace em
 * curso quando o registro não o traz anotado. O stdout fica só com a `LinhaPartida`.
 */
export const loggerStderr = Logger.withConsoleError(
  Logger.make((opcoes) => {
    const linha = Logger.formatLogFmt.log(opcoes);
    const span = opcoes.fiber.cache.span;
    if (span === undefined || "codigo" in opcoes.fiber.getRef(References.CurrentLogAnnotations)) return linha;
    return `${linha} codigo=${codigoDoErro(span.traceId)}`;
  }),
);

/** Troca o logger padrão pelo `loggerStderr`. */
export const layerLoggerStderr = Logger.layer([loggerStderr]);

/** Descarrega os spans e logs pendentes (o fim do escopo também descarrega). */
export const descarregar = Effect.gen(function* () {
  yield* (yield* OtlpExporter.Flusher).flush;
});
