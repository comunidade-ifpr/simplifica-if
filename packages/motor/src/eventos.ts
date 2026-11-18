/**
 * Eventos normalizados do motor: o que a interface vê de uma conversa, igual para os três providers.
 *
 * Cada driver traduz as mensagens nativas (Agent SDK, app-server do Codex, ACP) nestes eventos; os
 * normalizadores são funções puras, testadas com gravações reais em `test/fixtures/`.
 */
import * as Schema from "effect/Schema";
import { classificarFalha, TipoFalha, textoTecnico } from "./falhas.ts";

export const Provider = Schema.Literals(["claude", "codex", "antigravity"]);
export type Provider = typeof Provider.Type;

/** Pedaço de texto da resposta, na ordem em que chega. */
export const TextoParcial = Schema.TaggedStruct("TextoParcial", {
  texto: Schema.String,
});

/** Mensagem de texto completa do assistente (uma por bloco de texto do turno). */
export const TextoFinal = Schema.TaggedStruct("TextoFinal", {
  texto: Schema.String,
});

/** O provider começou a chamar uma ferramenta. `nome` vem como `servidor.ferramenta` para MCP. */
export const FerramentaIniciada = Schema.TaggedStruct("FerramentaIniciada", {
  id: Schema.String,
  nome: Schema.String,
  entrada: Schema.Unknown,
});

/** A ferramenta terminou; `resumo` é o começo do resultado, sem passar de `LIMITE_RESUMO`. */
export const FerramentaConcluida = Schema.TaggedStruct("FerramentaConcluida", {
  id: Schema.String,
  nome: Schema.String,
  resumo: Schema.String,
  falhou: Schema.Boolean,
});

/** O provider pede permissão para agir. A resposta vai por `Motor.responderAprovacao`. */
export const PedidoAprovacao = Schema.TaggedStruct("PedidoAprovacao", {
  id: Schema.String,
  ferramenta: Schema.String,
  descricao: Schema.String,
  entrada: Schema.Unknown,
});

/** Uso de tokens informado pelo provider (o acumulado do turno, quando ele informa). */
export const UsoTokens = Schema.TaggedStruct("UsoTokens", {
  entrada: Schema.Number,
  saida: Schema.Number,
  cacheLeitura: Schema.optionalKey(Schema.Number),
  /** Tokens gravados no cache nesta chamada (Claude: `cache_creation_input_tokens`), fora de `entrada`. */
  cacheEscrita: Schema.optionalKey(Schema.Number),
  custoUsd: Schema.optionalKey(Schema.Number),
});

/**
 * O turno falhou. `tipo` é o do classificador do motor (`falhas.ts`); `mensagem`, o texto técnico,
 * curto e saneado, que a interface mostra só em "Detalhes técnicos".
 */
export const Erro = Schema.TaggedStruct("Erro", {
  tipo: TipoFalha,
  mensagem: Schema.String,
});
export type Erro = typeof Erro.Type;

/** O `Erro` de um turno a partir do texto do provider: classificado, saneado e curto. */
export function erroDoTurno(texto: string): Erro {
  return { _tag: "Erro", tipo: classificarFalha("", texto), mensagem: textoTecnico(texto) };
}

/** Fim do turno. `motivo` é o do provider (`end_turn`, `completed`, `interrupted`…). */
export const FimTurno = Schema.TaggedStruct("FimTurno", {
  motivo: Schema.String,
});

export const Evento = Schema.Union([
  TextoParcial,
  TextoFinal,
  FerramentaIniciada,
  FerramentaConcluida,
  PedidoAprovacao,
  UsoTokens,
  Erro,
  FimTurno,
]);
export type Evento = typeof Evento.Type;

export const LIMITE_RESUMO = 300;

/** Resume um resultado de ferramenta: texto puro, uma linha, até `LIMITE_RESUMO` caracteres. */
export function resumir(valor: unknown): string {
  const texto = typeof valor === "string" ? valor : valor === undefined ? "" : JSON.stringify(valor);
  const linha = texto.replace(/\s+/g, " ").trim();
  return linha.length <= LIMITE_RESUMO ? linha : `${linha.slice(0, LIMITE_RESUMO - 1)}…`;
}

/** Junta o texto dos blocos `{ type: "text", text }` de um conteúdo MCP ou ACP. */
export function textoDeBlocos(conteudo: unknown): string {
  if (typeof conteudo === "string") return conteudo;
  if (!Array.isArray(conteudo)) return conteudo === undefined || conteudo === null ? "" : JSON.stringify(conteudo);
  return conteudo
    .map((bloco: unknown) => {
      if (typeof bloco !== "object" || bloco === null) return "";
      const registro = bloco as Record<string, unknown>;
      if (typeof registro.text === "string") return registro.text;
      // ACP embrulha o bloco: `{ type: "content", content: { type: "text", text } }`.
      if (registro.content !== undefined) return textoDeBlocos([registro.content]);
      return "";
    })
    .join("");
}
