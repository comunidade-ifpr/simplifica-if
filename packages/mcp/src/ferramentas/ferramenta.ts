/**
 * Forma comum das ferramentas: nome, título, descrição (o texto que a IA lê para escolher a
 * ferramenta), schemas de entrada e de dados, e o corpo do texto Markdown para a IA. Cada ferramenta
 * vira um `Tool` do `effect/ai`, só de leitura, idempotente e de mundo fechado (decisão de desenho
 * 2), com a `Resposta` inteira como sucesso e `ErroDeLeitura` como falha. A regra fica no serviço
 * `Leitura`; o texto, aqui.
 */
import * as Schema from "effect/Schema";
import { Tool } from "effect/ai";
import { ErroDeLeitura, Resposta } from "../contratos.ts";
import { montarTexto } from "../texto.ts";

export interface DefinicaoFerramenta<Nome extends string, E extends Schema.Top, D extends Schema.Top> {
  /** Verbo e objeto, em português e `snake_case`. */
  readonly nome: Nome;
  readonly titulo: string;
  readonly descricao: string;
  readonly entrada: E;
  readonly dados: D;
  /** Corpo do texto para a IA; avisos, paginação e rodapé vêm de `montarTexto`. */
  readonly texto: (resposta: Resposta<D["Type"]>) => string;
}

export function definirFerramenta<const Nome extends string, E extends Schema.Top, D extends Schema.Top>(
  definicao: DefinicaoFerramenta<Nome, E, D>,
) {
  const saida = Resposta(definicao.dados);
  const tool = Tool.make(definicao.nome, {
    description: definicao.descricao,
    parameters: definicao.entrada,
    success: saida,
    failure: ErroDeLeitura,
  })
    .annotate(Tool.Title, definicao.titulo)
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false);
  return {
    ...definicao,
    /** A resposta inteira (envelope + dados): o `outputSchema` da ferramenta. */
    saida,
    tool,
    /** O texto inteiro para a IA: avisos, corpo, paginação e rodapé. */
    textoCompleto: (resposta: Resposta<D["Type"]>) => montarTexto(resposta, definicao.texto(resposta)),
  };
}

/** Qualquer ferramenta definida aqui, para o registro e os testes. */
export type Ferramenta = ReturnType<typeof definirFerramenta<string, Schema.Top, Schema.Top>>;
