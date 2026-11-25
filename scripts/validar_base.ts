#!/usr/bin/env node
/**
 * Valida a base pública de conhecimento, os registros institucionais, a base da revisão de PPC
 * (`revisao-ppc/`: fichas, tópicos e marcos), os arquivos gerados (em dia com o `gerar_base`) e o
 * bloco `simplifica:` das skills do app: o Effect Schema `ManifestoSkill` de
 * `@simplifica-if/mcp/skills`, com as ferramentas conferidas contra o Toolkit do `simplifica-mcp`, e os
 * arquivos de `simplifica.arquivos`. Skill sem o bloco não é do app e não é conferida.
 */
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Command from "effect/cli/Command";
import { lerPastaSkills } from "@simplifica-if/mcp/skills";
import { ehErroFrontMatter } from "@simplifica-if/kb/normas/front-matter";
import { type CaminhosBase, criarCaminhos } from "./base/caminhos.ts";
import { conferirContrato } from "./base/esquemas.ts";
import { aplicarGerados, arquivosGeradosDaBase, mensagensDivergencias } from "./base/gerados.ts";
import { validarBase } from "./base/validacao.ts";
import { validarDadosInstitucionais } from "./dados/validacao.ts";
import { validarRevisaoPpc } from "./base/revisao-ppc/validacao.ts";
import { sairCom } from "@simplifica-if/kb/principal";
import { executarPrincipal } from "./principal.ts";

/** As skills do app válidas e os erros das inválidas, em `<raiz>/.agents/skills`. */
const validarSkillsDoApp = Effect.fn("validar_base.skills")(function* (raizProjeto: string) {
  const path = yield* Path.Path;
  return yield* lerPastaSkills(path.join(raizProjeto, ".agents", "skills")).pipe(
    Effect.map((pasta) => ({
      erros: pasta.invalidas.map((erro) => erro.message),
      doApp: pasta.skills.map((skill) => skill.nome),
    })),
    Effect.catchTags({
      PlatformError: (erro) =>
        Effect.succeed({ erros: [`skills: não foi possível ler .agents/skills (${erro.message})`], doApp: [] }),
    }),
  );
});

/**
 * Os arquivos gerados em dia com as fontes (o que o `gerar_base` gravaria) e o índice de PPCs no
 * contrato de `esquemas.ts`. Com um PPC de front matter inválido não há o que gerar: a validação dos
 * PPCs já diz qual.
 */
const validarGerados = Effect.fn("validar_base.gerados")(function* (caminhos: CaminhosBase) {
  const gerados = yield* Effect.sync(() => {
    try {
      return arquivosGeradosDaBase(caminhos);
    } catch (erro) {
      if (ehErroFrontMatter(erro)) return null;
      throw erro;
    }
  });
  if (gerados === null) return [];
  const { arquivos, extrasEm, indices } = gerados;
  const divergencias = yield* aplicarGerados(arquivos, { modo: "verificar", raiz: caminhos.raiz, extrasEm });
  return [
    ...conferirContrato("indicePpcs", indices.indice, "índice de PPCs gerado").erros,
    ...mensagensDivergencias(divergencias, "node scripts/gerar_base.ts"),
  ];
});

export const comando = Command.make(
  "validar_base",
  {},
  Effect.fn("validar_base")(function* () {
    const caminhos = criarCaminhos();
    const { erros, totalNormas, dadosInstitucionais } = yield* Effect.sync(() => validarBase(caminhos));
    const dados = yield* Effect.sync(() =>
      validarDadosInstitucionais(undefined, undefined, { carregados: dadosInstitucionais }),
    );
    erros.push(...dados.erros);
    erros.push(...(yield* Effect.sync(() => validarRevisaoPpc())).map((erro) => `revisão de PPC: ${erro}`));
    erros.push(...(yield* validarGerados(caminhos)));
    const skills = yield* validarSkillsDoApp(caminhos.raizProjeto);
    erros.push(...skills.erros);
    if (erros.length) {
      for (const erro of erros) yield* Console.error(`ERRO: ${erro}`);
      return yield* sairCom(1);
    }
    yield* Console.log(
      `Base válida: ${totalNormas} normas publicadas, metadados institucionais, catálogos e arquivos gerados conferidos; ` +
        `${dados.total} registros institucionais; base da revisão de PPC conferida; ` +
        `${skills.doApp.length} skills do app (${skills.doApp.join(", ")}).`,
    );
  }),
).pipe(
  Command.withDescription(
    "Valida a base pública de conhecimento, os registros institucionais (institucional/ifpr/: campi, cursos, " +
      "ingresso, processos SEI), a base da revisão de PPC (revisao-ppc/: fichas, tópicos e marcos) " +
      "os arquivos gerados (em dia com o gerar_base) e o bloco simplifica: das skills do app (.agents/skills/*/SKILL.md).",
  ),
);

if (import.meta.main) {
  executarPrincipal("validar_base", Command.run(comando, { version: "1.0.0" }));
}
