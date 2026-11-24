// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- ponto de entrada do Worker: `worker_threads` e o relógio vindo do pedido
/**
 * O Worker da revisão prévia (`RevisorPpc.ts`): recebe um pedido, roda `revisarDocx` (ou
 * `revisarDocxSemComentar`, quando `comentar` é falso: pula `comentarDocx`, `textosDeCaixas`,
 * recompactação do ZIP e transferência de `ArrayBuffer`) e devolve o resultado.
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
  revisarDocxSemComentar,
  type RevisaoPrevia,
} from "@simplifica-if/ppc/revisao-previa";

export type PedidoTrabalhador = {
  bytes: Uint8Array;
  nome: string;
  base: BaseRevisaoPrevia;
  /** ISO 8601. */
  agora: string;
  /** Quando falso, pula os comentários no `.docx` e devolve `docx: null`. */
  comentar: boolean;
  cnct?: string | undefined;
  forma?: string | undefined;
  /** Os resultados conferidos da revisão com IA (etapa 4), para a mesma lista e o mesmo DOCX. */
  ia?: EntradaIa | undefined;
  /** A situação de cada pendência na lista viva (etapa 5b), para a cópia comentada com o estado. */
  situacoes?: Record<string, MarcaPendencia> | undefined;
};

/** O aviso de andamento que o Worker manda antes da resposta (`WorkerLimitado.AvisoAndamento`). */
export type AndamentoTrabalhador = EtapaRevisaoPrevia;

export type RevisaoTrabalhador = Omit<RevisaoPrevia, "docx"> & { readonly docx: Uint8Array | null };

export type RespostaTrabalhador =
  | { ok: true; revisao: RevisaoTrabalhador }
  | { ok: false; arquivoInvalido: DadosErroDocx }
  | { ok: false; defeito: string };

const porta = NodeWorkerThreads.parentPort;
if (porta !== null)
  porta.once("message", (pedido: PedidoTrabalhador) => {
    let resposta: RespostaTrabalhador;
    try {
      const aoEtapa = (etapa: EtapaRevisaoPrevia) =>
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- porta de Worker, não janela
        porta.postMessage({ andamento: etapa } satisfies AvisoAndamento<AndamentoTrabalhador>);
      if (pedido.comentar) {
        const revisao = revisarDocx(pedido.bytes, pedido.nome, pedido.base, {
          agora: new Date(pedido.agora),
          cnct: pedido.cnct,
          forma: pedido.forma,
          ia: pedido.ia,
          situacoes: pedido.situacoes,
          aoEtapa,
        });
        porta.postMessage({ ok: true, revisao } satisfies RespostaTrabalhador, [revisao.docx.buffer as ArrayBuffer]);
        return;
      }
      const revisao = revisarDocxSemComentar(pedido.bytes, pedido.nome, pedido.base, {
        agora: new Date(pedido.agora),
        cnct: pedido.cnct,
        forma: pedido.forma,
        ia: pedido.ia,
        aoEtapa,
      });
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- porta de Worker, não janela
      porta.postMessage({ ok: true, revisao: { ...revisao, docx: null } } satisfies RespostaTrabalhador);
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
