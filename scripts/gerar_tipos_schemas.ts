#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- gerador de execução única, com a casca de scripts/cli.ts: lê os JSON Schemas com node:fs, formata pelo vp fmt com node:child_process e imprime no console
/** Gera scripts/base/tipos-schemas.ts, os tipos TypeScript dos JSON Schemas de base-conhecimento/schemas/. */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { compile, type JSONSchema } from "json-schema-to-typescript";
import { aplicarGerados, mensagensDivergencias } from "./base/gerados.ts";
import { listarDiretorio } from "./base/caminhos.ts";
import { lerArgumentos } from "./cli.ts";
import { RAIZ_BASE, RAIZ_PROJETO } from "./config.ts";

const USO = `uso: node scripts/gerar_tipos_schemas.ts [--check]

Gera scripts/base/tipos-schemas.ts a partir de base-conhecimento/schemas/*.schema.json.

  --check     verifica se os tipos gerados estão atualizados, sem gravar
  -h, --help  mostra esta ajuda`;

export const DESTINO_TIPOS = NodePath.join(RAIZ_PROJETO, "scripts", "base", "tipos-schemas.ts");
const RAIZ_SCHEMAS = NodePath.join(RAIZ_BASE, "schemas");

/** Nome do tipo gerado para cada schema; um schema novo precisa ganhar nome aqui. */
const NOMES_TIPOS: Record<string, string> = {
  catalogos_manifest: "ManifestCatalogosJson",
  cnct_curso: "CursoCnctJson",
  cnct_index: "IndiceCnctJson",
  cnct_manifest: "ManifestCnctJson",
  institucional_manifest: "ManifestInstitucionalJson",
  ppcps_index: "IndicePpcpsJson",
  ppcs_index: "IndicePpcsJson",
  ppcs_secao: "SecaoPpcJson",
};

const CABECALHO = `/**
 * Tipos dos JSON Schemas de base-conhecimento/schemas/. Arquivo gerado por
 * scripts/gerar_tipos_schemas.ts; não edite à mão. Depois de alterar um
 * schema, rode \`node scripts/gerar_tipos_schemas.ts\`.
 */
`;

/** Formata como `vp fmt` formata scripts/, para que o arquivo gerado já saia formatado. */
function formatar(codigo: string): string {
  const resultado = NodeChildProcess.spawnSync(
    NodePath.join(RAIZ_PROJETO, "node_modules", ".bin", "vp"),
    ["fmt", `--stdin-filepath=${DESTINO_TIPOS}`],
    { cwd: RAIZ_PROJETO, input: codigo, encoding: "utf-8" },
  );
  if (resultado.status !== 0) throw new Error(`vp fmt falhou: ${resultado.stderr}`);
  return resultado.stdout;
}

export async function gerarTipos(): Promise<string> {
  const partes = [CABECALHO];
  for (const caminho of listarDiretorio(RAIZ_SCHEMAS, ".schema.json")) {
    const chave = NodePath.basename(caminho, ".schema.json");
    const nome = NOMES_TIPOS[chave];
    if (!nome) throw new Error(`schema sem nome de tipo em NOMES_TIPOS: ${chave}`);
    const schema = JSON.parse(NodeFS.readFileSync(caminho, "utf-8")) as JSONSchema;
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

const programa = Effect.fn("gerar_tipos_schemas")(function* (check: boolean) {
  const tipos = yield* Effect.promise(gerarTipos);
  const rel = NodePath.relative(RAIZ_PROJETO, DESTINO_TIPOS);
  const divergencias = yield* aplicarGerados([{ caminho: DESTINO_TIPOS, texto: tipos }], {
    modo: check ? "verificar" : "gravar",
    raiz: RAIZ_PROJETO,
  });
  if (check) {
    if (divergencias.length) {
      for (const erro of mensagensDivergencias(divergencias, "node scripts/gerar_tipos_schemas.ts")) {
        yield* Console.error(`ERRO: ${erro}`);
      }
      return 1;
    }
    yield* Console.log(`Tipos dos schemas atualizados: ${rel}`);
    return 0;
  }
  yield* Console.log(`Tipos dos schemas gerados: ${rel}`);
  return 0;
});

async function main(): Promise<number> {
  const args = lerArgumentos(process.argv.slice(2), { check: { type: "boolean" } }, { uso: USO });
  if ("codigo" in args) return args.codigo;
  return Effect.runPromise(programa(args.values.check ?? false).pipe(Effect.provide(NodeServices.layer)));
}

if (import.meta.main) process.exitCode = await main();
