/**
 * O destino do `OtlpTracer` e do `OtlpLogger` quando nada sai do computador: um `HttpClient` que, em vez
 * de mandar o pedido de exportação pela rede, grava o OTLP/JSON como uma linha, no mesmo formato do file
 * exporter do OpenTelemetry Collector: um `ExportTraceServiceRequest` por linha em `traces.jsonl` e um
 * `ExportLogsServiceRequest` por linha em `logs-otlp.jsonl`. Responde sempre 200: uma falha de escrita
 * não pode desligar o exportador nem derrubar o servidor.
 *
 * Junto vai um `OtlpSerialization` próprio: o corpo do pedido leva os dados como objeto (`TraceData`,
 * `LogsData`), sem passar por texto e de volta, e o JSON se faz só na hora de gravar.
 *
 * - `completo`: grava todo pedido como veio.
 * - `caixa-preta`: passa os lotes pela `CaixaPreta` e grava só os traces com erro e o resumo dos lentos.
 *
 * Cada arquivo gira em `LIMITE_ARQUIVO`: o atual vira `.1` (o anterior se perde) e outro começa, como o
 * `simplifica-if.log` do desktop; se o giro falhar, segue no atual. Um erro de escrita desliga aquele
 * arquivo por `PAUSA_FALHA` e registra um aviso; a tentativa seguinte recria a pasta. O exportador já
 * agrupa os spans (a cada 5 s, ou mil) e os logs (a cada 1 s) e roda num fiber próprio, sem tracing: a
 * gravação não pesa em cada span.
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import * as Base64 from "effect/encoding/Base64";
import { HttpBody, HttpClient, HttpClientResponse } from "effect/http";
import { type OtlpLogger, OtlpSerialization, type OtlpTracer } from "effect/observability";
import { CaixaPreta } from "./CaixaPreta.ts";

export const ARQUIVO_TRACES = "traces.jsonl";
export const ARQUIVO_LOGS = "logs-otlp.jsonl";

/** 5 MB por arquivo, como o `simplifica-if.log`. */
export const LIMITE_ARQUIVO = 5 * 1024 * 1024;

/** Quanto tempo um arquivo fica desligado depois de um erro de escrita (o mesmo do exportador do Effect). */
export const PAUSA_FALHA = Duration.seconds(60);

/** O que vai ao arquivo: tudo, ou só os traces com erro ou lentos. */
export type ModoArquivo = "completo" | "caixa-preta";

export interface OpcoesArquivo {
  readonly pasta: string;
  readonly modo: ModoArquivo;
  /** O tamanho em que o arquivo gira (padrão `LIMITE_ARQUIVO`); os testes o apertam. */
  readonly limite?: number;
  /** A caixa-preta (padrão: uma nova, com os `LIMITES`); os testes passam uma com limites próprios. */
  readonly caixaPreta?: CaixaPreta;
}

/** Um arquivo JSONL que gira no limite e, num erro de escrita, se desliga por `PAUSA_FALHA`. */
const makeGravador = Effect.fnUntraced(function* (pasta: string, nome: string, limite: number) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const caminho = path.join(pasta, nome);
  const trava = yield* Semaphore.make(1);
  // `undefined`: abrir de novo (criar a pasta, medir o arquivo) na próxima escrita.
  let tamanho: number | undefined;
  let desligadoAte: number | undefined;
  let avisouGiro = false;

  /** Se o arquivo que já existe não termina em `\n` (uma gravação cortada), a primeira linha começa por um. */
  const terminaSemQuebra = (bytes: number) =>
    Effect.scoped(
      fs
        .open(caminho, { flag: "r" })
        .pipe(Effect.flatMap((arquivo) => arquivo.readAlloc(1, { position: BigInt(bytes - 1) }))),
    ).pipe(
      Effect.map((ultimo) => Option.isSome(ultimo) && ultimo.value[0] !== 0x0a),
      Effect.orElseSucceed(() => false),
    );

  const escrever = Effect.fnUntraced(function* (linha: string) {
    let prefixo = "";
    if (tamanho === undefined) {
      yield* fs.makeDirectory(pasta, { recursive: true });
      const atual = yield* fs.stat(caminho).pipe(
        Effect.map((info) => Number(info.size)),
        Effect.orElseSucceed(() => 0),
      );
      if (atual > 0 && (yield* terminaSemQuebra(atual))) prefixo = "\n";
      tamanho = atual;
    }
    const texto = `${prefixo}${linha}\n`;
    const bytes = Buffer.byteLength(texto, "utf8");
    if (tamanho > 0 && tamanho + bytes > limite) {
      const girou = yield* fs.rename(caminho, `${caminho}.1`).pipe(
        Effect.as(true),
        Effect.catch((erro) => {
          if (avisouGiro) return Effect.succeed(false);
          avisouGiro = true;
          return Effect.logWarning(
            `traces: não foi possível girar ${nome}; a gravação segue no arquivo atual`,
            erro,
          ).pipe(Effect.as(false));
        }),
      );
      if (girou) tamanho = 0;
    }
    yield* fs.writeFileString(caminho, texto, { flag: "a" });
    tamanho += bytes;
  });

  // Gravação serializada por arquivo: o exportador pode exportar dois lotes ao mesmo tempo.
  const gravar = Effect.fnUntraced(function* (linha: string) {
    const agora = yield* Clock.currentTimeMillis;
    if (desligadoAte !== undefined && agora < desligadoAte) return;
    desligadoAte = undefined;
    yield* escrever(linha).pipe(
      Effect.catch((erro) => {
        tamanho = undefined;
        desligadoAte = agora + Duration.toMillis(PAUSA_FALHA);
        return Effect.logWarning(
          `traces: não foi possível gravar ${nome}; o arquivo fica desligado por ${Duration.format(PAUSA_FALHA)}`,
          erro,
        );
      }),
    );
  }, trava.withPermit);
  return { gravar };
});

// Como o `OtlpSerialization.layerJson` do Effect: o OTLP/JSON escreve os números não finitos como texto e
// os bytes em base64. O `this` é lido porque o `toJSON` do `Buffer` roda antes do replacer.
function substituto(this: Record<string, unknown>, chave: string, valor: unknown): unknown {
  if (typeof valor === "number" && !Number.isFinite(valor)) return String(valor);
  const original = this[chave];
  if (chave === "bytesValue" && original instanceof Uint8Array) return Base64.encode(original);
  return valor;
}

/** Um pedido de exportação OTLP como uma linha de JSON. */
export const serializar = (pedido: unknown): string => JSON.stringify(pedido, substituto);

/** Os dados de um pedido de exportação, levados pelo corpo do pedido HTTP até o `HttpClient` de arquivo. */
type Pedido =
  | { readonly sinal: "traces"; readonly dados: OtlpTracer.TraceData }
  | { readonly sinal: "logs"; readonly dados: OtlpLogger.LogsData };

/**
 * O `HttpClient` que grava os pedidos de exportação na pasta de logs (`traces.jsonl`, `logs-otlp.jsonl`)
 * e o `OtlpSerialization` que lhe entrega os dados como objeto. As métricas se ignoram.
 */
export const make = Effect.fnUntraced(function* (opcoes: OpcoesArquivo) {
  const limite = opcoes.limite ?? LIMITE_ARQUIVO;
  const traces = yield* makeGravador(opcoes.pasta, ARQUIVO_TRACES, limite);
  const logs = yield* makeGravador(opcoes.pasta, ARQUIVO_LOGS, limite);
  const caixa = opcoes.modo === "caixa-preta" ? (opcoes.caixaPreta ?? new CaixaPreta()) : undefined;
  // O corpo é um objeto novo a cada pedido: a chave que liga o pedido HTTP aos dados que ele leva.
  const pedidos = new WeakMap<HttpBody.HttpBody, Pedido>();
  const corpo = (pedido: Pedido | undefined) => {
    const novo = HttpBody.text("", "application/json");
    if (pedido !== undefined) pedidos.set(novo, pedido);
    return novo;
  };
  let avisouCorpo = false;

  const receber = Effect.fnUntraced(function* (pedido: Pedido) {
    if (caixa === undefined) {
      return yield* (pedido.sinal === "traces" ? traces : logs).gravar(serializar(pedido.dados));
    }
    const agora = yield* Clock.currentTimeMillis;
    const aGravar = pedido.sinal === "traces" ? caixa.spans(pedido.dados, agora) : caixa.logs(pedido.dados, agora);
    if (aGravar.traces !== undefined) yield* traces.gravar(serializar(aGravar.traces));
    if (aGravar.logs !== undefined) yield* logs.gravar(serializar(aGravar.logs));
  });

  const cliente = HttpClient.make((requisicao) =>
    Effect.gen(function* () {
      const pedido = pedidos.get(requisicao.body);
      if (pedido !== undefined) {
        pedidos.delete(requisicao.body);
        yield* receber(pedido);
      } else if (!requisicao.url.endsWith("/v1/metrics") && !avisouCorpo) {
        avisouCorpo = true;
        yield* Effect.logWarning(`traces: pedido de exportação sem dados reconhecidos descartado (${requisicao.url})`);
      }
      return HttpClientResponse.fromWeb(requisicao, new Response(null, { status: 200 }));
    }),
  );
  const serializacao = OtlpSerialization.OtlpSerialization.of({
    traces: (dados) => corpo({ sinal: "traces", dados }),
    logs: (dados) => corpo({ sinal: "logs", dados }),
    metrics: () => corpo(undefined),
  });
  return Context.make(HttpClient.HttpClient, cliente).pipe(
    Context.add(OtlpSerialization.OtlpSerialization, serializacao),
  );
});

/** O `HttpClient` de arquivo e o `OtlpSerialization` que o acompanha. */
export const layer = (opcoes: OpcoesArquivo) => Layer.effectContext(make(opcoes));
