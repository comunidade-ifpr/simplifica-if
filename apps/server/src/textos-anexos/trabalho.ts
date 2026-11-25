/**
 * O trabalho do Worker da versão em texto dos anexos (`trabalhador.ts`), sem a porta: roda o conversor do
 * formato (`docxParaMarkdown` e `odtParaMarkdown`, síncronos, com a árvore do XML na memória;
 * `pdfParaMarkdown`, com o pdfjs na mesma thread) e devolve o Markdown.
 *
 * Aqui só se distingue o erro esperado (`ErroDocx`, `ErroPdf`: arquivo protegido, corrompido, grande
 * demais, sem texto), que volta como a frase para a pessoa (as funções de mensagem são puras), do defeito.
 */
import { ErroDocx, mensagemErroDocx } from "@simplifica-if/docx/erro";
import { docxParaMarkdown } from "@simplifica-if/docx/markdown";
import { odtParaMarkdown } from "@simplifica-if/docx/odt";
import { ErroPdf, mensagemErroPdf } from "@simplifica-if/pdf/erro";
import { pdfParaMarkdown } from "@simplifica-if/pdf/markdown";

/** Os formatos que o Worker converte (a extensão sem o ponto). */
export type FormatoTexto = "docx" | "odt" | "pdf";

export type PedidoTexto = { bytes: Uint8Array; formato: FormatoTexto };

export type RespostaTexto =
  | { ok: true; markdown: string }
  | { ok: false; arquivoInvalido: string }
  | { ok: false; defeito: string };

const converter = (pedido: PedidoTexto): string | Promise<string> => {
  switch (pedido.formato) {
    case "docx":
      return docxParaMarkdown(pedido.bytes);
    case "odt":
      return odtParaMarkdown(pedido.bytes);
    case "pdf":
      return pdfParaMarkdown(pedido.bytes);
  }
};

export const atender = async (pedido: PedidoTexto): Promise<RespostaTexto> => {
  try {
    return { ok: true, markdown: await converter(pedido) };
  } catch (erro) {
    if (erro instanceof ErroDocx) return { ok: false, arquivoInvalido: mensagemErroDocx(erro.dados) };
    if (erro instanceof ErroPdf) return { ok: false, arquivoInvalido: mensagemErroPdf(erro.dados) };
    return { ok: false, defeito: erro instanceof Error ? erro.message : String(erro) };
  }
};
