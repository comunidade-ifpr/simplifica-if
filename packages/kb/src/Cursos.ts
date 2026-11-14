/**
 * `Cursos`: cursos de `dados/institucional/` com CNCT e ofertas (`kb cursos`, ferramenta
 * `listar_cursos`) e a adequação dos cursos técnicos em oferta ao art. 71 da Res. CNE/CP nº 2/2026
 * (`kb adequacao-art71`). A regra da adequação é `adequacaoArt71Em`, pura; a fonte dela (cursos e
 * citações dos PPCs) é carregada do banco antes.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import {
  adequacaoArt71Em,
  type CursoParaAdequacao,
  DCN_EPT,
  type FonteAdequacao,
  type RelatorioAdequacao,
} from "./adequacao/art71.ts";
import { type FiltrosCursos, listarCursos, type ResultadoCurso } from "./db/consultas.ts";
import * as Sql from "./db/sql.ts";

const LinhaCurso = Schema.Struct({
  campus_id: Schema.String,
  curso_slug: Schema.String,
  nome: Schema.String,
  nivel: Schema.NullOr(Schema.String),
  forma_oferta: Schema.NullOr(Schema.String),
  situacao: Schema.NullOr(Schema.String),
  ppc_markdown_path: Schema.NullOr(Schema.String),
  ppc_ano_documento: Schema.NullOr(Schema.Int),
});
const linhasCursos = Sql.todas(LinhaCurso);

const LinhaCitacao = Schema.Struct({
  path: Schema.String,
  id: Schema.NullOr(Schema.String),
  linha: Schema.Int,
  regra: Schema.String,
});
const linhasCitacoes = Sql.todas(LinhaCitacao);
const linhasPpcs = Sql.todas(Schema.Struct({ path: Schema.String }));

export class Cursos extends Context.Service<
  Cursos,
  {
    readonly listar: (filtros?: FiltrosCursos) => Effect.Effect<ResultadoCurso[], Sql.FalhaNaConsulta>;
    readonly adequacaoArt71: (opcoes?: {
      readonly incluirTecnologia?: boolean;
    }) => Effect.Effect<RelatorioAdequacao, Sql.FalhaNaConsulta>;
  }
>()("@simplifica-if/kb/Cursos") {}

/** Cursos da tabela `cursos` e citações da tabela `citacoes` (PPC pelo `path`), já em memória. */
const carregarFonteAdequacao = Effect.fn("Cursos.carregarFonteAdequacao")(function* () {
  const cursos = (yield* linhasCursos(
    "SELECT campus_id, curso_slug, nome, nivel, forma_oferta, situacao, ppc_markdown_path, ppc_ano_documento FROM cursos ORDER BY id",
  )).map((c): CursoParaAdequacao => {
    const curso: CursoParaAdequacao = { campus_id: c.campus_id, curso_slug: c.curso_slug, nome: c.nome };
    if (c.nivel !== null) curso.nivel = c.nivel;
    if (c.forma_oferta !== null) curso.forma_oferta = c.forma_oferta;
    if (c.situacao !== null) curso.situacao = c.situacao;
    if (c.ppc_markdown_path !== null || c.ppc_ano_documento !== null) {
      curso.ppc = {
        ...(c.ppc_markdown_path !== null ? { markdown_path: c.ppc_markdown_path } : {}),
        ...(c.ppc_ano_documento !== null ? { ano_documento: c.ppc_ano_documento } : {}),
      };
    }
    return curso;
  });
  // citações de cada PPC na ordem do resolvedor; PPC sem citação aparece com lista vazia. A regra só
  // olha as citações das DCN da EPT: as outras ficam no banco (o filtro da regra continua o mesmo).
  const porPpc = new Map<string, { id: string | null; linha: number; regra: string }[]>();
  for (const p of yield* linhasPpcs("SELECT path FROM ppcs")) porPpc.set(p.path, []);
  for (const c of yield* linhasCitacoes(
    `SELECT p.path, c.norma_id AS id, c.linha, c.regra FROM citacoes c JOIN ppcs p ON p.id = c.ppc_id
     WHERE c.ato_id IN (${DCN_EPT.map(() => "?").join(", ")}) ORDER BY c.ppc_id, c.ordem`,
    DCN_EPT.map((dcn) => dcn.id),
  )) {
    porPpc.get(c.path)?.push({ id: c.id, linha: c.linha, regra: c.regra });
  }
  const fonte: FonteAdequacao = {
    cursos: () => cursos,
    citacoesDoPpc: (markdown) => porPpc.get(`base-conhecimento/${markdown}`) ?? null,
  };
  return fonte;
});

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listar = Effect.fn("Cursos.listar")(
    function* (filtros: FiltrosCursos = {}) {
      return yield* listarCursos(filtros);
    },
    Effect.provideService(SqlClient.SqlClient, sql),
  );

  const adequacaoArt71 = Effect.fn("Cursos.adequacaoArt71")(
    function* (opcoes: { readonly incluirTecnologia?: boolean } = {}) {
      const fonte = yield* carregarFonteAdequacao();
      return adequacaoArt71Em(
        fonte,
        opcoes.incluirTecnologia === undefined ? {} : { incluirTecnologia: opcoes.incluirTecnologia },
      );
    },
    Effect.provideService(SqlClient.SqlClient, sql),
  );

  return Cursos.of({ listar, adequacaoArt71 });
});

export const layer = Layer.effect(Cursos, make);
