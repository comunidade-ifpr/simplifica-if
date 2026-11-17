/**
 * O documento inteiro de uma norma ou de um PPC, para o leitor `ifpr://` do app (M1.6): o Markdown do
 * arquivo e as âncoras (os dispositivos da norma ou as seções do índice do PPC), com as linhas. O
 * leitor gera o HTML na hora a partir desse Markdown (decisão de 16/11/2026: o Markdown é a fonte
 * única; HTML não se grava na base). Não é ferramenta MCP: o texto inteiro não cabe no orçamento da IA,
 * que lê os trechos por `ler_dispositivos` e `ler_secao`.
 *
 * Só schemas: este módulo entra no grafo do `grupo-leitura.ts`, que a interface importa, e não pode
 * importar o `kb` nem módulos do Node. A leitura fica em `leitura/documentos.ts`.
 */
import * as Schema from "effect/Schema";
import { EsquemaLink, Resposta } from "./contratos.ts";

/** A entrada de `lerDocumento`: um link `ifpr://norma/…` ou `ifpr://ppc/…`, com ou sem fragmento. */
export const EntradaDocumento = Schema.Struct({ link: Schema.String });

const Linha = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/** Um ponto do documento a que um link leva: um dispositivo (`art28-xviii`) ou uma seção do PPC. */
export const Ancora = Schema.Struct({
  /** O fragmento do link, sem `#`: `art28-xviii`, `identificacao-1`. É o `id` do elemento no HTML. */
  id: Schema.String,
  /** Rótulo do dispositivo (`Art. 28`, `XVIII`) ou título da seção. */
  rotulo: Schema.String,
  /** `artigo`, `paragrafo`, `inciso`… ou o tipo da seção do PPC (`estagio_praticas`). */
  tipo: Schema.String,
  /** O fragmento do dispositivo pai; `null` no artigo, no anexo e nas seções. */
  pai: Schema.NullOr(Schema.String),
  /** As linhas do próprio dispositivo (sem os filhos) ou da seção, no arquivo, desde 1. */
  linha_inicio: Linha,
  linha_fim: Linha,
  revogado: Schema.Boolean,
});
export type Ancora = typeof Ancora.Type;

export const DadosDocumento = Schema.Struct({
  tipo: Schema.Literals(["norma", "ppc"]),
  /** O ID da norma (`br/cne-cp/res/2026/2`) ou a chave do PPC (`curitiba/tecnico-em-enfermagem`). */
  id: Schema.String,
  /** O título da norma ou o nome do curso do PPC. */
  titulo: Schema.String,
  /** O link do documento, sem fragmento. */
  link: EsquemaLink,
  /** O arquivo no repositório de origem. */
  path: Schema.String,
  /**
   * O Markdown do arquivo, com o front matter trocado por linhas em branco: a linha N do texto é a
   * linha N do arquivo, a mesma das âncoras.
   */
  markdown: Schema.String,
  /** Na ordem do documento. */
  ancoras: Schema.Array(Ancora),
  /** O fragmento do link pedido, se ele é uma das âncoras; `null` sem fragmento ou se não achou. */
  alvo: Schema.NullOr(Schema.String),
});
export type DadosDocumento = typeof DadosDocumento.Type;

/** A resposta inteira (envelope + dados): o contrato do RPC `lerDocumento`. */
export const SaidaDocumento = Resposta(DadosDocumento);
