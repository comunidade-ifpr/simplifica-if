/**
 * As tabelas do módulo no banco das conversas: a migração inicial do núcleo cria todas, com o prefixo
 * `revisao_ppc_`, e os índices delas.
 */
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@simplifica-if/kb/db/nodeSqliteClient";
import * as Banco from "../../../src/persistencia/Banco.ts";

describe("tabelas da revisão de PPC", () => {
  it.effect("a migração cria as tabelas e os índices do módulo, todos com o prefixo", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* Banco.rodarMigracoes();
      const nomes = (tipo: string) =>
        sql<{
          name: string;
        }>`SELECT name FROM sqlite_master WHERE type = ${tipo} AND name LIKE 'revisao_ppc_%' ORDER BY name`.pipe(
          Effect.map((linhas) => linhas.map((linha) => linha.name)),
        );
      assert.deepStrictEqual(yield* nomes("table"), [
        "revisao_ppc_acoes_ia",
        "revisao_ppc_blocos_ia",
        "revisao_ppc_copias_comentadas",
        "revisao_ppc_eventos_pendencia",
        "revisao_ppc_listas_pendencias",
        "revisao_ppc_pendencias_vivas",
        "revisao_ppc_revisoes_ia",
        "revisao_ppc_tentativas_ia",
      ]);
      assert.includeMembers(yield* nomes("index"), [
        "revisao_ppc_acoes_ia_lista",
        "revisao_ppc_eventos_pendencia_lista",
        "revisao_ppc_listas_pendencias_atualizada_em",
        "revisao_ppc_revisoes_ia_atualizada_em",
        "revisao_ppc_revisoes_ia_lista",
        "revisao_ppc_tentativas_ia_revisao",
      ]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
