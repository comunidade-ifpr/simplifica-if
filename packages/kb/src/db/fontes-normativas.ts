/**
 * Ponto de carga das entidades normativas da fase 5 no `kb.sqlite`: dispositivos, relações entre
 * normas, vigência em intervalos datados, regras de transição e tabelas de correspondência.
 *
 * A implementação é `fontesNormativasArquivos` (`normas/fontes-db.ts`), que lê pelos módulos de
 * `normas/` (parser de dispositivos, `relacoes.yaml`, `statusEm`, `transicoes.yaml`,
 * `correspondencias/`); `compilarBanco` a usa por padrão. Cada linha é validada pelo esquema zod
 * abaixo antes do INSERT; a ordem de inserção é a ordem do iterável, que precisa ser estável para o
 * banco sair byte a byte igual. Nada aqui depende do relógio: a vigência entra como intervalos
 * datados (calculados por `statusEm` nas datas em que o status pode mudar), e a consulta escolhe a
 * data.
 *
 * Os arquivos que a carga lê, além das normas em `base-conhecimento/normas/` e do `manifest.json`,
 * estão em `ARQUIVOS_FONTES_NORMATIVAS`, para que a CLI recompile o banco quando eles mudarem.
 */
import { z } from "zod";
import { TIPOS_DISPOSITIVO, TIPOS_NOTA } from "../normas/estrutura.ts";
import { STATUS_VIGENCIA } from "../normas/vigencia.ts";

const id = z.string().min(1);
const opcional = z.string().min(1).nullable();
const data = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();
const linha = z.number().int().positive();

/** Dispositivo normativo (artigo, parágrafo, inciso, alínea, item, anexo, seção), as colunas de `Dispositivo`. */
export const esquemaLinhaDispositivo = z.strictObject({
  /** ID do arquivo: `br/cne-cp/res/2026/2#art28-vii` (ou `br/lei/1996/9394~compilacao#art36`). */
  id,
  /** ID do ato (sem variante). */
  ato_id: id,
  /** ID do arquivo (com variante, se houver). */
  norma_id: id,
  /** `#art28-vii` */
  dispositivo: id,
  tipo: z.enum(TIPOS_DISPOSITIVO),
  /** Rótulo como no texto ("Art. 28", "VII", "§ 1º"). */
  rotulo: z.string(),
  /** ID completo do pai imediato, ou `null` no artigo, anexo e seção de primeiro nível. */
  pai: opcional,
  /** Ordem no arquivo da norma (0, 1, 2…). */
  ordem: z.number().int().nonnegative(),
  /** Texto literal do próprio dispositivo (com o rótulo, sem os filhos), só a redação vigente. */
  texto: z.string(),
  /** Textos dos ancestrais, do artigo até o pai (o caput herdado). */
  caput: z.array(z.string()),
  /** `caput` e `texto`, uma linha cada: o que a busca indexa e o que se cita para um inciso isolado. */
  texto_com_caput: z.string(),
  /** Divisões estruturais (`TÍTULO V`, `CAPÍTULO III`...). */
  estrutura: z.array(z.string()),
  /** Notas de redação ("Redação dada pela Lei X"), com o tipo. */
  notas: z.array(z.strictObject({ tipo: z.enum(TIPOS_NOTA), texto: z.string() })),
  revogado: z.boolean(),
  vetado: z.boolean(),
  /** Este é o dispositivo do índice do ato (`indiceDispositivos`): o texto integral prevalece sobre a compilação. */
  canonico: z.boolean(),
  /** Markdown, relativo à raiz do repositório. */
  path: z.string(),
  linha_inicio: linha,
  linha_fim: linha,
});
export type LinhaDispositivo = z.output<typeof esquemaLinhaDispositivo>;

/** Relação tipada entre normas ou dispositivos (`relacoes.yaml`), uma por item do arquivo. */
export const esquemaLinhaRelacao = z.strictObject({
  /** Posição no arquivo (0, 1, 2…). */
  ordem: z.number().int().nonnegative(),
  tipo: z.enum(["revoga", "altera", "regulamenta", "fundamenta-se-em"]),
  origem: id,
  /** Dispositivo da origem que opera a relação (`#art74-ii`). */
  operador: opcional,
  alvo: id,
  alvo_dispositivo: opcional,
  alcance: opcional,
  /** Como no arquivo: `vigencia-da-origem` ou data. */
  efeito_de: z.string().min(1),
  /** Data do efeito (`efeitoDaRelacao`), ou `null` quando depende de data a confirmar. */
  efeito_em: data,
  /** Limite inferior do efeito quando a data não é certa. */
  efeito_minimo: data,
  evidencia_em: id,
  evidencia_trecho: z.string().min(1),
  confirmado_em: data,
  proposta: z.enum(["front-matter", "regex", "manual"]),
  nota: opcional,
  path: z.string(),
});
export type LinhaRelacao = z.output<typeof esquemaLinhaRelacao>;

/**
 * Intervalo de vigência de um ato (`intervalosVigencia`): o resultado de `statusEm` em qualquer data
 * de `de` (inclusivo; `null` = desde sempre) até `ate` (exclusivo; `null` = em aberto).
 */
export const esquemaLinhaVigencia = z.strictObject({
  alvo: id,
  ordem: z.number().int().nonnegative(),
  de: data,
  ate: data,
  status: z.enum(STATUS_VIGENCIA),
  /** `false` quando o status depende de data a confirmar. */
  certo: z.boolean(),
  /** O que abre o intervalo: `inicio`, `anterior` ou a relação (`revoga br/cne-cp/res/2026/2#art74-ii`). */
  fonte: z.string(),
});
export type LinhaVigencia = z.output<typeof esquemaLinhaVigencia>;

/** Regra de transição (`transicoes.yaml`), com as datas resolvidas que não dependem da consulta. */
export const esquemaLinhaTransicao = z.strictObject({
  id,
  norma_id: id,
  dispositivo: id,
  tipo: z.string().min(1),
  /** Norma revogada cujos efeitos a regra preserva. */
  norma_anterior: opcional,
  aplica_a: z.string(),
  regra: z.string(),
  /** Como no arquivo: `vigencia`, `publicacao` ou data. */
  inicio: z.string().min(1),
  /** Como no arquivo: duração ISO, data ou `sem-prazo`. */
  fim: z.string().min(1),
  inicio_em: data,
  inicio_minimo: data,
  fim_em: data,
  evidencia: z.string(),
  path: z.string(),
});
export type LinhaTransicao = z.output<typeof esquemaLinhaTransicao>;

/** Tabela de correspondência entre normas sucessivas (`correspondencias/*.yaml`). */
export const esquemaLinhaTabelaCorrespondencia = z.strictObject({
  /** Arquivo, relativo à raiz do repositório. */
  arquivo: z.string(),
  origem: id,
  destino: id,
  status: z.enum(["rascunho", "revisado"]),
  elaborado_em: data,
  revisado_por: opcional,
  metodo: z.string(),
});
export type LinhaTabelaCorrespondencia = z.output<typeof esquemaLinhaTabelaCorrespondencia>;

/** Item de uma tabela de correspondência (dispositivo de origem → dispositivos de destino). */
export const esquemaLinhaCorrespondencia = z.strictObject({
  tabela: z.string(),
  ordem: z.number().int().nonnegative(),
  /** ID do ato com o dispositivo de origem (`br/cne-cp/res/2021/1#art20`). */
  origem: id,
  tipo: z.enum(["equivalente", "parcial", "sem-equivalente"]),
  /** IDs dos dispositivos de destino (vazio em `sem-equivalente`). */
  destino: z.array(id),
  nota: opcional,
});
export type LinhaCorrespondencia = z.output<typeof esquemaLinhaCorrespondencia>;

/** O que a fase 5 entrega ao compilador. Cada método é chamado uma vez por compilação. */
export interface FontesNormativas {
  dispositivos(): Iterable<LinhaDispositivo>;
  relacoes(): Iterable<LinhaRelacao>;
  vigencias(): Iterable<LinhaVigencia>;
  transicoes(): Iterable<LinhaTransicao>;
  tabelasCorrespondencia(): Iterable<LinhaTabelaCorrespondencia>;
  correspondencias(): Iterable<LinhaCorrespondencia>;
}

/**
 * Arquivos e diretórios (relativos à raiz do repositório) que a carga da fase 5 lê, além das normas
 * em `base-conhecimento/normas/` e do `manifest.json`, que já são fonte do banco. Entram na
 * impressão digital das fontes (`fontes.ts`).
 */
export const ARQUIVOS_FONTES_NORMATIVAS: readonly string[] = [
  "base-conhecimento/config/vigencia.yaml",
  "base-conhecimento/correspondencias",
  "base-conhecimento/normas/stubs.yaml",
  "base-conhecimento/relacoes.yaml",
  "base-conhecimento/transicoes.yaml",
];
