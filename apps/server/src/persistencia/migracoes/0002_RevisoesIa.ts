/**
 * Migração 2: a revisão de PPC com IA (M1.11, etapa 4).
 *
 * - `revisoes_ia`: uma por revisão. `plano` é o JSON do plano montado em código (os blocos, o texto de
 *   cada pedido, o Markdown do PPC convertido, as fichas e o contexto das transversais): a retomada não
 *   o refaz. `sha256` é o do `.docx` lido na preparação; o resultado final só sai se o arquivo não mudou.
 *   `estimativa`, `uso` e `resultado` em JSON.
 * - `blocos_ia`: o resultado conferido de cada bloco, gravado ao terminar, para a retomada depois de
 *   cota esgotada, limite de taxa, app fechado ou provider caído.
 *
 * Guarda o texto do PPC da pessoa (no `plano`), como as conversas guardam os anexos: fica só no banco
 * local, na pasta de estado do app.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE revisoes_ia (
      id TEXT PRIMARY KEY,
      arquivo TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      provider TEXT NOT NULL,
      modelo TEXT,
      modo TEXT NOT NULL,
      cnct TEXT,
      forma TEXT,
      situacao TEXT NOT NULL,
      motivo TEXT,
      limite INTEGER NOT NULL DEFAULT 0,
      plano TEXT NOT NULL,
      estimativa TEXT NOT NULL,
      resultado TEXT,
      criada_em TEXT NOT NULL,
      atualizada_em TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX revisoes_ia_atualizada_em ON revisoes_ia (atualizada_em DESC)`;

  yield* sql`
    CREATE TABLE blocos_ia (
      revisao_id TEXT NOT NULL REFERENCES revisoes_ia (id) ON DELETE CASCADE,
      bloco_id TEXT NOT NULL,
      resultado TEXT NOT NULL,
      uso TEXT NOT NULL,
      segundos REAL NOT NULL,
      criado_em TEXT NOT NULL,
      PRIMARY KEY (revisao_id, bloco_id)
    ) WITHOUT ROWID
  `;
});
