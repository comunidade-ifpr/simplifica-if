// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- ponto de entrada do Worker: `worker_threads` e o relógio vindo do pedido
/**
 * O Worker da revisão prévia (`AnalisePpc.ts`): recebe um pedido, roda `revisarDocx` (conversão,
 * pré-conferência e comentários, tudo síncrono e com a árvore do XML na memória) e devolve o
 * resultado, com os bytes do DOCX comentado transferidos, não copiados.
 *
 * Roda com `resourceLimits` e tempo máximo impostos por quem o cria; aqui só se distingue o erro
 * esperado (`ErroDocx`: arquivo protegido, corrompido, grande demais, sem texto, com a mensagem em
 * português) do defeito.
 */
import * as NodeWorkerThreads from "node:worker_threads";
import { ErroDocx } from "@simplifica-if/docx/erro";
import { type BaseRevisaoPrevia, revisarDocx, type RevisaoPrevia } from "@simplifica-if/ppc/revisao-previa";

export type PedidoTrabalhador = {
  bytes: Uint8Array;
  nome: string;
  base: BaseRevisaoPrevia;
  /** ISO 8601. */
  agora: string;
  cnct?: string | undefined;
  forma?: string | undefined;
};

export type RespostaTrabalhador =
  | { ok: true; revisao: RevisaoPrevia }
  | { ok: false; arquivoInvalido: boolean; mensagem: string };

const porta = NodeWorkerThreads.parentPort;
if (porta !== null)
  porta.once("message", (pedido: PedidoTrabalhador) => {
    let resposta: RespostaTrabalhador;
    try {
      const revisao = revisarDocx(pedido.bytes, pedido.nome, pedido.base, {
        agora: new Date(pedido.agora),
        cnct: pedido.cnct,
        forma: pedido.forma,
      });
      porta.postMessage({ ok: true, revisao } satisfies RespostaTrabalhador, [revisao.docx.buffer as ArrayBuffer]);
      return;
    } catch (erro) {
      resposta = {
        ok: false,
        arquivoInvalido: erro instanceof ErroDocx,
        mensagem: erro instanceof Error ? erro.message : String(erro),
      };
    }
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- porta de Worker, não janela
    porta.postMessage(resposta);
  });
