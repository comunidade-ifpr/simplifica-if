/**
 * Tipos das linhas normativas gravadas no `kb.sqlite`: dispositivos, relações entre normas,
 * vigência em intervalos datados, regras de transição e tabelas de correspondência.
 *
 * As linhas são geradas em `normas/fontes-db.ts` pela API de `normas/` (parser de dispositivos,
 * `relacoes.yaml`, `statusEm`, `transicoes.yaml`, `correspondencias/`), já validadas na leitura
 * das fontes; a ordem de inserção é a ordem do iterável, que precisa ser estável para o banco sair
 * byte a byte igual. Nada aqui depende do relógio: a vigência entra como intervalos datados
 * (calculados por `statusEm` nas datas em que o status pode mudar), e a consulta escolhe a data.
 *
 * Os arquivos que a carga lê, além das normas em `base-conhecimento/normas/`,
 * estão em `ARQUIVOS_FONTES_NORMATIVAS`, para que a CLI recompile o banco quando eles mudarem.
 */
import { CAMINHOS } from "../caminhos.ts";
import type { TIPOS_DISPOSITIVO, TIPOS_NOTA } from "../normas/estrutura.ts";
import type { TipoRelacao } from "../normas/relacoes.ts";
import type { STATUS_VIGENCIA } from "../normas/vigencia.ts";

type TipoDispositivo = (typeof TIPOS_DISPOSITIVO)[number];
type TipoNota = (typeof TIPOS_NOTA)[number];
type StatusVigencia = (typeof STATUS_VIGENCIA)[number];

/** Dispositivo normativo (artigo, parágrafo, inciso, alínea, item, anexo, seção), as colunas de `Dispositivo`. */
export type LinhaDispositivo = {
  /** `br/cne-cp/res/2026/2#art28-vii` */
  readonly id: string;
  /** ID da norma. */
  readonly norma_id: string;
  /** `#art28-vii` */
  readonly dispositivo: string;
  readonly tipo: TipoDispositivo;
  /** Rótulo como no texto ("Art. 28", "VII", "§ 1º"). */
  readonly rotulo: string;
  /** ID completo do pai imediato, ou `null` no artigo, anexo e seção de primeiro nível. */
  readonly pai: string | null;
  /** Ordem no arquivo da norma (0, 1, 2…). */
  readonly ordem: number;
  /** Texto literal do próprio dispositivo (com o rótulo, sem os filhos), só a redação vigente. */
  readonly texto: string;
  /** Textos dos ancestrais, do artigo até o pai (o caput herdado). */
  readonly caput: readonly string[];
  /** `caput` e `texto`, uma linha cada: o que a busca indexa e o que se cita para um inciso isolado. */
  readonly texto_com_caput: string;
  /** Divisões estruturais (`TÍTULO V`, `CAPÍTULO III`...). */
  readonly estrutura: readonly string[];
  /** Notas de redação ("Redação dada pela Lei X"), com o tipo. */
  readonly notas: readonly { readonly tipo: TipoNota; readonly texto: string }[];
  readonly revogado: boolean;
  readonly vetado: boolean;
  /** Markdown, relativo à raiz do repositório. */
  readonly path: string;
  readonly linha_inicio: number;
  readonly linha_fim: number;
};

/** Relação tipada entre normas ou dispositivos (`relacoes.yaml`), uma por item do arquivo. */
export type LinhaRelacao = {
  /** Posição no arquivo (0, 1, 2…). */
  readonly ordem: number;
  readonly tipo: TipoRelacao;
  readonly origem: string;
  /** Dispositivo da origem que opera a relação (`#art74-ii`). */
  readonly operador: string | null;
  readonly alvo: string;
  readonly alvo_dispositivo: string | null;
  readonly alcance: string | null;
  /** Como no arquivo: `vigencia-da-origem` ou data. */
  readonly efeito_de: string;
  /** Data do efeito (`efeitoDaRelacao`), ou `null` quando a origem aguarda publicação. */
  readonly efeito_em: string | null;
  readonly evidencia_em: string;
  readonly evidencia_trecho: string;
  readonly confirmado_em: string | null;
  readonly proposta: "front-matter" | "regex" | "manual";
  readonly nota: string | null;
  readonly path: string;
};

/**
 * Intervalo de vigência de um ato (`intervalosVigencia`): o resultado de `statusEm` em qualquer data
 * de `de` (inclusivo; `null` = desde sempre) até `ate` (exclusivo; `null` = em aberto).
 */
export type LinhaVigencia = {
  readonly alvo: string;
  readonly ordem: number;
  readonly de: string | null;
  readonly ate: string | null;
  readonly status: StatusVigencia;
  /** O que abre o intervalo: `inicio`, `anterior` ou a relação (`revoga br/cne-cp/res/2026/2#art74-ii`). */
  readonly fonte: string;
};

/** Regra de transição (`transicoes.yaml`), com as datas resolvidas que não dependem da consulta. */
export type LinhaTransicao = {
  readonly id: string;
  readonly norma_id: string;
  readonly dispositivo: string;
  readonly tipo: string;
  /** Norma revogada cujos efeitos a regra preserva. */
  readonly norma_anterior: string | null;
  readonly aplica_a: string;
  readonly regra: string;
  /** Como no arquivo: `vigencia`, `publicacao` ou data. */
  readonly inicio: string;
  /** Como no arquivo: duração ISO, data ou `sem-prazo`. */
  readonly fim: string;
  readonly inicio_em: string | null;
  readonly fim_em: string | null;
  readonly evidencia: string;
  readonly path: string;
};

/** Tabela de correspondência entre normas sucessivas (`correspondencias/*.yaml`). */
export type LinhaTabelaCorrespondencia = {
  /** Arquivo, relativo à raiz do repositório. */
  readonly arquivo: string;
  readonly origem: string;
  readonly destino: string;
  readonly status: "rascunho" | "revisado";
  readonly elaborado_em: string | null;
  readonly revisado_por: string | null;
  readonly metodo: string;
};

/** Item de uma tabela de correspondência (dispositivo de origem → dispositivos de destino). */
export type LinhaCorrespondencia = {
  readonly tabela: string;
  readonly ordem: number;
  /** ID do ato com o dispositivo de origem (`br/cne-cp/res/2021/1#art20`). */
  readonly origem: string;
  readonly tipo: "equivalente" | "parcial" | "sem-equivalente";
  /** IDs dos dispositivos de destino (vazio em `sem-equivalente`). */
  readonly destino: readonly string[];
  readonly nota: string | null;
};

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
