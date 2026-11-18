/**
 * Os erros do `PacoteContexto`, num módulo à parte porque `PacoteContexto.ts` e
 * `db/pacote-contexto.ts` os usam e um importa o outro: aqui não há ciclo.
 */
import * as Schema from "effect/Schema";

export class PpcNaoEncontrado extends Schema.TaggedError<PpcNaoEncontrado>()("PpcNaoEncontrado", {
  ppc: Schema.String,
}) {
  override get message(): string {
    return `PPC não encontrado: ${this.ppc}`;
  }
}

export class GrupoInexistente extends Schema.TaggedError<GrupoInexistente>()("GrupoInexistente", {
  grupo: Schema.String,
  /** Quantos grupos a rodada tem. */
  total: Schema.Number,
}) {
  override get message(): string {
    return `grupo inexistente: ${this.grupo} (há ${this.total})`;
  }
}

export class TarefaNaoReconhecida extends Schema.TaggedError<TarefaNaoReconhecida>()("TarefaNaoReconhecida", {
  /** Fichas pedidas que não estão no banco. */
  fichas: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return `tarefa não reconhecida (ficha, tópico, grupo-NNN ou todas): ${this.fichas.join(", ")}`;
  }
}
