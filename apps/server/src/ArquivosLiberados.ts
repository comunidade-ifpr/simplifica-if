/**
 * `ArquivosLiberados`: os arquivos que o processo principal do desktop liberou depois do diálogo de
 * escolha (`CAMINHO_LIBERAR_ARQUIVO`). A revisão prévia de PPC só lê um `.docx` liberado, e o "Anexar"
 * da pasta de trabalho só copia um arquivo liberado: um cliente do RPC não manda o servidor ler um
 * arquivo qualquer do computador.
 *
 * Sem o `tokenDesktop` (web, desenvolvimento, testes), o servidor não exige a liberação: todo arquivo
 * conta como liberado.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";

export interface OpcoesLiberacao {
  /** Só vale o arquivo liberado por `liberar` (o servidor do desktop, com o `tokenDesktop`). */
  readonly exigirLiberacao: boolean;
}

export class ArquivosLiberados extends Context.Service<
  ArquivosLiberados,
  {
    /** Libera um arquivo escolhido no diálogo do desktop. */
    readonly liberar: (arquivo: string) => Effect.Effect<void>;
    /** O arquivo foi liberado pelo desktop, ou o servidor não exige liberação. */
    readonly liberado: (arquivo: string) => Effect.Effect<boolean>;
  }
>()("@simplifica-if/server/ArquivosLiberados") {}

export const make = Effect.fn("ArquivosLiberados.make")(function* (opcoes: OpcoesLiberacao) {
  const path = yield* Path.Path;
  const liberados = yield* Ref.make<ReadonlySet<string>>(new Set());

  const liberar = Effect.fn("ArquivosLiberados.liberar")(function* (arquivo: string) {
    const normalizado = path.normalize(arquivo);
    yield* Ref.update(liberados, (atuais) => new Set([...atuais, normalizado]));
  });

  const liberado = Effect.fn("ArquivosLiberados.liberado")(function* (arquivo: string) {
    if (!opcoes.exigirLiberacao) return true;
    return (yield* Ref.get(liberados)).has(path.normalize(arquivo));
  });

  return ArquivosLiberados.of({ liberar, liberado });
});

/** Pede o `Path`. */
export const layer = (opcoes: OpcoesLiberacao) => Layer.effect(ArquivosLiberados, make(opcoes));
