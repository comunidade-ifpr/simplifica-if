/**
 * O índice dos PPCs convertidos (`base-conhecimento/institucional/ifpr/ppcs/index.json`), decodificado
 * por um schema só, o da compilação do banco e das citações dos arquivos. Os objetos são frouxos: os
 * campos dados são exigidos, e os demais ficam na saída, na ordem de entrada, depois deles.
 */
import * as Schema from "effect/Schema";
import { compararTexto } from "../texto.ts";

const texto = Schema.optionalKey(Schema.String);
const resto = [Schema.Record(Schema.String, Schema.Unknown)] as const;
const solto = <Campos extends Schema.Struct.Fields>(campos: Campos) =>
  Schema.StructWithRest(Schema.Struct(campos), resto);

const esquemaItemPpc = solto({
  id: Schema.String,
  campus_id: Schema.String,
  campus_nome: Schema.String,
  curso_slug: Schema.String,
  curso_nome: Schema.String,
  versao: Schema.String,
  vigente: Schema.Boolean,
  substituido_por: texto,
  nivel: Schema.String,
  taxonomia: texto,
  tipo_oferta: Schema.String,
  curso_url: texto,
  fonte_pdf: texto,
  path: Schema.String,
  proveniencia: Schema.optionalKey(Schema.Unknown),
  ano_documento: Schema.Int,
  ano_evidencia: Schema.String,
  ano_fonte: Schema.String,
});
/** Um PPC do índice; `path` é relativo a `base-conhecimento/`. */
export type ItemPpc = typeof esquemaItemPpc.Type;

const esquemaIndicePpcs = solto({
  items: Schema.Array(esquemaItemPpc),
  secoes: solto({ paths: Schema.Record(Schema.String, Schema.String) }),
});
export type IndicePpcs = typeof esquemaIndicePpcs.Type;

/** O `index.json` já lido como JSON; lança se ele não tem a forma do índice. */
export const decodificarIndicePpcs = Schema.decodeUnknownSync(esquemaIndicePpcs);

/** Os itens do índice, ordenados por id. */
export function itensPorId(indice: IndicePpcs): ItemPpc[] {
  return [...indice.items].sort((a, b) => compararTexto(a.id, b.id));
}
