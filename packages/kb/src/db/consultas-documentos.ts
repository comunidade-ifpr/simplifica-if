/**
 * O texto dos arquivos da base na tabela `documentos` (normas da base e PPCs convertidos), para o
 * leitor do app: `Normas.documento` e `Ppcs.documento`. O front matter vira linhas em branco
 * (`semFrontMatter`, o mesmo do parser de dispositivos), para que as linhas do texto sejam as do
 * arquivo e as das âncoras.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { semFrontMatter } from "../normas/markdown.ts";
import * as Sql from "./sql.ts";

const primeiroTexto = Sql.primeira(Schema.Struct({ texto: Schema.String }));

/** O Markdown do arquivo `path` (relativo à raiz), sem o front matter; `null` se a tabela não o tem. */
export const markdownDoArquivo = Effect.fn("consultasDocumentos.markdownDoArquivo")(function* (path: string) {
  const linha = yield* primeiroTexto("SELECT texto FROM documentos WHERE path = ?", [path]);
  return linha ? semFrontMatter(linha.texto) : null;
});
