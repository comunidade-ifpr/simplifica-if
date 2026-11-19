/**
 * Os modelos que a conta de um provider oferece e o nível de esforço que o app chama de
 * "Aprofundado". Funções puras: cada driver traduz a lista nativa (`initializationResult().models` do
 * Agent SDK, `model/list` do Codex) para `ModeloProvider`.
 */
import { type ModeloProvider, NIVEIS_ESFORCO, type NivelEsforco } from "./estados-provider.ts";

/**
 * O nível logo acima de `padrao` entre os `suportados`, na ordem de `NIVEIS_ESFORCO`. `undefined`
 * quando o padrão é desconhecido ou já é o maior: o app não oferece "Aprofundado" para o modelo.
 */
export function esforcoAcima(padrao: string, suportados: ReadonlyArray<string>): NivelEsforco | undefined {
  const base = (NIVEIS_ESFORCO as ReadonlyArray<string>).indexOf(padrao);
  if (base === -1) return undefined;
  return NIVEIS_ESFORCO.slice(base + 1).find((nivel) => suportados.includes(nivel));
}

/** Os níveis que o Agent SDK aceita em `Options.effort`. */
export const NIVEIS_CLAUDE = ["low", "medium", "high", "xhigh", "max"] as const;
export type NivelClaude = (typeof NIVEIS_CLAUDE)[number];

export const ehNivelClaude = (nivel: string | undefined): nivel is NivelClaude =>
  (NIVEIS_CLAUDE as ReadonlyArray<string | undefined>).includes(nivel);

/** O que o driver do Claude lê de cada `ModelInfo` do Agent SDK. */
export interface ModeloClaude {
  readonly value: string;
  readonly resolvedModel?: string;
  readonly displayName: string;
  readonly supportedEffortLevels?: ReadonlyArray<string>;
}

/**
 * Os modelos do Claude sem a linha `default` (na interface, é o "Automático"); o padrão da conta é a
 * linha que resolve para o mesmo modelo que ela, quando o SDK diz qual é.
 *
 * O "Aprofundado" é o `xhigh` e, sem ele, o `high`. É uma aposta: o SDK não informa o esforço padrão
 * de cada modelo (vem do catálogo remoto do Claude Code), e num modelo cujo padrão já é esse nível a
 * opção não muda nada.
 */
export function modelosClaude(modelos: ReadonlyArray<ModeloClaude>): ReadonlyArray<ModeloProvider> {
  const resolvido = modelos.find((modelo) => modelo.value === "default")?.resolvedModel;
  const nomeados = modelos.filter((modelo) => modelo.value !== "default");
  const padrao =
    resolvido === undefined
      ? undefined
      : nomeados.find((modelo) => modelo.value === resolvido || modelo.resolvedModel === resolvido);
  return nomeados.map((modelo) => {
    const esforco = (["xhigh", "high"] as const).find((nivel) => modelo.supportedEffortLevels?.includes(nivel));
    return {
      id: modelo.value,
      nome: modelo.displayName,
      ...(modelo === padrao ? { padrao: true } : {}),
      ...(esforco === undefined ? {} : { esforcoAprofundado: esforco }),
    };
  });
}

/** O que o driver do Codex lê de cada modelo do `model/list`. */
export interface ModeloCodex {
  readonly model: string;
  readonly displayName: string;
  readonly hidden: boolean;
  readonly isDefault: boolean;
  readonly defaultReasoningEffort: string;
  readonly supportedReasoningEfforts: ReadonlyArray<{ readonly reasoningEffort: string }>;
}

/** Os modelos visíveis do Codex; o "Aprofundado" é o nível logo acima do padrão do modelo. */
export function modelosCodex(modelos: ReadonlyArray<ModeloCodex>): ReadonlyArray<ModeloProvider> {
  return modelos
    .filter((modelo) => !modelo.hidden)
    .map((modelo) => {
      const esforco = esforcoAcima(
        modelo.defaultReasoningEffort,
        modelo.supportedReasoningEfforts.map((opcao) => opcao.reasoningEffort),
      );
      return {
        id: modelo.model,
        nome: modelo.displayName,
        ...(modelo.isDefault ? { padrao: true } : {}),
        ...(esforco === undefined ? {} : { esforcoAprofundado: esforco }),
      };
    });
}

/**
 * O esforço que a sessão do Codex manda: o pedido, se o modelo o anuncia; senão, o padrão do modelo
 * (e não o `model_reasoning_effort` do `config.toml` da pessoa, que faria o "Normal" variar de um
 * computador para outro). Sem o modelo no catálogo, o pedido vai como veio.
 */
export function esforcoCodex(modelo: ModeloCodex | undefined, pedido: string | undefined): string | undefined {
  if (modelo === undefined) return pedido;
  return pedido !== undefined && modelo.supportedReasoningEfforts.some((opcao) => opcao.reasoningEffort === pedido)
    ? pedido
    : modelo.defaultReasoningEffort;
}
