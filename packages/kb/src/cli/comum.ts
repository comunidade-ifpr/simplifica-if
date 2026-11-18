/**
 * Peças comuns aos comandos da CLI `kb`: erros da casca, flags repetidas, saída e a layer do
 * checkout.
 *
 * Cada comando recebe a layer dentro do próprio handler (`Effect.provide(camadaRepositorio)`), e
 * não em volta do `Command.run`: assim `--help` e os erros de uso não abrem nem recompilam o banco.
 */
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";
import * as Flag from "effect/cli/Flag";
import * as Layers from "../layers.ts";
import { ehIdExterno, ehIdNorma, idDoAto } from "../normas/ids.ts";
import { raizRepositorio } from "../normas/registro.ts";

/** Entrada que os parsers de flag não pegam (formato do ID, combinação de argumentos). */
export class EntradaInvalida extends Schema.TaggedError<EntradaInvalida>()("EntradaInvalida", {
  motivo: Schema.Literals(["id-fora-do-formato", "id-ausente"]),
  valor: Schema.optionalKey(Schema.String),
}) {
  override get message(): string {
    return this.motivo === "id-fora-do-formato"
      ? `ID fora do formato canônico: ${this.valor ?? ""} (ex.: br/cne-cp/res/2021/1)`
      : "informe o ID da norma ou --propor";
  }
}

export const ehEntradaInvalida = Schema.is(EntradaInvalida);

/**
 * O comando já imprimiu o que tinha a dizer (por exemplo, "dispositivo não encontrado") e só falta
 * o código de saída. O ponto de entrada não escreve nada para ele; o `runMain` lê o código pelo
 * marcador `Runtime.errorExitCode`.
 */
export class EncerrarComCodigo extends Schema.TaggedError<EncerrarComCodigo>()("EncerrarComCodigo", {
  codigo: Schema.Int,
}) {
  override get message(): string {
    return `encerrado com o código ${this.codigo}`;
  }

  override get [Runtime.errorExitCode](): number {
    return this.codigo;
  }
}

export const ehEncerrarComCodigo = Schema.is(EncerrarComCodigo);

/** Falha num comando de curadoria que lê os arquivos direto (`avaliar-resolvedor`, `relacoes --propor`). */
export class FalhaNaCuradoria extends Schema.TaggedError<FalhaNaCuradoria>()("FalhaNaCuradoria", {
  comando: Schema.Literals(["avaliar-resolvedor", "relacoes --propor"]),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `${this.comando}: não foi possível ler as fontes da curadoria`;
  }
}

/** Raiz do checkout, onde estão as fontes e o `tmp/kb.sqlite`. */
export const raiz = raizRepositorio();

/** Banco do checkout (recompilado se velho) e fontes normativas dos arquivos. */
export const camadaRepositorio = Layers.layerRepositorio({ raiz });

/** JSON com recuo de 2, como a CLI sempre imprimiu. */
export const paraJson = (valor: unknown): string => JSON.stringify(valor, null, 2);

/** JSON numa linha (trechos da saída em texto). */
export const paraJsonCompacto = (valor: unknown): string => JSON.stringify(valor);

/** Imprime as linhas de uma vez; sem linhas, não imprime nada. */
export const imprimir = (linhas: readonly string[]): Effect.Effect<void> =>
  linhas.length === 0 ? Effect.void : Console.log(linhas.join("\n"));

/** Confere o formato do ID (aceita `#dispositivo`) e devolve o ID do ato. */
export const exigirIdNorma = Effect.fn("cli.exigirIdNorma")(function* (
  id: string,
  opcoes: { readonly aceitarExterno?: boolean } = {},
) {
  const norma = id.split("#")[0]!;
  if (!ehIdNorma(norma) && !(opcoes.aceitarExterno && ehIdExterno(norma))) {
    return yield* new EntradaInvalida({ motivo: "id-fora-do-formato", valor: id });
  }
  return idDoAto(norma);
});

export const flagJson = Flag.Boolean("json").pipe(Flag.withDescription("saída em JSON"), Flag.withDefault(false));

/** `--limite <n>`: inteiro positivo. */
export const flagLimite = (descricao: string) =>
  Flag.Int("limite").pipe(
    Flag.withDescription(descricao),
    Flag.filter(
      (n) => n > 0,
      () => "use um inteiro positivo",
    ),
    Flag.withDefault(10),
  );

/** `--em <data>`: AAAA-MM-DD, opcional. */
export const flagData = (descricao: string) =>
  Flag.String("em").pipe(
    Flag.withDescription(descricao),
    Flag.filter(
      (valor) => /^\d{4}-\d{2}-\d{2}$/.test(valor),
      () => "use AAAA-MM-DD",
    ),
    Flag.optional,
  );

/** Flag de texto opcional. */
export const flagTexto = (nome: string, descricao: string) =>
  Flag.String(nome).pipe(Flag.withDescription(descricao), Flag.optional);

/** Flag booleana, falsa por padrão. */
export const flagLigada = (nome: string, descricao: string) =>
  Flag.Boolean(nome).pipe(Flag.withDescription(descricao), Flag.withDefault(false));
