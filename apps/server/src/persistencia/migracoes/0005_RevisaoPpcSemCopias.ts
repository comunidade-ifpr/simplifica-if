/**
 * Migração 5: a revisão de PPC sem cópias do que já está em outro lugar.
 *
 * - A estimativa de `revisoes_ia` troca `nomeJanela` ("uma janela de 5 horas do plano Pro") pela frase
 *   que a tela mostra, `limiteDoPlano` ("do limite de 5 horas do plano Pro"). A regra que a interface
 *   aplicava ao texto fica copiada aqui, e não importada: a migração não pode mudar junto com o código.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const JsonDesconhecido = Schema.fromJsonString(Schema.Unknown);
const lerJson = Schema.decodeUnknownEffect(JsonDesconhecido);
const codificarJson = Schema.encodeEffect(JsonDesconhecido);

/** "uma janela de 5 horas do plano Pro" → "do limite de 5 horas do plano Pro". */
function limiteDoPlano(nomeJanela: string): string {
  const plano = / do plano .+$/.exec(nomeJanela)?.[0] ?? "";
  const horas = /janela de (\d+) horas?/.exec(nomeJanela);
  if (horas !== null) return `do limite de ${horas[1]} horas${plano}`;
  if (/cota diária/.test(nomeJanela)) return `da cota diária${plano}`;
  return `de ${nomeJanela}`;
}

function estimativaNova(estimativa: unknown): unknown {
  if (typeof estimativa !== "object" || estimativa === null || Array.isArray(estimativa)) return estimativa;
  const { nomeJanela, ...resto } = estimativa as Record<string, unknown>;
  return typeof nomeJanela === "string" ? { ...resto, limiteDoPlano: limiteDoPlano(nomeJanela) } : estimativa;
}

/** Lê o JSON, aplica a mudança e devolve o texto novo; `null` se o JSON gravado não se lê. */
const converter = (texto: string, mudar: (valor: unknown) => unknown, onde: string) =>
  lerJson(texto).pipe(
    Effect.map(mudar),
    Effect.flatMap(codificarJson),
    Effect.catch(() => Effect.logWarning(`migração 5: JSON inválido em ${onde}`).pipe(Effect.as(null))),
  );

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const revisoes = yield* sql<{ id: string; estimativa: string }>`SELECT id, estimativa FROM revisoes_ia`;
  for (const revisao of revisoes) {
    const nova = yield* converter(revisao.estimativa, estimativaNova, `revisoes_ia ${revisao.id}`);
    if (nova !== null && nova !== revisao.estimativa)
      yield* sql`UPDATE revisoes_ia SET estimativa = ${nova} WHERE id = ${revisao.id}`;
  }
});
