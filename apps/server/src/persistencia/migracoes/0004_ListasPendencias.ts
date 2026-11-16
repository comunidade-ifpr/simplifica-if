/**
 * A lista viva de pendências (M1.11, etapa 5b): a lista (com o texto do PPC que as ações com IA usam),
 * a situação e a sugestão de cada pendência, o histórico e o uso de cada ação com IA. A lista que veio
 * de uma revisão com IA some com ela (`ON DELETE CASCADE`).
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE listas_pendencias (
      id TEXT PRIMARY KEY,
      arquivo TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      revisao_id TEXT REFERENCES revisoes_ia (id) ON DELETE CASCADE,
      provider TEXT,
      modelo TEXT,
      cnct TEXT,
      forma TEXT,
      markdown TEXT NOT NULL,
      linhas_texto_ia TEXT NOT NULL,
      nonce TEXT NOT NULL,
      resultado TEXT NOT NULL,
      paradas_vistas TEXT NOT NULL,
      parada_atual INTEGER NOT NULL,
      criada_em TEXT NOT NULL,
      atualizada_em TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX listas_pendencias_atualizada_em ON listas_pendencias (atualizada_em DESC)`;
  yield* sql`
    CREATE TABLE pendencias_vivas (
      lista_id TEXT NOT NULL REFERENCES listas_pendencias (id) ON DELETE CASCADE,
      chave TEXT NOT NULL,
      ordem INTEGER NOT NULL,
      pendencia TEXT NOT NULL,
      situacao TEXT NOT NULL,
      resolvida_por TEXT,
      sugestao TEXT,
      PRIMARY KEY (lista_id, chave)
    ) WITHOUT ROWID
  `;
  yield* sql`
    CREATE TABLE eventos_pendencia (
      lista_id TEXT NOT NULL REFERENCES listas_pendencias (id) ON DELETE CASCADE,
      chave TEXT NOT NULL,
      em TEXT NOT NULL,
      acao TEXT NOT NULL,
      situacao TEXT NOT NULL,
      texto TEXT NOT NULL,
      motivo TEXT,
      uso TEXT
    )
  `;
  yield* sql`CREATE INDEX eventos_pendencia_lista ON eventos_pendencia (lista_id, chave)`;
  yield* sql`
    CREATE TABLE acoes_ia (
      lista_id TEXT NOT NULL REFERENCES listas_pendencias (id) ON DELETE CASCADE,
      chave TEXT NOT NULL,
      acao TEXT NOT NULL,
      numero INTEGER NOT NULL,
      uso TEXT NOT NULL,
      segundos REAL NOT NULL,
      ferramentas TEXT NOT NULL,
      criada_em TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX acoes_ia_lista ON acoes_ia (lista_id)`;
});
