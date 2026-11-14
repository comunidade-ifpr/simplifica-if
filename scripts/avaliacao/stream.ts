/**
 * Leitura da saída `claude -p --output-format stream-json --verbose`: uma linha JSON por evento.
 * Extrai a resposta final, o modelo efetivo, as chamadas de ferramenta e o uso de tokens.
 */
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { solto } from "../esquema.ts";

/*
 * Os eventos são objetos soltos: o `claude` acrescenta campos de versão para versão, e o harness lê
 * só os que conhece. Linha que não é JSON, evento de outro tipo (`user`, `stream_event`...) ou campo
 * conhecido com tipo inesperado: a linha é ignorada.
 */

const numero = Schema.optional(Schema.Finite);
const texto = Schema.optional(Schema.String);

const esquemaUso = solto({
  input_tokens: numero,
  output_tokens: numero,
  cache_creation_input_tokens: numero,
  cache_read_input_tokens: numero,
});

const esquemaBloco = solto({
  type: Schema.String,
  id: texto,
  name: texto,
  text: texto,
});

const esquemaResultado = solto({
  type: Schema.Literal("result"),
  subtype: texto,
  is_error: Schema.optional(Schema.Boolean),
  result: texto,
  num_turns: numero,
  duration_ms: numero,
  total_cost_usd: numero,
  usage: Schema.optional(esquemaUso),
});

const esquemaEvento = Schema.Union([
  solto({ type: Schema.Literal("system"), subtype: texto, model: texto }),
  solto({
    type: Schema.Literal("assistant"),
    message: solto({
      model: texto,
      content: Schema.Array(esquemaBloco).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
    }),
  }),
  esquemaResultado,
]);

/** Uma linha do stream: JSON e evento conhecido, ou falha (a linha é ignorada). */
const decodificarLinha = Schema.decodeUnknownExit(Schema.fromJsonString(esquemaEvento));

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
  let final: typeof esquemaResultado.Type | undefined;

  for (const linha of saida.split("\n")) {
    const limpa = linha.trim();
    if (!limpa.startsWith("{")) continue;
    const evento = decodificarLinha(limpa);
    if (Exit.isFailure(evento)) continue;
    const dado = evento.value;
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
