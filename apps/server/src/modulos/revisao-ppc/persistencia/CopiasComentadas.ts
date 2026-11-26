/**
 * As cópias comentadas que o app gravou (a revisão de PPC), no banco das conversas: o sha256 da última
 * gravada em cada caminho. Antes de regravar uma cópia, o `RevisorPpc` confere o arquivo no disco contra
 * este registro: com outro conteúdo, a pessoa a editou (ou o arquivo não é do app), e ela não é
 * sobrescrita. Uma falha do banco é defeito, como nas `Listas`.
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

export class CopiasComentadas extends Context.Service<
  CopiasComentadas,
  {
    /** O sha256 da última cópia que o app gravou neste caminho, ou nulo. */
    readonly conhecida: (caminho: string) => Effect.Effect<string | null>;
    readonly registrar: (caminho: string, sha256: string) => Effect.Effect<void>;
  }
>()("@simplifica-if/server/modulos/revisao-ppc/persistencia/CopiasComentadas") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const conhecida = Effect.fn("CopiasComentadas.conhecida")(function* (caminho: string) {
    const linhas = yield* sql<{
      sha256: string;
    }>`SELECT sha256 FROM revisao_ppc_copias_comentadas WHERE caminho = ${caminho}`;
    return linhas[0]?.sha256 ?? null;
  }, Effect.orDie);

  const registrar = Effect.fn("CopiasComentadas.registrar")(function* (caminho: string, sha256: string) {
    const data = DateTime.formatIso(yield* DateTime.now);
    yield* sql`
      INSERT INTO revisao_ppc_copias_comentadas (caminho, sha256, gravada_em) VALUES (${caminho}, ${sha256}, ${data})
      ON CONFLICT (caminho) DO UPDATE SET sha256 = excluded.sha256, gravada_em = excluded.gravada_em
    `;
  }, Effect.orDie);

  return CopiasComentadas.of({ conhecida, registrar });
});

/** Pede o `SqlClient` do banco das conversas. */
export const layer = Layer.effect(CopiasComentadas, make);
