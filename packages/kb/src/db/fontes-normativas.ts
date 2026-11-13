/**
 * Ponto de carga das entidades normativas da fase 5 no `kb.sqlite`: dispositivos, relações entre
 * normas, vigência calculada, regras de transição e correspondência entre normas.
 *
 * A fase 6 cria as tabelas e a carga; a fase 5 (parser de dispositivos, `relacoes.yaml`, vigência,
 * transições e correspondência 2021 → 2026, em `packages/kb/src/normas/`) fornece os dados por esta
 * interface. Por ora a compilação usa `fontesNormativasVazias`, e as tabelas ficam vazias.
 *
 * Para ligar a fase 5: implemente `FontesNormativas` (por exemplo, em `normas/fontes-db.ts`) e passe
 * a implementação a `compilarBanco({ fontesNormativas })`, ou troque o padrão em `compilar.ts`
 * (`fontesNormativasPadrao`). Cada linha é validada pelo esquema zod abaixo antes do INSERT; a ordem
 * de inserção é a ordem do iterável, que precisa ser estável (ordene por ID) para o banco sair
 * byte a byte igual. Nada aqui pode depender do relógio: a vigência entra como intervalos datados,
 * e a consulta escolhe a data (`kb vigencia --em <data>`).
 *
 * Arquivos que a fase 5 vier a ler (como `base-conhecimento/relacoes.yaml`) devem entrar em
 * `ARQUIVOS_FONTES_NORMATIVAS`, para que a CLI recompile o banco quando eles mudarem.
 */
import { z } from "zod";

const id = z.string().min(1);
const opcional = z.string().min(1).nullable();
const data = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

/** Dispositivo normativo (artigo, parágrafo, inciso, alínea, item), com o caput herdado. */
export const esquemaLinhaDispositivo = z.strictObject({
  /** `br/cne-cp/res/2026/2#art28-vii` */
  id,
  norma_id: id,
  /** `#art28-vii` */
  dispositivo: id,
  /** `#art28` (o pai imediato), ou `null` no artigo. */
  pai: opcional,
  /** Ordem no texto da norma (0, 1, 2…). */
  ordem: z.number().int().nonnegative(),
  /** Rótulo como no texto ("Art. 28", "VII", "§ 1º"). */
  rotulo: z.string(),
  /** Texto literal do dispositivo, só a redação vigente. */
  texto: z.string(),
  /** Texto com o caput dos ancestrais (para busca e para citar inciso isolado). */
  texto_com_caput: z.string(),
  path: z.string(),
  linha_inicio: z.number().int().positive(),
  linha_fim: z.number().int().positive(),
  /** Notas de redação ("Redação dada pela Lei X"), como JSON (lista de textos). */
  notas: z.array(z.string()),
});
export type LinhaDispositivo = z.output<typeof esquemaLinhaDispositivo>;

/** Relação tipada e datada entre normas ou dispositivos (`relacoes.yaml`). */
export const esquemaLinhaRelacao = z.strictObject({
  origem: id,
  alvo: id,
  tipo: z.enum(["revoga", "altera", "regulamenta", "fundamenta-se-em"]),
  /** Data em que o efeito começa. */
  efeito_de: data,
  /** Dispositivo da origem que opera a relação (`#art74`). */
  dispositivo_operador: opcional,
  curadoria: z.enum(["proposta", "conferida"]),
  fonte: opcional,
});
export type LinhaRelacao = z.output<typeof esquemaLinhaRelacao>;

/** Intervalo de vigência de uma norma ou dispositivo (fim exclusivo; `null` = aberto). */
export const esquemaLinhaVigencia = z.strictObject({
  alvo: id,
  vigente_de: data,
  vigente_ate: data,
  /** Relação ou dado que determina o intervalo. */
  fonte: z.string(),
});
export type LinhaVigencia = z.output<typeof esquemaLinhaVigencia>;

/** Regra de transição como dado (art. 70 e 71 da Res. CNE/CP nº 2/2026, por exemplo). */
export const esquemaLinhaTransicao = z.strictObject({
  id,
  norma_id: id,
  dispositivo: opcional,
  descricao: z.string(),
  inicio: data,
  fim: data,
  aplica_a: z.string(),
});
export type LinhaTransicao = z.output<typeof esquemaLinhaTransicao>;

/** Correspondência entre dispositivos de normas sucessivas (1/2021 → 2/2026). */
export const esquemaLinhaCorrespondencia = z.strictObject({
  origem: id,
  alvo: opcional,
  tipo: z.enum(["equivalente", "parcial", "sem-equivalente"]),
  nota: opcional,
  curadoria: z.enum(["proposta", "conferida"]),
});
export type LinhaCorrespondencia = z.output<typeof esquemaLinhaCorrespondencia>;

/** O que a fase 5 entrega ao compilador. Cada método é chamado uma vez por compilação. */
export interface FontesNormativas {
  dispositivos(): Iterable<LinhaDispositivo>;
  relacoes(): Iterable<LinhaRelacao>;
  vigencias(): Iterable<LinhaVigencia>;
  transicoes(): Iterable<LinhaTransicao>;
  correspondencias(): Iterable<LinhaCorrespondencia>;
}

/** Fontes vazias: as tabelas da fase 5 existem, sem linhas. */
export const fontesNormativasVazias: FontesNormativas = {
  dispositivos: () => [],
  relacoes: () => [],
  vigencias: () => [],
  transicoes: () => [],
  correspondencias: () => [],
};

/**
 * Arquivos (relativos à raiz do repositório) que a implementação da fase 5 lê, além das normas em
 * `base-conhecimento/normas/`, que já são fonte do banco. Entram na impressão digital das fontes.
 */
export const ARQUIVOS_FONTES_NORMATIVAS: readonly string[] = ["base-conhecimento/relacoes.yaml"];
