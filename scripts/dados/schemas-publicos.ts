// @effect-diagnostics nodeBuiltinImport:off -- grava e confere os JSON Schemas públicos dos registros com node:fs síncrono (gerar_base, validar_base)
/**
 * JSON Schemas públicos dos registros institucionais (`base-conhecimento/schemas/registros/`), gerados
 * do Effect Schema que valida os arquivos (`institucional.ts`, `conselhos.ts`, `processos-sei.ts`). São
 * o contrato para quem lê a base publicada; a fonte é o Effect Schema. Gerados por `gerar_base.ts` e
 * conferidos por `gerar_base.ts --check` e pelo `validar_base.ts`.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";
import { RAIZ_BASE } from "../config.ts";
import { esquemaConselho, esquemaReuniao } from "./conselhos.ts";
import {
  esquemaCampusLocal,
  esquemaCursoLocal,
  esquemaEditalLocal,
  esquemaOfertaLocal,
  esquemaProcessoLocal,
} from "./institucional.ts";
import { esquemaProcessosSei } from "./processos-sei.ts";

export const PASTA_SCHEMAS_REGISTROS = NodePath.join(RAIZ_BASE, "schemas", "registros");

const REGISTROS = {
  campus: {
    esquema: esquemaCampusLocal,
    titulo: "Campus do IFPR",
    arquivo: "institucional/ifpr/campi/<campus_id>.json",
  },
  curso: {
    esquema: esquemaCursoLocal,
    titulo: "Curso do IFPR",
    arquivo: "institucional/ifpr/cursos/<campus_id>/<curso_slug>.json",
  },
  processo_seletivo: {
    esquema: esquemaProcessoLocal,
    titulo: "Processo seletivo do IFPR",
    arquivo: "institucional/ifpr/processos-seletivos/<processo_seletivo_id>.json",
  },
  edital: {
    esquema: esquemaEditalLocal,
    titulo: "Edital de ingresso do IFPR",
    arquivo: "institucional/ifpr/editais/<edital_id>.json",
  },
  oferta: {
    esquema: esquemaOfertaLocal,
    titulo: "Oferta de ingresso do IFPR",
    arquivo: "institucional/ifpr/ofertas/<processo_seletivo_id>/<oferta_id>.json",
  },
  conselho: {
    esquema: esquemaConselho,
    titulo: "Conselho superior do IFPR",
    arquivo: "institucional/ifpr/conselhos/<conselho_id>/conselho.json",
  },
  reuniao_conselho: {
    esquema: esquemaReuniao,
    titulo: "Reunião de conselho superior do IFPR",
    arquivo: "institucional/ifpr/conselhos/<conselho_id>/reunioes/<data>.json",
  },
  processos_sei: {
    esquema: esquemaProcessosSei,
    titulo: "Processos SEI dos cursos do IFPR",
    arquivo: "institucional/ifpr/processos-sei/index.json",
  },
} as const;
export type NomeRegistro = keyof typeof REGISTROS;
export const NOMES_REGISTROS = Object.keys(REGISTROS) as NomeRegistro[];

/** JSON Schema (draft 2020-12) do registro; objetos recusam chave a mais, como a decodificação estrita. */
export function jsonSchemaRegistro(nome: NomeRegistro): Record<string, unknown> {
  const { esquema, titulo, arquivo } = REGISTROS[nome];
  const documento = Schema.toJsonSchemaDocument(esquema as Schema.Top, { onExcessProperty: "error" });
  return semNulo({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://simplifica-if.github.io/base-conhecimento/schemas/registros/${nome}.schema.json`,
    title: titulo,
    description:
      `Formato de ${arquivo}. Gerado do Effect Schema de scripts/dados/ por scripts/gerar_base.ts; ` +
      "não edite à mão. As regras entre registros (chaves e relações) ficam na validação da base.",
    ...(documento.schema as Record<string, unknown>),
    ...(Object.keys(documento.definitions).length ? { $defs: documento.definitions } : {}),
  }) as Record<string, unknown>;
}

/**
 * `Schema.optional` aceita `undefined`, que o gerador traduz por `anyOf [tipo, null]`; no arquivo JSON o
 * campo ausente é chave ausente e `null` é recusado. O schema público fica só com o tipo.
 */
function semNulo(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(semNulo);
  if (!valor || typeof valor !== "object") return valor;
  const objeto = valor as Record<string, unknown>;
  const alternativas = objeto.anyOf;
  if (Array.isArray(alternativas) && Object.keys(objeto).length === 1) {
    const semNull = alternativas.filter(
      (alt) => !(alt && typeof alt === "object" && (alt as { type?: unknown }).type === "null"),
    );
    if (semNull.length === 1) return semNulo(semNull[0]);
  }
  return Object.fromEntries(Object.entries(objeto).map(([chave, item]) => [chave, semNulo(item)]));
}

const texto = (valor: unknown) => `${JSON.stringify(valor, null, 2)}\n`;
const caminho = (pasta: string, nome: NomeRegistro) => NodePath.join(pasta, `${nome}.schema.json`);

export function gravarSchemasRegistros(pasta: string = PASTA_SCHEMAS_REGISTROS): string[] {
  NodeFS.mkdirSync(pasta, { recursive: true });
  return NOMES_REGISTROS.flatMap((nome) => {
    const destino = caminho(pasta, nome);
    const esperado = texto(jsonSchemaRegistro(nome));
    if (NodeFS.existsSync(destino) && NodeFS.readFileSync(destino, "utf-8") === esperado) return [];
    NodeFS.writeFileSync(destino, esperado, "utf-8");
    return [`schemas/registros/${nome}.schema.json`];
  });
}

export function verificarSchemasRegistros(pasta: string = PASTA_SCHEMAS_REGISTROS): string[] {
  const esperados = new Set(NOMES_REGISTROS.map((nome) => `${nome}.schema.json`));
  const extras = NodeFS.existsSync(pasta)
    ? NodeFS.readdirSync(pasta).filter((nome) => nome.endsWith(".schema.json") && !esperados.has(nome))
    : [];
  return [
    ...NOMES_REGISTROS.filter((nome) => {
      const destino = caminho(pasta, nome);
      return !NodeFS.existsSync(destino) || NodeFS.readFileSync(destino, "utf-8") !== texto(jsonSchemaRegistro(nome));
    }).map((nome) => `schemas/registros/${nome}.schema.json desatualizado; rode node scripts/gerar_base.ts`),
    ...extras.map((nome) => `schemas/registros/${nome} não é mais gerado`),
  ];
}
