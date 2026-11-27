/**
 * Layers prontas para quem consome o kb.
 *
 * - `layerSomenteLeitura({ caminho })`: o `kb.sqlite` em `caminho`, só leitura, e todos os serviços
 *   de consulta, com as fontes remontadas das tabelas. Não exige `FileSystem`: o tipo garante que
 *   nada no caminho lê o repositório. É a do servidor MCP e a do app.
 * - `layerRepositorio({ raiz })`: o checkout em `raiz`. Recompila o `tmp/kb.sqlite` quando ele está
 *   ausente ou mais velho que as fontes (`KB_SQLITE` muda o caminho; `KB_RECOMPILAR=nunca|sempre`
 *   desliga ou força) e dá os mesmos serviços de `layerSomenteLeitura` sobre ele, com o `Compilador`.
 *   É a da CLI, dos scripts e dos testes que precisam do que o app vê (a revisão prévia do
 *   `packages/ppc`).
 */
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as SqlClient from "effect/sql/SqlClient";
import * as BaseKb from "./BaseKb.ts";
import * as Compilador from "./Compilador.ts";
import * as Conselhos from "./Conselhos.ts";
import * as Cursos from "./Cursos.ts";
import * as FontesNormativas from "./FontesNormativas.ts";
import * as Impacto from "./Impacto.ts";
import * as Normas from "./Normas.ts";
import * as PacoteRevisaoPpc from "./PacoteRevisaoPpc.ts";
import * as Ppcs from "./Ppcs.ts";
import type * as Sql from "./db/sql.ts";
import { CAMINHOS } from "./caminhos.ts";

/** Os serviços de consulta. */
export type ServicosConsulta =
  | Normas.Normas
  | Ppcs.Ppcs
  | Cursos.Cursos
  | Conselhos.Conselhos
  | Impacto.Impacto
  | PacoteRevisaoPpc.PacoteRevisaoPpc
  | FontesNormativas.FontesNormativas
  | BaseKb.BaseKb
  | SqlClient.SqlClient;

/** Os serviços de consulta sobre o `SqlClient` e as `FontesNormativas` do ambiente. */
export const layerConsultas = Layer.mergeAll(
  Normas.layer,
  Ppcs.layer,
  Cursos.layer,
  Conselhos.layer,
  Impacto.layer,
  PacoteRevisaoPpc.layer,
  BaseKb.layer,
);

/** O `kb.sqlite` em `caminho`, só leitura, sem o repositório. */
export const layerSomenteLeitura = (opcoes: {
  readonly caminho: string;
}): Layer.Layer<ServicosConsulta, BaseKb.BaseAusente | BaseKb.BaseIncompativel | Sql.FalhaNaConsulta> =>
  layerConsultas.pipe(Layer.provideMerge(FontesNormativas.layer), Layer.provideMerge(BaseKb.layerSqlite(opcoes)));

/** Caminho do banco da CLI: `KB_SQLITE` ou `<raiz>/tmp/kb.sqlite`. */
const caminhoDoBanco = Effect.fn("layers.caminhoDoBanco")(function* (raiz: string) {
  const path = yield* Path.Path;
  const configurado = yield* Config.option(Config.String("KB_SQLITE"));
  return Option.isSome(configurado) ? path.resolve(configurado.value) : path.join(raiz, ...CAMINHOS.banco.split("/"));
});

/** O `SqlClient` do banco da CLI, depois de garantir que ele corresponde às fontes. */
const layerSqliteFresco = (raiz: string) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const compilador = yield* Compilador.Compilador;
      const caminho = yield* caminhoDoBanco(raiz);
      const politica = yield* Config.Literals(Compilador.POLITICAS, "KB_RECOMPILAR").pipe(Config.withDefault("auto"));
      yield* compilador.garantirFresco({ raiz, caminho, politica });
      return BaseKb.layerSqlite({ caminho });
    }),
  );

/** O checkout em `raiz`: o banco recompilado se preciso e os serviços de consulta sobre ele, com o `Compilador`. */
export const layerRepositorio = (opcoes: {
  readonly raiz: string;
}): Layer.Layer<
  ServicosConsulta | Compilador.Compilador,
  | BaseKb.BaseAusente
  | BaseKb.BaseIncompativel
  | Sql.FalhaNaConsulta
  | Compilador.FalhaNaCompilacao
  | Compilador.BaseDesatualizada
  | Config.ConfigError,
  FileSystem.FileSystem | Path.Path
> =>
  layerConsultas.pipe(
    Layer.provideMerge(FontesNormativas.layer),
    Layer.provideMerge(layerSqliteFresco(opcoes.raiz)),
    Layer.provideMerge(Compilador.layer),
  );
