// @effect-diagnostics nodeBuiltinImport:off -- abre o banco temporário pelo node:sqlite direto (ver o comentário abaixo)
/**
 * `Compilador`: compila o `kb.sqlite` a partir dos arquivos do checkout e decide quando recompilar.
 *
 * A gravação usa o `DatabaseSync` do `node:sqlite` direto, numa transação (`preencherBanco` em
 * `db/compilar.ts`): são dezenas de milhares de inserções, e o `SqlClient` cobraria um efeito por
 * instrução. O banco temporário é aberto e fechado por `Effect.acquireUseRelease`; em caso de falha,
 * o temporário (até ~130 MB) é removido. O arquivo final aparece de uma vez, por renomeação.
 *
 * O estado do banco diante das fontes (`estadoDoBanco`: ausente, esquema, lista de fontes, mtime,
 * conteúdo) continua em `db/fontes.ts`, síncrono: ele percorre e hasheia milhares de fontes a cada
 * comando da CLI.
 */
import * as NodeSqlite from "node:sqlite";
import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import {
  type OpcoesCompilacao,
  preencherBanco,
  prepararCompilacao,
  type ResumoCompilacao,
  resumoCompilacao,
} from "./db/compilar.ts";
import { type Estado, estadoDoBanco } from "./db/fontes.ts";

/** `KB_RECOMPILAR`: `auto` (padrão) confere as fontes; `nunca` só abre; `sempre` recompila. */
export const POLITICAS = ["auto", "nunca", "sempre"] as const;
export type Politica = (typeof POLITICAS)[number];

export class FalhaNaCompilacao extends Schema.TaggedError<FalhaNaCompilacao>()("FalhaNaCompilacao", {
  /** `fontes`: ler ou hashear as fontes; `gravacao`: preencher, fechar ou renomear o banco. */
  etapa: Schema.Literals(["fontes", "gravacao"]),
  destino: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return this.etapa === "fontes"
      ? `não foi possível ler as fontes do kb.sqlite (${this.destino})`
      : `não foi possível gravar o kb.sqlite (${this.destino})`;
  }
}

export const ehFalhaNaCompilacao = Schema.is(FalhaNaCompilacao);

export class BaseDesatualizada extends Schema.TaggedError<BaseDesatualizada>()("BaseDesatualizada", {
  caminho: Schema.String,
  motivo: Schema.Literals(["ausente", "esquema", "lista-de-fontes", "conteudo"]),
}) {
  override get message(): string {
    return `kb.sqlite ${this.motivo === "ausente" ? "ausente" : "desatualizado"} (${this.caminho}); rode pnpm kb:compilar`;
  }
}

export const ehBaseDesatualizada = Schema.is(BaseDesatualizada);

export class Compilador extends Context.Service<
  Compilador,
  {
    /** Compila as fontes de `raiz` em `destino` (temporário + renomeação). */
    readonly compilar: (
      opcoes: Pick<OpcoesCompilacao, "versao" | "commit" | "canal"> & {
        readonly raiz: string;
        readonly destino: string;
      },
    ) => Effect.Effect<ResumoCompilacao, FalhaNaCompilacao>;
    /** O banco em `caminho` corresponde às fontes de `raiz`? (atualiza o mtime quando só ele mudou) */
    readonly estado: (opcoes: {
      readonly raiz: string;
      readonly caminho: string;
    }) => Effect.Effect<Estado, FalhaNaCompilacao>;
    /**
     * Garante um banco fresco em `caminho`, recompilando se preciso conforme a `politica`. As
     * mensagens de progresso vão para o stderr, para não sujar a saída `--json`.
     */
    readonly garantirFresco: (opcoes: {
      readonly raiz: string;
      readonly caminho: string;
      readonly politica: Politica;
    }) => Effect.Effect<void, FalhaNaCompilacao | BaseDesatualizada>;
  }
>()("@simplifica-if/kb/Compilador") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const compilar = Effect.fn("Compilador.compilar")(function* (
    opcoes: Pick<OpcoesCompilacao, "versao" | "commit" | "canal"> & { readonly raiz: string; readonly destino: string },
  ) {
    const destino = opcoes.destino;
    const falha = (etapa: "fontes" | "gravacao") => (cause: unknown) =>
      new FalhaNaCompilacao({ etapa, destino, cause });
    const leitura = yield* Clock.currentTimeMillis;
    const preparo = yield* Effect.try({ try: () => prepararCompilacao(opcoes, leitura), catch: falha("fontes") });
    const temporario = `${destino}.tmp-${process.pid}`;
    yield* fs.makeDirectory(path.dirname(destino), { recursive: true }).pipe(Effect.mapError(falha("gravacao")));
    yield* fs.remove(temporario, { force: true }).pipe(Effect.mapError(falha("gravacao")));
    const contagens = yield* Effect.acquireUseRelease(
      Effect.try({ try: () => new NodeSqlite.DatabaseSync(temporario), catch: falha("gravacao") }),
      (db) => Effect.try({ try: () => preencherBanco(db, preparo.contexto), catch: falha("gravacao") }),
      (db) => Effect.sync(() => db.close()),
    ).pipe(Effect.tapError(() => fs.remove(temporario, { force: true }).pipe(Effect.ignore)));
    // em segundos, como o `utimes` do Node
    yield* fs.utimes(temporario, leitura / 1000, leitura / 1000).pipe(Effect.mapError(falha("gravacao")));
    yield* fs.rename(temporario, destino).pipe(Effect.mapError(falha("gravacao")));
    return resumoCompilacao(preparo, contagens);
  });

  const estado = Effect.fn("Compilador.estado")(function* (opcoes: {
    readonly raiz: string;
    readonly caminho: string;
  }) {
    return yield* Effect.try({
      try: () => estadoDoBanco(opcoes.raiz, opcoes.caminho),
      catch: (cause) => new FalhaNaCompilacao({ etapa: "fontes", destino: opcoes.caminho, cause }),
    });
  });

  const garantirFresco = Effect.fn("Compilador.garantirFresco")(function* (opcoes: {
    readonly raiz: string;
    readonly caminho: string;
    readonly politica: Politica;
  }) {
    const atual: Estado =
      opcoes.politica === "sempre" ? { estado: "velho", motivo: "conteudo" } : yield* estado(opcoes);
    if (atual.estado === "fresco") return;
    if (opcoes.politica === "nunca") {
      return yield* new BaseDesatualizada({ caminho: opcoes.caminho, motivo: atual.motivo });
    }
    yield* Console.error(`kb: compilando ${opcoes.caminho} (motivo: ${atual.motivo})…`);
    const inicio = yield* Clock.currentTimeMillis;
    yield* compilar({ raiz: opcoes.raiz, destino: opcoes.caminho });
    const fim = yield* Clock.currentTimeMillis;
    yield* Console.error(`kb: banco compilado em ${((fim - inicio) / 1000).toFixed(1)} s`);
  });

  return Compilador.of({ compilar, estado, garantirFresco });
});

export const layer = Layer.effect(Compilador, make);
