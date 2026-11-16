/**
 * `@simplifica-if/mcp/skills`: o manifesto das skills do app (o bloco `simplifica:` do front matter do
 * `SKILL.md`, seção "Manifesto de skill" do plano do app) e a leitura de uma pasta de skills.
 *
 * Fica neste pacote, e não no `@simplifica-if/kb`, porque o manifesto confere `ferramentas` contra a
 * lista do Toolkit (`FERRAMENTAS`): uma skill do app só chama ferramentas do `simplifica-mcp`. Quem usa:
 *
 * - o `apps/server` (`CatalogoSkills`), que entrega as skills válidas às conversas;
 * - o `scripts/validar_base.ts`, que recusa um bloco inválido ou um arquivo listado que falta;
 * - o build do `apps/desktop`, que copia para o app só as skills elegíveis e só os arquivos listados.
 *
 * O `SKILL.md` continua no formato Agent Skills (`name`, `description`), que Claude, Codex e
 * Antigravity leem; o bloco `simplifica:` é a parte do app. Skill sem o bloco não vai para o app (as do
 * repositório que dependem de SUAP, SEI ou scripts ficam de fora assim).
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { formatarErro } from "@simplifica-if/kb/esquema/mensagens";
import { parse } from "yaml";
import { FERRAMENTAS } from "./ferramentas/toolkit.ts";

/** Os nomes das ferramentas do `simplifica-mcp`, na ordem do Toolkit. */
export const NOMES_FERRAMENTAS = FERRAMENTAS.map((ferramenta) => ferramenta.nome);

/**
 * Pastas da skill que nunca vão para o app: os scripts e os testes só rodam no repositório, e
 * `agents/` traz a configuração de outros clientes (o `openai.yaml` do Codex).
 */
export const PASTAS_FORA_DO_APP = ["scripts", "tests", "agents"] as const;

const NOME_SKILL = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

const texto = Schema.String.check(Schema.isMinLength(1));
const slug = Schema.String.check(Schema.isPattern(SLUG, { message: "esperava letras minúsculas, dígitos e hífen" }));

/** Um caminho relativo dentro da pasta da skill, fora de `scripts/`, `tests/` e `agents/`. */
const caminhoArquivo = Schema.String.check(
  Schema.makeFilter(
    (caminho: string) => {
      const partes = caminho.split("/");
      if (caminho === "" || caminho.startsWith("/") || caminho.includes("\\") || /^[A-Za-z]:/.test(caminho)) {
        return "esperava um caminho relativo à pasta da skill, com /";
      }
      if (partes.some((parte) => parte === "" || parte === "." || parte === "..")) {
        return "o caminho não pode ter partes vazias, . ou ..";
      }
      if ((PASTAS_FORA_DO_APP as ReadonlyArray<string>).includes(partes[0]!)) {
        return `${partes[0]}/ não vai para o app (só roda no repositório)`;
      }
      if (caminho === "SKILL.md") return "o SKILL.md vai sempre; não o liste";
      return true;
    },
    { message: "caminho inválido" },
  ),
);

const nomeFerramenta = Schema.String.check(
  Schema.makeFilter(
    (nome: string) =>
      (NOMES_FERRAMENTAS as ReadonlyArray<string>).includes(nome) ||
      `"${nome}" não é ferramenta do simplifica-mcp (${NOMES_FERRAMENTAS.join(", ")})`,
    { message: "ferramenta inexistente" },
  ),
);

/** Uma entrada que a tarefa pede ao servidor (os futuros cartões e formulários). */
const Entrada = Schema.Struct({
  id: slug,
  tipo: Schema.Literals(["arquivo", "curso", "texto", "norma"]),
  rotulo: texto,
  aceita: Schema.optionalKey(Schema.Array(Schema.String.check(Schema.isPattern(/^\.[a-z0-9]+$/)))),
  opcional: Schema.optionalKey(Schema.Boolean),
});

/** Uma etapa do indicador; a skill a marca com a ferramenta `etapa`. */
const Etapa = Schema.Struct({
  id: slug,
  rotulo: texto,
  progresso: Schema.optionalKey(Schema.Boolean),
});

/**
 * O bloco `simplifica:`. Obrigatórios para o app: `titulo`, `resumo`, `area`, `ferramentas` e
 * `arquivos` (a lista explícita do que vai com o `SKILL.md`). Os demais campos do plano são opcionais
 * por enquanto, até a interface (cartões, etapas) e a atualização (versões mínimas) usarem.
 */
export const ManifestoSkill = Schema.Struct({
  titulo: texto,
  resumo: texto,
  area: slug,
  ferramentas: Schema.Array(nomeFerramenta),
  arquivos: Schema.Array(caminhoArquivo),
  publico: Schema.optionalKey(Schema.Array(slug)),
  entradas: Schema.optionalKey(Schema.Array(Entrada)),
  etapas: Schema.optionalKey(Schema.Array(Etapa)),
  base_minima: Schema.optionalKey(texto),
  app_minimo: Schema.optionalKey(texto),
  duracao_estimada: Schema.optionalKey(texto),
  donos: Schema.optionalKey(Schema.Array(texto)),
});
export type ManifestoSkill = typeof ManifestoSkill.Type;

/** O front matter do `SKILL.md`: o do Agent Skills e, opcional, o bloco do app. Outros campos passam. */
const FrontMatterSkill = Schema.Struct({
  name: Schema.String.check(
    Schema.isPattern(NOME_SKILL, { message: "name: letras minúsculas, dígitos e hífen, até 64" }),
  ),
  description: texto,
  simplifica: Schema.optionalKey(Schema.Unknown),
});

const decodificarFrontMatter = Schema.decodeUnknownResult(FrontMatterSkill);
const decodificarManifesto = Schema.decodeUnknownResult(ManifestoSkill);

/** Uma skill que não pode ir para o app: bloco inválido, arquivo listado que falta, `SKILL.md` ilegível. */
export class ErroSkill extends Schema.TaggedError<ErroSkill>()("ErroSkill", {
  /** O nome da pasta da skill. */
  skill: Schema.String,
  detalhe: Schema.String,
}) {
  override get message(): string {
    return `skill ${this.skill}: ${this.detalhe}`;
  }
}

/** O `SKILL.md` lido: o front matter do Agent Skills, o bloco do app (se houver) e o corpo. */
export interface SkillMd {
  readonly nome: string;
  readonly descricao: string;
  readonly manifesto: ManifestoSkill | undefined;
  readonly corpo: string;
}

const RE_FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Lê o texto de um `SKILL.md`. Sem bloco `simplifica:`, `manifesto` fica `undefined`; com bloco
 * inválido, falha com cada problema numa linha (`ferramentas.0: …`).
 */
export function lerSkillMd(textoSkill: string, skill: string): Effect.Effect<SkillMd, ErroSkill> {
  return Effect.gen(function* () {
    const erro = (detalhe: string) => new ErroSkill({ skill, detalhe });
    const casamento = RE_FRONT_MATTER.exec(textoSkill);
    if (casamento === null) return yield* erro("o SKILL.md não começa com front matter (---)");
    const yaml = yield* Effect.try({
      try: () => parse(casamento[1]!) as unknown,
      catch: (causa) => erro(`front matter não é YAML válido: ${causa instanceof Error ? causa.message : causa}`),
    });
    const meta = decodificarFrontMatter(yaml);
    if (meta._tag === "Failure") return yield* erro(formatarErro(meta.failure));
    const corpo = textoSkill.slice(casamento[0].length).trim();
    if (meta.success.simplifica === undefined) {
      return { nome: meta.success.name, descricao: meta.success.description, manifesto: undefined, corpo };
    }
    const manifesto = decodificarManifesto(meta.success.simplifica);
    if (manifesto._tag === "Failure") {
      return yield* erro(
        `bloco simplifica: inválido\n${formatarErro(manifesto.failure)
          .split("\n")
          .map((linha) => `  simplifica.${linha}`)
          .join("\n")}`,
      );
    }
    return { nome: meta.success.name, descricao: meta.success.description, manifesto: manifesto.success, corpo };
  });
}

/** Uma skill do app pronta para o motor: o `Motor.Skill` (nome, descrição, instruções, arquivos) e o manifesto. */
export interface SkillDoApp {
  readonly nome: string;
  readonly descricao: string;
  /** O corpo do `SKILL.md`. */
  readonly instrucoes: string;
  readonly arquivos: ReadonlyArray<{ readonly caminho: string; readonly conteudo: string }>;
  readonly manifesto: ManifestoSkill;
  /** A pasta da skill, de onde os arquivos foram lidos. */
  readonly pasta: string;
}

/**
 * Lê uma skill (`<pasta>/SKILL.md` e os `arquivos` do manifesto). `undefined` quando a skill não tem
 * bloco `simplifica:` (não é do app). Falha se o bloco for inválido, se o `name` diferir do nome da
 * pasta ou se um arquivo listado faltar.
 */
export const lerSkill = Effect.fn("skills.lerSkill")(function* (pasta: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const nomePasta = path.basename(pasta);
  const erro = (detalhe: string) => new ErroSkill({ skill: nomePasta, detalhe });
  const textoSkill = yield* fs
    .readFileString(path.join(pasta, "SKILL.md"))
    .pipe(Effect.mapError(() => erro("não foi possível ler o SKILL.md")));
  const lido = yield* lerSkillMd(textoSkill, nomePasta);
  if (lido.manifesto === undefined) return undefined;
  if (lido.nome !== nomePasta) return yield* erro(`name "${lido.nome}" difere do nome da pasta`);
  const arquivos: Array<{ caminho: string; conteudo: string }> = [];
  for (const caminho of lido.manifesto.arquivos) {
    const conteudo = yield* fs
      .readFileString(path.join(pasta, ...caminho.split("/")))
      .pipe(Effect.mapError(() => erro(`o arquivo listado em simplifica.arquivos não existe: ${caminho}`)));
    arquivos.push({ caminho, conteudo });
  }
  return {
    nome: lido.nome,
    descricao: lido.descricao,
    instrucoes: lido.corpo,
    arquivos,
    manifesto: lido.manifesto,
    pasta,
  } satisfies SkillDoApp;
});

/** O que uma pasta de skills tem: as do app, as que não são do app e as inválidas. */
export interface PastaSkills {
  readonly skills: ReadonlyArray<SkillDoApp>;
  /** Skills sem bloco `simplifica:` (ficam no repositório). */
  readonly foraDoApp: ReadonlyArray<string>;
  readonly invalidas: ReadonlyArray<ErroSkill>;
}

/**
 * Lê cada subpasta com `SKILL.md` de `pasta`, em ordem alfabética. Uma skill inválida não derruba as
 * outras: vai para `invalidas`. Falha só se a pasta não puder ser listada.
 */
export const lerPastaSkills = Effect.fn("skills.lerPastaSkills")(function* (pasta: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const nomes = [...(yield* fs.readDirectory(pasta))].sort();
  const skills: Array<SkillDoApp> = [];
  const foraDoApp: Array<string> = [];
  const invalidas: Array<ErroSkill> = [];
  for (const nome of nomes) {
    const pastaSkill = path.join(pasta, nome);
    const temSkill = yield* fs.exists(path.join(pastaSkill, "SKILL.md")).pipe(Effect.orElseSucceed(() => false));
    if (!temSkill) continue;
    const lida = yield* lerSkill(pastaSkill).pipe(Effect.result);
    if (lida._tag === "Failure") invalidas.push(lida.failure);
    else if (lida.success === undefined) foraDoApp.push(nome);
    else skills.push(lida.success);
  }
  return { skills, foraDoApp, invalidas } satisfies PastaSkills;
});
