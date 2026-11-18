#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off -- caminhos fixos do repositório no carregamento do módulo, com node:path
/** Gera scripts/base/tipos-schemas.ts, os tipos TypeScript dos JSON Schemas de base-conhecimento/schemas/. */
import * as NodePath from "node:path";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { compararTexto } from "@simplifica-if/kb/texto";
import { compile, type JSONSchema } from "json-schema-to-typescript";
import { aplicarGerados, mensagensDivergencias } from "./base/gerados.ts";
import { RAIZ_BASE, RAIZ_PROJETO } from "./config.ts";
import { sairCom } from "@simplifica-if/kb/principal";
import { executarPrincipal } from "./principal.ts";

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

/** `vp fmt` saiu com erro; o stderr fica só em `cause`. */
export class FormatacaoFalhou extends Schema.TaggedError<FormatacaoFalhou>()("FormatacaoFalhou", {
  codigo: Schema.optional(Schema.Int),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return this.codigo === undefined ? "vp fmt não rodou" : `vp fmt falhou (código ${this.codigo})`;
  }
}

/** Um schema de base-conhecimento/schemas/ sem nome em `NOMES_TIPOS`. */
export class SchemaSemNome extends Schema.TaggedError<SchemaSemNome>()("SchemaSemNome", {
  chave: Schema.String,
}) {
  override get message(): string {
    return `schema sem nome de tipo em NOMES_TIPOS: ${this.chave}`;
  }
}

/** Formata como `vp fmt` formata scripts/, para que o arquivo gerado já saia formatado. */
const formatar = Effect.fn("gerar_tipos_schemas.formatar")(function* (codigo: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const path = yield* Path.Path;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const processo = yield* spawner.spawn(
        ChildProcess.make(
          path.join(RAIZ_PROJETO, "node_modules", ".bin", "vp"),
          ["fmt", `--stdin-filepath=${DESTINO_TIPOS}`],
          { cwd: RAIZ_PROJETO, stdin: Stream.make(new TextEncoder().encode(codigo)) },
        ),
      );
      const [saida, erro, codigoSaida] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(processo.stdout)),
          Stream.mkString(Stream.decodeText(processo.stderr)),
          processo.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      if (codigoSaida !== 0) return yield* new FormatacaoFalhou({ codigo: codigoSaida, cause: erro.trim() });
      return saida;
    }),
  ).pipe(Effect.catchTags({ PlatformError: (cause) => Effect.fail(new FormatacaoFalhou({ cause })) }));
});

const decodificarJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

/** O texto de scripts/base/tipos-schemas.ts que os schemas de hoje geram. */
export const gerarTipos = Effect.fn("gerar_tipos_schemas.gerarTipos")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const partes = [CABECALHO];
  const nomes = (yield* fs.readDirectory(RAIZ_SCHEMAS)).filter((nome) => nome.endsWith(".schema.json"));
  for (const arquivo of nomes.sort(compararTexto)) {
    const chave = arquivo.slice(0, -".schema.json".length);
    const nome = NOMES_TIPOS[chave];
    if (!nome) return yield* new SchemaSemNome({ chave });
    const schema = (yield* decodificarJson(yield* fs.readFileString(path.join(RAIZ_SCHEMAS, arquivo)))) as JSONSchema;
    // O título do schema vira o comentário do tipo; o nome do tipo vem de NOMES_TIPOS.
    const comNome: JSONSchema = {
      ...schema,
      title: nome,
      description: `${schema.title} (schemas/${chave}.schema.json).`,
    };
    partes.push(
      yield* Effect.promise(() =>
        compile(comNome, nome, {
          bannerComment: "",
          format: false,
          additionalProperties: false,
          ignoreMinAndMaxItems: true,
          declareExternallyReferenced: true,
        }),
      ),
    );
  }
  return yield* formatar(partes.join("\n"));
});

export const comando = Command.make(
  "gerar_tipos_schemas",
  {
    check: Flag.Boolean("check").pipe(
      Flag.withDescription("verifica se os tipos gerados estão atualizados, sem gravar"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn("gerar_tipos_schemas")(function* ({ check }) {
    const path = yield* Path.Path;
    const tipos = yield* gerarTipos();
    const rel = path.relative(RAIZ_PROJETO, DESTINO_TIPOS);
    const divergencias = yield* aplicarGerados([{ caminho: DESTINO_TIPOS, texto: tipos }], {
      modo: check ? "verificar" : "gravar",
      raiz: RAIZ_PROJETO,
    });
    if (check) {
      if (divergencias.length) {
        for (const erro of mensagensDivergencias(divergencias, "node scripts/gerar_tipos_schemas.ts")) {
          yield* Console.error(`ERRO: ${erro}`);
        }
        return yield* sairCom(1);
      }
      yield* Console.log(`Tipos dos schemas atualizados: ${rel}`);
      return;
    }
    yield* Console.log(`Tipos dos schemas gerados: ${rel}`);
  }),
).pipe(
  Command.withDescription("Gera scripts/base/tipos-schemas.ts a partir de base-conhecimento/schemas/*.schema.json."),
);

if (import.meta.main) {
  executarPrincipal("gerar_tipos_schemas", Command.run(comando, { version: "1.0.0" }));
}
