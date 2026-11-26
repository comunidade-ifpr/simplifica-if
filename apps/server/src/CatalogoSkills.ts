/**
 * O catálogo das skills do app (M1.11): as skills de uma pasta (`--pasta-skills`) que têm o bloco
 * `simplifica:` válido no `SKILL.md`, prontas para o motor (`Motor.Skill`).
 *
 * - **Quais entram:** só as com bloco válido (`@simplifica-if/mcp/skills`, o mesmo Effect Schema do
 *   `validar_base.ts`). Skill sem o bloco fica no repositório, sem log de aviso (é o caso normal
 *   de skill só do repositório); skill com bloco inválido, `name` diferente da pasta ou
 *   arquivo listado que falta fica de fora com o erro no log. Uma skill quebrada não derruba o servidor
 *   nem as outras.
 * - **O que vai ao motor:** o nome, a descrição do front matter, o corpo do `SKILL.md` como instruções
 *   e os arquivos listados em `simplifica.arquivos`, nada mais (nem `scripts/`, nem `tests/`).
 * - **Quando se lê:** uma vez, na abertura do servidor. No app, as skills mudam com a atualização
 *   (M1.10), que reinicia o servidor; no desenvolvimento, reinicie para ver uma skill editada.
 * - **Skills baixadas (M1.10):** além da pasta empacotada, as pastas que a atualização baixou. De cada
 *   skill entra a de `simplifica.versao` maior; no empate, a empacotada (um app novo pode trazer uma
 *   skill mais nova que a baixada).
 * - **Skills retiradas:** a skill cujo nome está na lista de retiradas não entra, venha do instalador ou
 *   de um download. A lista é a soma da que o instalador traz (`retiradas.yaml` na pasta de skills) com
 *   a que os manifestos do canal trouxeram (`retiradas.json` da pasta de atualização, só de acréscimos):
 *   ela só cresce, e assim uma skill com erro grave sai dos computadores sem release do app. A sessão
 *   apaga a pasta da skill retirada em `.simplifica/skills/` da pasta de trabalho (`Conversas.ts`).
 *
 * Todas as skills do catálogo vão para a conversa livre, nova ou retomada (`Conversas.ts`): as instruções
 * da sessão só levam o nome, a descrição e o caminho de cada uma, e o provider lê o `SKILL.md` quando o
 * pedido combina com a descrição. A conversa aberta por um cartão leva só a skill da tarefa.
 *
 * O cartão que abre uma skill é a tarefa (`CatalogoTarefas.ts`): a skill sem tarefa entra aqui e vai às
 * conversas livres do mesmo jeito, só não tem cartão.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { maisNova } from "@simplifica-if/atualizacao/manifesto";
import { ARQUIVO_RETIRADAS, nomesRetirados, tentarLerRetiradas } from "@simplifica-if/atualizacao/retiradas";
import type { EtapaTarefa } from "@simplifica-if/contratos-app";
import { lerPastaSkills, type SkillDoApp } from "@simplifica-if/mcp/skills";
import type * as Motor from "@simplifica-if/motor";

export class CatalogoSkills extends Context.Service<
  CatalogoSkills,
  {
    /** As skills do catálogo: todas vão à sessão da conversa livre; à da conversa de tarefa, só a dela. */
    readonly skills: ReadonlyArray<Motor.Skill>;
    /**
     * As etapas (`simplifica.etapas`) de cada skill do catálogo, pelo nome, para o indicador da tarefa que
     * a cita. Um `Map`, e não um objeto: o nome vem de um manifesto, e `constructor` não é skill.
     */
    readonly etapas: ReadonlyMap<string, ReadonlyArray<EtapaTarefa>>;
    /** A versão (`simplifica.versao`, ou `0.0.0`) de cada skill do catálogo, pelo nome, para a atualização. */
    readonly versoes: ReadonlyMap<string, string>;
    /**
     * As skills retiradas (as do instalador e as baixadas): a atualização não as baixa, e a sessão apaga a
     * pasta delas em `.simplifica/skills/` da pasta de trabalho.
     */
    readonly retiradas: ReadonlySet<string>;
  }
>()("@simplifica-if/server/CatalogoSkills") {}

/** A pasta de skills dada não pode ser lida (não existe, não é pasta, sem permissão). */
export class PastaSkillsInvalida extends Schema.TaggedError<PastaSkillsInvalida>()("PastaSkillsInvalida", {
  pasta: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `não foi possível ler a pasta de skills: ${this.pasta}`;
  }
}

const paraMotor = (skill: SkillDoApp): Motor.Skill => ({
  nome: skill.nome,
  descricao: skill.descricao,
  instrucoes: skill.instrucoes,
  arquivos: skill.arquivos,
});

/** O catálogo a partir de skills já lidas (o `layer` e os testes). */
export const deSkills = (skills: ReadonlyArray<SkillDoApp>, retiradas: ReadonlySet<string> = new Set()) =>
  CatalogoSkills.of({
    skills: skills.map(paraMotor),
    etapas: new Map(skills.map((skill) => [skill.nome, skill.manifesto.etapas ?? []])),
    versoes: new Map(skills.map((skill) => [skill.nome, versaoDe(skill)])),
    retiradas,
  });

const versaoDe = (skill: SkillDoApp) => skill.manifesto.versao ?? "0.0.0";

/**
 * De cada nome, a skill de versão maior; no empate, a que veio primeiro (a empacotada). A skill de nome
 * em `retiradas` não entra, de grupo nenhum.
 */
export const maisNovas = (
  grupos: ReadonlyArray<ReadonlyArray<SkillDoApp>>,
  retiradas: ReadonlySet<string> = new Set(),
): ReadonlyArray<SkillDoApp> => {
  const escolhidas = new Map<string, SkillDoApp>();
  for (const grupo of grupos) {
    for (const skill of grupo) {
      if (retiradas.has(skill.nome)) continue;
      const atual = escolhidas.get(skill.nome);
      if (atual === undefined || maisNova(versaoDe(skill), versaoDe(atual))) escolhidas.set(skill.nome, skill);
    }
  }
  return [...escolhidas.values()].sort((a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0));
};

/** Um catálogo vazio: o servidor sem `--pasta-skills`. */
export const layerVazio = Layer.succeed(CatalogoSkills, deSkills([]));

/** Um catálogo fixo, para os testes. */
export const layerFixo = (skills: ReadonlyArray<SkillDoApp>, retiradas: ReadonlySet<string> = new Set()) =>
  Layer.succeed(CatalogoSkills, deSkills(skills, retiradas));

/**
 * As skills retiradas que a pasta de skills traz (`retiradas.yaml`, que o build copia para o instalador).
 * Sem o arquivo, nenhuma; o arquivo que não se lê vai ao log e conta como vazio (a lista do catálogo
 * baixado continua valendo).
 */
const retiradasDaPasta = Effect.fn("CatalogoSkills.retiradasDaPasta")(function* (pasta: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const arquivo = path.join(pasta, ARQUIVO_RETIRADAS);
  const nenhuma: ReadonlyArray<string> = [];
  if (!(yield* fs.exists(arquivo).pipe(Effect.orElseSucceed(() => false)))) return nenhuma;
  const lido = yield* fs.readFileString(arquivo).pipe(Effect.map(tentarLerRetiradas), Effect.option);
  if (lido._tag === "None" || lido.value === undefined) {
    yield* Effect.logError(`lista de skills retiradas ilegível: ${ARQUIVO_RETIRADAS} em ${pasta}`);
    return nenhuma;
  }
  return nomesRetirados(lido.value);
});

/**
 * Lê a pasta de skills na abertura. Falha com `PastaSkillsInvalida` se a pasta não puder ser listada;
 * as skills inválidas só vão para o log. `retiradasBaixadas`: as retiradas que os manifestos do canal
 * trouxeram (`Abertura.skillsRetiradas`). Pede `FileSystem` e `Path`.
 */
export const layer = (
  pasta: string | undefined,
  baixadas: ReadonlyArray<string> = [],
  retiradasBaixadas: ReadonlyArray<string> = [],
) =>
  Layer.effect(
    CatalogoSkills,
    Effect.gen(function* () {
      const grupos: Array<ReadonlyArray<SkillDoApp>> = [];
      // Sem a pasta empacotada (o servidor sem `--pasta-skills`), só as baixadas.
      const pastas = pasta === undefined ? baixadas : [pasta, ...baixadas];
      for (const [indice, atual] of pastas.entries()) {
        const tentativa = yield* lerPastaSkills(atual).pipe(
          Effect.mapError((erro) => new PastaSkillsInvalida({ pasta: atual, cause: erro })),
          Effect.result,
        );
        if (tentativa._tag === "Failure") {
          // A empacotada que não se lê derruba a abertura; uma baixada só vai ao log (ficam as empacotadas).
          if (indice === 0 && pasta !== undefined) return yield* tentativa.failure;
          yield* Effect.logError(tentativa.failure.message);
          continue;
        }
        const lida = tentativa.success;
        for (const invalida of lida.invalidas) {
          yield* Effect.logError(`skill fora do catálogo: ${invalida.message}`);
        }
        yield* Effect.logInfo(
          lida.skills.length === 0
            ? `nenhuma skill do app em ${atual}`
            : `skills do app (${atual}): ${lida.skills.map((skill) => `${skill.nome} ${versaoDe(skill)}`).join(", ")}`,
        );
        grupos.push(lida.skills);
      }
      const retiradas = new Set([...(pasta === undefined ? [] : yield* retiradasDaPasta(pasta)), ...retiradasBaixadas]);
      const fora = [...new Set(grupos.flat().map((skill) => skill.nome))].filter((nome) => retiradas.has(nome));
      if (fora.length > 0) yield* Effect.logInfo(`skills retiradas, fora do catálogo: ${fora.sort().join(", ")}`);
      return deSkills(maisNovas(grupos, retiradas), retiradas);
    }),
  );
