/**
 * Migração 3: `apagamentos_pendentes`, o que falta apagar fora do banco depois de apagar uma conversa.
 *
 * A conversa sai do banco na hora (`Historico.apagar`), e na mesma transação fica aqui o que é preciso para
 * apagar o resto: as cópias do Desfazer (pela `conversa`) e o registro que o provider guarda no computador
 * (`provider`, `id_nativo` e a `pasta_trabalho` onde a sessão abriu). A linha sai quando as duas coisas
 * deram certo; senão, o servidor tenta de novo ao subir. Só identificadores e o caminho da pasta, nada do
 * texto da conversa. `tentativas` e `ultima_tentativa_em` vão para o log.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE apagamentos_pendentes (
      conversa TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      id_nativo TEXT,
      pasta_trabalho TEXT NOT NULL,
      criado_em TEXT NOT NULL,
      tentativas INTEGER NOT NULL DEFAULT 0,
      ultima_tentativa_em TEXT
    )
  `;
});
