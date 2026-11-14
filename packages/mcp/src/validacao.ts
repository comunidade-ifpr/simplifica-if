/**
 * Validação da entrada das ferramentas e a mensagem de entrada inválida que a IA lê.
 *
 * A mensagem mantém o formato do servidor anterior (SDK 2.x com zod 4 e o idioma `pt-BR` do zod):
 *
 *   Input validation error: Invalid arguments for tool etapa: id: Pequeno demais: esperava que o texto tivesse >= 1 caracteres
 *
 * O prefixo em inglês é o do SDK, que os clientes e as avaliações do M0.5 já conhecem; cada problema
 * é `<caminho>: <mensagem>` (só `<mensagem>` na raiz), separados por vírgula. As mensagens reproduzem
 * as do zod em português, porque são o que a IA lê para corrigir a chamada, e o gabarito do C0 as
 * confere byte a byte. O formatador do kb (`esquema/mensagens.ts`) tem outro texto ("Entrada inválida:
 * não pode ser vazio"), pensado para pessoas na CLI; daí este formatador próprio do transporte.
 *
 * A ordem também é a do zod: os campos na ordem do schema e, por último, as chaves não permitidas de
 * cada objeto, numa só mensagem ("Chaves inválidas: "a", "b"").
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

/* ================================================================== nomes, como no zod pt-BR */

/** "um texto", "um vetor"… (o artigo indefinido e o nome do tipo, como o `pt-BR` do zod). */
function nomeDoValor(valor: unknown): string {
  if (valor === undefined) return 'um valor "undefined"';
  if (valor === null) return 'um valor "nulo"';
  if (typeof valor === "string") return "um texto";
  if (typeof valor === "number") return Number.isNaN(valor) ? 'um valor "NaN"' : "um número";
  if (typeof valor === "boolean") return "um valor booleano";
  if (typeof valor === "bigint") return "um número bigint";
  if (Array.isArray(valor)) return "um vetor";
  if (typeof valor === "object") return "um objeto";
  return `um valor "${typeof valor}"`;
}

/** O tipo que um nó do schema espera, como o zod o nomeia ("um texto", "um vetor"). */
function nomeDoTipo(ast: SchemaAST.AST): string {
  const codificado = SchemaAST.toEncoded(ast);
  if (SchemaAST.isString(codificado) || SchemaAST.isTemplateLiteral(codificado)) return "um texto";
  if (SchemaAST.isNumber(codificado)) return "um número";
  if (SchemaAST.isBoolean(codificado)) return "um valor booleano";
  if (SchemaAST.isArrays(codificado)) return "um vetor";
  if (SchemaAST.isObjects(codificado)) return codificado.propertySignatures.length > 0 ? "um objeto" : "um registro";
  if (SchemaAST.isNull(codificado)) return 'um valor "nulo"';
  return "um valor";
}

/** As opções de uma união de literais (`z.enum`), ou `undefined` se a união não for só de literais. */
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
  if (valores.length === 1) return `Entrada inválida: esperava ${comAspas(valores[0])}`;
  return `Opção inválida: esperava uma das seguintes opções: ${valores.map(comAspas).join("|")}`;
}

/** Valor esperado e ausente (chave faltando): o `invalid_type` do zod com `undefined`. */
function ausente(ast: SchemaAST.AST | undefined): string {
  if (ast === undefined) return 'Entrada inválida: esperava um valor, recebeu um valor "undefined"';
  const opcoes = literais(ast);
  if (opcoes) return opcaoInvalida(opcoes);
  if (SchemaAST.isUnion(SchemaAST.toEncoded(ast))) return "Entrada inválida";
  return `Entrada inválida: esperava ${nomeDoTipo(ast)}, recebeu um valor "undefined"`;
}

/* ================================================================== checagens */

function anotacao(origem: unknown, chave: string): unknown {
  return typeof origem === "object" && origem !== null ? (origem as Record<string, unknown>)[chave] : undefined;
}

/** "o texto … caracteres" ou "o vetor … elementos", conforme o nó checado. */
function tamanho(ast: SchemaAST.AST | undefined): { readonly nome: string; readonly unidade: string } {
  return ast !== undefined && SchemaAST.isArrays(ast)
    ? { nome: "o vetor", unidade: "elementos" }
    : { nome: "o texto", unidade: "caracteres" };
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
    case "effect/schema/isMinLength": {
      const t = tamanho(checado);
      return `Pequeno demais: esperava que ${t.nome} tivesse >= ${valor("minLength")} ${t.unidade}`;
    }
    case "effect/schema/isMaxLength": {
      const t = tamanho(checado);
      return `Grande demais: esperava que ${t.nome} tivesse <= ${valor("maxLength")} ${t.unidade}`;
    }
    case "effect/schema/isGreaterThanOrEqualTo":
      return `Pequeno demais: esperava que o número fosse >= ${valor("minimum")}`;
    case "effect/schema/isLessThanOrEqualTo":
      return `Grande demais: esperava que o número fosse <= ${valor("maximum")}`;
    case "effect/schema/isInt":
      return "Entrada inválida: esperava um número inteiro, recebeu um número";
    case "effect/schema/isPattern":
      return `Texto inválido: deve corresponder ao padrão /${valor("source")}/${valor("flags")}`;
    default:
      return "Entrada inválida";
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
      if (naoPermitidas.length > 0) {
        const plural = naoPermitidas.length > 1 ? "s" : "";
        saida.push({
          caminho,
          mensagem: `Chave${plural} inválida${plural}: ${naoPermitidas.map((k) => comAspas(String(k))).join(", ")}`,
        });
      }
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
        saida.push({ caminho, mensagem: "Entrada inválida" });
        return;
      }
      saida.push({
        caminho,
        mensagem: `Entrada inválida: esperava ${nomeDoTipo(issue.ast)}, recebeu ${nomeDoValor(issue.input)}`,
      });
      return;
    }
    case "AnyOf": {
      const opcoes = literais(issue.ast);
      saida.push({ caminho, mensagem: opcoes ? opcaoInvalida(opcoes) : "Entrada inválida" });
      return;
    }
    case "MissingKey":
      saida.push({ caminho, mensagem: ausente(undefined) });
      return;
    case "UnexpectedKey": {
      const chave = caminho.at(-1);
      saida.push({ caminho: caminho.slice(0, -1), mensagem: `Chave inválida: ${comAspas(String(chave))}` });
      return;
    }
    case "InvalidValue": {
      const mensagem = anotacao(issue.annotations, "message");
      saida.push({ caminho, mensagem: typeof mensagem === "string" ? mensagem : "Entrada inválida" });
      return;
    }
    case "OneOf":
    case "Forbidden":
      saida.push({ caminho, mensagem: "Entrada inválida" });
      return;
  }
}

/** Os problemas de um `SchemaIssue` da entrada, na ordem do zod, com as mensagens em português. */
export function problemasDeEntrada(issue: SchemaIssue.Issue): ProblemaDeEntrada[] {
  const saida: ProblemaDeEntrada[] = [];
  percorrer(issue, [], { pai: undefined, checado: undefined }, saida);
  return saida;
}

/** `<caminho>: <mensagem>` (só `<mensagem>` na raiz), como o SDK formatava cada problema. */
export function linhaDoProblema(problema: ProblemaDeEntrada): string {
  if (problema.caminho.length === 0) return problema.mensagem;
  return `${problema.caminho.map(String).join(".")}: ${problema.mensagem}`;
}

/** A mensagem de entrada inválida de uma ferramenta, no formato do servidor anterior. */
export function mensagemDeEntradaInvalida(ferramenta: string, issue: SchemaIssue.Issue): string {
  const problemas = problemasDeEntrada(issue).map(linhaDoProblema).join(", ");
  return `Input validation error: Invalid arguments for tool ${ferramenta}: ${problemas}`;
}

/**
 * Decodificador da entrada de uma ferramenta: os argumentos da chamada (ausentes viram `{}`, como no
 * SDK) contra o schema, com objetos fechados; entrada inválida é `EntradaInvalida` com a mensagem acima.
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
      const chaves = Object.keys(valor);
      const plural = chaves.length > 1 ? "s" : "";
      const mensagem = `Chave${plural} inválida${plural}: ${chaves.map((k) => comAspas(k)).join(", ")}`;
      return Effect.fail(
        new EntradaInvalida({
          mensagem: `Input validation error: Invalid arguments for tool ${ferramenta}: ${mensagem}`,
        }),
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
