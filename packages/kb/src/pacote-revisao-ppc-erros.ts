/**
 * Os erros do `PacoteRevisaoPpc`, num módulo à parte porque `PacoteRevisaoPpc.ts` e
 * `db/pacote-revisao-ppc.ts` os usam e um importa o outro: aqui não há ciclo.
 */
import * as Schema from "effect/Schema";

export class PpcNaoEncontrado extends Schema.TaggedError<PpcNaoEncontrado>()("PpcNaoEncontrado", {
  ppc: Schema.String,
}) {
  override get message(): string {
    return `PPC não encontrado: ${this.ppc}`;
  }
}

export class TarefaNaoReconhecida extends Schema.TaggedError<TarefaNaoReconhecida>()("TarefaNaoReconhecida", {
  /** Fichas pedidas que não estão no banco. */
  fichas: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return `tarefa não reconhecida (ficha, tópico ou todas): ${this.fichas.join(", ")}`;
  }
}

export class CriteriosNaoEncontrados extends Schema.TaggedError<CriteriosNaoEncontrados>()("CriteriosNaoEncontrados", {
  /** O campo do filtro (`id`, `topico`, `norma`) ou `filtro`, quando não veio exatamente um. */
  campo: Schema.String,
  valor: Schema.String,
}) {
  override get message(): string {
    switch (this.campo) {
      case "id":
        return `critério não encontrado: "${this.valor}". Use o ID da ficha, como "CT-CURR-12"`;
      case "topico":
        return `tópico sem critérios: "${this.valor}". Use um tópico de topicos.json, como "estagio"`;
      case "norma":
        return `norma não encontrada na base: "${this.valor}". Use o ID canônico, como "br/cne-cp/res/2021/1"`;
      default:
        return `informe exatamente um destes: id, topico ou norma (veio: ${this.valor})`;
    }
  }
}
