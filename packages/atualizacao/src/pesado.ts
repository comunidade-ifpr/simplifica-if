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
import * as NodeWorker from "node:worker_threads";
import * as NodeZlib from "node:zlib";
import { VERSAO_ESQUEMA } from "@simplifica-if/kb/db/esquema";
import { type InfoBanco, validarBancoNucleo } from "./local.ts";

const C = NodeZlib.constants;
const descomprimirZstd = NodeUtil.promisify(NodeZlib.zstdDecompress);

export async function descomprimirAsync(dados: Uint8Array, limite: number): Promise<Buffer> {
  return descomprimirZstd(dados, { params: { [C.ZSTD_d_windowLogMax]: 31 }, maxOutputLength: limite });
}

export async function aplicarPatchAsync(anterior: Uint8Array, patch: Uint8Array, limite: number): Promise<Buffer> {
  return descomprimirZstd(patch, {
    dictionary: anterior,
    params: { [C.ZSTD_d_windowLogMax]: 31 },
    maxOutputLength: limite,
  });
}

export async function sha256Async(dados: Uint8Array): Promise<string> {
  const copia = new Uint8Array(dados.byteLength);
  copia.set(dados);
  return Buffer.from(await globalThis.crypto.subtle.digest("SHA-256", copia)).toString("hex");
}

const CODIGO_WORKER = `
const { parentPort, workerData } = require("node:worker_threads");
const validar = (${validarBancoNucleo.toString()});
try {
  parentPort.postMessage({ ok: validar(require("node:sqlite"), workerData.versaoEsquema, workerData.caminho, workerData.esperado) });
} catch (erro) {
  parentPort.postMessage({ erro: erro instanceof Error ? erro.message : String(erro) });
}
`;

/** `validarBanco` num Worker: a mesma conferência, sem travar o event loop. */
export function validarBancoEmWorker(
  caminho: string,
  esperado: { versao: string; dataReferencia?: string },
): Promise<InfoBanco> {
  return new Promise((resolver, rejeitar) => {
    const worker = new NodeWorker.Worker(CODIGO_WORKER, {
      eval: true,
      workerData: { caminho, esperado, versaoEsquema: VERSAO_ESQUEMA },
    });
    worker.once("message", (resposta: { ok?: InfoBanco; erro?: string }) => {
      void worker.terminate();
      if (resposta.ok !== undefined) resolver(resposta.ok);
      else rejeitar(new Error(resposta.erro ?? "a base baixada não pôde ser conferida"));
    });
    worker.once("error", (erro) => rejeitar(new Error(`a base baixada não pôde ser conferida: ${erro.message}`)));
  });
}
