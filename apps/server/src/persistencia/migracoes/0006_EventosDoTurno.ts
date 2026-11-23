/**
 * Migração 6: os eventos do turno gravados em `eventos.dados` na forma nova. O `MudancasPasta` ganha o
 * grupo `anexados` (os anexos do app, que antes iam numa nota no texto da mensagem e por isso não
 * estavam no evento): o gravado antes fica com o grupo vazio.
 *
 * A regra fica copiada neste arquivo, e não importada: a migração não pode mudar junto com o código.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const JsonDesconhecido = Schema.fromJsonString(Schema.Unknown);
const lerJson = Schema.decodeUnknownEffect(JsonDesconhecido);
const codificarJson = Schema.encodeEffect(JsonDesconhecido);

/** O evento na forma nova; o que não precisa mudar volta como está. */
function naFormaNova(evento: unknown): unknown {
  if (typeof evento !== "object" || evento === null || Array.isArray(evento)) return evento;
  const registro = evento as Record<string, unknown>;
  // `anexados` entra antes de `novos`, como o servidor passa a gravar.
  if (registro["_tag"] === "MudancasPasta" && registro["anexados"] === undefined) {
    const { _tag, ...resto } = registro;
    return { _tag, anexados: [], ...resto };
  }
  return evento;
}

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const linhas = yield* sql<{ conversa_id: string; ordem: number; dados: string }>`
    SELECT conversa_id, ordem, dados FROM eventos WHERE tipo = 'evento'
  `;
  for (const linha of linhas) {
    const novo = yield* lerJson(linha.dados).pipe(
      Effect.map(naFormaNova),
      Effect.flatMap(codificarJson),
      Effect.catch(() =>
        Effect.logWarning(`migração 6: JSON inválido em eventos ${linha.conversa_id}/${linha.ordem}`).pipe(
          Effect.as(null),
        ),
      ),
    );
    if (novo !== null && novo !== linha.dados)
      yield* sql`
        UPDATE eventos SET dados = ${novo} WHERE conversa_id = ${linha.conversa_id} AND ordem = ${linha.ordem}
      `;
  }
});
