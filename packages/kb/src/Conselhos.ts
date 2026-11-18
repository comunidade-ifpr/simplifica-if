/**
 * `Conselhos`: as reuniões dos conselhos superiores do IFPR na base (hoje, o Consepe), com os
 * documentos e os itens de pauta de cada uma, de `base-conhecimento/institucional/ifpr/conselhos/`
 * (tabelas `conselhos*` do `kb.sqlite`). Sem dado de pessoa: pareceres e itens, não conselheiros.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Sql from "./db/sql.ts";

const TextoNulo = Schema.NullOr(Schema.String);

const LinhaReuniao = Schema.Struct({
  id: Schema.String,
  conselho: Schema.String,
  conselho_nome: Schema.String,
  data: Schema.String,
  titulo: Schema.String,
  tipo: TextoNulo,
  situacao: TextoNulo,
  fonte: TextoNulo,
});
const linhasReunioes = Sql.todas(LinhaReuniao);

const LinhaDocumento = Schema.Struct({
  reuniao_id: Schema.String,
  documento_id: Schema.String,
  tipo: Schema.String,
  titulo: Schema.String,
  numero: TextoNulo,
  data: TextoNulo,
  resumo: TextoNulo,
  url: TextoNulo,
});
const linhasDocumentos = Sql.todas(LinhaDocumento);

const LinhaItem = Schema.Struct({
  reuniao_id: Schema.String,
  item_id: Schema.String,
  ordem: Schema.Int,
  titulo: Schema.String,
  resumo: TextoNulo,
  tipo_demanda: TextoNulo,
  resultado: TextoNulo,
  documento_id: TextoNulo,
  processo_sei: TextoNulo,
  campus_texto: TextoNulo,
  campus_id: TextoNulo,
  curso_texto: TextoNulo,
  curso_id: TextoNulo,
});
const linhasItens = Sql.todas(LinhaItem);

/** Um documento de reunião (parecer, ata, pauta), na ordem da reunião. */
export type DocumentoDeReuniao = Omit<typeof LinhaDocumento.Type, "reuniao_id">;
/** Um item de pauta, na ordem oficial da pauta; `campus_id` e `curso_id` quando reconhecidos. */
export type ItemDePauta = Omit<typeof LinhaItem.Type, "reuniao_id">;

/** Uma reunião, com a sigla e o nome do conselho, os documentos e os itens de pauta. */
export interface Reuniao extends Readonly<typeof LinhaReuniao.Type> {
  readonly documentos: ReadonlyArray<DocumentoDeReuniao>;
  readonly itens: ReadonlyArray<ItemDePauta>;
}

export class Conselhos extends Context.Service<
  Conselhos,
  {
    /** As reuniões, da mais recente à mais antiga (no mesmo dia, por ID). */
    readonly reunioes: Effect.Effect<ReadonlyArray<Reuniao>, Sql.FalhaNaConsulta>;
  }
>()("@simplifica-if/kb/Conselhos") {}

const make = Effect.gen(function* () {
  const prover = yield* Sql.ambienteDoServico(SqlClient.SqlClient);

  const reunioes = Effect.gen(function* () {
    const documentos = yield* linhasDocumentos(
      `SELECT reuniao_id, documento_id, tipo, titulo, numero, data, resumo, url
         FROM conselhos_documentos ORDER BY reuniao_id, ordem`,
    );
    const itens = yield* linhasItens(
      `SELECT reuniao_id, item_id, ordem, titulo, resumo, tipo_demanda, resultado, documento_id, processo_sei,
              campus_texto, campus_id, curso_texto, curso_id
         FROM conselhos_itens ORDER BY reuniao_id, ordem`,
    );
    const lista = yield* linhasReunioes(
      `SELECT r.id, c.sigla AS conselho, c.nome AS conselho_nome, r.data, r.titulo, r.tipo, r.situacao, r.fonte
         FROM conselhos_reunioes r JOIN conselhos c ON c.id = r.conselho_id ORDER BY r.data DESC, r.id`,
    );
    return lista.map((r): Reuniao => ({
      ...r,
      documentos: documentos.filter((d) => d.reuniao_id === r.id).map(({ reuniao_id: _, ...d }) => d),
      itens: itens.filter((i) => i.reuniao_id === r.id).map(({ reuniao_id: _, ...i }) => i),
    }));
  }).pipe(Effect.withSpan("Conselhos.reunioes"), prover);

  return Conselhos.of({ reunioes });
});

export const layer = Layer.effect(Conselhos, make);
