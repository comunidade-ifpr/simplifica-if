/**
 * O que vai à caixa da conversa que continua outra com outra IA (`docs/plans/multitarefa.md`, "Limite da
 * assinatura"): as fichas que o servidor devolve (o histórico da antiga e as da última mensagem) como
 * fichas da caixa, à vista e removíveis, e a última pergunta escrita, sem enviar.
 */
import type { Continuacao, FichaContexto } from "@simplifica-if/contratos-app";
import type { FichaRascunho } from "../painel/ControlePainel.ts";

/** A caixa da conversa nova: o texto e as fichas. */
export interface RascunhoConversa {
  readonly texto: string;
  readonly fichas: ReadonlyArray<FichaRascunho>;
}

const TIPOS: Readonly<Record<FichaContexto["_tag"], FichaRascunho["tipo"]>> = {
  link: "documento",
  arquivo: "arquivo",
  texto: "trecho",
};

/** As fichas e a pergunta da continuação, como a caixa as mostra. */
export function rascunhoDaContinuacao(continuacao: Continuacao): RascunhoConversa {
  return {
    texto: continuacao.pergunta,
    fichas: continuacao.fichas.map((ficha, indice) => ({
      chave: `continuacao-${indice}`,
      rotulo: ficha.rotulo,
      tipo: TIPOS[ficha._tag],
      tirar: `Tirar “${ficha.rotulo}” do contexto`,
      ...(ficha.texto === undefined ? {} : { detalhe: ficha.texto }),
      ficha,
    })),
  };
}
