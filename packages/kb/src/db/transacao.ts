/**
 * Transação sobre um `NodeSqlite.DatabaseSync` do `node:sqlite`, no lugar do `db.transaction(fn)()` do Bun:
 * `BEGIN`, a função e `COMMIT`, com `ROLLBACK` se ela lançar.
 */
// @effect-diagnostics nodeBuiltinImport:off -- transação sobre o NodeSqlite.DatabaseSync da compilação e das fixtures
import type * as NodeSqlite from "node:sqlite";

export function emTransacao<T>(db: NodeSqlite.DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const resultado = fn();
    db.exec("COMMIT");
    return resultado;
  } catch (erro) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw erro;
  }
}
