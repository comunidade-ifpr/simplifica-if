/**
 * `@simplifica-if/mcp/skills`: o manifesto das skills do app (o bloco `simplifica:` do front matter do
 * `SKILL.md`, seção "Manifesto de skill" do plano do app) e a leitura de uma pasta de skills. O cartão
 * que abre a skill numa conversa é a tarefa (`./tarefas.ts`).
 *
 * Fica neste pacote, e não no `@simplifica-if/kb`, porque o manifesto confere `ferramentas` contra a
 * lista do Toolkit (`FERRAMENTAS`): `ferramentas` lista só as ferramentas do `simplifica-mcp` que a
 * skill usa (a busca web, quando ligada, vem da política da sessão, não do manifesto). Quem usa:
 *
 * - o `apps/server` (`CatalogoSkills`), que entrega as skills válidas às conversas;
 * - o `scripts/validar_base.ts`, que recusa um bloco inválido, com campo desconhecido (`estrito`), ou um
 *   arquivo listado que falta;
 * - o build do `apps/desktop`, que copia para o app só as skills elegíveis e só os arquivos listados, e
 *   também lê em modo estrito.
 *
 * O `SKILL.md` continua no formato Agent Skills (`name`, `description`), que Claude, Codex e
 * Antigravity leem; o bloco `simplifica:` é a parte do app. Skill sem o bloco não vai para o app (as do
 * repositório que dependem de SUAP, SEI ou scripts ficam de fora assim).
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Semver, VersaoBase } from "@simplifica-if/atualizacao/manifesto";
import { formatarErro } from "@simplifica-if/kb/esquema/mensagens";
import { parse } from "yaml";
import { FERRAMENTAS } from "./ferramentas/toolkit.ts";

/** Os nomes das ferramentas do `simplifica-mcp`, na ordem do Toolkit. */
export const NOMES_FERRAMENTAS = FERRAMENTAS.map((ferramenta) => ferramenta.nome);

/** Pastas da skill que nunca vão para o app: os scripts e os testes só rodam no repositório. */
const PASTAS_FORA_DO_APP = ["scripts", "tests"] as const;

const NOME_SKILL = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

const texto = Schema.String.check(Schema.isMinLength(1));
const slug = Schema.String.check(Schema.isPattern(SLUG, { message: "esperava letras minúsculas, dígitos e hífen" }));

/** Um caminho relativo dentro da pasta da skill, fora de `scripts/` e `tests/`. */
const caminhoArquivo = Schema.String.check(
  Schema.makeFilter((caminho: string) => {
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
  }),
);

const nomeFerramenta = Schema.String.check(
  Schema.makeFilter(
    (nome: string) =>
      (NOMES_FERRAMENTAS as ReadonlyArray<string>).includes(nome) ||
      `"${nome}" não é ferramenta do simplifica-mcp (${NOMES_FERRAMENTAS.join(", ")})`,
  ),
);

/** Uma etapa do indicador; a skill a marca com a ferramenta `etapa`. */
const Etapa = Schema.Struct({
  id: slug,
  rotulo: texto,
  progresso: Schema.optionalKey(Schema.Boolean),
});

/**
 * O bloco `simplifica:`, só com o que é da skill. Obrigatórios para o app: `ferramentas` e `arquivos` (a
 * lista explícita do que vai com o `SKILL.md`). O cartão (título, resumo, área, público, formulário,
 * duração e mantenedor) é da tarefa (`./tarefas.ts`): uma skill com o bloco e sem tarefa continua
 * válida e vai para o app, sem cartão.
 */
export const ManifestoSkill = Schema.Struct({
  ferramentas: Schema.Array(nomeFerramenta),
  arquivos: Schema.Array(caminhoArquivo),
  etapas: Schema.optionalKey(Schema.Array(Etapa)),
  /**
   * Versão da skill (X.Y.Z), que vai ao manifesto do canal (M1.10); sem ela, a fábrica usa `0.1.0`. O
   * app só troca uma skill pela de versão maior, e a fábrica recusa publicar conteúdo novo com a versão
   * de antes: toda edição da skill sobe a versão.
   */
  versao: Schema.optionalKey(Semver),
  /** A menor versão da base (AAAA.MM.DD) que atende a skill. */
  base_minima: Schema.optionalKey(VersaoBase),
  /** A menor versão do app (X.Y.Z) que atende a skill. */
  app_minimo: Schema.optionalKey(Semver),
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

// Todos os problemas de uma vez: quem corrige o bloco vê a lista inteira.
const decodificarFrontMatter = Schema.decodeUnknownResult(FrontMatterSkill, { errors: "all" });
const decodificarManifesto = Schema.decodeUnknownResult(ManifestoSkill, { errors: "all" });
const decodificarManifestoEstrito = Schema.decodeUnknownResult(ManifestoSkill, {
  errors: "all",
  onExcessProperty: "error",
});

export interface OpcoesLeitura {
  /**
   * Recusa, no bloco `simplifica:`, campo que o schema não conhece (o `validar_base.ts` e o build do
   * desktop: um campo do cartão, que hoje é da tarefa, não passa em silêncio). O servidor lê sem isto,
   * para a skill de um app mais novo ainda servir a este. Fora do bloco, o front matter aceita outros campos.
   */
  readonly estrito?: boolean;
}

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
export const lerSkillMd = Effect.fn("skills.lerSkillMd")(function* (
  textoSkill: string,
  skill: string,
  opcoes: OpcoesLeitura = {},
): Effect.fn.Return<SkillMd, ErroSkill> {
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
  const manifesto = (opcoes.estrito === true ? decodificarManifestoEstrito : decodificarManifesto)(
    meta.success.simplifica,
  );
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
export const lerSkill = Effect.fn("skills.lerSkill")(function* (pasta: string, opcoes: OpcoesLeitura = {}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const nomePasta = path.basename(pasta);
  const erro = (detalhe: string) => new ErroSkill({ skill: nomePasta, detalhe });
  const textoSkill = yield* fs
    .readFileString(path.join(pasta, "SKILL.md"))
    .pipe(Effect.mapError(() => erro("não foi possível ler o SKILL.md")));
  const lido = yield* lerSkillMd(textoSkill, nomePasta, opcoes);
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
export const lerPastaSkills = Effect.fn("skills.lerPastaSkills")(function* (pasta: string, opcoes: OpcoesLeitura = {}) {
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
    const lida = yield* lerSkill(pastaSkill, opcoes).pipe(Effect.result);
    if (lida._tag === "Failure") invalidas.push(lida.failure);
    else if (lida.success === undefined) foraDoApp.push(nome);
    else skills.push(lida.success);
  }
  return { skills, foraDoApp, invalidas } satisfies PastaSkills;
});
