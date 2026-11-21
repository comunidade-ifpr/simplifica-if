// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- ponto de entrada do Worker: `worker_threads` e o relógio vindo do pedido
/**
 * O Worker da revisão prévia (`RevisorPpc.ts`): recebe um pedido, roda `revisarDocx` (conversão,
 * pré-conferência e comentários, tudo síncrono e com a árvore do XML na memória) e devolve o
 * resultado, com os bytes do DOCX comentado transferidos, não copiados.
 *
 * Roda com `resourceLimits` e tempo máximo impostos por quem o cria; aqui só se distingue o erro
 * esperado (`ErroDocx`: arquivo protegido, corrompido, grande demais, sem texto), que volta como o
 * motivo e os atributos (`DadosErroDocx`; quem criou o Worker monta a frase), do defeito.
 */
import * as NodeWorkerThreads from "node:worker_threads";
import { type DadosErroDocx, ErroDocx } from "@simplifica-if/docx/erro";
import type { AvisoAndamento } from "../WorkerLimitado.ts";
import {
  type BaseRevisaoPrevia,
  type EntradaIa,
  type EtapaRevisaoPrevia,
  type MarcaPendencia,
  revisarDocx,
  type RevisaoPrevia,
} from "@simplifica-if/ppc/revisao-previa";

export type PedidoTrabalhador = {
  bytes: Uint8Array;
  nome: string;
  base: BaseRevisaoPrevia;
  /** ISO 8601. */
  agora: string;
  cnct?: string | undefined;
  forma?: string | undefined;
  /** Os resultados conferidos da revisão com IA (etapa 4), para a mesma lista e o mesmo DOCX. */
  ia?: EntradaIa | undefined;
  /** A situação de cada pendência na lista viva (etapa 5b), para a cópia comentada com o estado. */
  situacoes?: Record<string, MarcaPendencia> | undefined;
};

/** O aviso de andamento que o Worker manda antes da resposta (`WorkerLimitado.AvisoAndamento`). */
export type AndamentoTrabalhador = EtapaRevisaoPrevia;

export type RespostaTrabalhador =
  | { ok: true; revisao: RevisaoPrevia }
  | { ok: false; arquivoInvalido: DadosErroDocx }
  | { ok: false; defeito: string };

const porta = NodeWorkerThreads.parentPort;
if (porta !== null)
  porta.once("message", (pedido: PedidoTrabalhador) => {
    let resposta: RespostaTrabalhador;
    try {
      const revisao = revisarDocx(pedido.bytes, pedido.nome, pedido.base, {
        agora: new Date(pedido.agora),
        cnct: pedido.cnct,
        forma: pedido.forma,
        ia: pedido.ia,
        situacoes: pedido.situacoes,
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- porta de Worker, não janela
        aoEtapa: (etapa) => porta.postMessage({ andamento: etapa } satisfies AvisoAndamento<AndamentoTrabalhador>),
      });
      porta.postMessage({ ok: true, revisao } satisfies RespostaTrabalhador, [revisao.docx.buffer as ArrayBuffer]);
      return;
    } catch (erro) {
      resposta =
        erro instanceof ErroDocx
          ? { ok: false, arquivoInvalido: erro.dados }
          : { ok: false, defeito: erro instanceof Error ? erro.message : String(erro) };
    }
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- porta de Worker, não janela
    porta.postMessage(resposta);
  });
