/**
 * Domínio das matrizes curriculares do SUAP: o formato do relatório de coleta (`matrizes-suap/1`),
 * que a coleta grava fora do repositório e `scripts/aplicar_matrizes_suap.ts` aplica aqui, e a
 * consolidação das matrizes ativas, calculada só na aplicação.
 */
import * as Schema from "effect/Schema";

const SITUACOES_MATRIZES = [
  "Única ativa",
  "Múltiplas — mesma CH",
  "Múltiplas — CH divergentes",
  "Sem matriz ativa",
] as const;
export type SituacaoMatrizes = (typeof SITUACOES_MATRIZES)[number];

export const CRITERIO_COLETA =
  "Ativa=Sim; CH do cabeçalho da matriz, consolidada somente se todas as ativas concordam; " +
  "não presume matriz de ingresso vigente nem soma novamente estágio/extensão.";

const SEM_MATRIZ_ATIVA = "Nenhuma matriz marcada Ativa=Sim.";

/**
 * Matriz curricular como aparece no SUAP. Usa a mesma forma do relatório de coleta, que
 * `aplicar_matrizes_suap.ts` lê, por isso os nomes seguem o JSON. Só as matrizes ativas
 * trazem `url`, `carga_horaria_h` e `campos`.
 */
export const esquemaMatrizSuap = Schema.Struct({
  id: Schema.Int,
  ativa: Schema.Boolean,
  descricao: Schema.String,
  url: Schema.optionalKey(Schema.String),
  carga_horaria_h: Schema.optionalKey(Schema.Number),
  campos: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});
export type MatrizSuap = typeof esquemaMatrizSuap.Type;

/** Versão do formato do relatório; a aplicação recusa outra. */
export const ESQUEMA_RELATORIO_MATRIZES = "matrizes-suap/1";

/** Identidade do curso no relatório, conferida contra o registro antes de gravar. */
export const esquemaIdentidadeCursoSuap = Schema.Struct({
  /** Chave canônica `campus_id/curso_slug`. */
  curso_id: Schema.String,
  suap_id: Schema.Int,
  codigo: Schema.String,
});

/** Curso a coletar: a identidade e o que a coleta confere na página do SUAP (nome do campus). */
export const esquemaCursoParaColeta = Schema.Struct({
  ...esquemaIdentidadeCursoSuap.fields,
  nome: Schema.String,
  campus: Schema.String,
  forma: Schema.String,
});
export type CursoParaColeta = typeof esquemaCursoParaColeta.Type;

/** Um curso do relatório: a identidade e as matrizes como o SUAP as mostrou, sem derivação. */
export const esquemaCursoColetado = Schema.Struct({
  ...esquemaIdentidadeCursoSuap.fields,
  matrizes: Schema.Array(esquemaMatrizSuap),
});
export type CursoColetado = typeof esquemaCursoColetado.Type;

/** Relatório de coleta das matrizes (`matrizes-suap/1`), o contrato com a coleta de fora. */
export const esquemaRelatorioMatrizes = Schema.Struct({
  esquema: Schema.Literal(ESQUEMA_RELATORIO_MATRIZES),
  coletado_em: Schema.String,
  /** Cursos que falharam na coleta; a aplicação recusa relatório com algum. */
  erros: Schema.Array(Schema.Struct({ ...esquemaIdentidadeCursoSuap.fields, erro: Schema.String })),
  cursos: Schema.Array(esquemaCursoColetado),
});
export type RelatorioMatrizes = typeof esquemaRelatorioMatrizes.Type;

/** Derivação das matrizes ativas, calculada na aplicação e gravada no registro do curso. */
export interface ConsolidacaoMatrizes {
  readonly situacao: SituacaoMatrizes;
  /** Só existe quando todas as matrizes ativas têm a mesma carga horária. */
  readonly carga_horaria_comum_h: number | null;
}

export function consolidarMatrizes(matrizes: ReadonlyArray<MatrizSuap>): ConsolidacaoMatrizes {
  const ativas = matrizes.filter((matriz) => matriz.ativa);
  const cargas = new Set(ativas.map((matriz) => matriz.carga_horaria_h));
  const situacao: SituacaoMatrizes = !ativas.length
    ? "Sem matriz ativa"
    : ativas.length === 1
      ? "Única ativa"
      : cargas.size === 1
        ? "Múltiplas — mesma CH"
        : "Múltiplas — CH divergentes";
  const [unica] = cargas;
  return { situacao, carga_horaria_comum_h: cargas.size === 1 && unica !== undefined ? unica : null };
}

/**
 * O cabeçalho mostra a carga total como "Carga horária (1200h)". O SUAP não usa separador de
 * milhar ali, então a vírgula é sempre decimal.
 */
export function interpretarCargaHorariaCabecalho(texto: string): number | undefined {
  const valor = texto.match(/^Carga horária\s*\(([\d.,]+)h\)$/)?.[1];
  if (!valor) return undefined;
  const horas = Number(valor.replaceAll(",", "."));
  return Number.isFinite(horas) ? horas : undefined;
}

/** Número com até 6 algarismos significativos, sem zeros à direita: 1200.0 vira "1200". */
function formatarHoras(valor: number): string {
  return String(Number(valor.toPrecision(6)));
}

export function resumoMatrizesAtivas(matrizes: ReadonlyArray<MatrizSuap>): string {
  const linhas = matrizes
    .filter((matriz) => matriz.ativa)
    .map((matriz) => {
      const campos = matriz.campos ?? {};
      const estagio = campos["Exige estágio e afins"] ?? "não informado";
      const cargaEstagio = campos["Carga horária mínima"] ?? "não informada";
      return (
        `${matriz.id} — ${matriz.descricao} — CH exibida: ${formatarHoras(matriz.carga_horaria_h ?? 0)} h; ` +
        `estágio exigido: ${estagio}; CH mínima de estágio (separada): ${cargaEstagio}`
      );
    });
  return linhas.join("\n") || SEM_MATRIZ_ATIVA;
}

export function urlsMatrizesAtivas(matrizes: ReadonlyArray<MatrizSuap>): string[] {
  return matrizes.filter((matriz) => matriz.ativa).map((matriz) => matriz.url ?? "");
}
