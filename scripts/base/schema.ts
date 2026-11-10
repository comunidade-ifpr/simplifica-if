/** Validador do subconjunto de JSON Schema usado em base-conhecimento/schemas/. */
import { ehInteiro, ehObjeto, type ObjetoJson, representar, textoDe, valoresIguais } from "./json.ts";
import { contarCaracteres, ESPACOS, RE_TEM_ESPACO } from "./texto.ts";

const RE_DATA = /^\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2}$/u;

/** Nome do tipo JSON Schema de um valor (inteiros separados de `number`). */
export function nomeTipo(valor: unknown): string {
  if (valor === null || valor === undefined) return "null";
  if (typeof valor === "boolean") return "boolean";
  if (typeof valor === "number") return Number.isInteger(valor) ? "integer" : "number";
  if (typeof valor === "string") return "string";
  if (Array.isArray(valor)) return "array";
  if (ehObjeto(valor)) return "object";
  return typeof valor;
}

export function validarJsonSchema(dados: unknown, schema: ObjetoJson, rotulo: string, caminho = "$"): string[] {
  const erros: string[] = [];
  const tem = (chave: string) => Object.hasOwn(schema, chave);

  const tipoEsperado = tem("type") ? schema.type : null;
  const tipoReal = nomeTipo(dados);
  // JSON Schema inclui inteiros no tipo number; booleanos continuam separados.
  if (
    tipoEsperado !== null &&
    tipoEsperado !== undefined &&
    !valoresIguais(tipoReal, tipoEsperado) &&
    !(tipoEsperado === "number" && tipoReal === "integer")
  ) {
    return [`${rotulo}: ${caminho} deve ser ${textoDe(tipoEsperado)}, recebido ${tipoReal}`];
  }

  if (tem("const") && !valoresIguais(dados, schema.const))
    erros.push(`${rotulo}: ${caminho} deve ser ${representar(schema.const)}`);
  if (tem("enum") && !(Array.isArray(schema.enum) && schema.enum.some((opcao) => valoresIguais(dados, opcao)))) {
    erros.push(`${rotulo}: ${caminho} deve ser um de ${representar(schema.enum)}`);
  }

  if (typeof dados === "string") {
    const minimo = schema.minLength;
    if (ehInteiro(minimo) && contarCaracteres(dados) < Number(minimo)) {
      erros.push(`${rotulo}: ${caminho} deve ter ao menos ${textoDe(minimo)} caractere(s)`);
    }
    const padrao = schema.pattern;
    if (typeof padrao === "string" && !regexDoSchema(padrao).test(dados)) {
      erros.push(`${rotulo}: ${caminho} não corresponde ao padrão ${padrao}`);
    }
    if (schema.format === "date" && !RE_DATA.test(dados)) erros.push(`${rotulo}: ${caminho} deve estar em YYYY-MM-DD`);
    if (schema.format === "uri") {
      if (!ehUrlAbsoluta(dados)) {
        erros.push(`${rotulo}: ${caminho} deve ser URI absoluta válida`);
      }
    }
  }

  if (typeof dados === "number") {
    const minimo = schema.minimum;
    if ((typeof minimo === "number" || typeof minimo === "boolean") && dados < Number(minimo)) {
      erros.push(`${rotulo}: ${caminho} deve ser maior ou igual a ${textoDe(minimo)}`);
    }
  }

  if (Array.isArray(dados)) {
    const minimo = schema.minItems;
    if (ehInteiro(minimo) && dados.length < Number(minimo)) {
      erros.push(`${rotulo}: ${caminho} deve ter ao menos ${textoDe(minimo)} item(ns)`);
    }
    const maximo = schema.maxItems;
    if (ehInteiro(maximo) && dados.length > Number(maximo)) {
      erros.push(`${rotulo}: ${caminho} deve ter no máximo ${textoDe(maximo)} item(ns)`);
    }
    if (ehObjeto(schema.items)) {
      const schemaItem = schema.items;
      dados.forEach((item, indice) =>
        erros.push(...validarJsonSchema(item, schemaItem, rotulo, `${caminho}[${indice}]`)),
      );
    }
  }

  if (ehObjeto(dados)) {
    if (Array.isArray(schema.required)) {
      for (const campo of schema.required) {
        if (typeof campo === "string" && !Object.hasOwn(dados, campo))
          erros.push(`${rotulo}: ${caminho}.${campo} é obrigatório`);
      }
    }
    const propriedades = ehObjeto(schema.properties) ? schema.properties : {};
    const adicionais = tem("additionalProperties") ? schema.additionalProperties : true;
    for (const [chave, valor] of Object.entries(dados)) {
      const schemaFilho = Object.hasOwn(propriedades, chave) ? propriedades[chave] : undefined;
      if (ehObjeto(schemaFilho)) {
        erros.push(...validarJsonSchema(valor, schemaFilho, rotulo, `${caminho}.${chave}`));
        continue;
      }
      if (adicionais === false) erros.push(`${rotulo}: ${caminho}.${chave} não é permitido`);
      else if (ehObjeto(adicionais)) erros.push(...validarJsonSchema(valor, adicionais, rotulo, `${caminho}.${chave}`));
    }
  }

  return erros;
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
