/**
 * As ferramentas na linha de comando: um comando por ferramenta (`kb buscar-norma "…" --limite 5`) e a
 * impressão da resposta, que o `simplifica-mcp consultar` também usa.
 *
 * Cada comando é derivado da ferramenta: o nome em kebab-case, a descrição dela, e um parâmetro por
 * campo do JSON Schema de entrada (o mesmo do `tools/list`). O primeiro campo obrigatório é o argumento
 * posicional (repetível, se for uma lista); os outros são flags com o nome do campo em kebab-case
 * (`confianca_min` → `--confianca-min`): booleano liga com a flag, lista repete a flag, número e texto
 * levam o valor. A conferência é a da ferramenta (`chamador`): a mesma entrada, as mesmas mensagens.
 *
 * A saída padrão é o texto Markdown que a IA recebe; `--json`, a `Resposta` (o `structuredContent`)
 * numa linha. Com `--todas-as-paginas` (nas ferramentas paginadas), segue o cursor e imprime cada
 * página, uma por linha no JSON. A `etapa` não vira comando: só faz sentido numa conversa.
 */
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Argument from "effect/cli/Argument";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import type { Resposta } from "./contratos.ts";
import { jsonSchema } from "./esquema.ts";
import type { Ferramenta } from "./ferramentas/ferramenta.ts";
import { chamador } from "./ferramentas/registrar.ts";
import { FERRAMENTAS, layerHandlers } from "./ferramentas/toolkit.ts";
import type * as Leitura from "./leitura/Leitura.ts";

export type Formato = "texto" | "json";

export interface OpcoesImpressao {
  readonly formato: Formato;
  readonly todasAsPaginas: boolean;
}

const emJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const TEXTOS: ReadonlyMap<string, (resposta: Resposta<unknown>) => string> = new Map(
  FERRAMENTAS.map((f) => [f.nome, f.textoCompleto as (resposta: Resposta<unknown>) => string]),
);

/**
 * Roda a ferramenta `nome` com `entrada` pelo `chamador` (a mesma conferência e a mesma resposta do
 * servidor MCP) e imprime o texto Markdown ou o JSON; com `todasAsPaginas`, segue o cursor no mesmo
 * banco aberto.
 */
export const imprimirConsulta = Effect.fn("consulta.imprimir")(function* (
  nome: string,
  entrada: unknown,
  opcoes: OpcoesImpressao,
) {
  const chamar = yield* chamador;
  const texto = TEXTOS.get(nome);
  let atual = entrada;
  for (;;) {
    const resposta = yield* chamar(nome, atual);
    yield* Console.log(
      opcoes.formato === "json" || texto === undefined ? yield* emJson(resposta).pipe(Effect.orDie) : texto(resposta),
    );
    const cursor = resposta.pagina?.cursor;
    if (!opcoes.todasAsPaginas || cursor === undefined) return;
    atual = { ...(atual as object), cursor };
  }
});

/* ================================================================== comandos */

/** O que o comando lê de cada propriedade do JSON Schema de entrada. */
interface Propriedade {
  readonly type?: string;
  readonly enum?: ReadonlyArray<string>;
  readonly description?: string;
  readonly default?: unknown;
}

interface EsquemaEntrada {
  readonly properties?: Readonly<Record<string, Propriedade>>;
  readonly required?: ReadonlyArray<string>;
}

/** Um parâmetro do comando, com o valor já na forma da entrada; `undefined` quando ausente. */
type Parametro = Flag.Flag<unknown> | Argument.Argument<unknown>;

const kebab = (nome: string): string => nome.replaceAll("_", "-");

function descricaoDe(p: Propriedade): string {
  return [
    p.description,
    p.enum ? `valores: ${p.enum.join(", ")}` : undefined,
    p.default !== undefined && p.type !== "boolean" ? `padrão: ${JSON.stringify(p.default)}` : undefined,
  ]
    .filter((parte) => parte !== undefined)
    .join("; ");
}

/**
 * Número da linha de comando: o texto que é número vira número; o resto segue como texto, para a
 * ferramenta recusá-lo com a mensagem dela.
 */
const numeroOuTexto = (valor: string): unknown =>
  /^[+-]?(\d+\.?\d*|\.\d+)$/.test(valor.trim()) ? Number(valor) : valor;

function flagDe(campo: string, p: Propriedade): Parametro {
  const nome = kebab(campo);
  const descricao = descricaoDe(p);
  switch (p.type) {
    case "boolean":
      return Flag.Boolean(nome).pipe(
        Flag.withDescription(descricao),
        Flag.withDefault(false),
        Flag.map((ligada) => (ligada ? true : undefined)),
      );
    case "array":
      return Flag.String(nome).pipe(
        Flag.withDescription(`${descricao} (repita a flag para mais de um)`),
        Flag.atLeast(0),
        Flag.map((valores) => (valores.length > 0 ? valores : undefined)),
      );
    case "integer":
    case "number":
      return Flag.String(nome).pipe(
        Flag.withDescription(descricao),
        Flag.optional,
        Flag.map((valor) => (Option.isSome(valor) ? numeroOuTexto(valor.value) : undefined)),
      );
    case "string":
      return Flag.String(nome).pipe(Flag.withDescription(descricao), Flag.optional, Flag.map(Option.getOrUndefined));
    default:
      throw new Error(`campo ${campo}: tipo ${String(p.type)} sem flag na linha de comando`);
  }
}

function argumentoDe(campo: string, p: Propriedade): Parametro {
  const argumento = Argument.String(kebab(campo)).pipe(Argument.withDescription(descricaoDe(p)));
  if (p.type === "array") return argumento.pipe(Argument.atLeast(1));
  if (p.type === "string") return argumento;
  throw new Error(`campo ${campo}: tipo ${String(p.type)} não serve de argumento posicional`);
}

const flagJson = Flag.Boolean("json").pipe(
  Flag.withDescription("imprime a resposta inteira em JSON (o structuredContent da ferramenta), numa linha"),
  Flag.withDefault(false),
);

const flagTodasAsPaginas = Flag.Boolean("todas-as-paginas").pipe(
  Flag.withDescription("segue o cursor e imprime todas as páginas (no JSON, uma resposta por linha)"),
  Flag.withDefault(false),
);

/** O comando de uma ferramenta, que roda sobre os handlers montados de `leitura`. */
function comandoDe<E, R>(ferramenta: Ferramenta, leitura: Layer.Layer<Leitura.Leitura, E, R>) {
  const esquema = jsonSchema(ferramenta.entrada) as EsquemaEntrada;
  const propriedades = Object.entries(esquema.properties ?? {});
  const posicional = esquema.required?.[0];
  const entrada: Record<string, Parametro> = Object.fromEntries(
    propriedades.map(([campo, p]) => [campo, campo === posicional ? argumentoDe(campo, p) : flagDe(campo, p)]),
  );
  const paginada = propriedades.some(([campo]) => campo === "cursor");
  const handlers = layerHandlers.pipe(Layer.provide(leitura));
  return Command.make(
    kebab(ferramenta.nome),
    { entrada, json: flagJson, ...(paginada ? { todasAsPaginas: flagTodasAsPaginas } : {}) },
    Effect.fn("consulta.comando")(function* (valores) {
      yield* Effect.annotateCurrentSpan("ferramenta", ferramenta.nome);
      const argumentos = Object.fromEntries(Object.entries(valores.entrada).filter(([, v]) => v !== undefined));
      yield* imprimirConsulta(ferramenta.nome, argumentos, {
        formato: valores.json ? "json" : "texto",
        todasAsPaginas: valores.todasAsPaginas === true,
      }).pipe(Effect.provide(handlers));
    }),
  ).pipe(Command.withDescription(ferramenta.descricao));
}

/**
 * Um comando por ferramenta (menos a `etapa`), na ordem do `tools/list`. O banco só abre quando um
 * comando roda: `--help` e os erros de uso não montam `leitura`.
 */
export const comandosDeConsulta = <E, R>(leitura: Layer.Layer<Leitura.Leitura, E, R>) =>
  (FERRAMENTAS as ReadonlyArray<Ferramenta>).filter((f) => f.nome !== "etapa").map((f) => comandoDe(f, leitura));
