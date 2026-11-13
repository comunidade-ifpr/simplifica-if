#!/usr/bin/env bun
/** Gera scripts/base/tipos-schemas.ts, os tipos TypeScript dos JSON Schemas de base-conhecimento/schemas/. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compile, type JSONSchema } from "json-schema-to-typescript";
import { listarDiretorio } from "./base/caminhos.ts";
import { lerArgumentos } from "./cli.ts";
import { RAIZ_BASE, RAIZ_PROJETO } from "./config.ts";

const USO = `uso: bun run scripts/gerar_tipos_schemas.ts [--check]

Gera scripts/base/tipos-schemas.ts a partir de base-conhecimento/schemas/*.schema.json.

  --check     verifica se os tipos gerados estão atualizados, sem gravar
  -h, --help  mostra esta ajuda`;

export const DESTINO_TIPOS = path.join(RAIZ_PROJETO, "scripts", "base", "tipos-schemas.ts");
const RAIZ_SCHEMAS = path.join(RAIZ_BASE, "schemas");

/** Nome do tipo gerado para cada schema; um schema novo precisa ganhar nome aqui. */
const NOMES_TIPOS: Record<string, string> = {
  campi_index: "IndiceCampiJson",
  campus: "CampusJson",
  catalogos_manifest: "ManifestCatalogosJson",
  cnct_curso: "CursoCnctJson",
  cnct_index: "IndiceCnctJson",
  cnct_manifest: "ManifestCnctJson",
  institucional_manifest: "ManifestInstitucionalJson",
  ppcps_index: "IndicePpcpsJson",
  ppcs_index: "IndicePpcsJson",
  ppcs_secao: "SecaoPpcJson",
  processo_seletivo: "ProcessoSeletivoJson",
  processos_seletivos_index: "IndiceProcessosSeletivosJson",
};

const CABECALHO = `/**
 * Tipos dos JSON Schemas de base-conhecimento/schemas/. Arquivo gerado por
 * scripts/gerar_tipos_schemas.ts; não edite à mão. Depois de alterar um
 * schema, rode \`bun run scripts/gerar_tipos_schemas.ts\`.
 */
`;

/** Formata como `bun fmt` formata scripts/, para que o arquivo gerado já saia formatado. */
function formatar(codigo: string): string {
  const resultado = Bun.spawnSync(["bun", "fmt", "--stdin-filepath", DESTINO_TIPOS], {
    cwd: RAIZ_PROJETO,
    stdin: Buffer.from(codigo),
  });
  if (resultado.exitCode !== 0) throw new Error(`bun fmt falhou: ${resultado.stderr.toString()}`);
  return resultado.stdout.toString();
}

export async function gerarTipos(): Promise<string> {
  const partes = [CABECALHO];
  for (const caminho of listarDiretorio(RAIZ_SCHEMAS, ".schema.json")) {
    const chave = path.basename(caminho, ".schema.json");
    const nome = NOMES_TIPOS[chave];
    if (!nome) throw new Error(`schema sem nome de tipo em NOMES_TIPOS: ${chave}`);
    const schema = JSON.parse(readFileSync(caminho, "utf-8")) as JSONSchema;
    // O título do schema vira o comentário do tipo; o nome do tipo vem de NOMES_TIPOS.
    const comNome: JSONSchema = {
      ...schema,
      title: nome,
      description: `${schema.title} (schemas/${chave}.schema.json).`,
    };
    partes.push(
      await compile(comNome, nome, {
        bannerComment: "",
        format: false,
        additionalProperties: false,
        ignoreMinAndMaxItems: true,
        declareExternallyReferenced: true,
      }),
    );
  }
  return formatar(partes.join("\n"));
}

async function main(): Promise<number> {
  const args = lerArgumentos(process.argv.slice(2), { check: { type: "boolean" } }, { uso: USO });
  if ("codigo" in args) return args.codigo;
  const tipos = await gerarTipos();
  const rel = path.relative(RAIZ_PROJETO, DESTINO_TIPOS);
  if (args.values.check) {
    if (!existsSync(DESTINO_TIPOS) || readFileSync(DESTINO_TIPOS, "utf-8") !== tipos) {
      console.error(`ERRO: ${rel} está desatualizado; rode bun run scripts/gerar_tipos_schemas.ts`);
      return 1;
    }
    console.log(`Tipos dos schemas atualizados: ${rel}`);
    return 0;
  }
  writeFileSync(DESTINO_TIPOS, tipos, "utf-8");
  console.log(`Tipos dos schemas gerados: ${rel}`);
  return 0;
}

if (import.meta.main) process.exitCode = await main();
