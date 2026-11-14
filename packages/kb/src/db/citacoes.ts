/**
 * Citações normativas dos PPCs pela tabela `citacoes` (as do resolvedor, gravadas na compilação):
 * os PPCs que citam uma norma e as normas que um PPC cita. A ordem e a forma são as de
 * `ppcsQueCitam` sobre os arquivos (`ppcs/citacoes.ts`); `db/base.test.ts` confere a igualdade.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { idDoAto } from "../normas/ids.ts";
import {
  cobreDispositivo,
  type NormaCitadaNoPpc,
  normasCitadasNoPpc,
  ocorrenciaGravada,
  type PpcCitante,
} from "../ppcs/citacoes.ts";
import { compararTexto } from "../texto.ts";
import * as Sql from "./sql.ts";

const ato = (id: string) => idDoAto(id.split("#")[0]!);

const LinhaCitante = Schema.Struct({
  chave: Schema.String,
  campus_nome: Schema.String,
  curso_nome: Schema.String,
  nivel: Schema.String,
  tipo_oferta: Schema.String,
  path: Schema.String,
  linha: Schema.Int,
  trecho: Schema.String,
  regra: Schema.String,
  confianca: Schema.Number,
  dispositivos_json: Schema.fromJsonString(Schema.Array(Schema.String)),
});
const linhasCitantes = Sql.todas(LinhaCitante);

/** PPCs que citam a norma `id` (com `#dispositivo`, só as citações que o cobrem), por chave do PPC. */
export const ppcsQueCitam = Effect.fn("citacoes.ppcsQueCitam")(function* (
  id: string,
  opcoes: { readonly confiancaMinima?: number } = {},
) {
  const dispositivo = id.split("#")[1];
  const minimo = opcoes.confiancaMinima ?? 0;
  const linhas = yield* linhasCitantes(
    `SELECT p.chave, p.campus_nome, p.curso_nome, p.nivel, p.tipo_oferta, p.path,
            c.linha, c.trecho, c.regra, c.confianca, c.dispositivos_json
     FROM citacoes c JOIN ppcs p ON p.id = c.ppc_id
     WHERE c.ato_id = ? ORDER BY p.chave, c.ordem`,
    [ato(id)],
  );
  const porPpc = new Map<string, PpcCitante>();
  for (const linha of linhas) {
    if (linha.confianca < minimo) continue;
    const dispositivos = [...linha.dispositivos_json];
    if (dispositivo && !cobreDispositivo(dispositivos, dispositivo)) continue;
    let ppc = porPpc.get(linha.chave);
    if (!ppc) {
      ppc = {
        ppc: linha.chave,
        campus: linha.campus_nome,
        curso: linha.curso_nome,
        nivel: linha.nivel,
        tipo_oferta: linha.tipo_oferta,
        // relativo a base-conhecimento/, como no índice de PPCs
        path: linha.path.replace(/^base-conhecimento\//, ""),
        ocorrencias: [],
      };
      porPpc.set(linha.chave, ppc);
    }
    ppc.ocorrencias.push(
      ocorrenciaGravada({
        linha: linha.linha,
        trecho: linha.trecho,
        regra: linha.regra,
        confianca: linha.confianca,
        dispositivos,
      }),
    );
  }
  return [...porPpc.values()].sort((a, b) => compararTexto(a.ppc, b.ppc));
});

const existePpc = Sql.primeira(Schema.Struct({ id: Schema.String }));
const linhasCitacoesDoPpc = Sql.todas(
  Schema.Struct({ id: Schema.NullOr(Schema.String), linha: Schema.Int, regra: Schema.String }),
);

/**
 * Normas citadas por um PPC (`campus/curso` ou `ppc:campus/curso`); `null` se o PPC não está na
 * base. Cada contagem é a que `ppcsQueCitam` dá ao PPC para aquele ato.
 */
export const normasCitadasDoPpc = Effect.fn("citacoes.normasCitadasDoPpc")(function* (ppc: string) {
  const id = ppc.startsWith("ppc:") ? ppc : `ppc:${ppc}`;
  if (!(yield* existePpc("SELECT id FROM ppcs WHERE id = ?", [id]))) return null;
  const citacoes = yield* linhasCitacoesDoPpc(
    "SELECT ato_id AS id, linha, regra FROM citacoes WHERE ppc_id = ? ORDER BY ordem",
    [id],
  );
  const normas: NormaCitadaNoPpc[] = normasCitadasNoPpc(citacoes);
  return normas;
});
