/**
 * O banco das conversas: `effect/sql` sobre `node:sqlite` (o `nodeSqliteClient` do T3, já copiado em
 * `@simplifica-if/kb`), num arquivo da pasta de estado do app (`conversas.sqlite`), com as migrações em
 * Effect (`effect/sql/Migrator`).
 *
 * Segue o `apps/server/src/persistence/Sqlite.ts` e o `Migrations.ts` do T3 (MIT, Copyright (c) 2026
 * T3 Tools Inc.; registro em `docs/upstream-t3.md`): os `PRAGMA` da abertura são os dele, em trechos
 * marcados `// T3:`; as migrações rodam pelo `Migrator` do Effect. Ficaram de fora a trava de dono do
 * banco (aqui só o servidor abre o arquivo) e o `VACUUM` incremental.
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
import Migracao0002 from "./migracoes/0002_ProblemasDasTentativas.ts";
import Migracao0003 from "./migracoes/0003_ArquivoAcompanhado.ts";
import Migracao0004 from "./migracoes/0004_ConversaAoLado.ts";
import Migracao0005 from "./migracoes/0005_AtividadesEContinuacao.ts";
import Migracao0006 from "./migracoes/0006_VocabularioRevisaoPpc.ts";
import Migracao0007 from "./migracoes/0007_ConversasDaRevisao.ts";
import Migracao0008 from "./migracoes/0008_ContinuacoesDasConversasDaRevisao.ts";

/** O nome do arquivo do banco na pasta de estado do app. */
export const ARQUIVO_BANCO = "conversas.sqlite";

export type EntradaMigracao = readonly [
  id: number,
  nome: string,
  efeito: Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient>,
];

/** As migrações, em ordem. */
export const MIGRACOES: ReadonlyArray<EntradaMigracao> = [
  [1, "Inicial", Migracao0001],
  [2, "ProblemasDasTentativas", Migracao0002],
  [3, "ArquivoAcompanhado", Migracao0003],
  [4, "ConversaAoLado", Migracao0004],
  [5, "AtividadesEContinuacao", Migracao0005],
  [6, "VocabularioRevisaoPpc", Migracao0006],
  [7, "ConversasDaRevisao", Migracao0007],
  [8, "ContinuacoesDasConversasDaRevisao", Migracao0008],
];

const loader = Migrator.fromRecord(
  Object.fromEntries(MIGRACOES.map(([id, nome, migracao]) => [`${id}_${nome}`, migracao] as const)),
);

const migrar = Migrator.make({});

/**
 * O histórico de migrações do banco não é o deste código: uma migração aplicada com outro nome (de outro
 * ramo, no banco de desenvolvimento) ou de número que este app não conhece (de uma versão mais nova). O
 * `Migrator` compara só o número e pularia a migração deste código, e o erro só apareceria na primeira
 * consulta a uma tabela que não existe.
 */
export class HistoricoDivergente extends Schema.TaggedError<HistoricoDivergente>()("HistoricoDivergente", {
  divergentes: Schema.Array(
    Schema.Struct({ id: Schema.Number, noBanco: Schema.String, noCodigo: Schema.NullOr(Schema.String) }),
  ),
}) {
  override get message(): string {
    const itens = this.divergentes.map(({ id, noBanco, noCodigo }) =>
      noCodigo === null
        ? `a ${id} ("${noBanco}") não existe neste app, que vai até a ${MIGRACOES.at(-1)?.[0] ?? 0}`
        : `a ${id} é "${noBanco}" no banco e "${noCodigo}" no código`,
    );
    return `O banco das conversas foi migrado por outra versão do Simplifica IF: ${itens.join("; ")}. Atualize o app ou, no desenvolvimento, corrija ou apague o conversas.sqlite (faça uma cópia antes).`;
  }
}

/** As migrações aplicadas que não batem com `MIGRACOES` (o banco novo, sem a tabela, não tem nenhuma). */
const conferirHistorico = Effect.fn("Banco.conferirHistorico")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tabela = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'`;
  if (tabela.length === 0) return;
  const aplicadas = yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id`;
  const doCodigo = new Map(MIGRACOES.map(([id, nome]) => [id, nome] as const));
  const divergentes = aplicadas.flatMap(({ migration_id: id, name }) => {
    const noCodigo = doCodigo.get(id);
    return noCodigo === name ? [] : [{ id, noBanco: name, noCodigo: noCodigo ?? null }];
  });
  if (divergentes.length > 0) return yield* new HistoricoDivergente({ divergentes });
});

/** Confere o histórico e roda as migrações pendentes. */
export const rodarMigracoes = Effect.fn("Banco.rodarMigracoes")(function* () {
  yield* conferirHistorico();
  const executadas = yield* migrar({ loader });
  if (executadas.length > 0) {
    yield* Effect.logInfo(`banco das conversas migrado: ${executadas.map(([id, nome]) => `${id}_${nome}`).join(", ")}`);
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
    yield* sql`PRAGMA foreign_keys = ON;`;
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
