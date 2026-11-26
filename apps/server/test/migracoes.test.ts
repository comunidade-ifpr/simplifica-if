// @effect-diagnostics nodeBuiltinImport:off -- teste: arquivo temporário para layerArquivo
/**
 * Migrações do `conversas.sqlite`: schema inicial, idempotência, `foreign_keys` ligado e criação do arquivo.
 */
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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
      assert.deepStrictEqual(aplicadas, [[1, "Inicial"]]);
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
