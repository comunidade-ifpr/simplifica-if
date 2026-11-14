/**
 * Equivalência entre os JSON Schemas do gabarito (gerados pelo zod no C0) e os do Effect (C2), por
 * dois critérios:
 *
 * 1. **Forma normalizada** (chaves ordenadas, sem `$schema`, `$defs` resolvidos e `type: [X, "null"]`
 *    como `anyOf`): as diferenças que sobram ficam listadas em `DIFERENCAS_ACEITAS`, com o motivo.
 * 2. **Veredito** (ajv, draft 2020-12): amostras válidas e inválidas de entrada (as chamadas do
 *    gabarito e variações de cada campo nos limites do schema antigo) e de saída (todo
 *    `structuredContent` do gabarito e variações dele) recebem o mesmo veredito nos dois schemas.
 *
 * Usado por `equivalencia-schemas.test.ts` (schemas das definições) e por `gabarito.ts
 * --schemas-equivalentes` (schemas do `tools/list` pelo protocolo).
 */
import { Ajv2020 } from "ajv/dist/2020.js";

type Json = unknown;
type Objeto = Record<string, Json>;

const ehObjeto = (v: Json): v is Objeto => typeof v === "object" && v !== null && !Array.isArray(v);

/* ================================================================== forma */

function resolverRefs(valor: Json, defs: Objeto): Json {
  if (Array.isArray(valor)) return valor.map((v) => resolverRefs(v, defs));
  if (!ehObjeto(valor)) return valor;
  const ref = valor.$ref;
  if (typeof ref === "string" && ref.startsWith("#/$defs/")) return resolverRefs(defs[ref.slice(8)], defs);
  return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, resolverRefs(v, defs)]));
}

function ordenar(valor: Json): Json {
  if (Array.isArray(valor)) return valor.map(ordenar);
  if (!ehObjeto(valor)) return valor;
  const saida: Objeto = {};
  for (const chave of Object.keys(valor).sort()) {
    if (chave === "$schema" || chave === "$defs") continue;
    saida[chave] = ordenar(valor[chave]);
  }
  // `type: [X, "null"]` (zod) é o mesmo que `anyOf: [{ type: X, … }, { type: "null" }]` (Effect)
  if (Array.isArray(saida.type) && saida.type.length === 2 && saida.type[1] === "null") {
    const { type, ...resto } = saida;
    return ordenar({ anyOf: [{ ...resto, type: (type as Json[])[0] }, { type: "null" }] });
  }
  return saida;
}

/** O schema normalizado: chaves ordenadas, sem `$schema`, `$defs` resolvidos, `type` com `null` como `anyOf`. */
export function normalizar(schema: Json): Json {
  const defs = ehObjeto(schema) && ehObjeto(schema.$defs) ? schema.$defs : {};
  return ordenar(resolverRefs(schema, defs));
}

/** As diferenças entre dois schemas normalizados, uma por linha: `<caminho>: <antes> → <depois>`. */
export function diferencas(antigo: Json, novo: Json, caminho = ""): string[] {
  if (JSON.stringify(antigo) === JSON.stringify(novo)) return [];
  if (ehObjeto(antigo) && ehObjeto(novo)) {
    return [...new Set([...Object.keys(antigo), ...Object.keys(novo)])]
      .sort()
      .flatMap((chave) => diferencas(antigo[chave], novo[chave], `${caminho}/${chave}`));
  }
  if (Array.isArray(antigo) && Array.isArray(novo) && antigo.length === novo.length) {
    return antigo.flatMap((item, i) => diferencas(item, novo[i], `${caminho}/${i}`));
  }
  return [`${caminho}: ${JSON.stringify(antigo)} → ${JSON.stringify(novo)}`];
}

/**
 * As diferenças de forma que ficam, por ferramenta, depois da normalização. Todas têm o mesmo
 * veredito nos dois lados (conferido pelas amostras):
 *
 * - o zod escreve `propertyNames: { type: "string" }` nos registros (`z.record(z.string(), …)`), e o
 *   Effect, não; as chaves de um objeto JSON são sempre texto, então a restrição não recusa nada.
 */
export const DIFERENCAS_ACEITAS: Readonly<Record<string, readonly string[]>> = {
  adequacao_art71: ['saida/properties/dados/properties/totais/propertyNames: {"type":"string"} → undefined'],
  fatos_ppc: [
    'saida/properties/dados/properties/totais/additionalProperties/propertyNames: {"type":"string"} → undefined',
    'saida/properties/dados/properties/totais/propertyNames: {"type":"string"} → undefined',
  ],
  sobre_a_base: ['saida/properties/dados/properties/contagens/propertyNames: {"type":"string"} → undefined'],
};

/* ================================================================== veredito */

export function validador(): (schema: Json, valor: Json) => boolean {
  const ajv = new Ajv2020({ strict: false, allErrors: false });
  const cache = new Map<string, ReturnType<typeof ajv.compile>>();
  return (schema, valor) => {
    const chave = JSON.stringify(schema);
    let validar = cache.get(chave);
    if (!validar) {
      validar = ajv.compile(schema as object);
      cache.set(chave, validar);
    }
    return validar(valor) === true;
  };
}

const clonar = <T>(valor: T): T => structuredClone(valor);

/** Valores de um campo nos limites do schema (antigo) dele, válidos e inválidos. */
function valoresDoCampo(schema: Json, atual: Json): Json[] {
  if (!ehObjeto(schema)) return [];
  const valores: Json[] = [null, { x: 1 }, [], 42, "texto", true];
  const tipo = schema.type;
  if (tipo === "string") {
    const minimo = typeof schema.minLength === "number" ? schema.minLength : 0;
    const maximo = typeof schema.maxLength === "number" ? schema.maxLength : undefined;
    valores.push("", "a".repeat(minimo), "a".repeat(Math.max(0, minimo - 1)), " com espaço ", "br/lei/1996/9394#art36");
    if (maximo !== undefined) valores.push("a".repeat(maximo), "a".repeat(maximo + 1));
    if (Array.isArray(schema.enum)) valores.push(...schema.enum, "outro");
  }
  if (tipo === "integer" || tipo === "number") {
    for (const chave of ["minimum", "maximum"]) {
      const limite = schema[chave];
      if (typeof limite === "number") valores.push(limite, limite - 1, limite + 1, limite + 0.5);
    }
    valores.push(0, -1, 1.5);
  }
  if (tipo === "array") {
    const item = Array.isArray(atual) && atual.length > 0 ? atual[0] : "a";
    const minimo = typeof schema.minItems === "number" ? schema.minItems : 0;
    const maximo = typeof schema.maxItems === "number" ? schema.maxItems : undefined;
    valores.push([item], [1], Array(Math.max(0, minimo - 1)).fill(item));
    if (maximo !== undefined) valores.push(Array(maximo).fill(item), Array(maximo + 1).fill(item));
  }
  if (tipo === "object" && ehObjeto(schema.properties)) {
    const base = ehObjeto(atual) ? atual : {};
    valores.push({}, { ...base, extra: 1 });
    for (const [chave, sub] of Object.entries(schema.properties)) {
      for (const v of valoresDoCampo(sub, base[chave])) valores.push({ ...base, [chave]: v });
      const { [chave]: _removido, ...sem } = base;
      valores.push(sem);
    }
  }
  return valores;
}

/** Amostras de entrada: as chamadas conhecidas e variações de cada campo, nos limites do schema antigo. */
export function amostrasDeEntrada(schemaAntigo: Json, conhecidas: readonly Json[]): Json[] {
  const amostras: Json[] = [{}, { extra: 1 }, null, [], "texto", ...conhecidas];
  const propriedades = ehObjeto(schemaAntigo) && ehObjeto(schemaAntigo.properties) ? schemaAntigo.properties : {};
  for (const base of conhecidas.filter(ehObjeto)) {
    amostras.push({ ...base, chave_extra: 1 });
    for (const [chave, sub] of Object.entries(propriedades)) {
      const { [chave]: _removido, ...sem } = base;
      amostras.push(sem);
      for (const valor of valoresDoCampo(sub, base[chave])) amostras.push({ ...base, [chave]: valor });
    }
  }
  return amostras;
}

/** Amostras de saída: a resposta e variações dela (chave a mais, chave obrigatória a menos, tipo trocado). */
export function amostrasDeSaida(resposta: Json, limite = 400): Json[] {
  const amostras: Json[] = [resposta];
  const visitar = (no: Json, caminho: (string | number)[]) => {
    if (amostras.length >= limite) return;
    if (Array.isArray(no)) {
      no.slice(0, 3).forEach((item, i) => visitar(item, [...caminho, i]));
      return;
    }
    if (!ehObjeto(no)) return;
    const variar = (mudar: (alvo: Objeto) => void) => {
      const copia = clonar(resposta) as Objeto;
      let alvo: Json = copia;
      for (const passo of caminho) alvo = (alvo as Record<string | number, Json>)[passo];
      mudar(alvo as Objeto);
      amostras.push(copia);
    };
    variar((alvo) => (alvo.chave_extra = 1));
    for (const [chave, valor] of Object.entries(no)) {
      variar((alvo) => delete alvo[chave]);
      variar((alvo) => (alvo[chave] = typeof valor === "string" ? 42 : "texto"));
      if (valor === null) variar((alvo) => (alvo[chave] = {}));
      visitar(valor, [...caminho, chave]);
    }
  };
  visitar(resposta, []);
  return amostras;
}

/* ================================================================== comparação com o gabarito */

/** Uma ferramenta como o `tools/list` a descreve. */
export interface DefinicaoListada {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly annotations?: Objeto;
  readonly inputSchema: Json;
  readonly outputSchema?: Json;
}

/** Uma chamada do gabarito: ferramenta, argumentos e resultado (`content` e `structuredContent`). */
export interface ChamadaDoGabarito {
  readonly name: string;
  readonly arguments: Objeto;
  readonly resultado: { readonly structuredContent?: Json };
}

/**
 * A única diferença aceita nas anotações: o `McpSchema` do Effect sempre escreve `destructiveHint`, e
 * o registro o manda `false` (ver `ferramentas/registrar.ts`); o servidor anterior o omitia.
 */
export const ANOTACOES_ACEITAS: Readonly<Objeto> = { destructiveHint: false };

/** O resultado de comparar as definições novas com as do gabarito. */
export interface Comparacao {
  /** Diferenças fora das aceitas; vazio quando os schemas são equivalentes. */
  readonly problemas: readonly string[];
  /** Amostras conferidas no ajv (entrada e saída), todas com o mesmo veredito nos dois schemas. */
  readonly amostras: number;
}

/**
 * Compara as ferramentas do gabarito com as novas, na mesma ordem: nome, título, descrição e anotações
 * iguais (menos `ANOTACOES_ACEITAS`); schemas normalizados iguais ou com as diferenças de
 * `DIFERENCAS_ACEITAS`; e o mesmo veredito do ajv, nos dois schemas, para as amostras de entrada (a
 * partir das chamadas do gabarito) e de saída (a partir de cada `structuredContent` do gabarito).
 */
export function compararDefinicoes(
  antigas: readonly DefinicaoListada[],
  novas: readonly DefinicaoListada[],
  chamadas: readonly ChamadaDoGabarito[],
): Comparacao {
  const problemas: string[] = [];
  const valida = validador();
  let amostras = 0;
  const nomes = (lista: readonly DefinicaoListada[]) => lista.map((t) => t.name).join(", ");
  if (nomes(antigas) !== nomes(novas)) problemas.push(`ferramentas: [${nomes(antigas)}] → [${nomes(novas)}]`);
  for (const antiga of antigas) {
    const nova = novas.find((t) => t.name === antiga.name);
    if (!nova) continue;
    const rotulo = antiga.name;
    if (antiga.title !== nova.title) problemas.push(`${rotulo}: título ${antiga.title} → ${nova.title}`);
    if (antiga.description !== nova.description) problemas.push(`${rotulo}: descrição diferente`);
    const anotacoes = JSON.stringify(ordenar({ ...antiga.annotations, ...ANOTACOES_ACEITAS }));
    if (anotacoes !== JSON.stringify(ordenar(nova.annotations ?? {}))) {
      problemas.push(`${rotulo}: anotações ${anotacoes} → ${JSON.stringify(ordenar(nova.annotations ?? {}))}`);
    }
    const aceitas = DIFERENCAS_ACEITAS[rotulo] ?? [];
    const forma = [
      ...diferencas(normalizar(antiga.inputSchema), normalizar(nova.inputSchema), "entrada"),
      ...diferencas(normalizar(antiga.outputSchema), normalizar(nova.outputSchema), "saida"),
    ];
    for (const d of forma) if (!aceitas.includes(d)) problemas.push(`${rotulo}: ${d}`);
    for (const d of aceitas)
      if (!forma.includes(d)) problemas.push(`${rotulo}: diferença aceita que não aparece mais: ${d}`);
    const doGabarito = chamadas.filter((c) => c.name === rotulo);
    for (const amostra of amostrasDeEntrada(
      antiga.inputSchema,
      doGabarito.map((c) => c.arguments),
    )) {
      amostras++;
      const antes = valida(antiga.inputSchema, amostra);
      if (antes !== valida(nova.inputSchema, amostra)) {
        problemas.push(`${rotulo}: entrada ${JSON.stringify(amostra)}: ${antes ? "aceita" : "recusada"} só no antigo`);
      }
    }
    if (antiga.outputSchema === undefined || nova.outputSchema === undefined) continue;
    for (const chamada of doGabarito) {
      if (chamada.resultado.structuredContent === undefined) continue;
      for (const amostra of amostrasDeSaida(chamada.resultado.structuredContent)) {
        amostras++;
        const antes = valida(antiga.outputSchema, amostra);
        if (antes !== valida(nova.outputSchema, amostra)) {
          problemas.push(
            `${rotulo}: saída de ${JSON.stringify(chamada.arguments)}: ${antes ? "aceita" : "recusada"} só no antigo`,
          );
        }
      }
    }
  }
  return { problemas, amostras };
}
