/**
 * Formatador único das mensagens de validação do Effect Schema, em português. Todo erro de schema
 * que chega a uma pessoa (CLI, validação da base) ou à IA (entrada inválida das ferramentas MCP)
 * passa pelo mesmo walker e mapeamento de `SchemaIssue` em português.
 *
 * Cada problema vira `<caminho>: <mensagem>` (só `<mensagem>` na raiz), com o caminho em notação
 * de ponto e índices numéricos (`referencias.0.ref`). Uma anotação `message` no schema ou na
 * checagem prevalece sobre o texto daqui.
 */
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as SchemaIssue from "effect/SchemaIssue";

/** Problema já formatado: caminho e mensagem. */
export interface Problema {
  readonly caminho: ReadonlyArray<PropertyKey>;
  readonly mensagem: string;
}

type Estilo = "padrao" | "ferramenta";

const PREFIXO = "Entrada inválida";

function anotacao(anotacoes: unknown, chave: string): unknown {
  return typeof anotacoes === "object" && anotacoes !== null
    ? (anotacoes as Record<string, unknown>)[chave]
    : undefined;
}

const comAspas = (valor: unknown) => (typeof valor === "string" ? `"${valor}"` : String(valor));

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

/** As opções de uma união de literais (no tipo codificado), ou `undefined` se não for só de literais. */
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

function opcaoInvalida(valores: ReadonlyArray<SchemaAST.LiteralValue>): string {
  if (valores.length === 1) return `esperava ${comAspas(valores[0])}`;
  return `esperava uma destas opções: ${valores.map(comAspas).join(", ")}`;
}

/** O valor esperado por um nó do schema, em português ("um texto", "um destes valores: a, b"). */
export function esperado(ast: SchemaAST.AST): string {
  const descricao = anotacao(ast.annotations, "expected");
  if (typeof descricao === "string" && /[áéíóúãõçê]/i.test(descricao)) return descricao;
  if (SchemaAST.isString(ast) || SchemaAST.isTemplateLiteral(ast)) return "um texto";
  if (SchemaAST.isNumber(ast)) return "um número";
  if (SchemaAST.isBoolean(ast)) return "um booleano";
  if (SchemaAST.isNull(ast)) return "nulo";
  if (SchemaAST.isUndefined(ast)) return "nada (campo ausente)";
  if (SchemaAST.isLiteral(ast)) return `o valor ${JSON.stringify(ast.literal)}`;
  if (SchemaAST.isArrays(ast)) return "uma lista";
  if (SchemaAST.isObjects(ast)) return "um objeto";
  if (SchemaAST.isUnion(ast)) {
    const literaisDaUniao = ast.types.filter(SchemaAST.isLiteral);
    if (literaisDaUniao.length === ast.types.length) {
      return `um destes valores: ${literaisDaUniao.map((l) => JSON.stringify(l.literal)).join(", ")}`;
    }
    return ast.types.map(esperado).join(" ou ");
  }
  if (SchemaAST.isSuspend(ast)) return esperado(ast.thunk());
  return "outro valor";
}

/** O tipo que um nó do schema espera, no vocabulário da entrada de ferramentas. */
function nomeDoTipo(ast: SchemaAST.AST): string {
  const codificado = SchemaAST.toEncoded(ast);
  if (SchemaAST.isBoolean(codificado)) return "um valor booleano";
  if (SchemaAST.isNull(codificado)) return "null";
  const nome = esperado(codificado);
  return nome === "outro valor" ? "um valor" : nome;
}

/** "Chave inválida: "a"" ou "Chaves inválidas: "a", "b"". */
export function chavesInvalidas(chaves: ReadonlyArray<PropertyKey>): string {
  const plural = chaves.length > 1 ? "s" : "";
  return `Chave${plural} inválida${plural}: ${chaves.map((k) => comAspas(String(k))).join(", ")}`;
}

/** Chave obrigatória ausente: o que ela espera, quando o tipo é conhecido (estilo ferramenta). */
function ausenteFerramenta(ast: SchemaAST.AST | undefined): string {
  if (ast === undefined) return "campo obrigatório";
  const opcoes = literais(ast);
  if (opcoes) return `campo obrigatório; ${opcaoInvalida(opcoes)}`;
  if (SchemaAST.isUnion(SchemaAST.toEncoded(ast))) return "campo obrigatório";
  return `campo obrigatório; esperava ${nomeDoTipo(ast)}`;
}

function numero(payload: unknown, chave: string): string {
  return String(anotacao(payload, chave));
}

/** "caractere(s)" ou "item(ns)", conforme o nó checado. */
function unidade(ast: SchemaAST.AST | undefined, n: string): string {
  const um = n === "1";
  return ast !== undefined && SchemaAST.isArrays(ast) ? (um ? "item" : "itens") : um ? "caractere" : "caracteres";
}

/** Mensagem das checagens do Effect pelo identificador da representação. */
function mensagemDaChecagem(
  filtro: SchemaIssue.Filter,
  estilo: Estilo,
  checado: SchemaAST.AST | undefined,
): string | undefined {
  const propria = anotacao(filtro.filter.annotations, "message");
  if (typeof propria === "string") return propria;
  // Filtro que devolveu texto (`makeFilter((v) => "mensagem")`): a mensagem fica no problema interno.
  const interna = anotacao(anotacao(filtro.issue, "annotations"), "message");
  if (typeof interna === "string") return interna;
  // Filtro que devolveu problemas com caminho (`{ path, issue }`, ou uma lista deles): cada folha
  // leva a própria mensagem, sem um texto único por cima.
  if (estilo === "padrao" && filtro.issue._tag !== "InvalidValue") return undefined;
  const representacao = anotacao(filtro.filter.annotations, "representation");
  const id = anotacao(representacao, "id");
  const payload = anotacao(representacao, "payload");
  if (estilo === "ferramenta") {
    switch (id) {
      case "effect/schema/isMinLength":
        return `deve ter pelo menos ${numero(payload, "minLength")} ${unidade(checado, numero(payload, "minLength"))}`;
      case "effect/schema/isMaxLength":
        return `deve ter no máximo ${numero(payload, "maxLength")} ${unidade(checado, numero(payload, "maxLength"))}`;
      case "effect/schema/isGreaterThanOrEqualTo":
        return `deve ser maior ou igual a ${numero(payload, "minimum")}`;
      case "effect/schema/isLessThanOrEqualTo":
        return `deve ser menor ou igual a ${numero(payload, "maximum")}`;
      case "effect/schema/isInt":
        return "esperava um número inteiro";
      case "effect/schema/isPattern":
        return `deve seguir o padrão /${numero(payload, "source")}/${numero(payload, "flags")}`;
      default:
        return "valor inválido";
    }
  }
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

/** Tipo do campo `chave` de um objeto, para nomear o que falta. */
function tipoDoCampo(objeto: SchemaAST.AST | undefined, chave: PropertyKey): SchemaAST.AST | undefined {
  if (objeto === undefined) return undefined;
  const codificado = SchemaAST.toEncoded(objeto);
  if (!SchemaAST.isObjects(codificado)) return undefined;
  return codificado.propertySignatures.find((p) => p.name === chave)?.type;
}

function mensagemDaFolhaPadrao(problema: SchemaIssue.Leaf): string {
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

function percorrer(
  issue: SchemaIssue.Issue,
  caminho: ReadonlyArray<PropertyKey>,
  contexto: { readonly pai: SchemaAST.AST | undefined; readonly checado: SchemaAST.AST | undefined },
  estilo: Estilo,
  saida: Problema[],
): void {
  switch (issue._tag) {
    case "Pointer": {
      const [chave] = issue.path;
      const interno = issue.issue;
      if (estilo === "ferramenta" && interno._tag === "MissingKey" && issue.path.length === 1 && chave !== undefined) {
        saida.push({
          caminho: [...caminho, ...issue.path],
          mensagem: ausenteFerramenta(tipoDoCampo(contexto.pai, chave)),
        });
        return;
      }
      percorrer(interno, [...caminho, ...issue.path], { pai: undefined, checado: undefined }, estilo, saida);
      return;
    }
    case "Composite": {
      const naoPermitidas: PropertyKey[] = [];
      for (const problema of issue.issues) {
        if (estilo === "ferramenta" && problema._tag === "Pointer" && problema.issue._tag === "UnexpectedKey") {
          naoPermitidas.push(...problema.path);
          continue;
        }
        percorrer(problema, caminho, { pai: issue.ast, checado: issue.ast }, estilo, saida);
      }
      if (naoPermitidas.length > 0) saida.push({ caminho, mensagem: chavesInvalidas(naoPermitidas) });
      return;
    }
    case "Encoding":
      percorrer(issue.issue, caminho, { pai: issue.ast, checado: issue.ast }, estilo, saida);
      return;
    case "Filter": {
      const mensagem = mensagemDaChecagem(issue, estilo, contexto.checado);
      if (mensagem !== undefined) {
        saida.push({ caminho, mensagem });
        return;
      }
      percorrer(issue.issue, caminho, contexto, estilo, saida);
      return;
    }
    case "AnyOf": {
      if (estilo === "ferramenta") {
        const opcoes = literais(issue.ast);
        saida.push({ caminho, mensagem: opcoes ? opcaoInvalida(opcoes) : "valor inválido" });
        return;
      }
      if (issue.issues.length === 0) {
        saida.push({ caminho, mensagem: `${PREFIXO}: esperava ${esperado(issue.ast)}` });
        return;
      }
      for (const alternativa of issue.issues) percorrer(alternativa, caminho, contexto, estilo, saida);
      return;
    }
    case "InvalidType": {
      if (estilo === "ferramenta") {
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
      saida.push({ caminho, mensagem: mensagemDaFolhaPadrao(issue) });
      return;
    }
    case "MissingKey":
      saida.push({
        caminho,
        mensagem: estilo === "ferramenta" ? ausenteFerramenta(undefined) : mensagemDaFolhaPadrao(issue),
      });
      return;
    case "UnexpectedKey":
      if (estilo === "ferramenta") {
        saida.push({ caminho: caminho.slice(0, -1), mensagem: chavesInvalidas(caminho.slice(-1)) });
        return;
      }
      saida.push({ caminho, mensagem: mensagemDaFolhaPadrao(issue) });
      return;
    case "InvalidValue": {
      if (estilo === "ferramenta") {
        const mensagem = anotacao(issue.annotations, "message");
        saida.push({ caminho, mensagem: typeof mensagem === "string" ? mensagem : "valor inválido" });
        return;
      }
      saida.push({ caminho, mensagem: mensagemDaFolhaPadrao(issue) });
      return;
    }
    case "OneOf":
    case "Forbidden":
      saida.push({ caminho, mensagem: estilo === "ferramenta" ? "valor inválido" : mensagemDaFolhaPadrao(issue) });
      return;
  }
}

/** Problemas de um `SchemaIssue`, em ordem, com caminho e mensagem em português. */
export function problemas(issue: SchemaIssue.Issue): Problema[] {
  const saida: Problema[] = [];
  percorrer(issue, [], { pai: undefined, checado: undefined }, "padrao", saida);
  return saida;
}

/** Problemas da entrada de uma ferramenta (com o valor recebido, opções de literais e chaves extras agrupadas). */
export function problemasDeEntrada(issue: SchemaIssue.Issue): Problema[] {
  const saida: Problema[] = [];
  percorrer(issue, [], { pai: undefined, checado: undefined }, "ferramenta", saida);
  return saida;
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
