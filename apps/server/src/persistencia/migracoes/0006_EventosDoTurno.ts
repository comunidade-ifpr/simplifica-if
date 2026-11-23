/**
 * Migração 6: os eventos do turno gravados em `eventos.dados` na forma nova.
 * - O `MudancasPasta` ganha o grupo `anexados` (os anexos do app, que antes iam numa nota no texto da
 *   mensagem e por isso não estavam no evento): o gravado antes fica com o grupo vazio.
 * - O `motivo` do `FimTurno` passa ao conjunto fechado (`concluido`, `interrompido`, `falha`,
 *   `parado_antes_do_envio`): o do provider (`end_turn`, `completed`, `interrupted`, `cancelled`,
 *   `failed`, `error_*`) e o do servidor viram um deles.
 * - O `FerramentaIniciada` e o `PedidoAprovacao` ganham o `tipo` da ferramenta, que o driver passa a dar.
 *   Do gravado, só o nome diz algo: as do MCP pelo servidor (`ifpr.` é do app), as web conhecidas com o
 *   alvo tirado da entrada, e o resto como `outra`.
 *
 * A regra fica copiada neste arquivo, e não importada: a migração não pode mudar junto com o código.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const JsonDesconhecido = Schema.fromJsonString(Schema.Unknown);
const lerJson = Schema.decodeUnknownEffect(JsonDesconhecido);
const codificarJson = Schema.encodeEffect(JsonDesconhecido);

const MOTIVOS = new Set(["concluido", "interrompido", "falha", "parado_antes_do_envio"]);

function motivoFechado(motivo: unknown): string {
  const texto = typeof motivo === "string" ? motivo : "";
  if (MOTIVOS.has(texto)) return texto;
  if (/interrupt|cancel|abort/i.test(texto)) return "interrompido";
  if (/^fail|^error/i.test(texto)) return "falha";
  return "concluido";
}

const PAGINA_WEB = new Set(["WebFetch", "ler_pagina_web", "read_url_content", "fetch"]);
const BUSCA_WEB = new Set(["WebSearch", "busca_web", "search_web"]);

/** O primeiro texto não vazio da entrada nas chaves dadas. */
function textoDe(entrada: unknown, chaves: ReadonlyArray<string>): string | undefined {
  if (typeof entrada !== "object" || entrada === null) return undefined;
  for (const chave of chaves) {
    const valor = (entrada as Record<string, unknown>)[chave];
    if (typeof valor === "string" && valor.trim() !== "") return valor.trim();
  }
  return undefined;
}

/** O tipo (e o alvo web) de uma ferramenta gravada, só pelo nome e pela entrada. */
function tipoPeloNome(nome: unknown, entrada: unknown): Record<string, unknown> {
  const texto = typeof nome === "string" ? nome : "";
  const servidor = /^mcp__(.+?)__/.exec(texto)?.[1] ?? /^([\w-]+)\./.exec(texto)?.[1];
  if (servidor !== undefined) return { tipo: servidor === "ifpr" ? "mcp-app" : "mcp-outro" };
  if (PAGINA_WEB.has(texto)) {
    const alvo = textoDe(entrada, ["url", "Url", "uri", "Uri"]);
    return { tipo: "web", ...(alvo === undefined ? {} : { web: { acao: "ler", alvo } }) };
  }
  if (BUSCA_WEB.has(texto)) {
    const alvo = textoDe(entrada, ["query", "Query", "consulta", "search_query"]);
    return { tipo: "web", ...(alvo === undefined ? {} : { web: { acao: "pesquisar", alvo } }) };
  }
  return { tipo: "outra" };
}

/** O registro com `extra` logo depois da chave `depois`, como o servidor passa a gravar. */
function inserirDepois(registro: Record<string, unknown>, depois: string, extra: Record<string, unknown>) {
  const saida: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(registro)) {
    saida[chave] = valor;
    if (chave === depois) Object.assign(saida, extra);
  }
  return saida;
}

/** O evento na forma nova; o que não precisa mudar volta como está. */
function naFormaNova(evento: unknown): unknown {
  if (typeof evento !== "object" || evento === null || Array.isArray(evento)) return evento;
  const registro = evento as Record<string, unknown>;
  switch (registro["_tag"]) {
    case "MudancasPasta":
      return registro["anexados"] === undefined ? inserirDepois(registro, "_tag", { anexados: [] }) : evento;
    case "FimTurno":
      return { ...registro, motivo: motivoFechado(registro["motivo"]) };
    case "FerramentaIniciada":
      return registro["tipo"] === undefined
        ? inserirDepois(registro, "nome", tipoPeloNome(registro["nome"], registro["entrada"]))
        : evento;
    case "PedidoAprovacao": {
      if (registro["tipo"] !== undefined) return evento;
      const { tipo } = tipoPeloNome(registro["ferramenta"], undefined);
      return inserirDepois(registro, "ferramenta", { tipo });
    }
    default:
      return evento;
  }
}

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const linhas = yield* sql<{ conversa_id: string; ordem: number; dados: string }>`
    SELECT conversa_id, ordem, dados FROM eventos WHERE tipo = 'evento'
  `;
  for (const linha of linhas) {
    const novo = yield* lerJson(linha.dados).pipe(
      Effect.map(naFormaNova),
      Effect.flatMap(codificarJson),
      Effect.catch(() =>
        Effect.logWarning(`migração 6: JSON inválido em eventos ${linha.conversa_id}/${linha.ordem}`).pipe(
          Effect.as(null),
        ),
      ),
    );
    if (novo !== null && novo !== linha.dados)
      yield* sql`
        UPDATE eventos SET dados = ${novo} WHERE conversa_id = ${linha.conversa_id} AND ordem = ${linha.ordem}
      `;
  }
});
