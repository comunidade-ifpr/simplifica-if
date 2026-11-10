/** Validador do subconjunto de JSON Schema usado em base-conhecimento/schemas/. */
import {
  ehInteiro,
  ehObjeto,
  iguais,
  type ObjetoJson,
  regexPython,
  repr,
  RE_TEM_ESPACO,
  str,
  tamanho,
  urlsplit,
} from "./python.ts";

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
    !iguais(tipoReal, tipoEsperado) &&
    !(tipoEsperado === "number" && tipoReal === "integer")
  ) {
    return [`${rotulo}: ${caminho} deve ser ${str(tipoEsperado)}, recebido ${tipoReal}`];
  }

  if (tem("const") && !iguais(dados, schema.const)) erros.push(`${rotulo}: ${caminho} deve ser ${repr(schema.const)}`);
  if (tem("enum") && !(Array.isArray(schema.enum) && schema.enum.some((opcao) => iguais(dados, opcao)))) {
    erros.push(`${rotulo}: ${caminho} deve ser um de ${repr(schema.enum)}`);
  }

  if (typeof dados === "string") {
    const minimo = schema.minLength;
    if (ehInteiro(minimo) && tamanho(dados) < Number(minimo)) {
      erros.push(`${rotulo}: ${caminho} deve ter ao menos ${str(minimo)} caractere(s)`);
    }
    const padrao = schema.pattern;
    if (typeof padrao === "string" && !regexPython(padrao).test(dados)) {
      erros.push(`${rotulo}: ${caminho} não corresponde ao padrão ${padrao}`);
    }
    if (schema.format === "date" && !RE_DATA.test(dados)) erros.push(`${rotulo}: ${caminho} deve estar em YYYY-MM-DD`);
    if (schema.format === "uri") {
      const partes = urlsplit(dados);
      if (!partes.scheme || !partes.netloc || RE_TEM_ESPACO.test(dados)) {
        erros.push(`${rotulo}: ${caminho} deve ser URI absoluta válida`);
      }
    }
  }

  if (typeof dados === "number") {
    const minimo = schema.minimum;
    if ((typeof minimo === "number" || typeof minimo === "boolean") && dados < Number(minimo)) {
      erros.push(`${rotulo}: ${caminho} deve ser maior ou igual a ${str(minimo)}`);
    }
  }

  if (Array.isArray(dados)) {
    const minimo = schema.minItems;
    if (ehInteiro(minimo) && dados.length < Number(minimo)) {
      erros.push(`${rotulo}: ${caminho} deve ter ao menos ${str(minimo)} item(ns)`);
    }
    const maximo = schema.maxItems;
    if (ehInteiro(maximo) && dados.length > Number(maximo)) {
      erros.push(`${rotulo}: ${caminho} deve ter no máximo ${str(maximo)} item(ns)`);
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
