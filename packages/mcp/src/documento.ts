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

/**
 * Um item do sumário da norma (`@simplifica-if/kb/normas/sumario`): uma divisão (Título, Capítulo,
 * Seção), um anexo ou um tópico do arquivo, para o índice de navegação do leitor.
 */
export const ItemSumario = Schema.Struct({
  tipo: Schema.Literals(["livro", "parte", "titulo", "capitulo", "secao", "subsecao", "anexo", "topico"]),
  /** O rótulo como está no texto: `TÍTULO III`, `Seção I`; no tópico, o cabeçalho inteiro. */
  rotulo: Schema.String,
  /** O nome da divisão (`DO ACESSO, DA PERMANÊNCIA E DO ÊXITO`); `null` se o texto não traz. */
  nome: Schema.NullOr(Schema.String),
  /** O nível no índice, desde 0. */
  nivel: Schema.Int,
  /** A linha do cabeçalho no arquivo, desde 1. */
  linha: Linha,
  /** A linha do último cabeçalho do item (a do nome, quando ele vem em cabeçalho próprio). */
  linha_fim: Linha,
  /** O primeiro e o último artigo da divisão (`14`, `36-A`); `null` sem artigos. */
  artigos: Schema.NullOr(Schema.Struct({ primeiro: Schema.String, ultimo: Schema.String })),
});
export type ItemSumario = typeof ItemSumario.Type;

/**
 * As datas do ato, do front matter da norma, como estão (`AAAA-MM-DD`, "a confirmar" ou "aguardando
 * publicação"); `null` no
 * campo que a norma não registra. O PPC não tem.
 */
export const DatasDoAto = Schema.Struct({
  assinada_em: Schema.NullOr(Schema.String),
  publicada_em: Schema.NullOr(Schema.String),
  vigente_de: Schema.NullOr(Schema.String),
});
export type DatasDoAto = typeof DatasDoAto.Type;

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
  /** O sumário da norma, na ordem do documento; vazio no PPC (as seções dele são as âncoras). */
  sumario: Schema.Array(ItemSumario),
  /** O fragmento do link pedido, se ele é uma das âncoras; `null` sem fragmento ou se não achou. */
  alvo: Schema.NullOr(Schema.String),
  /** As datas do ato (assinatura, publicação, início de vigência); `null` no PPC. */
  datas: Schema.NullOr(DatasDoAto),
});
export type DadosDocumento = typeof DadosDocumento.Type;

/** A resposta inteira (envelope + dados): o contrato do RPC `lerDocumento`. */
export const SaidaDocumento = Resposta(DadosDocumento);
