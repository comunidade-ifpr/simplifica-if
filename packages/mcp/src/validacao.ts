/**
 * Validação da entrada das ferramentas e a mensagem de entrada inválida que a IA lê para corrigir a
 * chamada:
 *
 *   Entrada inválida para a ferramenta etapa: id: deve ter pelo menos 1 caractere
 *
 * Cada problema é `<caminho>: <mensagem>` (só `<mensagem>` na raiz), separados por vírgula: os campos
 * na ordem do schema e, por último, as chaves não permitidas de cada objeto, numa só mensagem
 * ("Chaves inválidas: "a", "b""). O formatador do kb (`esquema/mensagens.ts`) fala com pessoas na CLI;
 * este fala com a IA, pelo transporte MCP.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as SchemaIssue from "effect/SchemaIssue";
import { EntradaInvalida } from "./contratos.ts";

/** Problema já formatado: caminho e mensagem. */
export interface ProblemaDeEntrada {
  readonly caminho: ReadonlyArray<PropertyKey>;
  readonly mensagem: string;
}

/** Opções de decodificação da entrada: objetos fechados, todos os problemas, com o valor recebido. */
export const OPCOES_ENTRADA: SchemaAST.ParseOptions = {
  onExcessProperty: "error",
  errors: "all",
  reportInput: true,
};

/* ================================================================== nomes */

/** O que veio: "um texto", "uma lista"… */
function nomeDoValor(valor: unknown): string {
  if (valor === undefined) return "nada";
  if (valor === null) return "null";
  if (typeof valor === "string") return "um texto";
  if (typeof valor === "number") return "um número";
  if (typeof valor === "boolean") return "um valor booleano";
  if (Array.isArray(valor)) return "uma lista";
  if (typeof valor === "object") return "um objeto";
  return `um valor do tipo ${typeof valor}`;
}

/** O tipo que um nó do schema espera ("um texto", "uma lista"). */
function nomeDoTipo(ast: SchemaAST.AST): string {
  const codificado = SchemaAST.toEncoded(ast);
  if (SchemaAST.isString(codificado) || SchemaAST.isTemplateLiteral(codificado)) return "um texto";
  if (SchemaAST.isNumber(codificado)) return "um número";
  if (SchemaAST.isBoolean(codificado)) return "um valor booleano";
  if (SchemaAST.isArrays(codificado)) return "uma lista";
  if (SchemaAST.isObjects(codificado)) return "um objeto";
  if (SchemaAST.isNull(codificado)) return "null";
  return "um valor";
}

/** As opções de uma união de literais, ou `undefined` se a união não for só de literais. */
function literais(ast: SchemaAST.AST): ReadonlyArray<SchemaAST.LiteralValue> | undefined {
  const codificado = SchemaAST.toEncoded(ast);
  if (SchemaAST.isLiteral(codificado)) return [codificado.literal];
  if (!SchemaAST.isUnion(codificado)) return undefined;
  const valores: SchemaAST.LiteralValue[] = [];
  for (const tipo of codificado.types) {
    if (!SchemaAST.isLiteral(tipo)) return undefined;
    valores.push(tipo.literal);
  }
  return valores;
}

const comAspas = (valor: unknown) => (typeof valor === "string" ? `"${valor}"` : String(valor));

function opcaoInvalida(valores: ReadonlyArray<SchemaAST.LiteralValue>): string {
  if (valores.length === 1) return `esperava ${comAspas(valores[0])}`;
  return `esperava uma destas opções: ${valores.map(comAspas).join(", ")}`;
}

/** Chave obrigatória ausente: o que ela espera, quando o tipo é conhecido. */
function ausente(ast: SchemaAST.AST | undefined): string {
  if (ast === undefined) return "campo obrigatório";
  const opcoes = literais(ast);
  if (opcoes) return `campo obrigatório; ${opcaoInvalida(opcoes)}`;
  if (SchemaAST.isUnion(SchemaAST.toEncoded(ast))) return "campo obrigatório";
  return `campo obrigatório; esperava ${nomeDoTipo(ast)}`;
}

/** "Chave inválida: "a"" ou "Chaves inválidas: "a", "b"". */
function chavesInvalidas(chaves: ReadonlyArray<PropertyKey>): string {
  const plural = chaves.length > 1 ? "s" : "";
  return `Chave${plural} inválida${plural}: ${chaves.map((k) => comAspas(String(k))).join(", ")}`;
}

/* ================================================================== checagens */

function anotacao(origem: unknown, chave: string): unknown {
  return typeof origem === "object" && origem !== null ? (origem as Record<string, unknown>)[chave] : undefined;
}

/** "caractere(s)" ou "item(ns)", conforme o nó checado. */
function unidade(ast: SchemaAST.AST | undefined, n: string): string {
  const um = n === "1";
  return ast !== undefined && SchemaAST.isArrays(ast) ? (um ? "item" : "itens") : um ? "caractere" : "caracteres";
}

function mensagemDaChecagem(filtro: SchemaIssue.Filter, checado: SchemaAST.AST | undefined): string {
  const propria = anotacao(filtro.filter.annotations, "message");
  if (typeof propria === "string") return propria;
  // filtro que devolveu texto (`makeFilter((v) => "mensagem")`): a mensagem fica no problema interno
  const interna = anotacao(anotacao(filtro.issue, "annotations"), "message");
  if (typeof interna === "string") return interna;
  const representacao = anotacao(filtro.filter.annotations, "representation");
  const payload = anotacao(representacao, "payload");
  const valor = (chave: string) => String(anotacao(payload, chave));
  switch (anotacao(representacao, "id")) {
    case "effect/schema/isMinLength":
      return `deve ter pelo menos ${valor("minLength")} ${unidade(checado, valor("minLength"))}`;
    case "effect/schema/isMaxLength":
      return `deve ter no máximo ${valor("maxLength")} ${unidade(checado, valor("maxLength"))}`;
    case "effect/schema/isGreaterThanOrEqualTo":
      return `deve ser maior ou igual a ${valor("minimum")}`;
    case "effect/schema/isLessThanOrEqualTo":
      return `deve ser menor ou igual a ${valor("maximum")}`;
    case "effect/schema/isInt":
      return "esperava um número inteiro";
    case "effect/schema/isPattern":
      return `deve seguir o padrão /${valor("source")}/${valor("flags")}`;
    default:
      return "valor inválido";
  }
}

/* ================================================================== percurso */

/** Tipo do campo `chave` de um objeto, para nomear o que falta. */
function tipoDoCampo(objeto: SchemaAST.AST | undefined, chave: PropertyKey): SchemaAST.AST | undefined {
  if (objeto === undefined) return undefined;
  const codificado = SchemaAST.toEncoded(objeto);
  if (!SchemaAST.isObjects(codificado)) return undefined;
  return codificado.propertySignatures.find((p) => p.name === chave)?.type;
}

function percorrer(
  issue: SchemaIssue.Issue,
  caminho: ReadonlyArray<PropertyKey>,
  contexto: { readonly pai: SchemaAST.AST | undefined; readonly checado: SchemaAST.AST | undefined },
  saida: ProblemaDeEntrada[],
): void {
  switch (issue._tag) {
    case "Pointer": {
      const [chave] = issue.path;
      const interno = issue.issue;
      if (interno._tag === "MissingKey" && issue.path.length === 1 && chave !== undefined) {
        saida.push({ caminho: [...caminho, ...issue.path], mensagem: ausente(tipoDoCampo(contexto.pai, chave)) });
        return;
      }
      percorrer(interno, [...caminho, ...issue.path], { pai: undefined, checado: undefined }, saida);
      return;
    }
    case "Composite": {
      const naoPermitidas: PropertyKey[] = [];
      for (const problema of issue.issues) {
        if (problema._tag === "Pointer" && problema.issue._tag === "UnexpectedKey") {
          naoPermitidas.push(...problema.path);
          continue;
        }
        percorrer(problema, caminho, { pai: issue.ast, checado: issue.ast }, saida);
      }
      if (naoPermitidas.length > 0) saida.push({ caminho, mensagem: chavesInvalidas(naoPermitidas) });
      return;
    }
    case "Encoding":
      percorrer(issue.issue, caminho, { pai: issue.ast, checado: issue.ast }, saida);
      return;
    case "Filter":
      saida.push({ caminho, mensagem: mensagemDaChecagem(issue, contexto.checado) });
      return;
    case "InvalidType": {
      const opcoes = literais(issue.ast);
      if (opcoes) {
        saida.push({ caminho, mensagem: opcaoInvalida(opcoes) });
        return;
      }
      if (SchemaAST.isUnion(SchemaAST.toEncoded(issue.ast))) {
        saida.push({ caminho, mensagem: "valor inválido" });
        return;
      }
      saida.push({ caminho, mensagem: `esperava ${nomeDoTipo(issue.ast)}, veio ${nomeDoValor(issue.input)}` });
      return;
    }
    case "AnyOf": {
      const opcoes = literais(issue.ast);
      saida.push({ caminho, mensagem: opcoes ? opcaoInvalida(opcoes) : "valor inválido" });
      return;
    }
    case "MissingKey":
      saida.push({ caminho, mensagem: ausente(undefined) });
      return;
    case "UnexpectedKey":
      saida.push({ caminho: caminho.slice(0, -1), mensagem: chavesInvalidas(caminho.slice(-1)) });
      return;
    case "InvalidValue": {
      const mensagem = anotacao(issue.annotations, "message");
      saida.push({ caminho, mensagem: typeof mensagem === "string" ? mensagem : "valor inválido" });
      return;
    }
    case "OneOf":
    case "Forbidden":
      saida.push({ caminho, mensagem: "valor inválido" });
      return;
  }
}

/** Os problemas de um `SchemaIssue` da entrada, na ordem do schema, com as mensagens em português. */
export function problemasDeEntrada(issue: SchemaIssue.Issue): ProblemaDeEntrada[] {
  const saida: ProblemaDeEntrada[] = [];
  percorrer(issue, [], { pai: undefined, checado: undefined }, saida);
  return saida;
}

/** `<caminho>: <mensagem>` (só `<mensagem>` na raiz). */
export function linhaDoProblema(problema: ProblemaDeEntrada): string {
  if (problema.caminho.length === 0) return problema.mensagem;
  return `${problema.caminho.map(String).join(".")}: ${problema.mensagem}`;
}

/** A mensagem de entrada inválida de uma ferramenta: o nome dela e os problemas. */
export function mensagemDeEntradaInvalida(ferramenta: string, issue: SchemaIssue.Issue): string {
  return comPrefixo(ferramenta, problemasDeEntrada(issue).map(linhaDoProblema).join(", "));
}

const comPrefixo = (ferramenta: string, problemas: string) =>
  `Entrada inválida para a ferramenta ${ferramenta}: ${problemas}`;

/**
 * Decodificador da entrada de uma ferramenta: os argumentos da chamada (ausentes, porque o protocolo
 * os deixa opcionais, viram `{}`) contra o schema, com objetos fechados; entrada inválida é
 * `EntradaInvalida` com a mensagem acima.
 */
export function decodificadorDeEntrada<S extends Schema.Decoder<unknown>>(ferramenta: string, schema: S) {
  const decodificar = Schema.decodeUnknownEffect(schema);
  // `Schema.Struct({})` aceita qualquer objeto, sem acusar chave a mais: a entrada sem campos confere aqui
  const semCampos =
    SchemaAST.isObjects(schema.ast) &&
    schema.ast.propertySignatures.length === 0 &&
    schema.ast.indexSignatures.length === 0;
  return (args: unknown): Effect.Effect<S["Type"], EntradaInvalida, S["DecodingServices"]> => {
    const valor = args ?? {};
    if (semCampos && typeof valor === "object" && !Array.isArray(valor) && Object.keys(valor).length > 0) {
      return Effect.fail(
        new EntradaInvalida({ mensagem: comPrefixo(ferramenta, chavesInvalidas(Object.keys(valor))) }),
      );
    }
    return decodificar(valor, OPCOES_ENTRADA).pipe(
      Effect.catchTags({
        SchemaError: (erro) =>
          Effect.fail(new EntradaInvalida({ mensagem: mensagemDeEntradaInvalida(ferramenta, erro.issue) })),
      }),
    );
  };
}
