/**
 * Os erros do motor e a `Decisao` de uma aprovação, só em Effect Schema: o que os contratos do app
 * (`@simplifica-if/contratos-app`) e a interface usam, sem a implementação do `Motor` nem os drivers.
 * `Driver.ts` e o ponto de entrada do pacote os reexportam.
 */
import * as Schema from "effect/Schema";
import { TipoFalha } from "./falhas.ts";

export const Decisao = Schema.Literals(["permitir", "negar"]);
export type Decisao = typeof Decisao.Type;

/**
 * Uma falha do provider. O `tipo` sai do classificador do motor (`falhas.ts`) no ponto em que o
 * driver produz a falha; o texto cru dela fica só em `cause`.
 */
export class FalhaProvider extends Schema.TaggedError<FalhaProvider>()("FalhaProvider", {
  provider: Schema.String,
  operacao: Schema.String,
  tipo: TipoFalha,
  /**
   * O texto técnico para "Detalhes técnicos", curto e saneado (`textoTecnico`). Só o transporte o
   * preenche, a partir do `cause`, ao tirar o `cause` do erro que vai à interface; o motor nunca.
   */
  tecnico: Schema.optionalKey(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    const tipo = this.tipo === "desconhecido" ? "" : ` (${this.tipo})`;
    return `${this.provider}: falha em ${this.operacao}${tipo}`;
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
