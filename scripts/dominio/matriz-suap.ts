import * as Schema from "effect/Schema";

export const SITUACOES_MATRIZES = [
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

export const esquemaSituacaoMatrizes = Schema.Literals(SITUACOES_MATRIZES);

/**
 * Matriz curricular como aparece no SUAP. Usa a mesma forma do relatório gravado em disco,
 * que `--apply-report` lê de volta, por isso os nomes seguem o JSON. Só as matrizes ativas
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

export const esquemaConsolidacaoMatrizes = Schema.Struct({
  situacao: esquemaSituacaoMatrizes,
  /** Só existe quando todas as matrizes ativas têm a mesma carga horária. */
  carga_horaria_comum_h: Schema.NullOr(Schema.Number),
});
export type ConsolidacaoMatrizes = typeof esquemaConsolidacaoMatrizes.Type;

export function consolidarMatrizes(matrizes: MatrizSuap[]): ConsolidacaoMatrizes {
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

export function resumoMatrizesAtivas(matrizes: MatrizSuap[]): string {
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

export function urlsMatrizesAtivas(matrizes: MatrizSuap[]): string[] {
  return matrizes.filter((matriz) => matriz.ativa).map((matriz) => matriz.url ?? "");
}
