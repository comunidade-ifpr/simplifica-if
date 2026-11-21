// @effect-diagnostics nodeBuiltinImport:off -- carregadores síncronos dos arquivos de avaliacao/, usados pelos testes e pelo avaliar_skill.ts
/** Leitura e validação dos arquivos de `avaliacao/` (YAML com o pacote `yaml`, JSON e Effect Schema). */
import { parse as interpretarYaml } from "yaml";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { caminhoTexto, problemas } from "@simplifica-if/kb/esquema/mensagens";
import { ESTRITO, type EsquemaSincrono } from "../esquema.ts";
import { esquemaPpcOuro, type PpcOuro } from "./esquema.ts";

export const RAIZ_REPOSITORIO = NodePath.resolve(import.meta.dirname, "..", "..");
export const DIR_AVALIACAO = NodePath.join(RAIZ_REPOSITORIO, "avaliacao");

/**
 * Arquivo de `avaliacao/` (ou relatório salvo) fora do contrato. `problemas` traz uma linha por
 * problema, `<caminho>: <mensagem>`, com `(raiz)` quando o problema é do arquivo inteiro.
 */
export class ArquivoAvaliacaoInvalido extends Schema.TaggedError<ArquivoAvaliacaoInvalido>()(
  "ArquivoAvaliacaoInvalido",
  {
    origem: Schema.String,
    problemas: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    return this.problemas.map((problema) => `${this.origem}: ${problema}`).join("\n");
  }
}

export const ehArquivoAvaliacaoInvalido = Schema.is(ArquivoAvaliacaoInvalido);

/** Erro de schema como `ArquivoAvaliacaoInvalido` de `origem`. */
export function arquivoInvalido(origem: string, erro: Schema.SchemaError): ArquivoAvaliacaoInvalido {
  return new ArquivoAvaliacaoInvalido({
    origem,
    problemas: problemas(erro.issue).map(
      (problema) => `${caminhoTexto(problema.caminho) || "(raiz)"}: ${problema.mensagem}`,
    ),
  });
}

/** Decodifica `dados` com `ESTRITO` ou lança `ArquivoAvaliacaoInvalido`. */
export function validar<T>(esquema: EsquemaSincrono<T>, dados: unknown, origem: string): T {
  const resultado = Schema.decodeUnknownExit(esquema)(dados, ESTRITO);
  if (Exit.isSuccess(resultado)) return resultado.value;
  const erro = Exit.findErrorOption(resultado);
  if (erro._tag === "Some") throw arquivoInvalido(origem, erro.value);
  throw new ArquivoAvaliacaoInvalido({ origem, problemas: ["(raiz): formato inesperado"] });
}

export function lerYaml(caminho: string): unknown {
  return interpretarYaml(NodeFS.readFileSync(caminho, "utf-8"));
}

export function carregarPpcOuro(caminho: string): PpcOuro {
  return validar(esquemaPpcOuro, lerYaml(caminho), NodePath.relative(RAIZ_REPOSITORIO, caminho));
}
