/**
 * Migração 2: a lista viva passa a ser dona dos resultados conferidos da leitura com IA
 * (`resultados_ia`) e desacopla o ciclo de vida da revisão (`revisao_id ... ON DELETE SET NULL`).
 *
 * Também preenche `leituraIa` nos JSONs `resultado` gravados antes desta migração (em
 * `listas_pendencias` e `revisoes_ia`, derivando de `revisao_id` + `revisoes_ia.situacao` para manter
 * coerência com `resultados_ia.parcial`) e popula `resultados_ia` a partir de `blocos_ia` nas listas já
 * ligadas a uma revisão.
 *
 * Roda com `PRAGMA foreign_keys = OFF` (garantido por `Banco.ts`, com `PRAGMA foreign_key_check` dentro
 * desta transação): recriar `listas_pendencias` preserva `pendencias_vivas`, `eventos_pendencia` e `acoes_ia`.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const JsonDesconhecido = Schema.fromJsonString(Schema.Unknown);
const lerJson = Schema.decodeUnknownEffect(JsonDesconhecido);
const codificarJson = Schema.encodeEffect(JsonDesconhecido);

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE listas_pendencias_nova (
      id TEXT PRIMARY KEY,
      arquivo TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      revisao_id TEXT REFERENCES revisoes_ia (id) ON DELETE SET NULL,
      provider TEXT,
      modelo TEXT,
      cnct TEXT,
      forma TEXT,
      markdown TEXT NOT NULL,
      linhas_texto_ia TEXT NOT NULL,
      nonce TEXT NOT NULL,
      resultado TEXT NOT NULL,
      resultados_ia TEXT,
      versao INTEGER NOT NULL,
      versao_copia INTEGER,
      criada_em TEXT NOT NULL,
      atualizada_em TEXT NOT NULL
    )
  `;

  yield* sql`
    INSERT INTO listas_pendencias_nova (
      id, arquivo, sha256, revisao_id, provider, modelo, cnct, forma,
      markdown, linhas_texto_ia, nonce, resultado, resultados_ia,
      versao, versao_copia, criada_em, atualizada_em
    )
    SELECT
      id, arquivo, sha256, revisao_id, provider, modelo, cnct, forma,
      markdown, linhas_texto_ia, nonce, resultado, NULL,
      versao, versao_copia, criada_em, atualizada_em
    FROM listas_pendencias
  `;

  yield* sql`DROP TABLE listas_pendencias`;
  yield* sql`ALTER TABLE listas_pendencias_nova RENAME TO listas_pendencias`;
  yield* sql`CREATE INDEX listas_pendencias_atualizada_em ON listas_pendencias (atualizada_em DESC)`;

  // `leituraIa` nas listas antigas: derivado de `revisao_id` + `revisoes_ia.situacao` (mesma fonte de
  // `resultados_ia.parcial`); sem `revisao_id`, cai nas contagens já gravadas no resultado.
  yield* sql`
    UPDATE listas_pendencias
    SET resultado = json_set(
      resultado,
      '$.leituraIa',
      CASE
        WHEN revisao_id IS NOT NULL THEN
          CASE
            WHEN (SELECT situacao FROM revisoes_ia WHERE id = listas_pendencias.revisao_id) = 'concluida'
            THEN 'completa'
            ELSE 'parcial'
          END
        WHEN COALESCE(json_extract(resultado, '$.conferidosIa'), 0)
           + COALESCE(json_extract(resultado, '$.paraConferirIa'), 0) > 0
        THEN 'completa'
        ELSE 'nenhuma'
      END
    )
    WHERE json_valid(resultado) AND json_type(resultado, '$.leituraIa') IS NULL
  `;

  // `leituraIa` nas revisões antigas que já têm `resultado`.
  yield* sql`
    UPDATE revisoes_ia
    SET resultado = json_set(
      resultado,
      '$.leituraIa',
      CASE WHEN situacao = 'concluida' THEN 'completa' ELSE 'parcial' END
    )
    WHERE resultado IS NOT NULL AND json_valid(resultado) AND json_type(resultado, '$.leituraIa') IS NULL
  `;

  // Listas antigas ligadas a uma revisão com IA herdam os resultados dos blocos já gravados.
  const ligadas = yield* sql<{ id: string; revisao_id: string; situacao: string; plano: string | null }>`
    SELECT l.id, l.revisao_id, r.situacao, r.plano
    FROM listas_pendencias l
    JOIN revisoes_ia r ON r.id = l.revisao_id
    WHERE l.resultados_ia IS NULL
  `;
  for (const lista of ligadas) {
    const blocos = yield* sql<{ bloco_id: string; resultado: string }>`
      SELECT bloco_id, resultado FROM blocos_ia WHERE revisao_id = ${lista.revisao_id} ORDER BY bloco_id
    `;
    if (blocos.length === 0) continue;

    const plano =
      lista.plano === null
        ? null
        : ((yield* lerJson(lista.plano).pipe(
            Effect.catch(() =>
              Effect.logWarning(`migração 2: plano com JSON inválido em ${lista.revisao_id}`).pipe(Effect.as(null)),
            ),
          )) as { fora?: string[]; blocos?: Array<{ id?: string }> } | null);

    // Quando o plano tem a ordem dos blocos, respeita-a; senão fica na ordem determinística de `bloco_id`.
    const ordemPlano = new Map<string, number>();
    if (Array.isArray(plano?.blocos)) {
      plano.blocos.forEach((b, indice) => {
        if (typeof b?.id === "string") ordemPlano.set(b.id, indice);
      });
    }
    const ordenados = [...blocos].sort((a, b) => {
      const oa = ordemPlano.get(a.bloco_id);
      const ob = ordemPlano.get(b.bloco_id);
      if (oa !== undefined && ob !== undefined) return oa - ob;
      if (oa !== undefined) return -1;
      if (ob !== undefined) return 1;
      return a.bloco_id.localeCompare(b.bloco_id);
    });

    const resultados: unknown[] = [];
    for (const bloco of ordenados) {
      const parsed = (yield* lerJson(bloco.resultado).pipe(
        Effect.catch(() =>
          Effect.logWarning(`migração 2: bloco ${bloco.bloco_id} com JSON inválido em ${lista.revisao_id}`).pipe(
            Effect.as(null),
          ),
        ),
      )) as { resultados?: unknown[] } | null;
      if (Array.isArray(parsed?.resultados)) resultados.push(...parsed.resultados);
    }
    const fora = Array.isArray(plano?.fora) ? plano.fora : [];
    const resultadosIa = yield* codificarJson({
      resultados,
      fora,
      parcial: lista.situacao !== "concluida",
    }).pipe(Effect.orDie);
    yield* sql`UPDATE listas_pendencias SET resultados_ia = ${resultadosIa} WHERE id = ${lista.id}`;
  }
});
