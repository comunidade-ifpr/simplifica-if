/**
 * Migração 5: a revisão de PPC sem cópias do que já está em outro lugar.
 *
 * - A estimativa de `revisoes_ia` troca `nomeJanela` ("uma janela de 5 horas do plano Pro") pela frase
 *   que a tela mostra, `limiteDoPlano` ("do limite de 5 horas do plano Pro"). A regra que a interface
 *   aplicava ao texto fica copiada aqui, e não importada: a migração não pode mudar junto com o código.
 * - A leitura com IA nasce da lista viva: `revisoes_ia.lista_id` (`ON DELETE SET NULL`: a leitura da lista
 *   que saiu fica órfã) no lugar do curso (`cnct`, `forma`), que a lista guarda. A lista de cada leitura
 *   gravada é a que a liga (`revisao_id`) ou, para a preparada, a que o servidor achava pelo arquivo, pelo
 *   conteúdo e pelo curso; sem nenhuma, fica nula.
 * - O `resultado` de `listas_pendencias` e de `revisoes_ia` deixa de guardar as pendências: a lista viva
 *   (`pendencias_vivas`) é a única cópia delas.
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

  yield* sql`ALTER TABLE revisoes_ia ADD COLUMN lista_id TEXT REFERENCES listas_pendencias (id) ON DELETE SET NULL`;
  yield* sql`
    UPDATE revisoes_ia SET lista_id = COALESCE(
      (SELECT l.id FROM listas_pendencias l WHERE l.revisao_id = revisoes_ia.id ORDER BY l.atualizada_em DESC LIMIT 1),
      (SELECT l.id FROM listas_pendencias l
        WHERE l.arquivo = revisoes_ia.arquivo AND l.sha256 = revisoes_ia.sha256
          AND l.cnct IS revisoes_ia.cnct AND l.forma IS revisoes_ia.forma
        ORDER BY l.atualizada_em DESC LIMIT 1)
    )
  `;
  yield* sql`CREATE INDEX revisoes_ia_lista ON revisoes_ia (lista_id)`;
  yield* sql`ALTER TABLE revisoes_ia DROP COLUMN cnct`;
  yield* sql`ALTER TABLE revisoes_ia DROP COLUMN forma`;

  yield* sql`
    UPDATE listas_pendencias SET resultado = json_remove(resultado, '$.pendencias')
    WHERE json_valid(resultado) AND json_type(resultado, '$.pendencias') IS NOT NULL
  `;
  yield* sql`
    UPDATE revisoes_ia SET resultado = json_remove(resultado, '$.pendencias')
    WHERE resultado IS NOT NULL AND json_valid(resultado) AND json_type(resultado, '$.pendencias') IS NOT NULL
  `;

  const revisoes = yield* sql<{ id: string; estimativa: string }>`SELECT id, estimativa FROM revisoes_ia`;
  for (const revisao of revisoes) {
    const nova = yield* converter(revisao.estimativa, estimativaNova, `revisoes_ia ${revisao.id}`);
    if (nova !== null && nova !== revisao.estimativa)
      yield* sql`UPDATE revisoes_ia SET estimativa = ${nova} WHERE id = ${revisao.id}`;
  }
});
