// @effect-diagnostics nodeBuiltinImport:off -- ponto de entrada do Worker: `worker_threads`
/**
 * O Worker do aviso ao anexar (M1.13, `conferir.ts`): recebe os bytes de um arquivo, extrai o texto
 * (`.docx` pelo leitor com os limites contra arquivo hostil; `.md`, `.txt`) e devolve o resumo do
 * detector, só com as formas mascaradas. Roda com `resourceLimits` e tempo máximo impostos por quem o
 * cria; nada sai daqui além da resposta pela porta.
 */
import * as NodeWorkerThreads from "node:worker_threads";
import { type ConferenciaArquivo, conferirArquivo } from "@simplifica-if/dados-pessoais/arquivo";

export type PedidoConferencia = { readonly nome: string; readonly bytes: Uint8Array };
export type RespostaConferencia = ConferenciaArquivo;

const porta = NodeWorkerThreads.parentPort;
if (porta !== null)
  porta.once("message", (pedido: PedidoConferencia) => {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- porta de Worker, não janela
    porta.postMessage(conferirArquivo(pedido.nome, pedido.bytes) satisfies RespostaConferencia);
  });
