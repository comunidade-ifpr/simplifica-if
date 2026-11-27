/**
 * Consultas ao `kb.sqlite` pelo `SqlClient`, com as linhas decodificadas por Effect Schema na
 * borda: `todas(Linha)` e `primeira(Linha)` compilam o decodificador uma vez (no nível do módulo
 * de quem as chama) e devolvem a função de consulta.
 *
 *   const linhasMeta = Sql.todas(Schema.Struct({ chave: Schema.String, valor: Schema.String }));
 *   const meta = yield* linhasMeta("SELECT chave, valor FROM meta ORDER BY chave");
 *
 * O SQL usa `?` posicionais, como o `node:sqlite` direto. Uma falha do SQLite ou uma linha fora do
 * schema é `FalhaNaConsulta`: o banco está corrompido ou não é deste esquema. O rótulo do erro é o
 * começo do SQL (código do kb, nunca dado de usuário).
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

/** Valor que o `node:sqlite` aceita como parâmetro posicional. */
export type Parametro = string | number | bigint | null | Uint8Array;

export class FalhaNaConsulta extends Schema.TaggedError<FalhaNaConsulta>()("FalhaNaConsulta", {
  consulta: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `falha ao ler o kb.sqlite (${this.consulta})`;
  }
}

export const ehFalhaNaConsulta = Schema.is(FalhaNaConsulta);

function rotulo(texto: string): string {
  const compacto = texto.replace(/\s+/g, " ").trim();
  return compacto.length > 80 ? `${compacto.slice(0, 80)}…` : compacto;
}

/** Consulta que devolve todas as linhas, decodificadas por `Linha`, na ordem do SQL. */
export function todas<S extends Schema.Decoder<unknown>>(Linha: S) {
  const decodificar = Schema.decodeUnknownEffect(Schema.Array(Linha));
  return (
    texto: string,
    parametros: ReadonlyArray<Parametro> = [],
  ): Effect.Effect<ReadonlyArray<S["Type"]>, FalhaNaConsulta, SqlClient.SqlClient | S["DecodingServices"]> =>
    SqlClient.SqlClient.pipe(
      Effect.flatMap((sql) => sql.unsafe(texto, parametros)),
      Effect.flatMap(decodificar),
      Effect.mapError((cause) => new FalhaNaConsulta({ consulta: rotulo(texto), cause })),
    );
}

/** Consulta que devolve a primeira linha (o `.get()` do `node:sqlite`) ou `undefined`. */
export function primeira<S extends Schema.Decoder<unknown>>(Linha: S) {
  const consultar = todas(Linha);
  return (
    texto: string,
    parametros: ReadonlyArray<Parametro> = [],
  ): Effect.Effect<S["Type"] | undefined, FalhaNaConsulta, SqlClient.SqlClient | S["DecodingServices"]> =>
    Effect.map(consultar(texto, parametros), (linhas) => linhas[0]);
}

/**
 * Os serviços de que as consultas de um serviço precisam (o `SqlClient` e, se elas pedem, as
 * `FontesNormativas`), capturados na construção da layer, e o combinador que os dá a cada método: as
 * consultas pedem o banco do ambiente (o PPC avulso do `PacoteRevisaoPpc` as roda sobre outro), e os
 * métodos não pedem nada. Só os serviços nomeados: o resto do contexto da construção (o `Scope` da
 * layer, o span pai) não passa por cima do de quem chama, e um recurso aberto num método fecha com o
 * escopo de quem o chamou.
 */
export const ambienteDoServico = <const S extends ReadonlyArray<Context.Key<unknown, unknown>>>(...servicos: S) =>
  Effect.map(Effect.context<Context.Service.Identifier<S[number]>>(), (contexto) =>
    Effect.provideContext(Context.pick(...servicos)(contexto)),
  );
