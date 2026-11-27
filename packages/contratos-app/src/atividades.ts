/**
 * O que está rodando ou espera a pessoa (`docs/plans/multitarefa.md`, "Em andamento"): as conversas que
 * respondem, que pedem permissão, que terminaram depois da última vez em que foram vistas ou que pararam
 * no limite da assinatura, e o que um módulo publica (a leitura com IA de uma revisão de PPC).
 *
 * O núcleo não conhece os módulos: cada atividade traz só um título, uma rota opaca (para onde o clique
 * leva) e, no máximo, as ações do núcleo (Permitir e Negar de um pedido de aprovação).
 */
import { Provider, TipoFerramenta } from "@simplifica-if/motor/eventos";
import * as Schema from "effect/Schema";
import { Rpc, RpcGroup } from "effect/rpc";

/**
 * - `andamento`: respondendo, ou a leitura com IA em curso;
 * - `permissao`: a IA pede permissão para gravar ou executar (`aprovacao`);
 * - `pronta`: a resposta terminou depois da última vez em que a conversa foi vista;
 * - `limite`: parou no limite de uso da assinatura (`provider`).
 */
export const SituacaoAtividade = Schema.Literals(["andamento", "permissao", "pronta", "limite"]);
export type SituacaoAtividade = typeof SituacaoAtividade.Type;

/** O pedido de aprovação pendente, com o que a conversa mostra dele; a resposta vai por `conversa.responderAprovacao`. */
export const AprovacaoPendente = Schema.Struct({
  conversa: Schema.String,
  id: Schema.String,
  ferramenta: Schema.String,
  tipo: TipoFerramenta,
  descricao: Schema.String,
});
export type AprovacaoPendente = typeof AprovacaoPendente.Type;

export const Atividade = Schema.Struct({
  /** Único entre as atividades: `conversa:<id>`, `revisao-ppc:<id>`. */
  id: Schema.String,
  /** Quem roda: "Conversa “Estágio e a 2/2026”", "Revisão do PPC de Enfermagem". */
  titulo: Schema.String,
  /** Para onde o clique leva (`/conversa?id=…`); opaca para quem mostra. */
  rota: Schema.String,
  situacao: SituacaoAtividade,
  /** O andamento dito pelo dono ("IA: 7 de 12 partes"); sem ele, a interface escreve pela situação. */
  detalhe: Schema.optionalKey(Schema.String),
  /** Desde quando está nesta situação (ISO 8601). */
  desde: Schema.String,
  /** A IA que trabalha, para dizer qual chegou ao limite. */
  provider: Schema.optionalKey(Provider),
  aprovacao: Schema.optionalKey(AprovacaoPendente),
});
export type Atividade = typeof Atividade.Type;

/** O fluxo de `atividades.acompanhar`: o retrato e, depois, cada mudança. */
export const EventoAtividades = Schema.Union([
  Schema.TaggedStruct("Retrato", { atividades: Schema.Array(Atividade) }),
  Schema.TaggedStruct("Mudou", { atividade: Atividade }),
  Schema.TaggedStruct("Saiu", { id: Schema.String }),
]);
export type EventoAtividades = typeof EventoAtividades.Type;

export class GrupoAtividades extends RpcGroup.make(
  /**
   * As atividades de agora (`Retrato`) e, daí em diante, cada uma que muda ou sai. Não termina sozinho; a
   * interface acompanha enquanto está aberta e, na reconexão, recomeça pelo retrato.
   */
  Rpc.make("atividades.acompanhar", { payload: Schema.Struct({}), success: EventoAtividades, stream: true }),
) {}
