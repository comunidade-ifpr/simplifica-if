/**
 * `BaseKb`: o `kb.sqlite` aberto e conferido. A layer lê a tabela `meta` uma vez, confere a versão
 * do esquema e valida o resto (data de referência, impressão digital das fontes, contagens e a
 * identificação do build); um banco de outro esquema ou sem `meta` falha a layer com
 * `BaseIncompativel`, antes de qualquer consulta.
 *
 * Abre o banco por um `SqlClient` (`layerSqlite`, sobre `node:sqlite`, só leitura): não lê o
 * repositório nem compila. A recompilação a partir do checkout é do `Compilador`.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "./db/nodeSqliteClient.ts";
import * as Sql from "./db/sql.ts";
import { VERSAO_ESQUEMA } from "./db/esquema.ts";
import { formatarErro } from "./esquema/mensagens.ts";

/** Canais de distribuição do build (`meta.canal`). */
export const CANAIS = ["piloto", "estavel", "dev"] as const;
export type Canal = (typeof CANAIS)[number];

export class BaseIncompativel extends Schema.TaggedError<BaseIncompativel>()("BaseIncompativel", {
  /** `esquema`: `versao_esquema` diferente; `meta`: tabela `meta` ausente ou fora do formato. */
  motivo: Schema.Literals(["esquema", "meta"]),
  /** Versão do esquema gravada no banco (`null` se ausente). */
  encontrado: Schema.NullOr(Schema.String),
  /** O que a validação da `meta` acusou (texto do formatador pt-BR, sem dado do banco). */
  problema: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    if (this.motivo === "esquema") {
      return `base incompatível com esta versão do kb (esquema da base: ${this.encontrado ?? "ausente"}; esperado: ${VERSAO_ESQUEMA})`;
    }
    return `base incompatível com esta versão do kb (tabela meta${this.problema ? `: ${this.problema}` : " ilegível"})`;
  }
}

export const ehBaseIncompativel = Schema.is(BaseIncompativel);

export class BaseAusente extends Schema.TaggedError<BaseAusente>()("BaseAusente", {
  caminho: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    return `kb.sqlite não encontrado ou ilegível: ${this.caminho}`;
  }
}

export const ehBaseAusente = Schema.is(BaseAusente);

/** A tabela `meta`, validada. */
export interface MetaBase {
  readonly versao_esquema: number;
  /** Data em que a vigência foi calculada (`config/vigencia.yaml`), AAAA-MM-DD. */
  readonly data_referencia: string;
  readonly fontes_sha256: string;
  readonly contagens: Readonly<Record<string, number>>;
  /** `versao`, `commit` e `canal` só existem quando o build os informa (`--versao`, `--commit`, `--canal`). */
  readonly versao: string | null;
  readonly commit: string | null;
  readonly canal: Canal | null;
  /** Todas as linhas de `meta`, por chave (inclusive as contagens e hashes que não estão acima). */
  readonly linhas: Readonly<Record<string, string>>;
}

const LinhaMeta = Schema.Struct({ chave: Schema.String, valor: Schema.String });
const linhasMeta = Sql.todas(LinhaMeta);

const Texto = Schema.String.check(Schema.isMinLength(1));
const esquemaMeta = Schema.Struct({
  data_referencia: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/, { message: "esperava AAAA-MM-DD" })),
  fontes_sha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/, { message: "esperava um sha256" })),
  contagens_json: Schema.fromJsonString(
    Schema.Record(Schema.String, Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  ),
  versao: Schema.optionalKey(Texto),
  commit: Schema.optionalKey(Texto),
  canal: Schema.optionalKey(Schema.Literals(CANAIS)),
});
const decodificarMeta = Schema.decodeUnknownEffect(esquemaMeta);

export class BaseKb extends Context.Service<
  BaseKb,
  {
    /** A `meta` do banco, lida e conferida na construção da layer. */
    readonly meta: MetaBase;
  }
>()("@simplifica-if/kb/BaseKb") {}

const make = Effect.gen(function* () {
  const linhas = yield* linhasMeta("SELECT chave, valor FROM meta ORDER BY chave").pipe(
    Effect.catchTags({
      FalhaNaConsulta: (cause) => Effect.fail(new BaseIncompativel({ motivo: "meta", encontrado: null, cause })),
    }),
  );
  const valores: Record<string, string> = Object.fromEntries(linhas.map((l) => [l.chave, l.valor]));
  const versao = valores["versao_esquema"] ?? null;
  if (versao !== String(VERSAO_ESQUEMA)) {
    return yield* new BaseIncompativel({ motivo: "esquema", encontrado: versao });
  }
  const meta = yield* decodificarMeta(valores).pipe(
    Effect.catchTags({
      SchemaError: (cause) =>
        Effect.fail(new BaseIncompativel({ motivo: "meta", encontrado: versao, problema: formatarErro(cause), cause })),
    }),
  );
  return BaseKb.of({
    meta: {
      versao_esquema: VERSAO_ESQUEMA,
      data_referencia: meta.data_referencia,
      fontes_sha256: meta.fontes_sha256,
      contagens: meta.contagens_json,
      versao: meta.versao ?? null,
      commit: meta.commit ?? null,
      canal: meta.canal ?? null,
      linhas: valores,
    },
  });
});

/** `BaseKb` sobre o `SqlClient` do ambiente. */
export const layer = Layer.effect(BaseKb, make);

/**
 * O `SqlClient` do `kb.sqlite` em `caminho`, só leitura, sem workers. Falha com `BaseAusente` se o
 * arquivo não existe ou não é um banco SQLite.
 */
export const layerSqlite = (opcoes: { readonly caminho: string }): Layer.Layer<SqlClient.SqlClient, BaseAusente> =>
  NodeSqliteClient.layer({ filename: opcoes.caminho, readonly: true }).pipe(
    Layer.catchTag("SqlError", (cause) =>
      Layer.effect(SqlClient.SqlClient, Effect.fail(new BaseAusente({ caminho: opcoes.caminho, cause }))),
    ),
  );
