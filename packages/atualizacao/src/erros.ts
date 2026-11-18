/**
 * As falhas da atualização. A mensagem vem só dos atributos: a URL do feed nunca entra nela (só o host),
 * e o erro de baixo, com a URL inteira, fica em `cause`.
 */
import * as Schema from "effect/Schema";

/** O host de uma URL, para a mensagem; `?` se ela não se lê. */
export function hostDe(url: string): string {
  try {
    return new URL(url).host || "?";
  } catch {
    return "?";
  }
}

/**
 * O download falhou: sem conexão, o servidor respondeu outro status, o arquivo passou do limite, a
 * conexão caiu no meio do corpo ou o prazo acabou.
 */
export class FalhaDownload extends Schema.TaggedError<FalhaDownload>()("FalhaDownload", {
  host: Schema.String,
  categoria: Schema.Literals(["sem-conexao", "status", "grande-demais", "caiu-no-meio", "prazo"]),
  status: Schema.optional(Schema.Number),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.categoria) {
      case "sem-conexao":
        return `sem conexão com o servidor de atualização (${this.host})`;
      case "status":
        return `o servidor de atualização (${this.host}) respondeu ${this.status ?? "?"}`;
      case "grande-demais":
        return `arquivo maior que o esperado (${this.host})`;
      case "caiu-no-meio":
        return `o download caiu no meio (${this.host})`;
      case "prazo":
        return `o servidor de atualização (${this.host}) não respondeu no prazo`;
    }
  }
}

/** O manifesto baixado não vale: assinatura, formato ou canal. */
export class ManifestoRecusado extends Schema.TaggedError<ManifestoRecusado>()("ManifestoRecusado", {
  motivo: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `manifesto recusado: ${this.motivo}`;
  }
}

/** Um pacote baixado (a base, o patch, uma skill) ou o banco que sai dele não confere com o manifesto. */
export class PacoteInvalido extends Schema.TaggedError<PacoteInvalido>()("PacoteInvalido", {
  pacote: Schema.String,
  motivo: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `${this.pacote}: ${this.motivo}`;
  }
}

/** Outro processo vivo tem a trava da pasta de atualização. */
export class OutroProcessoAtualizando extends Schema.TaggedError<OutroProcessoAtualizando>()(
  "OutroProcessoAtualizando",
  {},
) {
  override get message(): string {
    return "outro processo está atualizando esta pasta; tente mais tarde";
  }
}

/** Ler, gravar ou trocar um arquivo da pasta de atualização falhou. */
export class FalhaPastaAtualizacao extends Schema.TaggedError<FalhaPastaAtualizacao>()("FalhaPastaAtualizacao", {
  operacao: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `não foi possível ${this.operacao} na pasta de atualização`;
  }
}

export type ErroAtualizacao =
  | FalhaDownload
  | ManifestoRecusado
  | PacoteInvalido
  | OutroProcessoAtualizando
  | FalhaPastaAtualizacao;
