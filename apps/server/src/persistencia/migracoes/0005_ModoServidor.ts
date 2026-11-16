/**
 * O Modo Servidor (M1.9): a tarefa de cada conversa (a skill, ou `conversa` para a caixa livre do
 * Início), a avaliação das respostas (👍/👎 por turno) e os arquivos que entraram na pasta de trabalho
 * pelo "Anexar" do app.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE conversas ADD COLUMN tarefa TEXT`;
  yield* sql`
    CREATE TABLE avaliacoes (
      conversa_id TEXT NOT NULL REFERENCES conversas (id) ON DELETE CASCADE,
      turno INTEGER NOT NULL,
      nota TEXT NOT NULL,
      avaliada_em TEXT NOT NULL,
      PRIMARY KEY (conversa_id, turno)
    )
  `;
  yield* sql`
    CREATE TABLE anexos_pasta (
      pasta TEXT NOT NULL,
      nome TEXT NOT NULL,
      anexado_em TEXT NOT NULL,
      PRIMARY KEY (pasta, nome)
    )
  `;
});
