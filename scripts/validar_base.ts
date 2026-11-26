#!/usr/bin/env node
/**
 * Valida a base pública de conhecimento, os registros institucionais, a base da revisão de PPC
 * (`revisao-ppc/`: fichas, tópicos e marcos), os arquivos gerados (em dia com o `gerar_base`), o
 * bloco `simplifica:` das skills do app e os manifestos de tarefa:
 *
 * - **skills do app** (`catalogo/skills/<nome>/`): toda skill dali tem o bloco `simplifica:`, no Effect
 *   Schema `ManifestoSkill` de `@simplifica-if/mcp/skills`, sem campo desconhecido, com as ferramentas
 *   conferidas contra o Toolkit do `simplifica-mcp` e os arquivos de `simplifica.arquivos`. A skill que
 *   nenhuma tarefa cita gera aviso, não erro: vai para o app sem cartão, por escolha;
 * - **skills retiradas** (`catalogo/skills/retiradas.yaml`): o formato do registro, e nenhuma skill
 *   retirada continua no catálogo (o "só de acréscimos" é conferido pela fábrica, contra o commit da
 *   última versão publicada);
 * - **skills do repositório** (`.agents/skills/<nome>/`): nenhuma tem o bloco `simplifica:` (são de
 *   quem mantém o repositório e nunca vão para o app);
 * - **tarefas** (`catalogo/tarefas/<id>.yaml`): o Effect Schema `ManifestoTarefa` de
 *   `@simplifica-if/mcp/tarefas`, sem campo desconhecido, com o `id` igual ao nome do arquivo e único, os
 *   `{id}` do pedido nas entradas, a skill citada entre as do app e o módulo citado entre os do app
 *   (`conferirAbertura`), e o `app_minimo` da tarefa não menor que o da skill citada (`conferirAppMinimo`);
 * - **dados pessoais** em `catalogo/` e `.agents/skills/`, que são públicos como a base (a mesma regra de
 *   `base-conhecimento/`: CPF, RG, celular, matrícula, SIAPE, URL pré-assinada, planilha do Google e
 *   sessão do SEI).
 */
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Command from "effect/cli/Command";
import { MODULOS } from "@simplifica-if/mcp/modulos";
import { ARQUIVO_RETIRADAS, retiradasAindaNoCatalogo, tentarLerRetiradas } from "@simplifica-if/atualizacao/retiradas";
import { lerPastaSkills, type PastaSkills } from "@simplifica-if/mcp/skills";
import { aberturaDe, conferirAbertura, conferirAppMinimo, lerPastaTarefas } from "@simplifica-if/mcp/tarefas";
import { ehErroFrontMatter } from "@simplifica-if/kb/normas/front-matter";
import { type CaminhosBase, criarCaminhos } from "./base/caminhos.ts";
import { conferirContrato } from "./base/esquemas.ts";
import { aplicarGerados, arquivosGeradosDaBase, mensagensDivergencias } from "./base/gerados.ts";
import { validarBase } from "./base/validacao.ts";
import { dadosPessoaisEUrlsInternas, urlPreAssinada } from "./base/validacao/normas.ts";
import { validarDadosInstitucionais } from "./dados/validacao.ts";
import { validarRevisaoPpc } from "./base/revisao-ppc/validacao.ts";
import { sairCom } from "@simplifica-if/kb/principal";
import { executarPrincipal } from "./principal.ts";

/** Onde moram as skills do app, as do repositório e os manifestos de tarefa, a partir da raiz do projeto. */
const PASTA_SKILLS_APP = "catalogo/skills";
const PASTA_SKILLS_REPOSITORIO = ".agents/skills";
const PASTA_TAREFAS = "catalogo/tarefas";

/** As skills de uma pasta da raiz; a pasta que não existe conta como vazia. */
const lerSkillsDe = Effect.fn("validar_base.lerSkillsDe")(function* (raizProjeto: string, pasta: string) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const caminho = path.join(raizProjeto, ...pasta.split("/"));
  if (!(yield* fs.exists(caminho).pipe(Effect.orElseSucceed(() => false)))) {
    return { skills: [], foraDoApp: [], invalidas: [] } satisfies PastaSkills;
  }
  return yield* lerPastaSkills(caminho, { estrito: true });
});

/**
 * As skills do app válidas, em `<raiz>/catalogo/skills`, e os erros: a inválida, a que não tem o bloco
 * `simplifica:` (ali, toda skill é do app) e a de `<raiz>/.agents/skills` que tem o bloco (as dali são de
 * quem mantém o repositório e nunca vão para o app). A leitura é estrita: um campo que o bloco não tem (o
 * título, a área, as entradas, que são da tarefa) é erro.
 */
export const validarSkillsDoApp = Effect.fn("validar_base.skills")(function* (raizProjeto: string) {
  const doApp = yield* lerSkillsDe(raizProjeto, PASTA_SKILLS_APP).pipe(
    Effect.map((pasta) => ({
      erros: [
        ...pasta.invalidas.map((erro) => erro.message),
        ...pasta.foraDoApp.map(
          (nome) =>
            `skill ${nome}: está em ${PASTA_SKILLS_APP}/ sem o bloco simplifica: no SKILL.md ` +
            `(skill do app tem o bloco; a que só roda no repositório mora em ${PASTA_SKILLS_REPOSITORIO}/)`,
        ),
      ],
      doApp: pasta.skills.map((skill) => skill.nome),
      appMinimos: new Map(pasta.skills.map((skill) => [skill.nome, skill.manifesto.app_minimo] as const)),
    })),
    Effect.catchTags({
      PlatformError: (erro) =>
        Effect.succeed({
          erros: [`skills: não foi possível ler ${PASTA_SKILLS_APP} (${erro.reason._tag})`],
          doApp: [] as Array<string>,
          appMinimos: new Map<string, string | undefined>(),
        }),
    }),
  );
  const doRepositorio = yield* lerSkillsDe(raizProjeto, PASTA_SKILLS_REPOSITORIO).pipe(
    Effect.map((pasta) => [
      ...pasta.invalidas.map((erro) => erro.message),
      ...pasta.skills.map(
        (skill) =>
          `skill ${skill.nome}: está em ${PASTA_SKILLS_REPOSITORIO}/ com o bloco simplifica: ` +
          `(skill do app mora em ${PASTA_SKILLS_APP}/; a do repositório não tem o bloco)`,
      ),
    ]),
    Effect.catchTags({
      PlatformError: (erro) =>
        Effect.succeed([`skills: não foi possível ler ${PASTA_SKILLS_REPOSITORIO} (${erro.reason._tag})`]),
    }),
  );
  const retiradas = yield* validarRetiradas(raizProjeto, doApp.doApp);
  return { erros: [...doApp.erros, ...retiradas, ...doRepositorio], doApp: doApp.doApp, appMinimos: doApp.appMinimos };
});

/** O registro de skills retiradas: o formato, e nenhuma retirada ainda em `catalogo/skills`. Sem o arquivo, nada. */
const validarRetiradas = Effect.fn("validar_base.retiradas")(function* (
  raizProjeto: string,
  skillsDoApp: ReadonlyArray<string>,
) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const nome = `${PASTA_SKILLS_APP}/${ARQUIVO_RETIRADAS}`;
  const texto = yield* fs.readFileString(path.join(raizProjeto, ...nome.split("/"))).pipe(Effect.option);
  if (texto._tag === "None") return [];
  const lido = tentarLerRetiradas(texto.value);
  if (lido === undefined) {
    return [`${nome}: fora do formato (retiradas: lista de { skill, data: AAAA-MM-DD, motivo })`];
  }
  return retiradasAindaNoCatalogo(lido, skillsDoApp).map(
    (skill) => `${nome}: a skill ${skill} está retirada e continua em ${PASTA_SKILLS_APP}/ (apague a pasta dela)`,
  );
});

/**
 * Os manifestos de `<raiz>/catalogo/tarefas`: os ids válidos e os erros dos inválidos e dos que citam
 * skill que não é do app (`skillsDoApp`) ou módulo que o app não tem. Sem a pasta, nenhuma tarefa. Os
 * `avisos` não reprovam: a skill do app que nenhuma tarefa cita vai para o app sem cartão, e o aviso faz
 * disso uma escolha, não um esquecimento.
 */
export const validarTarefas = Effect.fn("validar_base.tarefas")(function* (
  raizProjeto: string,
  skillsDoApp: ReadonlyArray<string>,
  /** O `simplifica.app_minimo` de cada skill do app (`conferirAppMinimo`). */
  appMinimos: ReadonlyMap<string, string | undefined> = new Map(),
) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const pasta = path.join(raizProjeto, ...PASTA_TAREFAS.split("/"));
  const semCartao = (citadas: ReadonlySet<string>) =>
    skillsDoApp
      .filter((nome) => !citadas.has(nome))
      .map(
        (nome) =>
          `skill ${nome}: nenhuma tarefa de ${PASTA_TAREFAS}/ a cita (vai para o app sem cartão, só nas conversas livres)`,
      );
  if (!(yield* fs.exists(pasta).pipe(Effect.orElseSucceed(() => false)))) {
    return { erros: [], avisos: semCartao(new Set()), ids: [] };
  }
  return yield* lerPastaTarefas(pasta, { estrito: true }).pipe(
    Effect.map((lida) => {
      const erros = lida.invalidas.map((erro) => erro.message);
      const skills = new Set(skillsDoApp);
      // O `id` único vem da leitura: ele é o nome do arquivo.
      for (const tarefa of lida.tarefas) {
        const appMinimo = conferirAppMinimo(tarefa, (nome) => appMinimos.get(nome));
        if (appMinimo !== undefined) erros.push(appMinimo);
        const { ausente } = conferirAbertura(tarefa, skills);
        if (ausente === undefined) continue;
        erros.push(
          ausente.tipo === "skill"
            ? `tarefa ${tarefa.id}: abre.conversa.skill: "${ausente.nome}" não é skill do app ` +
                `(${skillsDoApp.join(", ") || `nenhuma em ${PASTA_SKILLS_APP}`})`
            : `tarefa ${tarefa.id}: abre.modulo: "${ausente.nome}" não é módulo do app (${MODULOS.join(", ")})`,
        );
      }
      const citadas = new Set(
        lida.tarefas.flatMap((tarefa) => {
          const abertura = aberturaDe(tarefa);
          return abertura.tipo === "conversa" && abertura.skill !== undefined ? [abertura.skill] : [];
        }),
      );
      return { erros, avisos: semCartao(citadas), ids: lida.tarefas.map((tarefa) => tarefa.id) };
    }),
    Effect.catchTags({
      PlatformError: (erro) =>
        Effect.succeed({
          erros: [`tarefas: não foi possível ler ${PASTA_TAREFAS} (${erro.reason._tag})`],
          avisos: [] as Array<string>,
          ids: [] as Array<string>,
        }),
    }),
  );
});

/** As pastas públicas fora de `base-conhecimento/` que passam pela varredura de dados pessoais. */
const PASTAS_PUBLICAS = ["catalogo", PASTA_SKILLS_REPOSITORIO] as const;

/** O texto dos bytes, se eles são UTF-8 (a mesma decodificação estrita do `lerTexto` do kb); senão, `undefined`. */
function textoUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * Dados pessoais, URL pré-assinada, planilha do Google e sessão do SEI nos textos das `PASTAS_PUBLICAS`.
 * Só o arquivo que não é UTF-8 (a imagem de uma skill) fica de fora da varredura; o que não se consegue
 * examinar ou ler (um link simbólico quebrado, um arquivo sem permissão) é erro da validação, com a
 * categoria da falha: um arquivo que ninguém varreu não passa como limpo.
 */
export const validarDadosPessoais = Effect.fn("validar_base.dadosPessoais")(function* (raizProjeto: string) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const erros: Array<string> = [];
  for (const pasta of PASTAS_PUBLICAS) {
    const raiz = path.join(raizProjeto, ...pasta.split("/"));
    if (!(yield* fs.exists(raiz).pipe(Effect.orElseSucceed(() => false)))) continue;
    const entradas = yield* fs.readDirectory(raiz, { recursive: true }).pipe(Effect.result);
    if (entradas._tag === "Failure") {
      erros.push(`${pasta}: não foi possível listar a pasta (${entradas.failure.reason._tag})`);
      continue;
    }
    for (const relativo of [...entradas.success].sort()) {
      const caminho = path.join(raiz, relativo);
      const nome = `${pasta}/${relativo.split(path.sep).join("/")}`;
      const info = yield* fs.stat(caminho).pipe(Effect.result);
      if (info._tag === "Failure") {
        erros.push(`${nome}: não foi possível examinar o arquivo (${info.failure.reason._tag})`);
        continue;
      }
      if (info.success.type !== "File") continue;
      const bytes = yield* fs.readFile(caminho).pipe(Effect.result);
      if (bytes._tag === "Failure") {
        erros.push(`${nome}: não foi possível ler o arquivo (${bytes.failure.reason._tag})`);
        continue;
      }
      const texto = textoUtf8(bytes.success);
      if (texto === undefined) continue;
      erros.push(...urlPreAssinada(nome, texto), ...dadosPessoaisEUrlsInternas(nome, texto));
    }
  }
  return erros;
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
    const tarefas = yield* validarTarefas(caminhos.raizProjeto, skills.doApp, skills.appMinimos);
    erros.push(...tarefas.erros);
    erros.push(...(yield* validarDadosPessoais(caminhos.raizProjeto)));
    for (const aviso of tarefas.avisos) yield* Console.warn(`AVISO: ${aviso}`);
    if (erros.length) {
      for (const erro of erros) yield* Console.error(`ERRO: ${erro}`);
      return yield* sairCom(1);
    }
    yield* Console.log(
      `Base válida: ${totalNormas} normas publicadas, metadados institucionais, catálogos e arquivos gerados conferidos; ` +
        `${dados.total} registros institucionais; base da revisão de PPC conferida; ` +
        `${skills.doApp.length} skills do app (${skills.doApp.join(", ")}); ` +
        `${tarefas.ids.length} tarefas (${tarefas.ids.join(", ")}); catalogo/ e .agents/skills/ sem dados pessoais.`,
    );
  }),
).pipe(
  Command.withDescription(
    "Valida a base pública de conhecimento, os registros institucionais (institucional/ifpr/: campi, cursos, " +
      "ingresso, processos SEI), a base da revisão de PPC (revisao-ppc/: fichas, tópicos e marcos) " +
      "os arquivos gerados (em dia com o gerar_base), o bloco simplifica: das skills do app (catalogo/skills/*/SKILL.md), " +
      "os manifestos de tarefa (catalogo/tarefas/*.yaml) e os dados pessoais em catalogo/ e .agents/skills/.",
  ),
);

if (import.meta.main) {
  executarPrincipal("validar_base", Command.run(comando, { version: "1.0.0" }));
}
