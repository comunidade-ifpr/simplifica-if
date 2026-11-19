// @effect-diagnostics nodeBuiltinImport:off -- ponto de entrada do Worker: `worker_threads`
/**
 * O Worker da versão em texto dos anexos (`TextosAnexos.ts`): recebe os bytes de um `.docx`, roda
 * `docxParaMarkdown` (síncrono, com a árvore do XML na memória) e devolve o Markdown.
 *
 * Roda com `resourceLimits` e tempo máximo impostos por quem o cria (`WorkerLimitado.ts`); aqui só se
 * distingue o erro esperado (`ErroDocx`: arquivo protegido, corrompido, grande demais, sem texto), que
 * volta como os atributos (`DadosErroDocx`; quem criou o Worker monta a frase), do defeito.
 */
import * as NodeWorkerThreads from "node:worker_threads";
import { type DadosErroDocx, ErroDocx } from "@simplifica-if/docx/erro";
import { docxParaMarkdown } from "@simplifica-if/docx/markdown";

export type PedidoTexto = { bytes: Uint8Array };

export type RespostaTexto =
  | { ok: true; markdown: string }
  | { ok: false; arquivoInvalido: DadosErroDocx }
  | { ok: false; defeito: string };

const porta = NodeWorkerThreads.parentPort;
if (porta !== null)
  porta.once("message", (pedido: PedidoTexto) => {
    let resposta: RespostaTexto;
    try {
      resposta = { ok: true, markdown: docxParaMarkdown(pedido.bytes) };
    } catch (erro) {
      resposta =
        erro instanceof ErroDocx
          ? { ok: false, arquivoInvalido: erro.dados }
          : { ok: false, defeito: erro instanceof Error ? erro.message : String(erro) };
    }
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- porta de Worker, não janela
    porta.postMessage(resposta);
  });
