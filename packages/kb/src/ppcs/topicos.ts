// @effect-diagnostics nodeBuiltinImport:off -- carregadores síncronos, usados pela compilação do banco e pela validação das fichas
/**
 * Tópicos da revisão de PPC (`base-conhecimento/revisao-ppc/topicos.json`): taxonomia semântica
 * dos tópicos das fichas e o mapa de cada tópico para os tipos de seção do PPC (`secoes`).
 */
import * as NodeFS from "node:fs";
import * as Schema from "effect/Schema";
import { CAMINHOS, noCheckout } from "../caminhos.ts";

export const esquemaTopicosSecoes = Schema.Record(
  Schema.String,
  Schema.Array(Schema.String.check(Schema.isPattern(/^[a-z_]+$/))),
);
export type TopicosSecoes = typeof esquemaTopicosSecoes.Type;

const esquemaTopicoFichas = Schema.StructWithRest(
  Schema.Struct({
    id: Schema.String,
    titulo: Schema.optionalKey(Schema.String),
    secoes: Schema.optionalKey(Schema.Array(Schema.String.check(Schema.isPattern(/^[a-z_]+$/)))),
    fichas: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
/** Tópico de `topicos.json`, na ordem da taxonomia (com `fichas` derivado das fichas no banco). */
export type TopicoFichas = typeof esquemaTopicoFichas.Type;

const esquemaTopicosFichas = Schema.StructWithRest(Schema.Struct({ topicos: Schema.Array(esquemaTopicoFichas) }), [
  Schema.Record(Schema.String, Schema.Unknown),
]);

const decodificarTopicosSecoes = Schema.decodeUnknownSync(esquemaTopicosSecoes);
const decodificarTopicosFichas = Schema.decodeUnknownSync(esquemaTopicosFichas);
const decodificarListaTopicos = Schema.decodeUnknownSync(Schema.Array(esquemaTopicoFichas));

/** `topicos.json`: os tópicos, na ordem do arquivo. */
export function topicosFichasDoJson(texto: string): ReadonlyArray<TopicoFichas> {
  return decodificarTopicosFichas(JSON.parse(texto)).topicos;
}

/** Deriva o mapa tópico → tipos de seção a partir dos tópicos de `topicos.json`. */
export function topicosSecoesDeTopicos(topicos: ReadonlyArray<TopicoFichas>): TopicosSecoes {
  return decodificarTopicosSecoes(Object.fromEntries(topicos.map((t) => [t.id, [...(t.secoes ?? [])]])));
}

/** O mapa já como objeto (as linhas da tabela `topicos_secoes`), validado. */
export function topicosSecoesDeObjeto(objeto: unknown): TopicosSecoes {
  return decodificarTopicosSecoes(objeto);
}

/** Os tópicos já separados (as linhas `dados_json` da tabela `topicos`), validados. */
export function topicosFichasDeObjetos(objetos: ReadonlyArray<unknown>): ReadonlyArray<TopicoFichas> {
  return decodificarListaTopicos(objetos);
}

/** O mapa tópico → tipos de seção, lido de `base-conhecimento/revisao-ppc/topicos.json` em `raiz`. */
export function lerTopicosSecoes(raiz: string): TopicosSecoes {
  const arquivo = noCheckout(raiz, CAMINHOS.topicosFichas);
  if (!NodeFS.existsSync(arquivo)) return {};
  return topicosSecoesDeTopicos(lerTopicosFichas(raiz));
}

/** Tópicos de `base-conhecimento/revisao-ppc/topicos.json`, na ordem do arquivo. */
export function lerTopicosFichas(raiz: string): ReadonlyArray<TopicoFichas> {
  return topicosFichasDoJson(NodeFS.readFileSync(noCheckout(raiz, CAMINHOS.topicosFichas), "utf-8"));
}
