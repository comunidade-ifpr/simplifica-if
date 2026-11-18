/**
 * Layers prontas para quem consome o kb.
 *
 * - `layerSomenteLeitura({ caminho })`: o `kb.sqlite` em `caminho`, só leitura, e todos os serviços
 *   de consulta, com as fontes remontadas das tabelas. Não exige `FileSystem`: o tipo garante que
 *   nada no caminho lê o repositório. É a do servidor MCP e a do fork.
 * - `layerRepositorio({ raiz })`: o checkout em `raiz`. Recompila o `tmp/kb.sqlite` quando ele está
 *   ausente ou mais velho que as fontes (`KB_SQLITE` muda o caminho; `KB_RECOMPILAR=nunca|sempre`
 *   desliga ou força) e lê as fontes normativas dos arquivos. É a da CLI.
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
import * as Cursos from "./Cursos.ts";
import * as FontesNormativas from "./FontesNormativas.ts";
import * as Impacto from "./Impacto.ts";
import * as Normas from "./Normas.ts";
import * as PacoteContexto from "./PacoteContexto.ts";
import * as Ppcs from "./Ppcs.ts";
import type * as Sql from "./db/sql.ts";
import { CAMINHOS } from "./caminhos.ts";

/** Os serviços de consulta. */
export type ServicosConsulta =
  | Normas.Normas
  | Ppcs.Ppcs
  | Cursos.Cursos
  | Impacto.Impacto
  | PacoteContexto.PacoteContexto
  | FontesNormativas.FontesNormativas
  | BaseKb.BaseKb
  | SqlClient.SqlClient;

/** Os serviços de consulta sobre o `SqlClient` e as `FontesNormativas` do ambiente. */
export const layerConsultas = Layer.mergeAll(
  Normas.layer,
  Ppcs.layer,
  Cursos.layer,
  Impacto.layer,
  PacoteContexto.layer,
  BaseKb.layer,
);

/** O `kb.sqlite` em `caminho`, só leitura, sem o repositório. */
export const layerSomenteLeitura = (opcoes: {
  readonly caminho: string;
}): Layer.Layer<ServicosConsulta, BaseKb.BaseAusente | BaseKb.BaseIncompativel | Sql.FalhaNaConsulta> =>
  layerConsultas.pipe(Layer.provideMerge(FontesNormativas.layerBanco), Layer.provideMerge(BaseKb.layerSqlite(opcoes)));

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

/** O checkout em `raiz`: banco recompilado se preciso e fontes normativas lidas dos arquivos. */
export const layerRepositorio = (opcoes: {
  readonly raiz: string;
}): Layer.Layer<
  ServicosConsulta | Compilador.Compilador,
  | BaseKb.BaseAusente
  | BaseKb.BaseIncompativel
  | Sql.FalhaNaConsulta
  | FontesNormativas.FalhaNasFontes
  | Compilador.FalhaNaCompilacao
  | Compilador.BaseDesatualizada
  | Config.ConfigError,
  FileSystem.FileSystem | Path.Path
> =>
  layerConsultas.pipe(
    Layer.provideMerge(FontesNormativas.layerArquivos(opcoes)),
    Layer.provideMerge(layerSqliteFresco(opcoes.raiz)),
    Layer.provideMerge(Compilador.layer),
  );
