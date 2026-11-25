// @effect-diagnostics nodeBuiltinImport:off -- ponto de entrada do Worker: `worker_threads`
/**
 * O Worker da versão em texto dos anexos (`TextosAnexos.ts`): recebe os bytes e o formato, faz o trabalho
 * (`trabalho.ts`) e devolve a resposta. Roda com `resourceLimits` e tempo máximo impostos por quem o cria
 * (`WorkerLimitado.ts`).
 */
import * as NodeWorkerThreads from "node:worker_threads";
import { atender, type PedidoTexto } from "./trabalho.ts";

const porta = NodeWorkerThreads.parentPort;
if (porta !== null)
  porta.once("message", (pedido: PedidoTexto) => {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- porta de Worker, não janela
    void atender(pedido).then((resposta) => porta.postMessage(resposta));
  });
