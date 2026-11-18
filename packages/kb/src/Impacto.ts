/**
 * `Impacto`: o que uma mudança numa norma atinge na base (`kb impacto`, ferramenta
 * `impacto_da_norma`). A regra é `impactoEm` (`normas/impacto.ts`), pura; este serviço carrega a
 * fonte dela: registro, vigência, relações e conteúdo das skills de `FontesNormativas`, e do banco
 * os dispositivos da norma, a correspondência, os segmentos de outras normas que citam e os PPCs.
 *
 * Sobre `FontesNormativas.layerArquivos`, os arquivos afetados incluem todos os textos das skills;
 * sobre `layerBanco`, só as fichas da `revisar-ppc` (a exceção aceita da paridade).
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
import { idDoAto } from "./normas/ids.ts";
import { type FonteImpacto, impactoEm, type ResultadoImpacto, type TopicoTaxonomia } from "./normas/impacto.ts";

const LinhaDispositivo = Schema.Struct({ dispositivo: Schema.String, texto: Schema.String });
const linhasDispositivos = Sql.todas(LinhaDispositivo);

const LinhaSegmento = Schema.Struct({
  norma_id: Schema.String,
  ato_id: Schema.String,
  segmento: Schema.String,
  citado_id: Schema.String,
  dispositivos_json: Schema.fromJsonString(Schema.Array(Schema.String)),
  trecho: Schema.String,
});
const linhasSegmentos = Sql.todas(LinhaSegmento);

interface OpcoesImpacto {
  /** Data da vigência (padrão: `data_referencia`). */
  readonly data?: string;
  /** `false` não consulta os PPCs (mais rápido). */
  readonly incluirPpcs?: boolean;
  /** Raiz alternativa dos textos das skills (`kb impacto --conteudo`); ignorada sobre o banco. */
  readonly raizConteudo?: string;
}

export class Impacto extends Context.Service<
  Impacto,
  {
    readonly daNorma: (
      id: string,
      opcoes?: OpcoesImpacto,
    ) => Effect.Effect<ResultadoImpacto, Sql.FalhaNaConsulta | FontesNormativas.FalhaNasFontes>;
  }
>()("@simplifica-if/kb/Impacto") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fontes = yield* FontesNormativas.FontesNormativas;
  // as tabelas de correspondência e os dispositivos que elas citam não mudam com o banco aberto:
  // carregados uma vez, na construção da layer
  const fonteCorrespondencia = yield* carregarFonteCorrespondencia;

  const daNorma = Effect.fn("Impacto.daNorma")(
    function* (id: string, opcoes: OpcoesImpacto = {}) {
      const ato = idDoAto(id.split("#")[0]!);
      const correspondencia = fonteCorrespondencia;
      const dispositivos = yield* linhasDispositivos(
        "SELECT dispositivo, texto FROM dispositivos WHERE ato_id = ? AND canonico = 1 ORDER BY norma_id <> ato_id, norma_id, ordem",
        [ato],
      );
      // uma citação por segmento: o impacto só pergunta se o segmento cita a norma
      const segmentos = (yield* linhasSegmentos(
        "SELECT norma_id, ato_id, segmento, citado_id, dispositivos_json, trecho FROM normas_citacoes WHERE ato_id <> ? ORDER BY rowid",
        [ato],
      )).map((c) => ({
        norma: c.norma_id,
        ato: c.ato_id,
        segmento: c.segmento,
        citacoes: [{ id: c.citado_id, dispositivos: [...c.dispositivos_json], trecho: c.trecho }],
      }));
      const ppcs = opcoes.incluirPpcs === false ? [] : yield* Citacoes.ppcsQueCitam(id);
      const conteudo = yield* fontes.conteudoDasSkills(
        opcoes.raizConteudo === undefined ? {} : { raiz: opcoes.raizConteudo },
      );

      const pedido = (oQue: string, recebido: string, esperado: string) => {
        if (recebido !== esperado)
          throw new Error(`impacto: ${oQue} pedido para ${recebido}, carregado para ${esperado}`);
      };
      const fonte: FonteImpacto = {
        registro: fontes.registro,
        vigencia: fontes.vigencia,
        dataReferencia: () => fontes.dataReferencia,
        relacoes: () => fontes.relacoes,
        correspondencia,
        dispositivosDoAto: (a) => {
          pedido("dispositivosDoAto", a, ato);
          return dispositivos.map((d) => ({ dispositivo: d.dispositivo, texto: d.texto }));
        },
        // a taxonomia validada tem os campos que o impacto lê (`id`, `termos_busca`, `fichas`) e outros
        topicos: () => conteudo.topicos as unknown as TopicoTaxonomia[],
        arquivosConteudo: () => conteudo.arquivos,
        segmentosCitantes: (excetoAto) => {
          pedido("segmentosCitantes", excetoAto, ato);
          return segmentos;
        },
        ppcsQueCitam: (pedidoId) => {
          pedido("ppcsQueCitam", pedidoId, id);
          return ppcs;
        },
      };
      return impactoEm(id, fonte, {
        ...(opcoes.data !== undefined ? { data: opcoes.data } : {}),
        ...(opcoes.incluirPpcs !== undefined ? { incluirPpcs: opcoes.incluirPpcs } : {}),
      });
    },
    Effect.provideService(SqlClient.SqlClient, sql),
  );

  return Impacto.of({ daNorma });
});

export const layer = Layer.effect(Impacto, make);
