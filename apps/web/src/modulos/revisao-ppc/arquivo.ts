/**
 * O arquivo do PPC vindo do desktop (escolhido no diálogo ou solto na janela) e o pedido do servidor
 * para escolher o mesmo arquivo de novo: o desktop libera cada arquivo só até o app fechar, e uma ação
 * que precisa reler o arquivo depois disso recusa com `escolherDeNovo`.
 */
import { explicarErro, type MensagemErro } from "../../conexao/erros.ts";
import { nomeDoArquivo } from "../../lib/texto.ts";

export type ArquivoDoDesktop = { readonly arquivo: string } | { readonly erro: MensagemErro } | undefined;

/**
 * Obtém o arquivo pela ponte. `null` é a recusa do desktop (`seRecusado`, como o arquivo solto que não é
 * `.docx`) ou, sem `seRecusado`, a pessoa que fechou o diálogo: nada a fazer. Um erro da ponte é outra
 * coisa, e a frase não culpa o arquivo.
 */
export async function obterArquivo(
  obter: () => Promise<string | null>,
  seRecusado?: MensagemErro,
): Promise<ArquivoDoDesktop> {
  try {
    const arquivo = await obter();
    if (arquivo !== null) return { arquivo };
    return seRecusado === undefined ? undefined : { erro: seRecusado };
  } catch (motivo) {
    const explicado = explicarErro(motivo);
    return {
      erro: { texto: "Não foi possível usar o arquivo. Tente de novo.", detalhe: explicado.detalhe ?? explicado.texto },
    };
  }
}

/** O servidor pede o mesmo arquivo de novo (`FalhaRevisaoPpc` com `escolherDeNovo`). */
export function pedeArquivoDeNovo(erro: unknown): boolean {
  if (typeof erro !== "object" || erro === null) return false;
  const falha = erro as { readonly _tag?: unknown; readonly escolherDeNovo?: unknown };
  return falha._tag === "FalhaRevisaoPpc" && falha.escolherDeNovo === true;
}

/** A pessoa escolheu outro arquivo quando o app pedia o mesmo. */
export const textoMesmoArquivo = (arquivo: string): MensagemErro => ({
  texto: `Escolha o mesmo arquivo, “${nomeDoArquivo(arquivo)}”. Para revisar outro arquivo, use “Revisar outro arquivo”.`,
});
