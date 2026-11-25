// @effect-diagnostics nodeBuiltinImport:off -- ponto de entrada do Worker: `worker_threads`
/**
 * O Worker da revisão prévia (`RevisorPpc.ts`): recebe um pedido, faz o trabalho (`trabalho.ts`) e
 * devolve a resposta, antes dela os avisos de andamento. Roda com `resourceLimits` e tempo máximo
 * impostos por quem o cria (`WorkerLimitado.ts`).
 */
import * as NodeWorkerThreads from "node:worker_threads";
import type { AvisoAndamento } from "../WorkerLimitado.ts";
import { type AndamentoTrabalhador, atender, type PedidoTrabalhador } from "./trabalho.ts";

const porta = NodeWorkerThreads.parentPort;
if (porta !== null)
  porta.once("message", (pedido: PedidoTrabalhador) => {
    const { resposta, transferir } = atender(pedido, (etapa) =>
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- porta de Worker, não janela
      porta.postMessage({ andamento: etapa } satisfies AvisoAndamento<AndamentoTrabalhador>),
    );
    porta.postMessage(resposta, [...transferir]);
  });
