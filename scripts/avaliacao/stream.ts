/**
 * Leitura da saída `claude -p --output-format stream-json --verbose`: uma linha JSON por evento.
 * Extrai a resposta final, o modelo efetivo, as chamadas de ferramenta e o uso de tokens.
 */
import { z } from "zod";

const esquemaUso = z.looseObject({
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  cache_creation_input_tokens: z.number().optional(),
  cache_read_input_tokens: z.number().optional(),
});

const esquemaBloco = z.looseObject({
  type: z.string(),
  id: z.string().optional(),
  name: z.string().optional(),
  text: z.string().optional(),
});

const esquemaEvento = z.discriminatedUnion("type", [
  z.looseObject({ type: z.literal("system"), subtype: z.string().optional(), model: z.string().optional() }),
  z.looseObject({
    type: z.literal("assistant"),
    message: z.looseObject({ model: z.string().optional(), content: z.array(esquemaBloco).default([]) }),
  }),
  z.looseObject({
    type: z.literal("result"),
    subtype: z.string().optional(),
    is_error: z.boolean().optional(),
    result: z.string().optional(),
    num_turns: z.number().optional(),
    duration_ms: z.number().optional(),
    total_cost_usd: z.number().optional(),
    usage: esquemaUso.optional(),
  }),
]);

export interface Tokens {
  entrada: number;
  saida: number;
  cache_criacao: number;
  cache_leitura: number;
  total: number;
}

export interface Execucao {
  resposta: string;
  modelo: string | null;
  chamadas_ferramenta: number;
  /** Chamadas recusadas pela política só de leitura (`permission_denied`). */
  chamadas_negadas: number;
  ferramentas: Record<string, number>;
  tokens: Tokens;
  custo_usd: number | null;
  turnos: number | null;
  duracao_ms: number | null;
  /** `success`, `error_max_turns`, `error_during_execution` etc.; `sem_resultado` se o evento final faltar. */
  desfecho: string;
  erro: boolean;
}

export function lerStreamJson(saida: string): Execucao {
  const ferramentas: Record<string, number> = {};
  const idsVistos = new Set<string>();
  const textos: string[] = [];
  let modelo: string | null = null;
  let negadas = 0;
  let final: (z.output<typeof esquemaEvento> & { type: "result" }) | undefined;

  for (const linha of saida.split("\n")) {
    const limpa = linha.trim();
    if (!limpa.startsWith("{")) continue;
    let bruto: unknown;
    try {
      bruto = JSON.parse(limpa);
    } catch {
      continue;
    }
    const evento = esquemaEvento.safeParse(bruto);
    if (!evento.success) continue;
    const dado = evento.data;
    if (dado.type === "system") {
      if (dado.subtype === "init" && dado.model) modelo = dado.model;
      if (dado.subtype === "permission_denied") negadas += 1;
    } else if (dado.type === "assistant") {
      modelo ??= dado.message.model ?? null;
      for (const bloco of dado.message.content) {
        if (bloco.type === "tool_use") {
          const id = bloco.id ?? `${idsVistos.size}`;
          if (idsVistos.has(id)) continue;
          idsVistos.add(id);
          const nome = bloco.name ?? "?";
          ferramentas[nome] = (ferramentas[nome] ?? 0) + 1;
        } else if (bloco.type === "text" && bloco.text) {
          textos.push(bloco.text);
        }
      }
    } else {
      final = dado;
    }
  }

  const uso = final?.usage ?? {};
  const tokens: Tokens = {
    entrada: uso.input_tokens ?? 0,
    saida: uso.output_tokens ?? 0,
    cache_criacao: uso.cache_creation_input_tokens ?? 0,
    cache_leitura: uso.cache_read_input_tokens ?? 0,
    total: 0,
  };
  tokens.total = tokens.entrada + tokens.saida + tokens.cache_criacao + tokens.cache_leitura;
  return {
    resposta: final?.result ?? textos.at(-1) ?? "",
    modelo,
    chamadas_ferramenta: idsVistos.size,
    chamadas_negadas: negadas,
    ferramentas: Object.fromEntries(Object.entries(ferramentas).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    tokens,
    custo_usd: final?.total_cost_usd ?? null,
    turnos: final?.num_turns ?? null,
    duracao_ms: final?.duration_ms ?? null,
    desfecho: final?.subtype ?? "sem_resultado",
    erro: final ? final.is_error === true || final.subtype !== "success" : true,
  };
}
