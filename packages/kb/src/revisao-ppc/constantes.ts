/**
 * Vocabulário único dos critérios da revisão de PPC: modos de execução, criticidades e estados.
 *
 * Fonte única para os contratos Effect Schema (`scripts/base/revisao-ppc/esquemas.ts`), o `kb`,
 * a revisão em `packages/ppc`, o servidor, o MCP e a interface do app (`@simplifica-if/contratos-app`).
 */
import * as Schema from "effect/Schema";

export const MODOS_EXECUCAO = ["hibrido", "focal", "tematico", "transversal"] as const;
export type ModoExecucao = (typeof MODOS_EXECUCAO)[number];

export const DESCRICAO_MODO_EXECUCAO: Readonly<
  Record<ModoExecucao, { readonly rotulo: string; readonly descricao: string }>
> = {
  hibrido: {
    rotulo: "Híbrido",
    descricao: "O app confere primeiro em código; se não conseguir concluir, a IA analisa o trecho.",
  },
  focal: {
    rotulo: "Focal",
    descricao: "O app localiza os trechos relevantes no PPC e a IA confirma o que eles dizem.",
  },
  tematico: {
    rotulo: "Temático",
    descricao: "A IA julga as seções inteiras do tema; o app confere o trecho e as normas citadas.",
  },
  transversal: {
    rotulo: "Transversal",
    descricao:
      "A IA cruza os resumos dos temas e os recortes no fim da revisão para conferir a coerência entre seções.",
  },
};

export const ehModoExecucao = (valor: unknown): valor is ModoExecucao =>
  typeof valor === "string" && (MODOS_EXECUCAO as readonly string[]).includes(valor);

export const esquemaModoExecucao = Schema.Literals(MODOS_EXECUCAO).annotate({
  description: MODOS_EXECUCAO.map((m) => `${m}: ${DESCRICAO_MODO_EXECUCAO[m].descricao}`).join(" "),
});

export const CRITICIDADES = ["bloqueante", "obrigatorio", "recomendado"] as const;
export type CriticidadeCriterio = (typeof CRITICIDADES)[number];

export const DESCRICAO_CRITICIDADE: Readonly<
  Record<CriticidadeCriterio, { readonly rotulo: string; readonly descricao: string }>
> = {
  bloqueante: {
    rotulo: "Bloqueia a submissão",
    descricao: "Pendência que impede o encaminhamento do PPC à PROENS.",
  },
  obrigatorio: {
    rotulo: "Obrigatório",
    descricao: "Requisito normativo ou institucional obrigatório no PPC.",
  },
  recomendado: {
    rotulo: "Recomendado",
    descricao: "Boa prática ou orientação recomendada, sem caráter bloqueante.",
  },
};

export const ehCriticidadeCriterio = (valor: unknown): valor is CriticidadeCriterio =>
  typeof valor === "string" && (CRITICIDADES as readonly string[]).includes(valor);

export const esquemaCriticidade = Schema.Literals(CRITICIDADES).annotate({
  description: CRITICIDADES.map((c) => `${c}: ${DESCRICAO_CRITICIDADE[c].descricao}`).join(" "),
});

export const ESTADOS_CRITERIO = ["atende", "nao_atende", "a_conferir", "nao_se_aplica"] as const;
export type EstadoCriterioBase = (typeof ESTADOS_CRITERIO)[number];

export const ehEstadoCriterioBase = (valor: unknown): valor is EstadoCriterioBase =>
  typeof valor === "string" && (ESTADOS_CRITERIO as readonly string[]).includes(valor);

export const esquemaEstadoCriterio = Schema.Literals(ESTADOS_CRITERIO).annotate({
  description:
    "atende: critério atendido; nao_atende: pendência identificada; a_conferir: requer verificação humana ou evidência incompleta; nao_se_aplica: não se aplica a este curso/PPC.",
});

export const MOTIVOS_ESCALONAMENTO = ["nao_encontrado", "divergente", "citacao_incerta", "citacao_historica"] as const;
export type MotivoEscalonamento = (typeof MOTIVOS_ESCALONAMENTO)[number];

/** Textos fixos (sem texto do PPC) enviados à IA quando um verificador híbrido escala o critério. */
export const DESCRICAO_MOTIVO_ESCALONAMENTO: Readonly<Record<MotivoEscalonamento, string>> = {
  nao_encontrado: "A verificação automática em código não localizou o dado esperado no texto.",
  divergente: "A verificação automática em código encontrou um valor divergente ou fora do padrão esperado.",
  citacao_incerta: "A verificação automática em código identificou uma citação normativa com confiança menor.",
  citacao_historica:
    "A verificação automática em código encontrou norma revogada junto da sucessora ou em contexto histórico.",
};

export const esquemaMotivoEscalonamento = Schema.Literals(MOTIVOS_ESCALONAMENTO);
