/**
 * Forma comum das ferramentas: nome, título, descrição (o texto que a IA lê para escolher a
 * ferramenta), schemas zod de entrada e de dados, anotações, o handler que devolve a `Resposta` e o
 * corpo do texto para a IA. O servidor registra a partir de `FERRAMENTAS` (index.ts); os testes e,
 * no Marco 1, a API HTTP do app chamam `responder` diretamente.
 */
import type { DatabaseSync } from "node:sqlite";
import type { ToolAnnotations } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { MetaBase } from "../banco.ts";
import { type Base, ErroEntrada, esquemaResposta, type Resposta } from "../envelope.ts";
import { montarTexto } from "../texto.ts";

export interface Contexto {
  db: DatabaseSync;
  meta: MetaBase;
  base: Base;
  /** Única pasta de onde o servidor lê arquivos (`pacote_contexto`, T4); caminho real e absoluto. */
  pastaTrabalho: string;
}

/** Só leitura e mundo fechado: nenhuma ferramenta escreve nem acessa a rede (decisão de desenho 2). */
export const ANOTACOES_LEITURA = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const satisfies ToolAnnotations;

export interface DefinicaoFerramenta<E extends z.ZodType, D extends z.ZodType> {
  /** Verbo e objeto, em português e `snake_case`. */
  nome: string;
  titulo: string;
  descricao: string;
  entrada: E;
  dados: D;
  executar(entrada: z.output<E>, ctx: Contexto): Resposta<z.output<D>>;
  /** Corpo do texto para a IA; avisos, paginação e rodapé vêm de `montarTexto`. */
  texto(resposta: Resposta<z.output<D>>): string;
}

export interface Ferramenta<
  E extends z.ZodType = z.ZodType,
  D extends z.ZodType = z.ZodType,
> extends DefinicaoFerramenta<E, D> {
  /** Schema da resposta inteira (envelope + dados): o `outputSchema` da ferramenta. */
  saida: z.ZodType;
  anotacoes: ToolAnnotations;
  /** Valida a entrada, executa e monta o texto. Entrada inválida gera `ErroEntrada`. */
  responder(args: unknown, ctx: Contexto): { resposta: Resposta<z.output<D>>; texto: string };
}

export function definirFerramenta<E extends z.ZodType, D extends z.ZodType>(
  definicao: DefinicaoFerramenta<E, D>,
): Ferramenta<E, D> {
  return {
    ...definicao,
    saida: esquemaResposta(definicao.dados),
    anotacoes: { title: definicao.titulo, ...ANOTACOES_LEITURA },
    responder(args, ctx) {
      const entrada = definicao.entrada.safeParse(args ?? {});
      if (!entrada.success) {
        throw new ErroEntrada(`entrada inválida para ${definicao.nome}:\n${z.prettifyError(entrada.error)}`);
      }
      const resposta = definicao.executar(entrada.data, ctx);
      return { resposta, texto: montarTexto(resposta, definicao.texto(resposta)) };
    },
  };
}
