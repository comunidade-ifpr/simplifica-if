/**
 * O primeiro uso (M1.8): as preferências deste computador, uma linha por chave, com o valor em JSON
 * (`perfil`, `aviso_aceito_em`, `boas_vindas_em`, `ias_desligadas`). Ver `Preferencias.ts`.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE preferencias (
      chave TEXT PRIMARY KEY,
      valor TEXT NOT NULL,
      atualizada_em TEXT NOT NULL
    )
  `;
});
