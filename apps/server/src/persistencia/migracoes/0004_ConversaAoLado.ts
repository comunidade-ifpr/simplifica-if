/**
 * Migração 4: a conversa ao lado (`docs/plans/multitarefa.md`, "Persistência").
 *
 * - Núcleo: a origem da conversa em `conversas` (`origem_rotulo` e `origem_rota`, nulos na conversa da
 *   caixa do Início ou de um cartão). As fichas de contexto vão nos `dados` da mensagem, em JSON, sem
 *   coluna nova.
 * - Módulo `revisao-ppc`: a conversa ao lado de cada revisão e o texto do último arquivo conferido ao
 *   salvar, pela função do módulo. Arquivo de composição, como as migrações 1 a 3.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as TabelasRevisaoPpc from "../../modulos/revisao-ppc/persistencia/tabelas.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE conversas ADD COLUMN origem_rotulo TEXT`;
  yield* sql`ALTER TABLE conversas ADD COLUMN origem_rota TEXT`;
  // Composição: o módulo `revisao-ppc`.
  yield* TabelasRevisaoPpc.adicionarConversaAoLado;
});
