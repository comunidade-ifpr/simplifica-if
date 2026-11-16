/**
 * Migração 3: o uso de cada tentativa da revisão com IA, gravado ao fim da tentativa, mesmo quando o
 * bloco não termina (pausa, limite de taxa, "Pausar", a falha de outro bloco que interrompe este). O
 * uso mostrado na tela é a soma destas linhas: nada do que se gastou some, nem conta duas vezes.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE tentativas_ia (
      revisao_id TEXT NOT NULL REFERENCES revisoes_ia (id) ON DELETE CASCADE,
      bloco_id TEXT NOT NULL,
      numero INTEGER NOT NULL,
      uso TEXT NOT NULL,
      segundos REAL NOT NULL,
      ferramentas TEXT NOT NULL,
      criada_em TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX tentativas_ia_revisao ON tentativas_ia (revisao_id)`;
});
