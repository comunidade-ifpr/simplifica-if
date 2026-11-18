/**
 * Uma skill do app no catálogo do servidor: o que os futuros cartões da tela inicial mostram. Vem do
 * `name` e do bloco `simplifica:` do `SKILL.md` (`@simplifica-if/mcp/skills`).
 */
import * as Schema from "effect/Schema";
import { Rpc, RpcGroup } from "effect/rpc";

/** Uma entrada do formulário da tarefa (`entradas` do manifesto). */
export const EntradaTarefa = Schema.Struct({
  id: Schema.String,
  tipo: Schema.Literals(["arquivo", "curso", "texto", "norma"]),
  rotulo: Schema.String,
  /** As extensões aceitas num `arquivo` (`.docx`, `.md`). */
  aceita: Schema.optionalKey(Schema.Array(Schema.String)),
  opcional: Schema.optionalKey(Schema.Boolean),
});
export type EntradaTarefa = typeof EntradaTarefa.Type;

/** Uma etapa do indicador (`etapas` do manifesto); a skill a marca com a ferramenta `etapa`. */
export const EtapaTarefa = Schema.Struct({
  id: Schema.String,
  rotulo: Schema.String,
  /** A etapa informa `progresso` (feito de total). */
  progresso: Schema.optionalKey(Schema.Boolean),
});
export type EtapaTarefa = typeof EtapaTarefa.Type;

export const ResumoSkill = Schema.Struct({
  nome: Schema.String,
  titulo: Schema.String,
  resumo: Schema.String,
  area: Schema.String,
  /** Os perfis a quem a tarefa serve (`publico`); vazio quando o manifesto não diz. */
  publico: Schema.Array(Schema.String),
  /** O formulário da tarefa; vazio quando o manifesto não declara. */
  entradas: Schema.Array(EntradaTarefa),
  /** O indicador de etapas; vazio quando o manifesto não declara. */
  etapas: Schema.Array(EtapaTarefa),
  /** Como o manifesto escreve (`20min`, `1h`). */
  duracaoEstimada: Schema.optionalKey(Schema.String),
});
export type ResumoSkill = typeof ResumoSkill.Type;

export class GrupoSkills extends RpcGroup.make(
  /** As skills do catálogo do servidor, em ordem alfabética do nome; todas vão para toda conversa. */
  Rpc.make("skills.listar", { payload: Schema.Struct({}), success: Schema.Array(ResumoSkill) }),
) {}
