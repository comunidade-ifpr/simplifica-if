// @effect-diagnostics nodeBuiltinImport:off -- trabalho pesado fora do event loop do servidor: zlib e WebCrypto no threadpool, node:sqlite num Worker
/**
 * O que leva tempo com a base de 132 MB fica fora do event loop do servidor, para o RPC e as conversas
 * não pararem durante uma atualização:
 *
 * - zstd (patch e pacote inteiro): as versões assíncronas do `node:zlib`, que rodam no threadpool;
 * - sha256: `crypto.subtle.digest`, também no threadpool;
 * - `quick_check` e o `meta` do banco baixado: num `Worker` com o código de `validarBancoNucleo` (o
 *   texto da função, sem arquivo à parte, para o bundle do servidor e o executável SEA não precisarem
 *   de mais uma entrada).
 */
import * as NodeUtil from "node:util";
import * as NodeWorkerThreads from "node:worker_threads";
import * as NodeZlib from "node:zlib";
import { VERSAO_ESQUEMA } from "@simplifica-if/kb/db/esquema";
import * as Effect from "effect/Effect";
import { PacoteInvalido } from "./erros.ts";
import { type InfoBanco, validarBancoNucleo } from "./local.ts";

const C = NodeZlib.constants;
const descomprimirZstd = NodeUtil.promisify(NodeZlib.zstdDecompress);

/** Descomprime o `pacote` zstd; recusa o que não descomprime ou passa do limite. */
export const descomprimir = (pacote: string, dados: Uint8Array, limite: number) =>
  Effect.tryPromise({
    try: () => descomprimirZstd(dados, { params: { [C.ZSTD_d_windowLogMax]: 31 }, maxOutputLength: limite }),
    catch: (cause) => new PacoteInvalido({ pacote, motivo: "não descomprime", cause }),
  });

/** Aplica o patch zstd (o banco anterior como dicionário). */
export const aplicarPatch = (anterior: Uint8Array, patch: Uint8Array, limite: number) =>
  Effect.tryPromise({
    try: () =>
      descomprimirZstd(patch, {
        dictionary: anterior,
        params: { [C.ZSTD_d_windowLogMax]: 31 },
        maxOutputLength: limite,
      }),
    catch: (cause) => new PacoteInvalido({ pacote: "patch da base", motivo: "não aplica sobre a base em uso", cause }),
  });

export const sha256 = (dados: Uint8Array): Effect.Effect<string> =>
  Effect.promise(async () => {
    const copia = new Uint8Array(dados.byteLength);
    copia.set(dados);
    return Buffer.from(await globalThis.crypto.subtle.digest("SHA-256", copia)).toString("hex");
  });

const CODIGO_WORKER = `
const { parentPort, workerData } = require("node:worker_threads");
const validar = (${validarBancoNucleo.toString()});
try {
  parentPort.postMessage({ ok: validar(require("node:sqlite"), workerData.versaoEsquema, workerData.caminho, workerData.esperado) });
} catch (erro) {
  parentPort.postMessage({
    erro: erro instanceof Error ? erro.message : String(erro),
    causa: erro instanceof Error && erro.cause !== undefined ? String(erro.cause) : undefined,
  });
}
`;

const BANCO_BAIXADO = "banco baixado";

/**
 * `validarBancoNucleo` num Worker: a conferência do banco baixado, sem travar o event loop. O Worker termina se a
 * conferência for interrompida.
 */
export const validarBancoEmWorker = (
  caminho: string,
  esperado: { versao: string; dataReferencia: string },
): Effect.Effect<InfoBanco, PacoteInvalido> =>
  Effect.callback<InfoBanco, PacoteInvalido>((resume) => {
    const worker = new NodeWorkerThreads.Worker(CODIGO_WORKER, {
      eval: true,
      workerData: { caminho, esperado, versaoEsquema: VERSAO_ESQUEMA },
    });
    worker.once("message", (resposta: { ok?: InfoBanco; erro?: string; causa?: string }) => {
      void worker.terminate();
      if (resposta.ok !== undefined) return resume(Effect.succeed(resposta.ok));
      resume(
        Effect.fail(
          new PacoteInvalido({
            pacote: BANCO_BAIXADO,
            motivo: resposta.erro ?? "a base baixada não pôde ser conferida",
            ...(resposta.causa === undefined ? {} : { cause: new Error(resposta.causa) }),
          }),
        ),
      );
    });
    worker.once("error", (erro) =>
      resume(
        Effect.fail(
          new PacoteInvalido({ pacote: BANCO_BAIXADO, motivo: "a base baixada não pôde ser conferida", cause: erro }),
        ),
      ),
    );
    return Effect.promise(() => worker.terminate());
  });
