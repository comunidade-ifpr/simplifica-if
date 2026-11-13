/**
 * Validação contra os JSON Schemas da base (base-conhecimento/schemas/ e
 * base-analise/schemas/ da analise-ppc), com o ajv (draft 2020-12).
 * `validarJsonSchema` mantém o texto e a ordem do validador próprio que a base
 * usava antes do ajv; outros formatos de mensagem partem de `compilarJsonSchema`.
 */
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { ehObjeto, type ObjetoJson, representar, textoDe } from "./json.ts";
import { ESPACOS, RE_TEM_ESPACO } from "./texto.ts";

const RE_DATA = /^\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2}$/u;

/** Nome do tipo JSON Schema de um valor (inteiros separados de `number`). */
function nomeTipo(valor: unknown): string {
  if (valor === null || valor === undefined) return "null";
  if (typeof valor === "boolean") return "boolean";
  if (typeof valor === "number") return Number.isInteger(valor) ? "integer" : "number";
  if (typeof valor === "string") return "string";
  if (Array.isArray(valor)) return "array";
  if (ehObjeto(valor)) return "object";
  return typeof valor;
}

/** `pattern` com a semântica dos schemas da base; o ajv exige `code`, usado só em código standalone. */
const motorRegex = Object.assign((padrao: string) => regexDoSchema(padrao), { code: "regexDoSchema" });

/**
 * `allErrors` relata todos os erros, não só o primeiro. Em `format`, `date`
 * exige só o formato `YYYY-MM-DD`, `uri` exige URL absoluta com autoridade
 * (`ehUrlAbsoluta`) e `date-time` fica como anotação, sem verificação.
 */
const ajv = new Ajv2020({
  allErrors: true,
  verbose: true,
  strict: true,
  addUsedSchema: false,
  logger: false,
  code: { regExp: motorRegex },
  formats: {
    date: (texto: string) => RE_DATA.test(texto),
    uri: (texto: string) => ehUrlAbsoluta(texto),
    "date-time": true,
  },
});

/** Validadores compilados por conteúdo do schema: cada base (e cada teste) traz os seus. */
const compilados = new Map<string, ValidateFunction>();

/** Validador ajv compilado (e guardado em cache) para `schema`; os erros ficam em `.errors`. */
export function compilarJsonSchema(schema: ObjetoJson): ValidateFunction {
  const chave = JSON.stringify(schema);
  let validar = compilados.get(chave);
  if (!validar) {
    validar = ajv.compile(schema);
    compilados.set(chave, validar);
  }
  return validar;
}

/** Ordem das palavras-chave num mesmo nó, que é a ordem das mensagens na saída. */
const ORDEM_NO_NO: Record<string, number> = {
  type: 0,
  const: 1,
  enum: 2,
  minLength: 3,
  pattern: 4,
  format: 5,
  minimum: 6,
  minItems: 7,
  maxItems: 8,
  minProperties: 9,
  required: 10,
};

type Segmento = string | number;

/** Segmentos de um `instancePath` (JSON Pointer); posições de listas viram números. */
function segmentosDe(dados: unknown, ponteiro: string): Segmento[] {
  const segmentos: Segmento[] = [];
  let atual = dados;
  for (const bruto of ponteiro ? ponteiro.slice(1).split("/") : []) {
    const chave = bruto.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(atual)) {
      segmentos.push(Number(chave));
      atual = atual[Number(chave)];
    } else {
      segmentos.push(chave);
      atual = ehObjeto(atual) ? atual[chave] : undefined;
    }
  }
  return segmentos;
}

/**
 * Posição de uma mensagem no percurso do documento: cada nó vem antes dos
 * filhos, e os filhos seguem a ordem do documento (posição na lista ou ordem
 * das chaves no objeto), não a ordem das propriedades no schema.
 */
function posicaoNoPercurso(dados: unknown, segmentos: Segmento[], noNo: number[]): number[] {
  const posicao: number[] = [];
  let atual = dados;
  for (const segmento of segmentos) {
    if (typeof segmento === "number") {
      posicao.push(1, segmento);
      atual = Array.isArray(atual) ? atual[segmento] : undefined;
    } else {
      posicao.push(1, ehObjeto(atual) ? Object.keys(atual).indexOf(segmento) : 0);
      atual = ehObjeto(atual) ? atual[segmento] : undefined;
    }
  }
  return [...posicao, 0, ...noNo];
}

function compararPosicoes(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

/** Texto de um erro do ajv; `caminho` é o nó em notação `$.a[0].b`. */
function mensagemDe(erro: ErrorObject, caminho: string): string {
  const schema = erro.parentSchema as ObjetoJson;
  switch (erro.keyword) {
    case "type":
      return `${caminho} deve ser ${textoDe(schema.type)}, recebido ${nomeTipo(erro.data)}`;
    case "const":
      return `${caminho} deve ser ${representar(schema.const)}`;
    case "enum":
      return `${caminho} deve ser um de ${representar(schema.enum)}`;
    case "minLength":
      return `${caminho} deve ter ao menos ${textoDe(schema.minLength)} caractere(s)`;
    case "pattern":
      return `${caminho} não corresponde ao padrão ${textoDe(schema.pattern)}`;
    case "format":
      if (schema.format === "date") return `${caminho} deve estar em YYYY-MM-DD`;
      return `${caminho} deve ser URI absoluta válida`;
    case "minimum":
      return `${caminho} deve ser maior ou igual a ${textoDe(schema.minimum)}`;
    case "minItems":
      return `${caminho} deve ter ao menos ${textoDe(schema.minItems)} item(ns)`;
    case "maxItems":
      return `${caminho} deve ter no máximo ${textoDe(schema.maxItems)} item(ns)`;
    case "minProperties":
      return `${caminho} deve ter ao menos ${textoDe(schema.minProperties)} propriedade(s)`;
    case "required":
      return `${caminho}.${String(erro.params.missingProperty)} é obrigatório`;
    case "additionalProperties":
      return `${caminho}.${String(erro.params.additionalProperty)} não é permitido`;
    default:
      throw new Error(`palavra-chave de JSON Schema sem mensagem definida: ${erro.keyword}`);
  }
}

/**
 * Valida `dados` contra `schema` e devolve as mensagens na ordem do percurso
 * do documento. Num nó, `type` vem antes das demais palavras-chave, e um
 * `type` inválido é a única mensagem do nó.
 */
export function validarJsonSchema(dados: unknown, schema: ObjetoJson, rotulo: string): string[] {
  const validar = compilarJsonSchema(schema);
  if (validar(dados)) return [];
  const erros = validar.errors ?? [];
  const nosComTipoInvalido = new Set(erros.filter((erro) => erro.keyword === "type").map((erro) => erro.instancePath));

  const mensagens: Array<{ posicao: number[]; texto: string }> = [];
  for (const erro of erros) {
    if (erro.keyword !== "type" && nosComTipoInvalido.has(erro.instancePath)) continue;
    const segmentos = segmentosDe(dados, erro.instancePath);
    const caminho = `$${segmentos.map((s) => (typeof s === "number" ? `[${s}]` : `.${s}`)).join("")}`;
    let posicao: number[];
    if (erro.keyword === "additionalProperties") {
      // A chave não permitida ocupa, na ordem, o lugar do filho que ela seria.
      posicao = posicaoNoPercurso(dados, [...segmentos, String(erro.params.additionalProperty)], []);
    } else if (erro.keyword === "required") {
      const obrigatorios = (erro.parentSchema as ObjetoJson).required as string[];
      const indice = obrigatorios.indexOf(String(erro.params.missingProperty));
      posicao = posicaoNoPercurso(dados, segmentos, [ORDEM_NO_NO.required!, indice]);
    } else {
      posicao = posicaoNoPercurso(dados, segmentos, [ORDEM_NO_NO[erro.keyword] ?? 0]);
    }
    mensagens.push({ posicao, texto: `${rotulo}: ${mensagemDe(erro, caminho)}` });
  }
  return mensagens.sort((a, b) => compararPosicoes(a.posicao, b.posicao)).map((mensagem) => mensagem.texto);
}

/**
 * Converte um `pattern` dos schemas da base para `RegExp` (flag `u`). Os
 * schemas foram escritos com a semântica de regex em que `\d` e `\w` aceitam
 * dígitos e letras Unicode, `\s` usa o conjunto `ESPACOS`, `.` não casa `\n` e
 * `$` aceita um `\n` final. Escapes de pontuação que a flag `u` rejeita (como
 * `\-` ou `\#`) viram o code point correspondente.
 */
export function regexDoSchema(padrao: string): RegExp {
  const traducaoEmClasse: Record<string, string> = { d: "\\p{Nd}", s: ESPACOS, w: "\\p{L}\\p{N}_" };
  const traducao: Record<string, string> = {
    d: "\\p{Nd}",
    D: "\\P{Nd}",
    s: `[${ESPACOS}]`,
    S: `[^${ESPACOS}]`,
    w: "[\\p{L}\\p{N}_]",
    W: "[^\\p{L}\\p{N}_]",
    A: "^",
    Z: "$",
  };
  let saida = "";
  let emClasse = false;
  for (let i = 0; i < padrao.length; i += 1) {
    const caractere = padrao[i]!;
    if (caractere === "\\") {
      const proximo = padrao[i + 1] ?? "";
      i += 1;
      if (emClasse && traducaoEmClasse[proximo]) saida += traducaoEmClasse[proximo];
      else if (!emClasse && traducao[proximo]) saida += traducao[proximo];
      else if (
        /^[^\p{L}\p{N}]$/u.test(proximo) &&
        !"^$\\.*+?()[]{}|/".includes(proximo) &&
        !(emClasse && proximo === "-")
      ) {
        saida += `\\u{${proximo.codePointAt(0)!.toString(16)}}`;
      } else saida += `\\${proximo}`;
      continue;
    }
    if (emClasse) {
      if (caractere === "]") emClasse = false;
      saida += caractere;
      continue;
    }
    if (caractere === "[") {
      emClasse = true;
      saida += caractere;
      if (padrao[i + 1] === "^") saida += padrao[++i];
      if (padrao[i + 1] === "]") saida += `\\${padrao[++i]}`;
      continue;
    }
    if (caractere === ".") saida += "[^\\n]";
    else if (caractere === "$") saida += "(?=\\n?$)";
    else saida += caractere;
  }
  return new RegExp(saida, "u");
}

/**
 * Esquema (em minúsculas) e autoridade (o trecho após `//`) de uma URL, pela
 * divisão léxica usada desde sempre pela base. `new URL` não serve aqui: ela
 * aceita `https:host` e `https:///host` como tendo host e rejeita `https://:80`,
 * enquanto a base exige autoridade explícita e não vazia.
 * Colchete de IPv6 desbalanceado lança erro.
 */
export function partesUrl(url: string): { esquema: string; autoridade: string } {
  let resto = url.replace(/^[\x00-\x20]+/, "").replace(/[\t\r\n]/g, "");
  let esquema = "";
  const indice = resto.indexOf(":");
  if (indice > 0 && /^[A-Za-z]/.test(resto) && /^[A-Za-z0-9+\-.]+$/.test(resto.slice(0, indice))) {
    esquema = resto.slice(0, indice).toLowerCase();
    resto = resto.slice(indice + 1);
  }
  let autoridade = "";
  if (resto.startsWith("//")) {
    let fim = resto.length;
    for (const delimitador of "/?#") {
      const posicao = resto.indexOf(delimitador, 2);
      if (posicao >= 0) fim = Math.min(fim, posicao);
    }
    autoridade = resto.slice(2, fim);
    if (autoridade.includes("[") !== autoridade.includes("]")) throw new Error("Invalid IPv6 URL");
  }
  return { esquema, autoridade };
}

/** URL absoluta com esquema, autoridade não vazia e sem espaços. */
export function ehUrlAbsoluta(url: string, esquemaExigido?: string): boolean {
  const { esquema, autoridade } = partesUrl(url);
  if (esquemaExigido === undefined ? !esquema : esquema !== esquemaExigido) return false;
  return Boolean(autoridade) && !RE_TEM_ESPACO.test(url);
}
