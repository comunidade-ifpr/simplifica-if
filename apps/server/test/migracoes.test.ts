// @effect-diagnostics nodeBuiltinImport:off -- teste: arquivo temporário para layerArquivo
/**
 * Migrações do `conversas.sqlite`: schema inicial, idempotência, o upgrade de um banco da versão 1,
 * `foreign_keys` ligado e criação do arquivo.
 */
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@simplifica-if/kb/db/nodeSqliteClient";
import * as Banco from "../src/persistencia/Banco.ts";
import { diretorioTemporario, limparTemporarios } from "./apoio.ts";

afterAll(limparTemporarios);

const pasta = diretorioTemporario("simplifica-migracoes-");
const ULTIMA = Banco.MIGRACOES.at(-1)![0];
const emMemoria = NodeSqliteClient.layer({ filename: ":memory:" });

describe("migrações do banco das conversas", () => {
  it.effect("aplica o schema inicial e é idempotente", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const aplicadas = yield* Banco.rodarMigracoes();
      assert.deepStrictEqual(
        aplicadas,
        Banco.MIGRACOES.map(([id, nome]) => [id, nome]),
      );
      assert.deepStrictEqual(yield* Banco.rodarMigracoes(), []);

      const tabelas = new Set(
        (yield* sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'table'`).map((t) => t.name),
      );
      for (const nome of [
        "conversas",
        "eventos",
        "avaliacoes",
        "anexos_pasta",
        "relatos",
        "apagamentos_pendentes",
        "preferencias",
      ]) {
        assert.isTrue(tabelas.has(nome), `tabela ausente: ${nome}`);
      }
    }).pipe(Effect.provide(emMemoria)),
  );

  it.effect("migração 2: o banco da versão 1 ganha `problemas` nas tentativas sem perder o que tinha", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const so = (ate: number) =>
        Migrator.fromRecord(
          Object.fromEntries(
            Banco.MIGRACOES.filter(([id]) => id <= ate).map(([id, nome, efeito]) => [`${id}_${nome}`, efeito]),
          ),
        );
      yield* Migrator.make({})({ loader: so(1) });
      yield* sql`
        INSERT INTO revisao_ppc_revisoes_ia (id, arquivo, sha256, provider, modelo, modo, situacao, plano,
          estimativa, criada_em, atualizada_em)
        VALUES ('r', 'PPC.docx', 'abc', 'claude', 'claude-sonnet-5-5', 'completo', 'concluida', '{}', '{}',
          '2026-11-26T14:55:15Z', '2026-11-26T14:59:18Z')
      `;
      yield* sql`
        INSERT INTO revisao_ppc_tentativas_ia (revisao_id, bloco_id, numero, uso, segundos, ferramentas, criada_em)
        VALUES ('r', 'j-02', 1, '{"entrada":15542}', 12.7, '[]', '2026-11-26T14:55:50Z')
      `;

      assert.deepStrictEqual(yield* Banco.rodarMigracoes(), [[2, "ProblemasDasTentativas"]]);
      const linhas = yield* sql<{ bloco_id: string; uso: string; problemas: string | null }>`
        SELECT bloco_id, uso, problemas FROM revisao_ppc_tentativas_ia
      `;
      assert.deepStrictEqual(linhas, [{ bloco_id: "j-02", uso: '{"entrada":15542}', problemas: null }]);
      assert.strictEqual((yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM revisao_ppc_revisoes_ia`)[0]?.n, 1);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("layerMemoria liga foreign_keys e aplica o schema", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const fk = yield* sql<{ foreign_keys: number }>`PRAGMA foreign_keys;`;
      assert.strictEqual(fk[0]?.foreign_keys, 1);
      const rows = yield* sql<{ id: number }>`SELECT MAX(migration_id) AS id FROM effect_sql_migrations`;
      assert.strictEqual(rows[0]?.id, ULTIMA);
    }).pipe(Effect.provide(Banco.layerMemoria)),
  );

  it.live("layerArquivo cria a pasta e aplica o schema no arquivo", () =>
    Effect.gen(function* () {
      const arquivo = NodePath.join(pasta, "sub", "conversas.sqlite");
      const versao = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const rows = yield* sql<{ id: number }>`SELECT MAX(migration_id) AS id FROM effect_sql_migrations`;
        return rows[0]?.id;
      }).pipe(Effect.provide(Banco.layerArquivo(arquivo).pipe(Layer.provide(NodeServices.layer))));
      assert.strictEqual(versao, ULTIMA);
    }),
  );
});
