/**
 * Transação sobre um `DatabaseSync` do `node:sqlite`, no lugar do `db.transaction(fn)()` do Bun:
 * `BEGIN`, a função e `COMMIT`, com `ROLLBACK` se ela lançar.
 */
import type { DatabaseSync } from "node:sqlite";

export function emTransacao<T>(db: DatabaseSync, fn: () => T): T {
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
