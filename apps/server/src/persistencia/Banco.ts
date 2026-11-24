/**
 * O banco das conversas: `effect/sql` sobre `node:sqlite` (o `nodeSqliteClient` do T3, já copiado em
 * `@simplifica-if/kb`), num arquivo da pasta de estado do app (`conversas.sqlite`), com as migrações em
 * Effect (`effect/sql/Migrator`).
 *
 * Segue o `apps/server/src/persistence/Sqlite.ts` e o `Migrations.ts` do T3 (MIT, Copyright (c) 2026
 * T3 Tools Inc.; registro em `docs/upstream-t3.md`): os `PRAGMA` da abertura são os dele, em trechos
 * marcados `// T3:`; as migrações rodam uma a uma, cada uma na própria transação, numa lista
 * `[id, nome, efeito]`. Ficaram de fora a trava de dono do banco (aqui só o servidor abre o arquivo) e o
 * `VACUUM` incremental.
 *
 * O banco não guarda segredo: nem o token do RPC, nem o do MCP de cada sessão, nem credencial de
 * provider. Guarda o texto das mensagens, os eventos normalizados (que podem trazer trechos de
 * documentos da pasta de trabalho, como a própria conversa) e o id nativo de cada conversa no provider.
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type * as SqlError from "effect/sql/SqlError";
import * as Migrator from "effect/sql/Migrator";
import * as NodeSqliteClient from "@simplifica-if/kb/db/nodeSqliteClient";
import Migracao0001 from "./migracoes/0001_Inicial.ts";

/** O nome do arquivo do banco na pasta de estado do app. */
export const ARQUIVO_BANCO = "conversas.sqlite";

export type EntradaMigracao = readonly [
  id: number,
  nome: string,
  efeito: Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient>,
];

/**
 * O banco tem um histórico de migrações que esta versão do app não reconhece (banco de uma versão mais
 * nova do app, ou banco antigo de desenvolvimento com ids incompatíveis).
 */
export class BancoIncompativel extends Schema.TaggedError<BancoIncompativel>()("BancoIncompativel", {
  motivo: Schema.String,
  versaoBanco: Schema.NullOr(Schema.Number),
  versaoApp: Schema.Number,
}) {
  override get message(): string {
    return this.motivo;
  }
}

/** Uma migração deixou alguma chave estrangeira quebrada; a transação dela foi desfeita. */
export class MigracaoViolouIntegridade extends Schema.TaggedError<MigracaoViolouIntegridade>()(
  "MigracaoViolouIntegridade",
  {
    migracao: Schema.String,
    violacoes: Schema.String,
  },
) {
  override get message(): string {
    return `A migração ${this.migracao} violou a integridade referencial do banco (${this.violacoes}).`;
  }
}

/** As migrações, em ordem. */
export const MIGRACOES: ReadonlyArray<EntradaMigracao> = [[1, "Inicial", Migracao0001]];

const ultimaDe = (lista: ReadonlyArray<EntradaMigracao>) => lista[lista.length - 1]![0];

/** Confere `PRAGMA foreign_key_check` dentro da transação da migração: se falhar, a transação sofre rollback. */
const checarFks = Effect.fn("Banco.checarFks")(function* (rotulo: string) {
  const sql = yield* SqlClient.SqlClient;
  const violacoes = yield* sql<{ table: string; rowid: number | null; parent: string }>`PRAGMA foreign_key_check;`;
  if (violacoes.length > 0) {
    const resumo = violacoes.map((v) => `${v.table}(rowid=${v.rowid ?? "?"})->${v.parent}`).join(", ");
    return yield* new MigracaoViolouIntegridade({ migracao: rotulo, violacoes: resumo });
  }
});

const carregador = (lista: ReadonlyArray<EntradaMigracao>, ate: number) =>
  Migrator.fromRecord(
    Object.fromEntries(
      lista
        .filter(([id]) => id <= ate)
        .map(([id, nome, migracao]) => {
          const rotulo = `${id}_${nome}`;
          return [rotulo, migracao.pipe(Effect.andThen(checarFks(rotulo)))] as const;
        }),
    ),
  );

const migrar = Migrator.make({});

/**
 * Exige que as linhas já registradas em `effect_sql_migrations` sejam um prefixo exato de `lista`.
 * Protege contra downgrade (abrir versão mais velha do app sobre banco mais novo) e contra bancos
 * antigos de desenvolvimento com histórico diferente.
 */
const conferirHistorico = Effect.fn("Banco.conferirHistorico")(function* (lista: ReadonlyArray<EntradaMigracao>) {
  const sql = yield* SqlClient.SqlClient;
  const versaoApp = ultimaDe(lista);
  const tabela = yield* sql<{ name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
  `;
  if (tabela.length === 0) return;
  const aplicadas = yield* sql<{ migration_id: number; name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
  `;
  for (let i = 0; i < aplicadas.length; i++) {
    const row = aplicadas[i]!;
    const esperada = lista[i];
    if (esperada === undefined) {
      const versaoBanco = aplicadas[aplicadas.length - 1]!.migration_id;
      return yield* new BancoIncompativel({
        versaoBanco,
        versaoApp,
        motivo: `Este banco foi atualizado por uma versão mais nova do Simplifica IF (versão ${versaoBanco}; este app suporta até ${versaoApp}). Atualize o Simplifica IF antes de abrir.`,
      });
    }
    if (row.migration_id !== esperada[0] || row.name !== esperada[1]) {
      const versaoBanco = aplicadas[aplicadas.length - 1]!.migration_id;
      return yield* new BancoIncompativel({
        versaoBanco,
        versaoApp,
        motivo: `O histórico de migrações deste banco não é compatível com esta versão do Simplifica IF (encontrado ${row.migration_id}_${row.name}, esperado ${esperada[0]}_${esperada[1]}). Se for um banco antigo de desenvolvimento, apague o arquivo ${ARQUIVO_BANCO}.`,
      });
    }
  }
});

/**
 * Roda as migrações que faltam até `ate` (padrão: todas), uma por vez (cada uma na própria transação).
 *
 * Depende de uma única conexão SQLite (sem `writerWorker`/`readerWorker` separados): desliga
 * `PRAGMA foreign_keys` fora das transações (confirmando que ficou em 0 para evitar `ON DELETE CASCADE`
 * silencioso ao recriar tabelas pai), confere `PRAGMA foreign_key_check` dentro de cada transação
 * (desfazendo a migração em caso de violação) e religa `foreign_keys` ao fim.
 */
export const rodarMigracoes = Effect.fn("Banco.rodarMigracoes")(function* (
  ate?: number,
  opcoes?: { readonly migracoes?: ReadonlyArray<EntradaMigracao> },
) {
  const lista = opcoes?.migracoes ?? MIGRACOES;
  const alvo = ate ?? ultimaDe(lista);
  const sql = yield* SqlClient.SqlClient;
  yield* conferirHistorico(lista);
  const executadas: Array<readonly [id: number, nome: string]> = [];
  yield* sql`PRAGMA foreign_keys = OFF;`;
  const desligado = yield* sql<{ foreign_keys: number }>`PRAGMA foreign_keys;`;
  if (desligado[0]?.foreign_keys !== 0) {
    return yield* Effect.die(new Error("não foi possível desligar PRAGMA foreign_keys antes das migrações"));
  }
  yield* Effect.gen(function* () {
    for (const [id] of lista) {
      if (id > alvo) break;
      executadas.push(...(yield* migrar({ loader: carregador(lista, id) })));
    }
    if (executadas.length > 0) {
      yield* Effect.logInfo(
        `banco das conversas migrado: ${executadas.map(([id, nome]) => `${id}_${nome}`).join(", ")}`,
      );
    }
  }).pipe(Effect.ensuring(sql`PRAGMA foreign_keys = ON;`.pipe(Effect.ignore)));
  const fk = yield* sql<{ foreign_keys: number }>`PRAGMA foreign_keys;`;
  if (fk[0]?.foreign_keys !== 1) {
    return yield* Effect.die(new Error("não foi possível religar PRAGMA foreign_keys após as migrações"));
  }
  return executadas;
});

/**
 * Leva ao arquivo do banco a versão sem o que acabou de se apagar e esvazia o `-wal`, onde a versão
 * antiga das páginas ficaria até o próximo checkpoint. Chame depois de apagar dado da pessoa.
 */
export const descarregar = (sql: SqlClient.SqlClient) => sql`PRAGMA wal_checkpoint(TRUNCATE)`.pipe(Effect.asVoid);

const preparar = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // T3: CLI and server write from separate processes; wait rather than fail with SQLITE_BUSY.
    yield* sql`PRAGMA busy_timeout = 5000;`;
    yield* sql`PRAGMA journal_mode = WAL;`;
    // T3: FULL fsyncs every event commit; NORMAL syncs only at WAL checkpoints.
    yield* sql`PRAGMA synchronous = NORMAL;`;
    // T3: macOS fsync misses drive caches; F_FULLFSYNC flushes them at checkpoints and is ignored elsewhere.
    yield* sql`PRAGMA checkpoint_fullfsync = ON;`;
    yield* sql`PRAGMA temp_store = MEMORY;`;
    // Apagar apaga de fato: as páginas liberadas por um `DELETE` (o texto do PPC, as mensagens) são zeradas.
    yield* sql`PRAGMA secure_delete = ON;`;
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
