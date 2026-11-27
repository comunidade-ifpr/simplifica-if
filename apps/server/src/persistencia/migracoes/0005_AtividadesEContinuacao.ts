/**
 * Migração 5: em andamento e limite (`docs/plans/multitarefa.md`, "Persistência").
 *
 * - Núcleo: em `conversas`, o `vista_em` (a última vez em que a interface mostrou a conversa: a resposta
 *   que terminou depois é "resposta pronta") e o `continua_de` (a conversa que parou no limite da
 *   assinatura e continua nesta, com outra IA; a antiga acha a continuação por ele). As conversas que já
 *   existem contam como vistas na última atualização, para não aparecerem todas como respostas prontas.
 * - Módulo `revisao-ppc`: a IA de cada bloco e de cada pendência da leitura com IA, pela função do
 *   módulo. Arquivo de composição, como as migrações 1 a 4.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as TabelasRevisaoPpc from "../../modulos/revisao-ppc/persistencia/tabelas.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE conversas ADD COLUMN vista_em TEXT`;
  yield* sql`UPDATE conversas SET vista_em = atualizada_em`;
  yield* sql`ALTER TABLE conversas ADD COLUMN continua_de TEXT REFERENCES conversas (id) ON DELETE SET NULL`;
  // A lista acha a continuação de cada conversa por ele.
  yield* sql`CREATE INDEX conversas_continua_de ON conversas (continua_de)`;
  // Composição: o módulo `revisao-ppc`.
  yield* TabelasRevisaoPpc.adicionarIaPorBloco;
});
