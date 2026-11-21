/**
 * O banco das conversas: `effect/sql` sobre `node:sqlite` (o `nodeSqliteClient` do T3, já copiado em
 * `@simplifica-if/kb`), num arquivo da pasta de estado do app (`conversas.sqlite`), com as migrações em
 * Effect (`effect/sql/Migrator`).
 *
 * Segue o `apps/server/src/persistence/Sqlite.ts` e o `Migrations.ts` do T3 (MIT, Copyright (c) 2026
 * T3 Tools Inc.; registro em `docs/upstream-t3.md`): os `PRAGMA` da abertura são os dele, em trechos
 * marcados `// T3:`; as migrações rodam uma a uma, cada uma na própria transação, numa lista
 * `[id, nome, efeito]`. Ficaram de fora a trava de dono do banco (aqui só o servidor abre o arquivo), o
 * `VACUUM` incremental e a conferência de histórico do V2.
 *
 * O banco não guarda segredo: nem o token do RPC, nem o do MCP de cada sessão, nem credencial de
 * provider. Guarda o texto das mensagens, os eventos normalizados (que podem trazer trechos de
 * documentos da pasta de trabalho, como a própria conversa) e o id nativo de cada conversa no provider.
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";
import * as Migrator from "effect/sql/Migrator";
import * as NodeSqliteClient from "@simplifica-if/kb/db/nodeSqliteClient";
import Migracao0001 from "./migracoes/0001_Inicial.ts";

/** O nome do arquivo do banco na pasta de estado do app. */
export const ARQUIVO_BANCO = "conversas.sqlite";

/**
 * As migrações, em ordem. Enquanto o app não tem usuários, a 1 é o banco inteiro e muda no lugar (apague
 * o `conversas.sqlite` de desenvolvimento); depois do primeiro piloto, cada mudança é uma migração nova.
 */
const MIGRACOES = [[1, "Inicial", Migracao0001]] as const;

const carregador = (ate: number) =>
  Migrator.fromRecord(
    Object.fromEntries(
      MIGRACOES.filter(([id]) => id <= ate).map(([id, nome, migracao]) => [`${id}_${nome}`, migracao] as const),
    ),
  );

const migrar = Migrator.make({});

/**
 * Roda as migrações que faltam, uma por vez (como o T3: cada uma na própria transação, e um
 * reinício continua da última que terminou). Devolve as que rodaram.
 */
export const rodarMigracoes = Effect.fn("Banco.rodarMigracoes")(function* () {
  const executadas: Array<readonly [id: number, nome: string]> = [];
  for (const [id] of MIGRACOES) {
    executadas.push(...(yield* migrar({ loader: carregador(id) })));
  }
  if (executadas.length > 0) {
    yield* Effect.logInfo(`banco das conversas migrado: ${executadas.map(([id, nome]) => `${id}_${nome}`).join(", ")}`);
  }
  return executadas;
});

const preparar = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // T3: CLI and server write from separate processes; wait rather than fail with SQLITE_BUSY.
    yield* sql`PRAGMA busy_timeout = 5000;`;
    yield* sql`PRAGMA foreign_keys = ON;`;
    yield* sql`PRAGMA journal_mode = WAL;`;
    // T3: FULL fsyncs every event commit; NORMAL syncs only at WAL checkpoints.
    yield* sql`PRAGMA synchronous = NORMAL;`;
    // T3: macOS fsync misses drive caches; F_FULLFSYNC flushes them at checkpoints and is ignored elsewhere.
    yield* sql`PRAGMA checkpoint_fullfsync = ON;`;
    yield* sql`PRAGMA temp_store = MEMORY;`;
    yield* rodarMigracoes();
  }).pipe(Effect.withSpan("Banco.preparar")),
);

/** O banco num arquivo (a pasta é criada se faltar), migrado. */
export const layerArquivo = (arquivo: string) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* fs.makeDirectory(path.dirname(arquivo), { recursive: true });
      // Sem os workers do T3: o servidor é o único processo, e os registros são pequenos.
      return Layer.provideMerge(preparar, NodeSqliteClient.layer({ filename: arquivo }));
    }),
  );

/** O banco na memória, migrado (testes e o servidor sem pasta de estado). */
export const layerMemoria = Layer.provideMerge(preparar, NodeSqliteClient.layer({ filename: ":memory:" }));
