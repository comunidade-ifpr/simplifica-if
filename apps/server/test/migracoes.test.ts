// @effect-diagnostics nodeBuiltinImport:off -- teste: arquivo temporário para layerArquivo
/**
 * Migrações do `conversas.sqlite`: schema inicial, idempotência, integridade referencial
 * (`PRAGMA foreign_key_check`) e proteção contra downgrade/histórico incompatível.
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
  it.effect("aplica o schema inicial, mantém foreign_keys ligado e é idempotente", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const aplicadas = yield* Banco.rodarMigracoes();
      assert.deepStrictEqual(aplicadas, [[1, "Inicial"]]);
      assert.deepStrictEqual(yield* Banco.rodarMigracoes(), []);

      const fk = yield* sql<{ foreign_keys: number }>`PRAGMA foreign_keys;`;
      assert.strictEqual(fk[0]?.foreign_keys, 1);

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
        "revisoes_ia",
        "blocos_ia",
        "tentativas_ia",
        "listas_pendencias",
        "pendencias_vivas",
        "eventos_pendencia",
        "acoes_ia",
        "copias_comentadas",
        "preferencias",
      ]) {
        assert.isTrue(tabelas.has(nome), `tabela ausente: ${nome}`);
      }

      const colunasLista = (yield* sql<{ name: string }>`PRAGMA table_info(listas_pendencias)`).map((c) => c.name);
      assert.notInclude(colunasLista, "nonce");
      assert.include(colunasLista, "resultados_ia");

      const colunasRevisao = (yield* sql<{ name: string }>`PRAGMA table_info(revisoes_ia)`).map((c) => c.name);
      assert.include(colunasRevisao, "lista_id");
      assert.notInclude(colunasRevisao, "cnct");
      assert.notInclude(colunasRevisao, "forma");
    }).pipe(Effect.provide(emMemoria)),
  );

  it.effect("recusa banco criado por versão mais nova do app (downgrade) e histórico incompatível", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* Banco.rodarMigracoes(ULTIMA);

      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${ULTIMA + 1}, 'Futura')`;
      const erroDowngrade = yield* Banco.rodarMigracoes(ULTIMA).pipe(Effect.flip);
      assert.strictEqual(erroDowngrade._tag, "BancoIncompativel");
      assert.include(erroDowngrade.message, "versão mais nova");

      yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = ${ULTIMA + 1}`;
      yield* sql`UPDATE effect_sql_migrations SET name = 'AntigaDiferente' WHERE migration_id = 1`;
      const erroIncompativel = yield* Banco.rodarMigracoes(ULTIMA).pipe(Effect.flip);
      assert.strictEqual(erroIncompativel._tag, "BancoIncompativel");
      assert.include(erroIncompativel.message, "não é compatível");
    }).pipe(Effect.provide(emMemoria)),
  );

  it.effect("violação de FK dentro de uma migração faz rollback e mantém o banco na versão anterior", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* Banco.rodarMigracoes(ULTIMA);

      const migracaoQuebrada: Banco.EntradaMigracao = [
        ULTIMA + 1,
        "QuebraFk",
        Effect.gen(function* () {
          const s = yield* SqlClient.SqlClient;
          yield* s`
            INSERT INTO pendencias_vivas (lista_id, chave, ordem, pendencia, situacao)
            VALUES ('lista-inexistente', 'CT-X:1', 0, '{}', 'aberta')
          `;
        }),
      ];
      const erro = yield* Banco.rodarMigracoes(ULTIMA + 1, {
        migracoes: [...Banco.MIGRACOES, migracaoQuebrada],
      }).pipe(Effect.flip);
      assert.strictEqual(erro._tag, "MigrationError");
      assert.include(String(erro.cause), "MigracaoViolouIntegridade");

      const orfaos = yield* sql`SELECT * FROM pendencias_vivas WHERE lista_id = 'lista-inexistente'`;
      assert.strictEqual(orfaos.length, 0);
      const aplicada = yield* sql`SELECT * FROM effect_sql_migrations WHERE migration_id = ${ULTIMA + 1}`;
      assert.strictEqual(aplicada.length, 0);
      const fk = yield* sql<{ foreign_keys: number }>`PRAGMA foreign_keys;`;
      assert.strictEqual(fk[0]?.foreign_keys, 1);
    }).pipe(Effect.provide(emMemoria)),
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
