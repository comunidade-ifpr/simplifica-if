/**
 * O catálogo das skills do app (M1.11): as skills de uma pasta (`--pasta-skills`) que têm o bloco
 * `simplifica:` válido no `SKILL.md`, prontas para o motor (`Motor.Skill`).
 *
 * - **Quais entram:** só as com bloco válido (`@simplifica-if/mcp/skills`, o mesmo Effect Schema do
 *   `validar_base.ts`). Skill sem o bloco fica no repositório, sem log de aviso (é o caso normal de
 *   `revisar-processo-ppc`, `suap-ifpr`…); skill com bloco inválido, `name` diferente da pasta ou
 *   arquivo listado que falta fica de fora com o erro no log. Uma skill quebrada não derruba o servidor
 *   nem as outras.
 * - **O que vai ao motor:** o nome, a descrição do front matter, o corpo do `SKILL.md` como instruções
 *   e os arquivos listados em `simplifica.arquivos`, nada mais (nem `scripts/`, nem `tests/`).
 * - **Quando se lê:** uma vez, na abertura do servidor. No app, as skills mudam com a atualização
 *   (M1.10), que reinicia o servidor; no desenvolvimento, reinicie para ver uma skill editada.
 *
 * Todas as skills do catálogo vão para toda conversa nova ou retomada (`Conversas.ts`): as instruções
 * da sessão só levam o nome, a descrição e o caminho de cada uma, e o provider lê o `SKILL.md` quando o
 * pedido combina com a descrição.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
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
});

/** O catálogo a partir de skills já lidas (o `layer` e os testes). */
export const deSkills = (skills: ReadonlyArray<SkillDoApp>) =>
  CatalogoSkills.of({ skills: skills.map(paraMotor), resumos: skills.map(paraResumo) });

/** Um catálogo vazio: o servidor sem `--pasta-skills`. */
export const layerVazio = Layer.succeed(CatalogoSkills, deSkills([]));

/** Um catálogo fixo, para os testes. */
export const layerFixo = (skills: ReadonlyArray<SkillDoApp>) => Layer.succeed(CatalogoSkills, deSkills(skills));

/**
 * Lê a pasta de skills na abertura. Falha com `PastaSkillsInvalida` se a pasta não puder ser listada;
 * as skills inválidas só vão para o log. Pede `FileSystem` e `Path`.
 */
export const layer = (pasta: string) =>
  Layer.effect(
    CatalogoSkills,
    Effect.gen(function* () {
      const lida = yield* lerPastaSkills(pasta).pipe(
        Effect.mapError((erro) => new PastaSkillsInvalida({ pasta, cause: erro })),
      );
      for (const invalida of lida.invalidas) {
        yield* Effect.logError(`skill fora do catálogo: ${invalida.message}`);
      }
      yield* Effect.logInfo(
        lida.skills.length === 0
          ? `nenhuma skill do app em ${pasta}`
          : `skills do app (${pasta}): ${lida.skills.map((skill) => skill.nome).join(", ")}`,
      );
      return deSkills(lida.skills);
    }),
  );
