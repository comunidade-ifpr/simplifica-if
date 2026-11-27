/**
 * `Impacto`: o que uma mudança numa norma atinge na base (`kb impacto-da-norma`, ferramenta
 * `impacto_da_norma`). A regra é `impactoEm` (`normas/impacto.ts`), pura; este serviço carrega a
 * fonte dela: registro, vigência e relações de `FontesNormativas`, e do banco a correspondência, os
 * segmentos de outras normas que citam e os PPCs.
 *
 * Os critérios da revisão de PPC (as fichas) não são base e ficam de fora: os que uma norma atinge
 * vêm do `PacoteRevisaoPpc.criterios` (ferramenta `criterios_revisao_ppc`).
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as FontesNormativas from "./FontesNormativas.ts";
import * as Citacoes from "./db/citacoes.ts";
import { carregarFonteCorrespondencia } from "./db/consultas-normas.ts";
import * as Sql from "./db/sql.ts";
import { type FonteImpacto, impactoEm, type ResultadoImpacto } from "./normas/impacto.ts";

const LinhaSegmento = Schema.Struct({
  norma_id: Schema.String,
  segmento: Schema.String,
  citado_id: Schema.String,
  dispositivos_json: Schema.fromJsonString(Schema.Array(Schema.String)),
  trecho: Schema.String,
});
const linhasSegmentos = Sql.todas(LinhaSegmento);

interface OpcoesImpacto {
  /** Data da vigência (padrão: `FontesNormativas.diaDaVigencia`). */
  readonly data?: string;
  /** `false` não consulta os PPCs (mais rápido). */
  readonly incluirPpcs?: boolean;
}

export class Impacto extends Context.Service<
  Impacto,
  {
    readonly daNorma: (id: string, opcoes?: OpcoesImpacto) => Effect.Effect<ResultadoImpacto, Sql.FalhaNaConsulta>;
  }
>()("@simplifica-if/kb/Impacto") {}

const make = Effect.gen(function* () {
  const prover = yield* Sql.ambienteDoServico(SqlClient.SqlClient);
  const fontes = yield* FontesNormativas.FontesNormativas;
  // as tabelas de correspondência e os dispositivos que elas citam não mudam com o banco aberto:
  // carregados uma vez, na construção da layer
  const fonteCorrespondencia = yield* carregarFonteCorrespondencia;

  const daNorma = Effect.fn("Impacto.daNorma")(function* (id: string, opcoes: OpcoesImpacto = {}) {
    const ato = id.split("#")[0]!;
    // uma citação por segmento: o impacto só pergunta se o segmento cita a norma
    const segmentos = (yield* linhasSegmentos(
      "SELECT norma_id, segmento, citado_id, dispositivos_json, trecho FROM normas_citacoes WHERE norma_id <> ? ORDER BY rowid",
      [ato],
    )).map((c) => ({
      norma: c.norma_id,
      segmento: c.segmento,
      citacoes: [{ id: c.citado_id, dispositivos: [...c.dispositivos_json], trecho: c.trecho }],
    }));
    const ppcs = opcoes.incluirPpcs === false ? [] : yield* Citacoes.ppcsQueCitam(id);

    const fonte: FonteImpacto = {
      id,
      vigencia: fontes,
      dataReferencia: fontes.dataReferencia,
      correspondencia: fonteCorrespondencia,
      segmentosCitantes: segmentos,
      ppcsQueCitam: ppcs,
    };
    return impactoEm(fonte, {
      data: opcoes.data ?? (yield* fontes.diaDaVigencia),
      ...(opcoes.incluirPpcs !== undefined ? { incluirPpcs: opcoes.incluirPpcs } : {}),
    });
  }, prover);

  return Impacto.of({ daNorma });
});

export const layer = Layer.effect(Impacto, make);
