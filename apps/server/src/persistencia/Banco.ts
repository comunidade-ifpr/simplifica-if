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
import * as Clock from "effect/Clock";
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
import Migracao0002 from "./migracoes/0002_ResultadosIaNaLista.ts";
import Migracao0003 from "./migracoes/0003_ApagamentosPendentes.ts";
import Migracao0004 from "./migracoes/0004_TextoDaPendenciaEmPartes.ts";
import Migracao0005 from "./migracoes/0005_RevisaoPpcSemCopias.ts";

/** O nome do arquivo do banco na pasta de estado do app. */
export const ARQUIVO_BANCO = "conversas.sqlite";

/** Quantas cópias `.v<id>.bak` manter ao lado do arquivo do banco, e por quantos dias. */
const MAX_BACKUPS = 2;
const DIAS_BACKUP = 14;

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

/**
 * As migrações, em ordem. Cada migração commitada em `main` é imutável: mudanças de schema ou novos
 * campos obrigatórios em colunas JSON entram numa migração nova (com teste de upgrade em
 * `test/migracoes.test.ts`).
 */
export const MIGRACOES: ReadonlyArray<EntradaMigracao> = [
  [1, "Inicial", Migracao0001],
  [2, "ResultadosIaNaLista", Migracao0002],
  [3, "ApagamentosPendentes", Migracao0003],
  [4, "TextoDaPendenciaEmPartes", Migracao0004],
  [5, "RevisaoPpcSemCopias", Migracao0005],
];

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
 * antigos de desenvolvimento com histórico diferente. Devolve o maior `migration_id` já aplicado (ou null).
 */
const conferirHistorico = Effect.fn("Banco.conferirHistorico")(function* (lista: ReadonlyArray<EntradaMigracao>) {
  const sql = yield* SqlClient.SqlClient;
  const versaoApp = ultimaDe(lista);
  const tabela = yield* sql<{ name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
  `;
  if (tabela.length === 0) return null;
  const aplicadas = yield* sql<{ migration_id: number; name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
  `;
  if (aplicadas.length === 0) return null;
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
  return aplicadas[aplicadas.length - 1]!.migration_id;
});

/**
 * Remove cópias `.v<id>.bak` mais velhas que `DIAS_BACKUP` dias (para não furar a retenção de conversas
 * e PPCs apagados) e mantém no máximo `MAX_BACKUPS` arquivos.
 */
const limparBackups = Effect.fn("Banco.limparBackups")(function* (
  arquivo: string,
  fs: FileSystem.FileSystem,
  path: Path.Path,
) {
  const dir = path.dirname(arquivo);
  const base = path.basename(arquivo);
  const entradas = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => [] as string[]));
  const prefixo = `${base}.v`;
  const backups = entradas
    .filter((nome) => nome.startsWith(prefixo) && nome.endsWith(".bak"))
    .map((nome) => ({ nome, caminho: path.join(dir, nome), versao: Number(nome.slice(prefixo.length, -4)) }))
    .filter((item) => Number.isFinite(item.versao))
    .sort((a, b) => b.versao - a.versao);
  const agoraMs = yield* Clock.currentTimeMillis;
  const limiteMs = agoraMs - DIAS_BACKUP * 24 * 60 * 60 * 1000;
  for (let i = 0; i < backups.length; i++) {
    const item = backups[i]!;
    if (i >= MAX_BACKUPS) {
      yield* fs.remove(item.caminho, { force: true }).pipe(Effect.ignore);
      continue;
    }
    const info = yield* fs.stat(item.caminho).pipe(Effect.orElseSucceed(() => null));
    const mtime = info?.mtime._tag === "Some" ? info.mtime.value.getTime() : null;
    if (mtime !== null && mtime < limiteMs) {
      yield* fs.remove(item.caminho, { force: true }).pipe(Effect.ignore);
    }
  }
});

/**
 * Grava um snapshot consistente em `<arquivo>.v<versao>.bak` (`VACUUM INTO` via `.tmp` + `rename`) antes
 * de aplicar migrações pendentes. Falha de disco ou arquivo travado registra aviso sem bloquear a partida.
 */
const backupAntesDeMigrar = Effect.fn("Banco.backupAntesDeMigrar")(function* (
  arquivo: string,
  ultima: number,
  fs: FileSystem.FileSystem,
  path: Path.Path,
) {
  const sql = yield* SqlClient.SqlClient;
  const copia = `${arquivo}.v${ultima}.bak`;
  const tmp = `${copia}.tmp`;
  yield* Effect.gen(function* () {
    yield* fs.remove(tmp, { force: true }).pipe(Effect.ignore);
    // `VACUUM INTO` gera um arquivo único e consistente mesmo em modo WAL.
    yield* sql`VACUUM INTO ${tmp}`;
    yield* fs.rename(tmp, copia);
    yield* Effect.logInfo(`cópia de segurança do banco salva antes da migração: ${copia}`);
    yield* limparBackups(arquivo, fs, path);
  }).pipe(
    Effect.catchCause((causa) =>
      Effect.logWarning(`não foi possível salvar cópia de segurança do banco em ${copia}`, causa).pipe(
        Effect.andThen(fs.remove(tmp, { force: true }).pipe(Effect.ignore)),
      ),
    ),
  );
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
  opcoes?: {
    readonly migracoes?: ReadonlyArray<EntradaMigracao>;
    readonly backup?: {
      readonly arquivo: string;
      readonly fs: FileSystem.FileSystem;
      readonly path: Path.Path;
    };
  },
) {
  const lista = opcoes?.migracoes ?? MIGRACOES;
  const alvo = ate ?? ultimaDe(lista);
  const sql = yield* SqlClient.SqlClient;
  const ultima = yield* conferirHistorico(lista);
  if (opcoes?.backup !== undefined) {
    if (ultima !== null && ultima < alvo) {
      yield* backupAntesDeMigrar(opcoes.backup.arquivo, ultima, opcoes.backup.fs, opcoes.backup.path);
    } else {
      yield* limparBackups(opcoes.backup.arquivo, opcoes.backup.fs, opcoes.backup.path);
    }
  }
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

const preparar = (backup?: {
  readonly arquivo: string;
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
}) =>
  Layer.effectDiscard(
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
      yield* rodarMigracoes(undefined, backup === undefined ? undefined : { backup });
    }).pipe(Effect.withSpan("Banco.preparar")),
  );

/** O banco num arquivo (a pasta é criada se faltar), migrado (com cópia `.v<id>.bak` se houver upgrade). */
export const layerArquivo = (arquivo: string) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* fs.makeDirectory(path.dirname(arquivo), { recursive: true });
      // Sem os workers do T3: o servidor é o único processo, e os registros são pequenos.
      return Layer.provideMerge(preparar({ arquivo, fs, path }), NodeSqliteClient.layer({ filename: arquivo }));
    }),
  );

/** O banco na memória, migrado (testes e o servidor sem pasta de estado). */
export const layerMemoria = Layer.provideMerge(preparar(), NodeSqliteClient.layer({ filename: ":memory:" }));
