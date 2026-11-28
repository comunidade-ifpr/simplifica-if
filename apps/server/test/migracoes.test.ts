// @effect-diagnostics nodeBuiltinImport:off -- teste: arquivo temporário para layerArquivo
/**
 * Migrações do `conversas.sqlite`: schema inicial, idempotência, o histórico divergente, o upgrade de um banco das versões 1 a 6,
 * `foreign_keys` ligado e criação do arquivo.
 */
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@simplifica-if/kb/db/nodeSqliteClient";
import * as Banco from "../src/persistencia/Banco.ts";
import * as Historico from "../src/persistencia/Historico.ts";
import { diretorioTemporario, limparTemporarios } from "./apoio.ts";

afterAll(limparTemporarios);

const pasta = diretorioTemporario("simplifica-migracoes-");
const ULTIMA = Banco.MIGRACOES.at(-1)![0];
const ehHistoricoDivergente = Schema.is(Banco.HistoricoDivergente);
const emMemoria = NodeSqliteClient.layer({ filename: ":memory:" });

/** As migrações até `ate`, para montar o banco de uma versão anterior. */
const migracoesAte = (ate: number) =>
  Migrator.fromRecord(
    Object.fromEntries(
      Banco.MIGRACOES.filter(([id]) => id <= ate).map(([id, nome, efeito]) => [`${id}_${nome}`, efeito]),
    ),
  );

describe("migrações do banco das conversas", () => {
  it.effect("aplica o schema inicial e é idempotente", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const aplicadas = yield* Banco.rodarMigracoes();
      assert.deepStrictEqual(
        aplicadas,
        Banco.MIGRACOES.map(([id, nome]) => [id, nome]),
      );
      assert.deepStrictEqual(yield* Banco.rodarMigracoes(), []);

      const tabelas = new Set(
        (yield* sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'table'`).map((t) => t.name),
      );
      for (const nome of [
        "conversas",
        "eventos",
        "avaliacoes",
        "anexos_pasta",
        "relatos",
        "apagamentos_pendentes",
        "preferencias",
      ]) {
        assert.isTrue(tabelas.has(nome), `tabela ausente: ${nome}`);
      }
    }).pipe(Effect.provide(emMemoria)),
  );

  it.effect("migração 2: o banco da versão 1 ganha `problemas` nas tentativas sem perder o que tinha", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* Migrator.make({})({ loader: migracoesAte(1) });
      yield* sql`
        INSERT INTO revisao_ppc_revisoes_ia (id, arquivo, sha256, provider, modelo, modo, situacao, plano,
          estimativa, criada_em, atualizada_em)
        VALUES ('r', 'PPC.docx', 'abc', 'claude', 'claude-sonnet-5-5', 'completo', 'concluida', '{}', '{}',
          '2026-11-26T14:55:15Z', '2026-11-26T14:59:18Z')
      `;
      yield* sql`
        INSERT INTO revisao_ppc_tentativas_ia (revisao_id, bloco_id, numero, uso, segundos, ferramentas, criada_em)
        VALUES ('r', 'j-02', 1, '{"entrada":15542}', 12.7, '[]', '2026-11-26T14:55:50Z')
      `;

      assert.deepStrictEqual(yield* Banco.rodarMigracoes(), [
        [2, "ProblemasDasTentativas"],
        [3, "ArquivoAcompanhado"],
        [4, "ConversaAoLado"],
        [5, "AtividadesEContinuacao"],
        [6, "VocabularioRevisaoPpc"],
        [7, "ConversasDaRevisao"],
        [8, "ContinuacoesDasConversasDaRevisao"],
      ]);
      const linhas = yield* sql<{ bloco_id: string; uso: string; problemas: string | null }>`
        SELECT bloco_id, uso, problemas FROM revisao_ppc_tentativas_ia
      `;
      assert.deepStrictEqual(linhas, [{ bloco_id: "tematico-02", uso: '{"entrada":15542}', problemas: null }]);
      assert.strictEqual((yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM revisao_ppc_revisoes_ia`)[0]?.n, 1);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect(
    "migração 3: a lista do banco da versão 2 ganha o arquivo acompanhado, nulo e sem conferência, sem perder o que tinha",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* Migrator.make({})({ loader: migracoesAte(2) });
        yield* sql`
        INSERT INTO revisao_ppc_listas_pendencias (id, arquivo, sha256, markdown, linhas_texto_ia, resultado, versao,
          versao_copia, criada_em, atualizada_em)
        VALUES ('l', '/docs/PPC.docx', 'abc', '# PPC', '[]', '{}', 3, 3, '2026-11-26T14:55:15Z', '2026-11-26T14:59:18Z')
      `;
        assert.deepStrictEqual(yield* Banco.rodarMigracoes(), [
          [3, "ArquivoAcompanhado"],
          [4, "ConversaAoLado"],
          [5, "AtividadesEContinuacao"],
          [6, "VocabularioRevisaoPpc"],
          [7, "ConversasDaRevisao"],
          [8, "ContinuacoesDasConversasDaRevisao"],
        ]);
        const linhas = yield* sql<{
          arquivo: string;
          versao: number;
          arquivo_acompanhado: string | null;
          sha256_conferido: string | null;
          codigo_conferido: number;
        }>`SELECT arquivo, versao, arquivo_acompanhado, sha256_conferido, codigo_conferido FROM revisao_ppc_listas_pendencias`;
        assert.deepStrictEqual(linhas, [
          {
            arquivo: "/docs/PPC.docx",
            versao: 3,
            arquivo_acompanhado: null,
            sha256_conferido: null,
            codigo_conferido: 0,
          },
        ]);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect(
    "migração 4: a conversa e a lista do banco da versão 3 ganham a origem e a conversa ao lado, nulas, e a mensagem gravada continua lida",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* Migrator.make({})({ loader: migracoesAte(3) });
        yield* sql`
          INSERT INTO conversas (id, provider, pasta_trabalho, titulo, estado, criada_em, atualizada_em)
          VALUES ('c', 'claude', '/docs/Tarefa', 'Oi', 'liberada', '2026-11-26T14:55:15Z', '2026-11-26T14:59:18Z')
        `;
        yield* sql`
          INSERT INTO eventos (conversa_id, ordem, turno, tipo, dados, criado_em)
          VALUES ('c', 1, 1, 'mensagem', '{"texto":"Oi"}', '2026-11-26T14:55:15Z')
        `;
        yield* sql`
          INSERT INTO revisao_ppc_listas_pendencias (id, arquivo, sha256, markdown, linhas_texto_ia, resultado, versao,
            versao_copia, criada_em, atualizada_em)
          VALUES ('l', '/docs/PPC.docx', 'abc', '# PPC', '[]', '{}', 3, 3, '2026-11-26T14:55:15Z', '2026-11-26T14:59:18Z')
        `;
        assert.deepStrictEqual(yield* Migrator.make({})({ loader: migracoesAte(6) }), [
          [4, "ConversaAoLado"],
          [5, "AtividadesEContinuacao"],
          [6, "VocabularioRevisaoPpc"],
        ]);
        const conversas = yield* sql<{ titulo: string; origem_rotulo: string | null; origem_rota: string | null }>`
          SELECT titulo, origem_rotulo, origem_rota FROM conversas
        `;
        assert.deepStrictEqual(conversas, [{ titulo: "Oi", origem_rotulo: null, origem_rota: null }]);
        const listas = yield* sql<{
          versao: number;
          conversa_id: string | null;
          conversa_pasta: string | null;
          markdown_conferido: string | null;
        }>`SELECT versao, conversa_id, conversa_pasta, markdown_conferido FROM revisao_ppc_listas_pendencias`;
        assert.deepStrictEqual(listas, [
          { versao: 3, conversa_id: null, conversa_pasta: null, markdown_conferido: null },
        ]);
        // A mensagem de antes das fichas é lida como sempre, sem fichas.
        const itens = yield* Effect.gen(function* () {
          const historico = yield* Historico.Historico;
          return yield* historico.itens("c");
        }).pipe(Effect.provide(Historico.layer));
        assert.deepStrictEqual(itens, [{ _tag: "Mensagem", turno: 1, ordem: 1, texto: "Oi" }]);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect(
    "migração 5: a conversa da versão 4 conta como vista (não vira resposta pronta), sem continuação, e blocos e pendências sem IA",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* Migrator.make({})({ loader: migracoesAte(4) });
        yield* sql`
          INSERT INTO conversas (id, provider, pasta_trabalho, titulo, estado, criada_em, atualizada_em)
          VALUES ('c', 'claude', '/docs/Tarefa', 'Oi', 'liberada', '2026-11-26T14:55:15Z', '2026-11-26T14:59:18Z')
        `;
        yield* sql`
          INSERT INTO eventos (conversa_id, ordem, turno, tipo, dados, criado_em) VALUES
            ('c', 1, 1, 'mensagem', '{"texto":"Oi"}', '2026-11-26T14:55:15Z'),
            ('c', 2, 1, 'evento', '{"_tag":"FimTurno","motivo":"concluido"}', '2026-11-26T14:59:18Z')
        `;
        yield* sql`
          INSERT INTO revisao_ppc_revisoes_ia (id, arquivo, sha256, provider, modelo, modo, situacao, plano,
            estimativa, criada_em, atualizada_em)
          VALUES ('r', 'PPC.docx', 'abc', 'claude', null, 'completo', 'pausada', '{}', '{}',
            '2026-11-26T14:55:15Z', '2026-11-26T14:59:18Z')
        `;
        yield* sql`
          INSERT INTO revisao_ppc_blocos_ia (revisao_id, bloco_id, resultado, uso, segundos, criado_em)
          VALUES ('r', 'j-02', '{}', '{}', 3, '2026-11-26T14:55:50Z')
        `;
        yield* sql`
          INSERT INTO revisao_ppc_listas_pendencias (id, arquivo, sha256, markdown, linhas_texto_ia, resultado, versao,
            versao_copia, criada_em, atualizada_em)
          VALUES ('l', '/docs/PPC.docx', 'abc', '# PPC', '[]', '{}', 3, 3, '2026-11-26T14:55:15Z', '2026-11-26T14:59:18Z')
        `;
        yield* sql`
          INSERT INTO revisao_ppc_pendencias_vivas (lista_id, chave, ordem, pendencia, situacao)
          VALUES ('l', 'k', 0, '{}', 'aberta')
        `;
        assert.deepStrictEqual(yield* Banco.rodarMigracoes(), [
          [5, "AtividadesEContinuacao"],
          [6, "VocabularioRevisaoPpc"],
          [7, "ConversasDaRevisao"],
          [8, "ContinuacoesDasConversasDaRevisao"],
        ]);
        const conversas = yield* sql<{ vista_em: string | null; continua_de: string | null }>`
          SELECT vista_em, continua_de FROM conversas
        `;
        assert.deepStrictEqual(conversas, [{ vista_em: "2026-11-26T14:59:18Z", continua_de: null }]);
        // A lista acha a continuação pelo índice, sem varrer as conversas a cada uma.
        const plano = yield* sql<{ detail: string }>`
          EXPLAIN QUERY PLAN SELECT id FROM conversas WHERE continua_de = 'c'
        `;
        assert.isTrue(plano.some((passo) => passo.detail.includes("conversas_continua_de")));
        const { naoVistas, registro } = yield* Effect.gen(function* () {
          const historico = yield* Historico.Historico;
          return { naoVistas: yield* historico.naoVistas, registro: yield* historico.buscar("c") };
        }).pipe(Effect.provide(Historico.layer));
        assert.deepStrictEqual(naoVistas, []);
        assert.isTrue(registro._tag === "Some" && registro.value.continuadaCom === undefined);
        assert.deepStrictEqual(yield* sql`SELECT provider FROM revisao_ppc_blocos_ia`, [{ provider: null }]);
        assert.deepStrictEqual(yield* sql`SELECT ia FROM revisao_ppc_pendencias_vivas`, [{ ia: null }]);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("migração 6: reescreve blocos (S/J/T) e estados (ATENDE/…) gravados para o vocabulário unificado", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* Migrator.make({})({ loader: migracoesAte(5) });
      const planoAntigo = JSON.stringify({
        blocos: [
          { id: "s-01-1", tipo: "S", tema: "Identificação", ordemTema: 1, fichas: ["CT-IDENT-02"] },
          { id: "j-02", tipo: "J", tema: "Matriz", ordemTema: 2, fichas: ["CT-CURR-12"] },
          { id: "t", tipo: "T", tema: "Transversais", ordemTema: 9, fichas: ["CT-TRANS-01"] },
        ],
        fichas: [
          {
            id: "CT-IDENT-02",
            modo: "S",
            tipo_escopo: "tematico",
            criticidade: "BLOQ",
            estados_permitidos: ["ATENDE", "NAO_ATENDE", "INCONCLUSIVO", "NAO_APLICAVEL"],
          },
          {
            id: "CT-TRANS-01",
            modo: "J",
            tipo_escopo: "transversal",
            criticidade: "OBRIG",
            estados_permitidos: ["ATENDE"],
          },
        ],
      });
      yield* sql`
          INSERT INTO revisao_ppc_revisoes_ia (id, arquivo, sha256, provider, modelo, modo, situacao, plano,
            estimativa, criada_em, atualizada_em)
          VALUES ('r6', 'PPC.docx', 'abc', 'claude', null, 'rapido', 'pausada', ${planoAntigo}, '{}',
            '2026-11-26T14:55:15Z', '2026-11-26T14:59:18Z')
        `;
      yield* sql`
          INSERT INTO revisao_ppc_blocos_ia (revisao_id, bloco_id, resultado, uso, segundos, criado_em, provider)
          VALUES ('r6', 's-01-1', '{"resultados":[{"ficha":"CT-IDENT-02","estado":"NAO_ATENDE"},{"ficha":"CT-CURR-12","estado":"INCONCLUSIVO"}]}', '{}', 2, '2026-11-26T14:55:50Z', 'claude')
        `;
      yield* sql`
          INSERT INTO revisao_ppc_tentativas_ia (revisao_id, bloco_id, numero, uso, segundos, ferramentas, criada_em)
          VALUES ('r6', 't', 1, '{}', 1, '[]', '2026-11-26T14:55:50Z')
        `;
      yield* sql`
          INSERT INTO revisao_ppc_listas_pendencias (id, arquivo, sha256, markdown, linhas_texto_ia, resultado,
            resultados_ia, versao, versao_copia, criada_em, atualizada_em)
          VALUES ('l6', '/docs/PPC.docx', 'abc', '# PPC', '[]', '{}',
            '{"resultados":[{"ficha":"CT-IDENT-02","estado":"ATENDE"},{"ficha":"CT-CURR-12","estado":"NAO_APLICAVEL"}],"fora":[]}',
            1, 1, '2026-11-26T14:55:15Z', '2026-11-26T14:59:18Z')
        `;

      assert.deepStrictEqual(yield* Banco.rodarMigracoes(), [
        [6, "VocabularioRevisaoPpc"],
        [7, "ConversasDaRevisao"],
        [8, "ContinuacoesDasConversasDaRevisao"],
      ]);

      const [rev] = yield* sql<{ plano: string }>`SELECT plano FROM revisao_ppc_revisoes_ia WHERE id = 'r6'`;
      const plano = JSON.parse(rev!.plano) as {
        blocos: Array<{ id: string; tipo: string }>;
        fichas: Array<{
          id: string;
          modo: string;
          criticidade: string;
          estados_permitidos: string[];
          tipo_escopo?: unknown;
        }>;
      };
      assert.deepStrictEqual(
        plano.blocos.map((b) => [b.id, b.tipo]),
        [
          ["focal-01-1", "focal"],
          ["tematico-02", "tematico"],
          ["transversal", "transversal"],
        ],
      );
      assert.strictEqual(plano.fichas[0]!.modo, "focal");
      assert.strictEqual(plano.fichas[0]!.criticidade, "bloqueante");
      assert.deepStrictEqual(plano.fichas[0]!.estados_permitidos, [
        "atende",
        "nao_atende",
        "a_conferir",
        "nao_se_aplica",
      ]);
      assert.isUndefined(plano.fichas[0]!.tipo_escopo);
      assert.strictEqual(plano.fichas[1]!.modo, "transversal");
      assert.strictEqual(plano.fichas[1]!.criticidade, "obrigatorio");

      const [bloco] = yield* sql<{ bloco_id: string; resultado: string }>`
          SELECT bloco_id, resultado FROM revisao_ppc_blocos_ia WHERE revisao_id = 'r6'
        `;
      assert.strictEqual(bloco!.bloco_id, "focal-01-1");
      assert.deepStrictEqual(
        (JSON.parse(bloco!.resultado) as { resultados: Array<{ estado: string }> }).resultados.map((r) => r.estado),
        ["nao_atende", "a_conferir"],
      );

      const [tent] = yield* sql<{ bloco_id: string }>`
          SELECT bloco_id FROM revisao_ppc_tentativas_ia WHERE revisao_id = 'r6'
        `;
      assert.strictEqual(tent!.bloco_id, "transversal");

      const [lista] = yield* sql<{ resultados_ia: string }>`
          SELECT resultados_ia FROM revisao_ppc_listas_pendencias WHERE id = 'l6'
        `;
      assert.deepStrictEqual(
        (JSON.parse(lista!.resultados_ia) as { resultados: Array<{ estado: string }> }).resultados.map((r) => r.estado),
        ["atende", "nao_se_aplica"],
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect(
    "migrações 7 e 8: a conversa ao lado que a lista da versão 6 guardava passa a ser a conversa geral dela (a última da cadeia de continuações), e as colunas saem da lista",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* Migrator.make({})({ loader: migracoesAte(6) });
        yield* sql`
          INSERT INTO revisao_ppc_listas_pendencias (id, arquivo, sha256, markdown, linhas_texto_ia, resultado, versao,
            versao_copia, criada_em, atualizada_em, conversa_id, conversa_pasta)
          VALUES
            ('l', '/docs/PPC.docx', 'abc', '# PPC', '[]', '{}', 3, 3, '2026-11-26T14:55:15Z', '2026-11-26T14:59:18Z',
              'c', '/docs/PPC Enfermagem – conversa'),
            ('m', '/docs/Outro.docx', 'def', '# PPC', '[]', '{}', 1, 1, '2026-11-26T14:55:15Z', '2026-11-26T14:59:18Z',
              NULL, NULL)
        `;
        // A conversa da lista já continuou com outra IA (`c2`, na mesma pasta): a linha vai à continuação.
        yield* sql`
          INSERT INTO conversas (id, provider, pasta_trabalho, estado, criada_em, atualizada_em, continua_de)
          VALUES
            ('c', 'claude', '/docs/PPC Enfermagem – conversa', 'liberada', '2026-11-26T14:59:18Z', '2026-11-26T14:59:18Z', NULL),
            ('c2', 'codex', '/docs/PPC Enfermagem – conversa', 'liberada', '2026-11-26T15:10:00Z', '2026-11-26T15:10:00Z', 'c')
        `;
        assert.deepStrictEqual(yield* Banco.rodarMigracoes(), [
          [7, "ConversasDaRevisao"],
          [8, "ContinuacoesDasConversasDaRevisao"],
        ]);
        assert.deepStrictEqual(
          yield* sql`SELECT conversa_id, lista_id, pasta, pendencia, criada_em FROM revisao_ppc_conversas`,
          [
            {
              conversa_id: "c2",
              lista_id: "l",
              pasta: "/docs/PPC Enfermagem – conversa",
              pendencia: null,
              criada_em: "2026-11-26T14:59:18Z",
            },
          ],
        );
        const colunas = (yield* sql<{ name: string }>`PRAGMA table_info(revisao_ppc_listas_pendencias)`).map(
          (c) => c.name,
        );
        assert.notInclude(colunas, "conversa_id");
        assert.notInclude(colunas, "conversa_pasta");
        assert.include(colunas, "markdown_conferido");
        yield* sql`PRAGMA foreign_keys = ON`;
        const ligada = () =>
          sql<{ conversa_id: string }>`SELECT conversa_id FROM revisao_ppc_conversas`.pipe(
            Effect.map((linhas) => linhas.map((l) => l.conversa_id)),
          );
        // Daí em diante, a continuação criada toma a linha (onde quer que se continue)…
        yield* sql`
          INSERT INTO conversas (id, provider, pasta_trabalho, estado, criada_em, atualizada_em, continua_de)
          VALUES ('c3', 'claude', '/docs/PPC Enfermagem – conversa', 'liberada', '2026-11-26T15:20:00Z', '2026-11-26T15:20:00Z', 'c2')
        `;
        assert.deepStrictEqual(yield* ligada(), ["c3"]);
        // …apagar a original não a deixa órfã…
        yield* sql`DELETE FROM conversas WHERE id = 'c'`;
        assert.deepStrictEqual(yield* ligada(), ["c3"]);
        // …e a continuação apagada (a que não abriu, ou a que a pessoa apagou) devolve a linha à anterior.
        yield* sql`DELETE FROM conversas WHERE id = 'c3'`;
        assert.deepStrictEqual(yield* ligada(), ["c2"]);
        // A lista apagada leva as linhas das conversas dela (as conversas e as pastas ficam).
        yield* sql`DELETE FROM revisao_ppc_listas_pendencias WHERE id = 'l'`;
        assert.deepStrictEqual(yield* sql`SELECT conversa_id FROM revisao_ppc_conversas`, []);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("recusa o histórico com uma migração de outro nome, sem aplicar a deste código", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* Migrator.make({})({ loader: migracoesAte(ULTIMA - 1) });
      // A migração de mesmo número que outro ramo aplicou no banco de desenvolvimento.
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${ULTIMA}, 'DeOutroRamo')`;
      const erro = yield* Effect.flip(Banco.rodarMigracoes());
      if (!ehHistoricoDivergente(erro)) return assert.fail(`outro erro: ${erro.message}`);
      assert.deepStrictEqual(erro.divergentes, [
        { id: ULTIMA, noBanco: "DeOutroRamo", noCodigo: Banco.MIGRACOES.at(-1)![1] },
      ]);
      assert.include(erro.message, `a ${ULTIMA} é "DeOutroRamo" no banco`);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("recusa o banco migrado por uma versão mais nova", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* Banco.rodarMigracoes();
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${ULTIMA + 1}, 'DoFuturo')`;
      const erro = yield* Effect.flip(Banco.rodarMigracoes());
      if (!ehHistoricoDivergente(erro)) return assert.fail(`outro erro: ${erro.message}`);
      assert.deepStrictEqual(erro.divergentes, [{ id: ULTIMA + 1, noBanco: "DoFuturo", noCodigo: null }]);
      assert.include(erro.message, "não existe neste app");
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("layerMemoria liga foreign_keys e aplica o schema", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const fk = yield* sql<{ foreign_keys: number }>`PRAGMA foreign_keys;`;
      assert.strictEqual(fk[0]?.foreign_keys, 1);
      const rows = yield* sql<{ id: number }>`SELECT MAX(migration_id) AS id FROM effect_sql_migrations`;
      assert.strictEqual(rows[0]?.id, ULTIMA);
    }).pipe(Effect.provide(Banco.layerMemoria)),
  );

  it.live("layerArquivo cria a pasta e aplica o schema no arquivo", () =>
    Effect.gen(function* () {
      const arquivo = NodePath.join(pasta, "sub", "conversas.sqlite");
      const versao = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const rows = yield* sql<{ id: number }>`SELECT MAX(migration_id) AS id FROM effect_sql_migrations`;
        return rows[0]?.id;
      }).pipe(Effect.provide(Banco.layerArquivo(arquivo).pipe(Layer.provide(NodeServices.layer))));
      assert.strictEqual(versao, ULTIMA);
    }),
  );
});
