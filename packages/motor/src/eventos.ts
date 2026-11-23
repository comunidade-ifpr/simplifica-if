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

/**
 * Tipos de ferramenta, iguais nos três providers; cada driver classifica as nativas dele (a política de
 * aprovação usa o mesmo tipo):
 * - `leitura`: ler arquivo, listar pasta, buscar em arquivos;
 * - `escrita`: criar, alterar, apagar ou mover arquivo;
 * - `comando`: rodar um comando no terminal;
 * - `comando-rede`: comando no terminal que pede acesso à rede (proxy gerenciado do Codex);
 * - `mcp-app`: ferramenta (ou recurso) de um servidor MCP do app marcado `preAprovado` (o `ifpr`);
 * - `mcp-outro`: ferramenta de outro servidor MCP;
 * - `web`: busca na web ou leitura de uma URL (ferramentas nativas conhecidas);
 * - `outra`: o resto (subagente, plano, pergunta ao usuário…).
 */
export const TipoFerramenta = Schema.Literals([
  "leitura",
  "escrita",
  "comando",
  "comando-rede",
  "mcp-app",
  "mcp-outro",
  "web",
  "outra",
]);
export type TipoFerramenta = typeof TipoFerramenta.Type;

/** O que uma ferramenta `web` abre: a página que ela lê (`ler`, a URL) ou a consulta que pesquisa. */
export const AlvoWeb = Schema.Struct({
  acao: Schema.Literals(["ler", "pesquisar"]),
  alvo: Schema.String,
});
export type AlvoWeb = typeof AlvoWeb.Type;

/** O `AlvoWeb` de um valor da entrada da ferramenta, se for texto não vazio. */
export function alvoWeb(acao: AlvoWeb["acao"], valor: unknown): AlvoWeb | undefined {
  return typeof valor === "string" && valor.trim() !== "" ? { acao, alvo: valor.trim() } : undefined;
}

/**
 * O provider começou a chamar uma ferramenta. `nome` vem como `servidor.ferramenta` para MCP; `tipo` é o
 * do driver, e `web`, o alvo de uma ferramenta `web`, quando a entrada o traz.
 */
export const FerramentaIniciada = Schema.TaggedStruct("FerramentaIniciada", {
  id: Schema.String,
  nome: Schema.String,
  tipo: TipoFerramenta,
  web: Schema.optionalKey(AlvoWeb),
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
  tipo: TipoFerramenta,
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

/**
 * Por que o turno acabou: `concluido` (o provider terminou a resposta), `interrompido` (o "Parar", ou o
 * turno que o servidor fechou sem o fim do provider), `falha` (o provider falhou; um `Erro` vem antes) e
 * `parado_antes_do_envio` (o servidor parou o turno no preparo, antes de a IA receber a mensagem). Cada
 * driver mapeia o motivo nativo dele.
 */
export const MotivoFim = Schema.Literals(["concluido", "interrompido", "falha", "parado_antes_do_envio"]);
export type MotivoFim = typeof MotivoFim.Type;

export const FimTurno = Schema.TaggedStruct("FimTurno", {
  motivo: MotivoFim,
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
