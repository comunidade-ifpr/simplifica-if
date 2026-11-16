/**
 * A lista da revisão prévia como a pessoa a lê: as pendências agrupadas por tema, na ordem do parecer
 * da PROENS (a `ordemTema` que o servidor dá), e os critérios conferidos sem pendência; os estados em
 * linguagem de quem edita o PPC, não os códigos das fichas.
 */
import type { CriterioRevisao, PendenciaRevisao, ResultadoRevisaoPpc } from "@simplifica-if/contratos-app";

export interface GrupoTema {
  readonly tema: string;
  readonly ordem: number;
  readonly pendencias: ReadonlyArray<PendenciaRevisao>;
  /** Critérios do tema conferidos sem pendência (em ordem ou que não se aplicam). */
  readonly semPendencia: ReadonlyArray<CriterioRevisao>;
}

export function agruparPorTema(resultado: ResultadoRevisaoPpc): ReadonlyArray<GrupoTema> {
  const grupos = new Map<number, { tema: string; pendencias: PendenciaRevisao[]; semPendencia: CriterioRevisao[] }>();
  const grupo = (ordem: number, tema: string) => {
    let achado = grupos.get(ordem);
    if (achado === undefined) {
      achado = { tema, pendencias: [], semPendencia: [] };
      grupos.set(ordem, achado);
    }
    return achado;
  };
  for (const pendencia of resultado.pendencias) grupo(pendencia.ordemTema, pendencia.tema).pendencias.push(pendencia);
  for (const criterio of resultado.criterios)
    if (criterio.estado === "atende" || criterio.estado === "nao_se_aplica")
      grupo(criterio.ordemTema, criterio.tema).semPendencia.push(criterio);
  return [...grupos.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ordem, { tema, pendencias, semPendencia }]) => ({
      tema,
      ordem,
      // No tema, primeiro o que precisa de ajuste, depois o que é para conferir.
      pendencias: [...pendencias].sort((a, b) => Number(a.estado === "a_conferir") - Number(b.estado === "a_conferir")),
      semPendencia,
    }));
}

export const ROTULO_ESTADO = {
  nao_atende: "Precisa de ajuste",
  a_conferir: "Para conferir",
  atende: "Em ordem",
  nao_se_aplica: "Não se aplica",
} as const;

export const ROTULO_LOCAL = {
  "no-trecho": "Comentado no trecho, na cópia do documento.",
  "no-inicio": "Listado no comentário do título, na cópia do documento (o problema é algo que falta).",
  "so-na-lista": "Só nesta lista: o trecho não foi localizado no arquivo, então não há comentário nele.",
} as const;

const FORMAS: Record<string, string> = {
  integrado: "integrado ao ensino médio",
  subsequente: "subsequente",
  concomitante: "concomitante",
  proeja: "PROEJA",
};

/** "Técnico em Agropecuária, subsequente", ou a frase de curso não identificado. */
export function descreverCurso(curso: ResultadoRevisaoPpc["curso"]): string {
  if (curso.cnct === null)
    return "Não identificamos o curso no Catálogo Nacional de Cursos Técnicos: os critérios que dependem dele ficaram para conferir.";
  const forma = curso.forma === null ? "" : `, ${FORMAS[curso.forma] ?? curso.forma}`;
  return `${curso.cnct.denominacao}${forma}${curso.origem === "documento" ? " (identificado no documento)" : ""}.`;
}

export const dataBrasileira = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
