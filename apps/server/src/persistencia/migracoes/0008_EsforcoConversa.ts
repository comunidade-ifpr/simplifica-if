/** O nível de esforço de raciocínio escolhido para a conversa (`EntradaIniciar.esforco`), para a retomada. */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE conversas ADD COLUMN esforco TEXT`;
});
