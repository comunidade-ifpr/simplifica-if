// @effect-diagnostics globalDate:off -- o relógio vem do pedido
/**
 * O trabalho do Worker da revisão prévia (`trabalhador.ts`), sem a porta: recebe um pedido, roda
 * `revisarDocx` (ou `revisarDocxSemComentar`, quando `comentar` é falso: pula `comentarDocx`,
 * `textosDeCaixas`, recompactação do ZIP e transferência de `ArrayBuffer`) e devolve a resposta.
 *
 * Aqui só se distingue o erro esperado (`ErroDocx`: arquivo protegido, corrompido, grande demais, sem
 * texto), que volta como o motivo e os atributos (`DadosErroDocx`; quem criou o Worker monta a frase), do
 * defeito.
 */
import { type DadosErroDocx, ErroDocx } from "@simplifica-if/docx/erro";
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

type RevisaoTrabalhador = Omit<RevisaoPrevia, "docx"> & { readonly docx: Uint8Array | null };

export type RespostaTrabalhador =
  | { ok: true; revisao: RevisaoTrabalhador }
  | { ok: false; arquivoInvalido: DadosErroDocx }
  | { ok: false; defeito: string };

/** A resposta ao pedido e o que vai sem cópia (o `.docx` comentado). */
export function atender(
  pedido: PedidoTrabalhador,
  aoEtapa: (etapa: AndamentoTrabalhador) => void,
): { readonly resposta: RespostaTrabalhador; readonly transferir: ReadonlyArray<ArrayBuffer> } {
  try {
    const opcoes = {
      agora: new Date(pedido.agora),
      cnct: pedido.cnct,
      forma: pedido.forma,
      ia: pedido.ia,
      aoEtapa,
    };
    if (pedido.comentar) {
      const revisao = revisarDocx(pedido.bytes, pedido.nome, pedido.base, { ...opcoes, situacoes: pedido.situacoes });
      return { resposta: { ok: true, revisao }, transferir: [revisao.docx.buffer as ArrayBuffer] };
    }
    const revisao = revisarDocxSemComentar(pedido.bytes, pedido.nome, pedido.base, opcoes);
    return { resposta: { ok: true, revisao: { ...revisao, docx: null } }, transferir: [] };
  } catch (erro) {
    const resposta: RespostaTrabalhador =
      erro instanceof ErroDocx
        ? { ok: false, arquivoInvalido: erro.dados }
        : { ok: false, defeito: erro instanceof Error ? erro.message : String(erro) };
    return { resposta, transferir: [] };
  }
}
