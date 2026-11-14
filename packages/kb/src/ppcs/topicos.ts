// @effect-diagnostics nodeBuiltinImport:off -- carregadores síncronos, usados pela compilação do banco e pela revisar-ppc
/**
 * Tópicos da `revisar-ppc`: os tipos de seção de cada tópico (`packages/kb/dados/topicos-secoes.yaml`)
 * e a taxonomia de tópicos das fichas (`.agents/skills/revisar-ppc/base-analise/topicos-fichas.json`).
 *
 * `topicosSecoesDoYaml` e `topicosFichasDoJson` interpretam o texto (a layer de arquivos de
 * `FontesNormativas` lê por `FileSystem`); `lerTopicosSecoes` e `lerTopicosFichas` leem o arquivo
 * direto, para a compilação do banco e a skill.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";
import { parse } from "yaml";

export const esquemaTopicosSecoes = Schema.Record(
  Schema.String,
  Schema.Array(Schema.String.check(Schema.isPattern(/^[a-z_]+$/))),
);
export type TopicosSecoes = typeof esquemaTopicosSecoes.Type;

const esquemaTopicoFichas = Schema.StructWithRest(
  Schema.Struct({
    id: Schema.String,
    titulo: Schema.optionalKey(Schema.String),
    tipo_escopo: Schema.optionalKey(Schema.String),
    fichas: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
/** Tópico de `topicos-fichas.json`, na ordem da taxonomia (com as chaves extras do arquivo). */
export type TopicoFichas = typeof esquemaTopicoFichas.Type;

const esquemaTopicosFichas = Schema.StructWithRest(Schema.Struct({ topicos: Schema.Array(esquemaTopicoFichas) }), [
  Schema.Record(Schema.String, Schema.Unknown),
]);

const decodificarTopicosSecoes = Schema.decodeUnknownSync(esquemaTopicosSecoes);
const decodificarTopicosFichas = Schema.decodeUnknownSync(esquemaTopicosFichas);
const decodificarListaTopicos = Schema.decodeUnknownSync(Schema.Array(esquemaTopicoFichas));

/** `dados/topicos-secoes.yaml` (YAML failsafe): tópico → tipos de seção. */
export function topicosSecoesDoYaml(texto: string): TopicosSecoes {
  return decodificarTopicosSecoes(parse(texto, { schema: "failsafe" }) ?? {});
}

/** `topicos-fichas.json`: os tópicos, na ordem do arquivo. */
export function topicosFichasDoJson(texto: string): ReadonlyArray<TopicoFichas> {
  return decodificarTopicosFichas(JSON.parse(texto)).topicos;
}

/** O mapa já como objeto (as linhas da tabela `topicos_secoes`), validado. */
export function topicosSecoesDeObjeto(objeto: unknown): TopicosSecoes {
  return decodificarTopicosSecoes(objeto);
}

/** Os tópicos já separados (as linhas `dados_json` da tabela `topicos`), validados. */
export function topicosFichasDeObjetos(objetos: ReadonlyArray<unknown>): ReadonlyArray<TopicoFichas> {
  return decodificarListaTopicos(objetos);
}

/** Caminho de `topicos-secoes.yaml`, relativo à raiz do repositório. */
export const TOPICOS_SECOES = "packages/kb/dados/topicos-secoes.yaml";

// Calculado na chamada, não no import: no executável empacotado, `import.meta.dirname` não aponta
// para o pacote, e o servidor MCP nunca lê este arquivo.
export function lerTopicosSecoes(
  caminho: string = NodePath.resolve(import.meta.dirname, "..", "..", "dados", "topicos-secoes.yaml"),
): TopicosSecoes {
  return topicosSecoesDoYaml(NodeFS.readFileSync(caminho, "utf-8"));
}

/** Caminho de `topicos-fichas.json`, relativo à raiz do repositório. */
export const TOPICOS_FICHAS = ".agents/skills/revisar-ppc/base-analise/topicos-fichas.json";

/** Tópicos de `.agents/skills/revisar-ppc/base-analise/topicos-fichas.json`, na ordem do arquivo. */
export function lerTopicosFichas(raiz: string): ReadonlyArray<TopicoFichas> {
  return topicosFichasDoJson(NodeFS.readFileSync(NodePath.join(raiz, TOPICOS_FICHAS), "utf-8"));
}
