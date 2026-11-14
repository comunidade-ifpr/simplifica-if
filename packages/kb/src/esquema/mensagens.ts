/**
 * Formatador único das mensagens de validação do Effect Schema, em português. Todo erro de schema
 * que chega a uma pessoa (CLI, validação da base, entrada inválida do MCP) passa por aqui, em vez
 * de uma anotação `message` em cada schema.
 *
 * Usa `SchemaIssue.makeFormatterStandardSchemaV1` com ganchos de folha e de checagem em português:
 * no Effect 4.1.3, `makeFormatterDefault` não aceita ganchos. Uma anotação `message` no schema ou
 * na checagem prevalece sobre o texto daqui.
 *
 * Cada problema vira uma linha `<caminho>: <mensagem>` (só `<mensagem>` na raiz), com o caminho em
 * notação de ponto e índices numéricos (`referencias.0.ref`), como o zod mostrava.
 */
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as SchemaIssue from "effect/SchemaIssue";

/** Problema já formatado: caminho e mensagem. */
export interface Problema {
  readonly caminho: ReadonlyArray<PropertyKey>;
  readonly mensagem: string;
}

const PREFIXO = "Entrada inválida";

function anotacao(anotacoes: unknown, chave: string): unknown {
  return typeof anotacoes === "object" && anotacoes !== null
    ? (anotacoes as Record<string, unknown>)[chave]
    : undefined;
}

/** O valor esperado por um nó do schema, em português ("um texto", "um destes valores: a, b"). */
export function esperado(ast: SchemaAST.AST): string {
  const descricao = anotacao(ast.annotations, "expected");
  if (typeof descricao === "string" && /[áéíóúãõçê]/i.test(descricao)) return descricao;
  if (SchemaAST.isString(ast)) return "um texto";
  if (SchemaAST.isNumber(ast)) return "um número";
  if (SchemaAST.isBoolean(ast)) return "um booleano";
  if (SchemaAST.isNull(ast)) return "nulo";
  if (SchemaAST.isUndefined(ast)) return "nada (campo ausente)";
  if (SchemaAST.isLiteral(ast)) return `o valor ${JSON.stringify(ast.literal)}`;
  if (SchemaAST.isArrays(ast)) return "uma lista";
  if (SchemaAST.isObjects(ast)) return "um objeto";
  if (SchemaAST.isUnion(ast)) {
    const literais = ast.types.filter(SchemaAST.isLiteral);
    if (literais.length === ast.types.length) {
      return `um destes valores: ${literais.map((l) => JSON.stringify(l.literal)).join(", ")}`;
    }
    return ast.types.map(esperado).join(" ou ");
  }
  if (SchemaAST.isSuspend(ast)) return esperado(ast.thunk());
  return "outro valor";
}

function numero(payload: unknown, chave: string): string {
  return String(anotacao(payload, chave));
}

/** Mensagem das checagens do Effect pelo identificador da representação. */
function mensagemDaChecagem(filtro: SchemaIssue.Filter): string | undefined {
  const propria = anotacao(filtro.filter.annotations, "message");
  if (typeof propria === "string") return propria;
  // Filtro que devolveu texto (`makeFilter((v) => "mensagem")`): a mensagem fica no problema interno.
  const interna = anotacao(anotacao(filtro.issue, "annotations"), "message");
  if (typeof interna === "string") return interna;
  // Filtro que devolveu problemas com caminho (`{ path, issue }`, ou uma lista deles): cada folha
  // leva a própria mensagem, sem um texto único por cima.
  if (filtro.issue._tag !== "InvalidValue") return undefined;
  const representacao = anotacao(filtro.filter.annotations, "representation");
  const id = anotacao(representacao, "id");
  const payload = anotacao(representacao, "payload");
  switch (id) {
    case "effect/schema/isMinLength":
      return Number(anotacao(payload, "minLength")) === 1
        ? `${PREFIXO}: não pode ser vazio`
        : `${PREFIXO}: esperava tamanho mínimo ${numero(payload, "minLength")}`;
    case "effect/schema/isMaxLength":
      return `${PREFIXO}: esperava tamanho máximo ${numero(payload, "maxLength")}`;
    case "effect/schema/isPattern":
      return `${PREFIXO}: formato inválido`;
    case "effect/schema/isInt":
      return `${PREFIXO}: esperava um inteiro`;
    case "effect/schema/isFinite":
      return `${PREFIXO}: esperava um número finito`;
    case "effect/schema/isGreaterThanOrEqualTo":
      return `${PREFIXO}: esperava um valor maior ou igual a ${numero(payload, "minimum")}`;
    case "effect/schema/isLessThanOrEqualTo":
      return `${PREFIXO}: esperava um valor menor ou igual a ${numero(payload, "maximum")}`;
    case "effect/schema/isGreaterThan":
      return `${PREFIXO}: esperava um valor maior que ${numero(payload, "exclusiveMinimum")}`;
    case "effect/schema/isLessThan":
      return `${PREFIXO}: esperava um valor menor que ${numero(payload, "exclusiveMaximum")}`;
    default:
      return `${PREFIXO}: valor fora da regra`;
  }
}

function mensagemDaFolha(problema: SchemaIssue.Leaf): string {
  const propria = anotacao(problema, "annotations");
  const mensagem = anotacao(propria, "message");
  if (typeof mensagem === "string") return mensagem;
  switch (problema._tag) {
    case "InvalidType":
      return `${PREFIXO}: esperava ${esperado(problema.ast)}`;
    case "InvalidValue":
      return `${PREFIXO}: valor inválido`;
    case "MissingKey":
      return `${PREFIXO}: campo obrigatório ausente`;
    case "UnexpectedKey":
      return `${PREFIXO}: campo não permitido`;
    case "Forbidden":
      return `${PREFIXO}: operação não permitida`;
    case "OneOf":
      return `${PREFIXO}: o valor casa com mais de uma alternativa`;
  }
}

const formatador = SchemaIssue.makeFormatterStandardSchemaV1({
  leafHook: mensagemDaFolha,
  checkHook: mensagemDaChecagem,
});

/**
 * O formatador do Effect trata a união sem nenhuma alternativa casada (`AnyOf` vazio) sem passar
 * pelo gancho de folha, e a mensagem sairia em inglês ("Expected "a" | "b""). Aqui ela vira
 * `InvalidType` da união, que o gancho descreve com `esperado` ("um destes valores: ...").
 */
function uniaoComoTipo(issue: SchemaIssue.Issue): SchemaIssue.Issue {
  switch (issue._tag) {
    case "AnyOf":
      return issue.issues.length === 0
        ? new SchemaIssue.InvalidType(issue.ast)
        : new SchemaIssue.AnyOf(issue.ast, issue.issues.map(uniaoComoTipo));
    case "Pointer":
      return new SchemaIssue.Pointer(issue.path, uniaoComoTipo(issue.issue));
    case "Composite": {
      const [primeiro, ...demais] = issue.issues;
      return new SchemaIssue.Composite(issue.ast, [uniaoComoTipo(primeiro), ...demais.map(uniaoComoTipo)]);
    }
    case "Encoding":
      return new SchemaIssue.Encoding(issue.ast, uniaoComoTipo(issue.issue));
    case "Filter":
      return new SchemaIssue.Filter(issue.filter, uniaoComoTipo(issue.issue));
    default:
      return issue;
  }
}

/** Problemas de um `SchemaIssue`, em ordem, com caminho e mensagem em português. */
export function problemas(issue: SchemaIssue.Issue): Problema[] {
  return formatador(uniaoComoTipo(issue)).issues.map((p) => ({
    caminho: (p.path ?? []).map((s) => (typeof s === "object" && s !== null && "key" in s ? s.key : s)),
    mensagem: p.message,
  }));
}

/** Caminho em notação de ponto (`referencias.0.ref`); vazio na raiz. */
export function caminhoTexto(caminho: ReadonlyArray<PropertyKey>): string {
  return caminho.map(String).join(".");
}

/** Uma linha por problema: `<caminho>: <mensagem>`, ou só a mensagem na raiz. */
export function formatarProblema(issue: SchemaIssue.Issue): string {
  return problemas(issue)
    .map((p) => (p.caminho.length ? `${caminhoTexto(p.caminho)}: ${p.mensagem}` : p.mensagem))
    .join("\n");
}

/** O texto de um `SchemaError` (de `decodeUnknown*`), pelo formatador acima. */
export function formatarErro(erro: Schema.SchemaError): string {
  return formatarProblema(erro.issue);
}
