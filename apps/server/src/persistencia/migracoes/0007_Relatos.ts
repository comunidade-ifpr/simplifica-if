/**
 * "Isto está errado" (M1.12): o registro local dos relatos, um por envio (issue aberta no navegador,
 * arquivo salvo na pasta da tarefa ou texto copiado), com o título e o corpo como a pessoa os aprovou.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE relatos (
      id INTEGER PRIMARY KEY,
      conversa_id TEXT NOT NULL REFERENCES conversas (id) ON DELETE CASCADE,
      turno INTEGER NOT NULL,
      via TEXT NOT NULL,
      titulo TEXT NOT NULL,
      corpo TEXT NOT NULL,
      arquivo TEXT,
      criado_em TEXT NOT NULL
    )
  `;
});
