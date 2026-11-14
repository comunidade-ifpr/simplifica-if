// @effect-diagnostics nodeBuiltinImport:off -- adapta ao SqlClient um `DatabaseSync` do `node:sqlite` já aberto.
/**
 * `SqlClient` sobre um `DatabaseSync` já aberto e já preenchido: o banco em memória de um PPC fora
 * da base (`bancoDoPpcAvulso`, gravado pelo mesmo código da compilação) e os bancos de fixture dos
 * testes. As consultas do kb rodam sobre ele como sobre o `kb.sqlite`, trocando só o `SqlClient`
 * do ambiente.
 *
 * Uma conexão só, sem worker e sem cache de instruções; serve a bancos pequenos e de vida curta.
 * Para o `kb.sqlite`, use `BaseKb.layerSqlite` (o cliente do T3). `fechar: true` fecha o banco
 * quando a layer é liberada.
 */
import type * as NodeSqlite from "node:sqlite";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as SqlClient from "effect/sql/SqlClient";
import type * as SqlConnection from "effect/sql/SqlConnection";
import { classifySqliteError, SqlError } from "effect/sql/SqlError";
import * as Statement from "effect/sql/Statement";

function erroSql(cause: unknown, operacao: string): SqlError {
  // o node:sqlite informa `errcode`; o classificador do Effect espera `errno`
  if (typeof cause === "object" && cause !== null && "errcode" in cause && !("errno" in cause)) {
    Object.assign(cause, { errno: (cause as { errcode: unknown }).errcode });
  }
  return new SqlError({
    reason: classifySqliteError(cause, { message: `falha no SQLite (${operacao})`, operation: operacao }),
  });
}

function conexao(db: NodeSqlite.DatabaseSync): SqlConnection.Connection {
  const executar = (
    sql: string,
    parametros: ReadonlyArray<unknown>,
    modo: "linhas" | "valores" | "bruto",
  ): Effect.Effect<ReadonlyArray<any>, SqlError> =>
    Effect.try({
      try: () => {
        const instrucao = db.prepare(sql);
        if (instrucao.columns().length === 0) {
          const resultado = instrucao.run(...(parametros as Array<NodeSqlite.SQLInputValue>));
          return modo === "bruto" ? (resultado as unknown as ReadonlyArray<unknown>) : [];
        }
        if (modo === "valores") instrucao.setReturnArrays(true);
        return instrucao.all(...(parametros as Array<NodeSqlite.SQLInputValue>));
      },
      catch: (cause) => erroSql(cause, "execute"),
    });
  return {
    execute: (sql, parametros, transformar) =>
      Effect.map(executar(sql, parametros, "linhas"), (linhas) => (transformar ? transformar(linhas) : linhas)),
    executeRaw: (sql, parametros) => executar(sql, parametros, "bruto"),
    executeValues: (sql, parametros) =>
      executar(sql, parametros, "valores") as Effect.Effect<ReadonlyArray<ReadonlyArray<unknown>>, SqlError>,
    executeValuesUnprepared: (sql, parametros) =>
      executar(sql, parametros, "valores") as Effect.Effect<ReadonlyArray<ReadonlyArray<unknown>>, SqlError>,
    executeUnprepared: (sql, parametros, transformar) =>
      Effect.map(executar(sql, parametros, "linhas"), (linhas) => (transformar ? transformar(linhas) : linhas)),
    executeStream: () => Stream.fail(erroSql(new Error("executeStream não é suportado"), "stream")),
  };
}

/** `SqlClient` sobre `db`. Com `fechar: true`, o banco é fechado quando a layer é liberada. */
export const layerDeConexao = (
  db: NodeSqlite.DatabaseSync,
  opcoes: { readonly fechar?: boolean } = {},
): Layer.Layer<SqlClient.SqlClient> =>
  Layer.effect(
    SqlClient.SqlClient,
    Effect.gen(function* () {
      if (opcoes.fechar) yield* Effect.addFinalizer(() => Effect.sync(() => db.close()));
      return yield* SqlClient.make({
        driver: "node:sqlite",
        acquirer: Effect.succeed(conexao(db)),
        compiler: Statement.makeCompilerSqlite(),
        spanAttributes: [["db.system.name", "sqlite"]],
      });
    }),
  ).pipe(Layer.provide(Reactivity.layer));
