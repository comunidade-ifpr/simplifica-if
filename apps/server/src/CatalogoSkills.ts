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
 *
 * Todas as skills do catálogo vão para toda conversa nova ou retomada (`Conversas.ts`): as instruções
 * da sessão só levam o nome, a descrição e o caminho de cada uma, e o provider lê o `SKILL.md` quando o
 * pedido combina com a descrição.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { compararVersoes } from "@simplifica-if/atualizacao/manifesto";
import type { ResumoSkill } from "@simplifica-if/contratos-app";
import { lerPastaSkills, type SkillDoApp } from "@simplifica-if/mcp/skills";
import type * as Motor from "@simplifica-if/motor";

export class CatalogoSkills extends Context.Service<
  CatalogoSkills,
  {
    /** As skills que vão a cada sessão do provider. */
    readonly skills: ReadonlyArray<Motor.Skill>;
    /** O que `skills.listar` devolve à interface. */
    readonly resumos: ReadonlyArray<ResumoSkill>;
    /** A versão (`simplifica.versao`, ou `0.0.0`) de cada skill do catálogo, para a atualização. */
    readonly versoes: Readonly<Record<string, string>>;
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

const paraResumo = (skill: SkillDoApp): ResumoSkill => ({
  nome: skill.nome,
  titulo: skill.manifesto.titulo,
  resumo: skill.manifesto.resumo,
  area: skill.manifesto.area,
  publico: skill.manifesto.publico ?? [],
  entradas: skill.manifesto.entradas ?? [],
  etapas: skill.manifesto.etapas ?? [],
  ...(skill.manifesto.duracao_estimada === undefined ? {} : { duracaoEstimada: skill.manifesto.duracao_estimada }),
});

/** O catálogo a partir de skills já lidas (o `layer` e os testes). */
export const deSkills = (skills: ReadonlyArray<SkillDoApp>) =>
  CatalogoSkills.of({
    skills: skills.map(paraMotor),
    resumos: skills.map(paraResumo),
    versoes: Object.fromEntries(skills.map((skill) => [skill.nome, versaoDe(skill)])),
  });

const versaoDe = (skill: SkillDoApp) => skill.manifesto.versao ?? "0.0.0";

/** De cada nome, a skill de versão maior; no empate, a que veio primeiro (a empacotada). */
export const maisNovas = (grupos: ReadonlyArray<ReadonlyArray<SkillDoApp>>): ReadonlyArray<SkillDoApp> => {
  const escolhidas = new Map<string, SkillDoApp>();
  for (const grupo of grupos) {
    for (const skill of grupo) {
      const atual = escolhidas.get(skill.nome);
      if (atual === undefined || compararVersoes(versaoDe(skill), versaoDe(atual)) > 0)
        escolhidas.set(skill.nome, skill);
    }
  }
  return [...escolhidas.values()].sort((a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0));
};

/** Um catálogo vazio: o servidor sem `--pasta-skills`. */
export const layerVazio = Layer.succeed(CatalogoSkills, deSkills([]));

/** Um catálogo fixo, para os testes. */
export const layerFixo = (skills: ReadonlyArray<SkillDoApp>) => Layer.succeed(CatalogoSkills, deSkills(skills));

/**
 * Lê a pasta de skills na abertura. Falha com `PastaSkillsInvalida` se a pasta não puder ser listada;
 * as skills inválidas só vão para o log. Pede `FileSystem` e `Path`.
 */
export const layer = (pasta: string, baixadas: ReadonlyArray<string> = []) =>
  Layer.effect(
    CatalogoSkills,
    Effect.gen(function* () {
      const grupos: Array<ReadonlyArray<SkillDoApp>> = [];
      const pastas = [pasta, ...baixadas];
      for (const [indice, atual] of pastas.entries()) {
        const tentativa = yield* lerPastaSkills(atual).pipe(
          Effect.mapError((erro) => new PastaSkillsInvalida({ pasta: atual, cause: erro })),
          Effect.result,
        );
        if (tentativa._tag === "Failure") {
          // A empacotada que não se lê derruba a abertura; uma baixada só vai ao log (ficam as empacotadas).
          if (indice === 0) return yield* tentativa.failure;
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
      return deSkills(maisNovas(grupos));
    }),
  );
