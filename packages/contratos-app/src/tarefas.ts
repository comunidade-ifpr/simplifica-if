/**
 * O catálogo de tarefas que o servidor serve à interface (`tarefas.listar`): os cartões do Início e de
 * "Todas as tarefas". Cada tarefa vem do manifesto dela (`catalogo/tarefas/<id>.yaml`,
 * `@simplifica-if/mcp/tarefas`) e, na abertura `conversa`, das etapas da skill que ela cita.
 */
import { MODULOS, type Modulo } from "@simplifica-if/mcp/modulos";
import { RE_MARCADOR } from "@simplifica-if/mcp/pedido";
import { PUBLICOS } from "@simplifica-if/mcp/publicos";
import * as Schema from "effect/Schema";
import { Rpc, RpcGroup } from "effect/rpc";

export { MODULOS, type Modulo, RE_MARCADOR };

/** Uma entrada do formulário da tarefa (`abre.conversa.entradas` do manifesto). */
export const EntradaTarefa = Schema.Struct({
  id: Schema.String,
  tipo: Schema.Literals(["arquivo", "curso", "texto", "norma"]),
  rotulo: Schema.String,
  /** As extensões aceitas num `arquivo` (`.docx`, `.md`). */
  aceita: Schema.optionalKey(Schema.Array(Schema.String)),
  opcional: Schema.optionalKey(Schema.Boolean),
});
export type EntradaTarefa = typeof EntradaTarefa.Type;

/** Uma etapa do indicador (`etapas` do manifesto da skill); a skill a marca com a ferramenta `etapa`. */
export const EtapaTarefa = Schema.Struct({
  id: Schema.String,
  rotulo: Schema.String,
  /** A etapa informa `progresso` (feito de total). */
  progresso: Schema.optionalKey(Schema.Boolean),
});
export type EtapaTarefa = typeof EtapaTarefa.Type;

/** Abre um sistema externo no navegador do sistema; o app não vê a página nem a credencial. */
export const AberturaLink = Schema.Struct({
  tipo: Schema.Literal("link"),
  /** Sempre `https` (regra do manifesto). */
  url: Schema.String,
  /** O destino pede login. */
  requerLogin: Schema.Boolean,
});

/** Abre uma conversa com um pedido inicial, um formulário curto e, se houver, uma skill. */
export const AberturaConversa = Schema.Struct({
  tipo: Schema.Literal("conversa"),
  /** A skill que a conversa segue, pelo nome; sem ela, a conversa só leva o pedido. */
  skill: Schema.optionalKey(Schema.String),
  /** O pedido inicial, com `{id}` no lugar de cada entrada. */
  pedido: Schema.String,
  /** O formulário; vazio quando o manifesto não declara. */
  entradas: Schema.Array(EntradaTarefa),
  /** O indicador de etapas da skill; vazio sem skill ou quando ela não declara. */
  etapas: Schema.Array(EtapaTarefa),
});

/** Abre a tela de um módulo do app; a rota de cada módulo é do código da interface. */
export const AberturaModulo = Schema.Struct({
  tipo: Schema.Literal("modulo"),
  modulo: Schema.Literals(MODULOS),
});

export const AberturaTarefa = Schema.Union([AberturaLink, AberturaConversa, AberturaModulo]);
export type AberturaTarefa = typeof AberturaTarefa.Type;

export const ResumoTarefa = Schema.Struct({
  /** O `id` permanente da tarefa: o que `conversa.iniciar` recebe e a conversa guarda. */
  id: Schema.String,
  titulo: Schema.String,
  resumo: Schema.String,
  area: Schema.String,
  /** Os perfis a quem a tarefa serve (`publico`); vazio quando o manifesto não diz. */
  publico: Schema.Array(Schema.Literals(PUBLICOS)),
  /** `experimental` só chega no canal beta; a `descontinuada` não chega (fica em `retiradas`). */
  situacao: Schema.Literals(["experimental", "estavel"]),
  /** Quem mantém a tarefa; o contato é o usuário do GitHub. */
  mantenedor: Schema.Struct({ nome: Schema.String, github: Schema.String }),
  /** O que a tarefa não faz. */
  limites: Schema.optionalKey(Schema.String),
  /** Quem escreveu a tarefa. */
  autoria: Schema.optionalKey(Schema.String),
  /** Como o manifesto escreve (`20min`, `1h`). */
  duracaoEstimada: Schema.optionalKey(Schema.String),
  abre: AberturaTarefa,
});
export type ResumoTarefa = typeof ResumoTarefa.Type;

/** Uma tarefa fora do catálogo: só o que nomeia as conversas antigas dela. */
export const TarefaRetirada = Schema.Struct({ id: Schema.String, titulo: Schema.String });
export type TarefaRetirada = typeof TarefaRetirada.Type;

export const CatalogoTarefas = Schema.Struct({
  /**
   * As tarefas que este app atende, em ordem alfabética do `id`. Ficam de fora a `descontinuada`, a
   * `experimental` fora do canal beta e a que pede módulo, skill ou versão que o app não tem.
   */
  tarefas: Schema.Array(ResumoTarefa),
  /** As que ficaram de fora: a interface só usa o título, nas conversas que nasceram delas. */
  retiradas: Schema.Array(TarefaRetirada),
});
export type CatalogoTarefas = typeof CatalogoTarefas.Type;

export class GrupoTarefas extends RpcGroup.make(
  /** O catálogo de tarefas do servidor, lido na abertura dele. */
  Rpc.make("tarefas.listar", { payload: Schema.Struct({}), success: CatalogoTarefas }),
) {}
