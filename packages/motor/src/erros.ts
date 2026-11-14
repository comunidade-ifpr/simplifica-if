/**
 * Os erros do motor e a `Decisao` de uma aprovação, só em Effect Schema: o que os contratos do app
 * (`@simplifica-if/contratos-app`) e a interface usam, sem a implementação do `Motor` nem os drivers.
 * `Driver.ts` e o ponto de entrada do pacote os reexportam.
 */
import * as Schema from "effect/Schema";

export const Decisao = Schema.Literals(["permitir", "negar"]);
export type Decisao = typeof Decisao.Type;

export class FalhaProvider extends Schema.TaggedError<FalhaProvider>()("FalhaProvider", {
  provider: Schema.String,
  operacao: Schema.String,
  detalhe: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `${this.provider}: falha em ${this.operacao}: ${this.detalhe}`;
  }
}

export class AprovacaoDesconhecida extends Schema.TaggedError<AprovacaoDesconhecida>()("AprovacaoDesconhecida", {
  id: Schema.String,
}) {
  override get message(): string {
    return `não há pedido de aprovação pendente com o id ${this.id}`;
  }
}

export class TurnoEmAndamento extends Schema.TaggedError<TurnoEmAndamento>()("TurnoEmAndamento", {}) {
  override get message(): string {
    return "a sessão já tem um turno em andamento";
  }
}

export class OperacaoNaoSuportada extends Schema.TaggedError<OperacaoNaoSuportada>()("OperacaoNaoSuportada", {
  provider: Schema.String,
  operacao: Schema.String,
}) {
  override get message(): string {
    return `${this.provider} não oferece ${this.operacao} pelo app`;
  }
}

export class SessaoDesconhecida extends Schema.TaggedError<SessaoDesconhecida>()("SessaoDesconhecida", {
  id: Schema.String,
}) {
  override get message(): string {
    return `sessão desconhecida ou já encerrada: ${this.id}`;
  }
}
