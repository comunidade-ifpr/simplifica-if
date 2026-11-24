/**
 * Esquemas das linhas normativas gravadas no `kb.sqlite`: dispositivos, relações entre normas,
 * vigência em intervalos datados, regras de transição e tabelas de correspondência.
 *
 * As linhas são geradas em `normas/fontes-db.ts` pela API de `normas/` (parser de dispositivos,
 * `relacoes.yaml`, `statusEm`, `transicoes.yaml`, `correspondencias/`). Cada linha é validada pelo
 * esquema abaixo (Effect Schema, sem chaves extras) antes do INSERT; a ordem de inserção é a ordem
 * do iterável, que precisa ser estável para o banco sair byte a byte igual. Nada aqui depende do
 * relógio: a vigência entra como intervalos datados (calculados por `statusEm` nas datas em que o
 * status pode mudar), e a consulta escolhe a data.
 *
 * Os arquivos que a carga lê, além das normas em `base-conhecimento/normas/`,
 * estão em `ARQUIVOS_FONTES_NORMATIVAS`, para que a CLI recompile o banco quando eles mudarem.
 */
import * as Schema from "effect/Schema";
import { CAMINHOS } from "../caminhos.ts";
import { TIPOS_DISPOSITIVO, TIPOS_NOTA } from "../normas/estrutura.ts";
import { STATUS_VIGENCIA } from "../normas/vigencia.ts";

const naoVazio = Schema.String.check(Schema.isMinLength(1));
const id = naoVazio;
const opcional = Schema.NullOr(naoVazio);
const data = Schema.NullOr(Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)));
const linha = Schema.Int.check(Schema.isGreaterThan(0));
const ordem = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** Dispositivo normativo (artigo, parágrafo, inciso, alínea, item, anexo, seção), as colunas de `Dispositivo`. */
export const esquemaLinhaDispositivo = Schema.Struct({
  /** `br/cne-cp/res/2026/2#art28-vii` */
  id,
  /** ID da norma. */
  norma_id: id,
  /** `#art28-vii` */
  dispositivo: id,
  tipo: Schema.Literals(TIPOS_DISPOSITIVO),
  /** Rótulo como no texto ("Art. 28", "VII", "§ 1º"). */
  rotulo: Schema.String,
  /** ID completo do pai imediato, ou `null` no artigo, anexo e seção de primeiro nível. */
  pai: opcional,
  /** Ordem no arquivo da norma (0, 1, 2…). */
  ordem,
  /** Texto literal do próprio dispositivo (com o rótulo, sem os filhos), só a redação vigente. */
  texto: Schema.String,
  /** Textos dos ancestrais, do artigo até o pai (o caput herdado). */
  caput: Schema.Array(Schema.String),
  /** `caput` e `texto`, uma linha cada: o que a busca indexa e o que se cita para um inciso isolado. */
  texto_com_caput: Schema.String,
  /** Divisões estruturais (`TÍTULO V`, `CAPÍTULO III`...). */
  estrutura: Schema.Array(Schema.String),
  /** Notas de redação ("Redação dada pela Lei X"), com o tipo. */
  notas: Schema.Array(Schema.Struct({ tipo: Schema.Literals(TIPOS_NOTA), texto: Schema.String })),
  revogado: Schema.Boolean,
  vetado: Schema.Boolean,
  /** Markdown, relativo à raiz do repositório. */
  path: Schema.String,
  linha_inicio: linha,
  linha_fim: linha,
});
export type LinhaDispositivo = typeof esquemaLinhaDispositivo.Type;

/** Relação tipada entre normas ou dispositivos (`relacoes.yaml`), uma por item do arquivo. */
export const esquemaLinhaRelacao = Schema.Struct({
  /** Posição no arquivo (0, 1, 2…). */
  ordem,
  tipo: Schema.Literals(["revoga", "altera", "regulamenta", "fundamenta-se-em"]),
  origem: id,
  /** Dispositivo da origem que opera a relação (`#art74-ii`). */
  operador: opcional,
  alvo: id,
  alvo_dispositivo: opcional,
  alcance: opcional,
  /** Como no arquivo: `vigencia-da-origem` ou data. */
  efeito_de: naoVazio,
  /** Data do efeito (`efeitoDaRelacao`), ou `null` quando a origem aguarda publicação. */
  efeito_em: data,
  evidencia_em: id,
  evidencia_trecho: naoVazio,
  confirmado_em: data,
  proposta: Schema.Literals(["front-matter", "regex", "manual"]),
  nota: opcional,
  path: Schema.String,
});
export type LinhaRelacao = typeof esquemaLinhaRelacao.Type;

/**
 * Intervalo de vigência de um ato (`intervalosVigencia`): o resultado de `statusEm` em qualquer data
 * de `de` (inclusivo; `null` = desde sempre) até `ate` (exclusivo; `null` = em aberto).
 */
export const esquemaLinhaVigencia = Schema.Struct({
  alvo: id,
  ordem,
  de: data,
  ate: data,
  status: Schema.Literals(STATUS_VIGENCIA),
  /** O que abre o intervalo: `inicio`, `anterior` ou a relação (`revoga br/cne-cp/res/2026/2#art74-ii`). */
  fonte: Schema.String,
});
export type LinhaVigencia = typeof esquemaLinhaVigencia.Type;

/** Regra de transição (`transicoes.yaml`), com as datas resolvidas que não dependem da consulta. */
export const esquemaLinhaTransicao = Schema.Struct({
  id,
  norma_id: id,
  dispositivo: id,
  tipo: naoVazio,
  /** Norma revogada cujos efeitos a regra preserva. */
  norma_anterior: opcional,
  aplica_a: Schema.String,
  regra: Schema.String,
  /** Como no arquivo: `vigencia`, `publicacao` ou data. */
  inicio: naoVazio,
  /** Como no arquivo: duração ISO, data ou `sem-prazo`. */
  fim: naoVazio,
  inicio_em: data,
  fim_em: data,
  evidencia: Schema.String,
  path: Schema.String,
});
export type LinhaTransicao = typeof esquemaLinhaTransicao.Type;

/** Tabela de correspondência entre normas sucessivas (`correspondencias/*.yaml`). */
export const esquemaLinhaTabelaCorrespondencia = Schema.Struct({
  /** Arquivo, relativo à raiz do repositório. */
  arquivo: Schema.String,
  origem: id,
  destino: id,
  status: Schema.Literals(["rascunho", "revisado"]),
  elaborado_em: data,
  revisado_por: opcional,
  metodo: Schema.String,
});
export type LinhaTabelaCorrespondencia = typeof esquemaLinhaTabelaCorrespondencia.Type;

/** Item de uma tabela de correspondência (dispositivo de origem → dispositivos de destino). */
export const esquemaLinhaCorrespondencia = Schema.Struct({
  tabela: Schema.String,
  ordem,
  /** ID do ato com o dispositivo de origem (`br/cne-cp/res/2021/1#art20`). */
  origem: id,
  tipo: Schema.Literals(["equivalente", "parcial", "sem-equivalente"]),
  /** IDs dos dispositivos de destino (vazio em `sem-equivalente`). */
  destino: Schema.Array(id),
  nota: opcional,
});
export type LinhaCorrespondencia = typeof esquemaLinhaCorrespondencia.Type;

/**
 * Arquivos e diretórios (relativos à raiz do repositório) que a carga das tabelas normativas lê,
 * além das normas em `base-conhecimento/normas/`, que já são fonte do banco. Entram na impressão
 * digital das fontes (`fontes.ts`).
 */
export const ARQUIVOS_FONTES_NORMATIVAS: readonly string[] = [
  CAMINHOS.configVigencia,
  CAMINHOS.correspondencias,
  CAMINHOS.stubs,
  CAMINHOS.relacoes,
  CAMINHOS.transicoes,
];
