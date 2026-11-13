/**
 * Validação dos JSON Schemas de `base-analise/schemas/` pelo ajv de
 * `@simplifica-if/kb/schema`, com as mensagens e a ordem que o validador da
 * analise-ppc sempre usou:
 *
 * - num nó, `anyOf` ou `type` inválidos são a única mensagem do nó (e de seus filhos);
 * - depois vêm `enum`, `minimum`, `maximum`, os `required` ausentes (na ordem da lista) e as demais
 *   palavras-chave (`pattern`, `minLength`, `additionalProperties`);
 * - os filhos seguem a ordem de `properties` no schema e a posição nas listas.
 */
import type { ErrorObject } from "ajv/dist/2020.js";
import { ehObjeto, type ObjetoJson, representar, textoDe } from "@simplifica-if/kb/json";
import { compilarJsonSchema } from "@simplifica-if/kb/schema";

/** Nome do tipo JSON de um valor, separando inteiros de `number`. */
export function tipoJson(valor: unknown): string {
  if (valor === null || valor === undefined) return "null";
  if (typeof valor === "boolean") return "boolean";
  if (typeof valor === "number") return Number.isInteger(valor) ? "integer" : "number";
  if (typeof valor === "string") return "string";
  if (Array.isArray(valor)) return "array";
  if (ehObjeto(valor)) return "object";
  return typeof valor;
}

const ORDEM_NO_NO: Record<string, number> = { anyOf: 0, type: 0, enum: 1, minimum: 2, maximum: 3, required: 4 };

function decodificarSegmento(segmento: string): string {
  return decodeURIComponent(segmento).replaceAll("~1", "/").replaceAll("~0", "~");
}

function compararPosicoes(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

function mensagemDe(erro: ErrorObject): string {
  const schema = erro.parentSchema as ObjetoJson;
  switch (erro.keyword) {
    case "anyOf":
      return "não corresponde a nenhuma alternativa de anyOf";
    case "type":
      return `tipo ${tipoJson(erro.data)}; esperado ${textoDe(schema.type)}`;
    case "enum":
      return `valor ${representar(erro.data)} fora do enum`;
    case "minimum":
      return `valor ${textoDe(erro.data)} menor que ${textoDe(schema.minimum)}`;
    case "maximum":
      return `valor ${textoDe(erro.data)} maior que ${textoDe(schema.maximum)}`;
    case "required":
      return `campo obrigatório ausente: ${String(erro.params.missingProperty)}`;
    case "pattern":
      return `valor ${representar(erro.data)} fora do formato`;
    case "minLength":
      return `valor ${representar(erro.data)} menor que o tamanho mínimo ${textoDe(schema.minLength)}`;
    case "additionalProperties":
      return `campo não permitido: ${String(erro.params.additionalProperty)}`;
    default:
      return erro.message ?? erro.keyword;
  }
}

/** Valida `valor` contra `schema` e devolve mensagens `$.campo[0]: texto`. */
export function validarSchemaAnalise(valor: unknown, schema: ObjetoJson): string[] {
  const validar = compilarJsonSchema(schema);
  if (validar(valor)) return [];
  // Erros dentro das alternativas de um anyOf não são relatados: só o do próprio anyOf.
  const erros = (validar.errors ?? []).filter((erro) => !erro.schemaPath.includes("/anyOf/"));
  const exclusivos = erros
    .filter((erro) => erro.keyword === "type" || erro.keyword === "anyOf")
    .map((erro) => erro.instancePath);
  const encoberto = (erro: ErrorObject) =>
    exclusivos.some(
      (ponteiro) =>
        (erro.instancePath === ponteiro && erro.keyword !== "type" && erro.keyword !== "anyOf") ||
        erro.instancePath.startsWith(`${ponteiro}/`),
    );

  const mensagens: Array<{ posicao: number[]; texto: string }> = [];
  for (const erro of erros) {
    if (encoberto(erro)) continue;
    const instancia = erro.instancePath ? erro.instancePath.slice(1).split("/").map(decodificarSegmento) : [];
    const segmentos = erro.schemaPath.replace(/^#\/?/, "").split("/").map(decodificarSegmento);
    let cursor: unknown = schema;
    let caminho = "$";
    let consumidos = 0;
    const posicao: number[] = [];
    for (let i = 0; i < segmentos.length - 1; i += 1) {
      const segmento = segmentos[i]!;
      const no = ehObjeto(cursor) ? cursor : {};
      if (segmento === "properties") {
        const nome = segmentos[++i]!;
        const propriedades = ehObjeto(no.properties) ? no.properties : {};
        posicao.push(1, Object.keys(propriedades).indexOf(nome));
        caminho += `.${nome}`;
        cursor = propriedades[nome];
        consumidos += 1;
      } else if (segmento === "items") {
        const indice = Number(instancia[consumidos]);
        posicao.push(1, indice);
        caminho += `[${indice}]`;
        cursor = no.items;
        consumidos += 1;
      } else {
        throw new Error(`palavra-chave de JSON Schema não suportada no caminho ${erro.schemaPath}`);
      }
    }
    const ordem = ORDEM_NO_NO[erro.keyword] ?? 5;
    const sub =
      erro.keyword === "required"
        ? ((erro.parentSchema as ObjetoJson).required as string[]).indexOf(String(erro.params.missingProperty))
        : 0;
    mensagens.push({ posicao: [...posicao, 0, ordem, sub], texto: `${caminho}: ${mensagemDe(erro)}` });
  }
  return mensagens.sort((a, b) => compararPosicoes(a.posicao, b.posicao)).map((mensagem) => mensagem.texto);
}
