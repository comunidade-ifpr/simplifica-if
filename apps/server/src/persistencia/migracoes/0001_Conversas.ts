/**
 * Migração 1: as conversas e os eventos de cada uma.
 *
 * - `conversas`: uma por conversa do app. `id_nativo` é o id da conversa no provider (o `session_id`
 *   do Claude, o `threadId` do Codex, o `sessionId` do ACP), para a retomada; `estado` é o
 *   `EstadoConversa` do contrato. Datas em ISO 8601.
 * - `eventos`: o histórico, na `ordem` da conversa. `tipo` é `mensagem` (o texto da pessoa, que abre
 *   o turno), `evento` (um `Evento` normalizado do motor, em JSON, exceto o `TextoParcial`) ou
 *   `decisao` (a resposta a um pedido de aprovação).
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE conversas (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      pasta_trabalho TEXT NOT NULL,
      modelo TEXT,
      busca_web INTEGER,
      titulo TEXT NOT NULL DEFAULT '',
      id_nativo TEXT,
      estado TEXT NOT NULL,
      criada_em TEXT NOT NULL,
      atualizada_em TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX conversas_atualizada_em ON conversas (atualizada_em DESC)`;

  yield* sql`
    CREATE TABLE eventos (
      conversa_id TEXT NOT NULL REFERENCES conversas (id) ON DELETE CASCADE,
      ordem INTEGER NOT NULL,
      turno INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      dados TEXT NOT NULL,
      criado_em TEXT NOT NULL,
      PRIMARY KEY (conversa_id, ordem)
    ) WITHOUT ROWID
  `;
});
