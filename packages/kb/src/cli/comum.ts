/**
 * Peças comuns aos comandos de curadoria da CLI `kb` (`compilar`, `relacoes --propor`,
 * `avaliar-resolvedor`, `avaliar-busca`): erros da casca, flags repetidas, saída e a layer do
 * checkout.
 *
 * Cada comando recebe a layer dentro do próprio handler (`Effect.provide(camadaRepositorio)`), e
 * não em volta do `Command.run`: assim `--help` e os erros de uso não abrem nem recompilam o banco.
 */
import * as Console from "effect/Console";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Flag from "effect/cli/Flag";
import * as Layers from "../layers.ts";

/** Uso que os parsers de flag não pegam: `relacoes` sem `--propor`. */
export class EntradaInvalida extends Schema.TaggedError<EntradaInvalida>()("EntradaInvalida", {
  motivo: Schema.Literals(["sem-propor"]),
}) {
  override get message(): string {
    return "relacoes só lista as propostas do regex (--propor); as relações de uma norma estão em kb ficha-norma <id>";
  }
}

/** Falha num comando de curadoria que lê os arquivos direto (`avaliar-resolvedor`, `relacoes --propor`). */
export class FalhaNaCuradoria extends Schema.TaggedError<FalhaNaCuradoria>()("FalhaNaCuradoria", {
  comando: Schema.Literals(["avaliar-resolvedor", "relacoes --propor"]),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `${this.comando}: não foi possível ler as fontes da curadoria`;
  }
}

/** O checkout onde estão as fontes e o `tmp/kb.sqlite`; o ponto de entrada (`packages/mcp/src/kb.ts`) informa a raiz. */
export class Checkout extends Context.Service<Checkout, { readonly raiz: string }>()(
  "@simplifica-if/kb/cli/comum/Checkout",
) {}

/** Banco do checkout, recompilado se velho, e os serviços de consulta sobre ele. */
export const camadaRepositorio = Layer.unwrap(
  Effect.gen(function* () {
    const { raiz } = yield* Checkout;
    return Layers.layerRepositorio({ raiz });
  }),
);

/** JSON com recuo de 2, como a CLI sempre imprimiu. */
export const paraJson = (valor: unknown): string => JSON.stringify(valor, null, 2);

/** JSON numa linha (trechos da saída em texto). */
export const paraJsonCompacto = (valor: unknown): string => JSON.stringify(valor);

/** Imprime as linhas de uma vez; sem linhas, não imprime nada. */
export const imprimir = (linhas: readonly string[]): Effect.Effect<void> =>
  linhas.length === 0 ? Effect.void : Console.log(linhas.join("\n"));

export const flagJson = Flag.Boolean("json").pipe(Flag.withDescription("saída em JSON"), Flag.withDefault(false));

/** Flag de texto opcional. */
export const flagTexto = (nome: string, descricao: string) =>
  Flag.String(nome).pipe(Flag.withDescription(descricao), Flag.optional);

/** Flag booleana, falsa por padrão. */
export const flagLigada = (nome: string, descricao: string) =>
  Flag.Boolean(nome).pipe(Flag.withDescription(descricao), Flag.withDefault(false));
