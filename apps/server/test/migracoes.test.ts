// @effect-diagnostics nodeBuiltinImport:off -- teste: arquivo temporário para o backup antes da migração
/**
 * Upgrades de schema do `conversas.sqlite`: cada migração nova preserva dados anteriores, mantém a
 * integridade referencial dentro da própria transação (`PRAGMA foreign_key_check`), valida o histórico
 * contra downgrade/incompatibilidade e, em banco em arquivo, grava `.v<id>.bak` antes de migrar.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@simplifica-if/kb/db/nodeSqliteClient";
import * as Banco from "../src/persistencia/Banco.ts";
import * as Listas from "../src/persistencia/Listas.ts";
import * as Revisoes from "../src/persistencia/Revisoes.ts";
import { diretorioTemporario, limparTemporarios } from "./apoio.ts";

afterAll(limparTemporarios);

const pasta = diretorioTemporario("simplifica-migracoes-");

/** Resultado no formato da migração 1 (sem `leituraIa`). */
const resultadoV1 = (idLista: string, comIa: boolean) =>
  JSON.stringify({
    arquivoOriginal: "/tmp/PPC.docx",
    arquivoComentado: "/tmp/PPC - revisão prévia (Simplifica IF).docx",
    curso: {
      cnct: { slug: "tecnico-em-informatica", denominacao: "Técnico em Informática" },
      forma: "integrado",
      origem: "documento",
    },
    pendencias: [],
    criterios: [],
    conferidos: 12,
    conferidosIa: comIa ? 5 : 0,
    paraConferirIa: 0,
    foraDaRevisao: [],
    totalCriterios: 84,
    dataBase: "2026-11-20",
    lista: idLista,
  });

const pendenciaJson = JSON.stringify({
  ficha: "CT-IDENT-01",
  tituloFicha: "Denominação do curso",
  tema: "Identificação e oferta",
  ordemTema: 1,
  estado: "a_conferir",
  mensagem: "Confira a denominação.",
  oQueFazer: "Ajuste o nome.",
  trecho: "Curso Técnico",
  secao: "1. Identificação",
  fontes: [],
  tambemEm: [],
  noDocumento: "no-trecho",
  origem: "codigo",
  dependeDoCurso: false,
});

const estimativaJson = JSON.stringify({
  provider: "claude",
  blocos: 1,
  fichas: 1,
  tokensEntrada: 1000,
  tokensSaida: 200,
  minutos: 1,
  custoUsd: 0.01,
  percentualJanela: 1,
  nomeJanela: "janela de 5 horas do plano Pro",
});

const usoJson = JSON.stringify({ entrada: 100, saida: 50, cacheLeitura: 0, cacheEscrita: 0, custoUsd: 0.001 });

/** Popula um banco na migração 1 com revisões (concluída, pausada com 1 bloco, pausada sem blocos) e listas. */
const popularV1 = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO revisoes_ia (id, arquivo, sha256, provider, modelo, modo, cnct, forma, situacao, plano, estimativa, resultado, criada_em, atualizada_em)
    VALUES
      ('rev-1', '/tmp/PPC.docx', 'hash-1', 'claude', 'claude-sonnet', 'rapido', 'tecnico-em-informatica', 'integrado',
        'concluida', ${JSON.stringify({ fora: ["CT-EXT-01"], blocos: [{ id: "s-01-1" }] })}, ${estimativaJson}, ${resultadoV1("lista-ia", true)},
        '2026-11-20T10:00:00Z', '2026-11-20T10:05:00Z'),
      ('rev-pausada', '/tmp/Pausado.docx', 'hash-3', 'claude', 'claude-sonnet', 'completo', 'tecnico-em-informatica', 'integrado',
        'pausada', ${JSON.stringify({ fora: [], blocos: [{ id: "s-02-1" }, { id: "s-01-1" }] })}, ${estimativaJson}, NULL,
        '2026-11-20T11:00:00Z', '2026-11-20T11:02:00Z'),
      ('rev-vazia', '/tmp/Vazio.docx', 'hash-4', 'claude', 'claude-sonnet', 'rapido', NULL, NULL,
        'pausada', '{}', ${estimativaJson}, NULL,
        '2026-11-20T11:10:00Z', '2026-11-20T11:10:00Z')
  `;
  yield* sql`
    INSERT INTO blocos_ia (revisao_id, bloco_id, resultado, uso, segundos, criado_em)
    VALUES
      ('rev-1', 's-01-1', ${JSON.stringify({
        resultados: [
          {
            ficha: "CT-IDENT-02",
            estado: "ATENDE",
            confianca: 0.9,
            justificativa: "Atende.",
            lacunas: [],
            oQueFazer: "",
            trechos: [],
            fontes: [],
            revisaoHumana: false,
          },
        ],
        resumo: null,
        tentativas: 1,
      })}, ${usoJson}, 12.5, '2026-11-20T10:04:00Z'),
      ('rev-pausada', 's-01-1', ${JSON.stringify({
        resultados: [
          {
            ficha: "CT-IDENT-02",
            estado: "ATENDE",
            confianca: 0.8,
            justificativa: "Bloco 1.",
            lacunas: [],
            oQueFazer: "",
            trechos: [],
            fontes: [],
            revisaoHumana: false,
          },
        ],
        resumo: null,
        tentativas: 1,
      })}, ${usoJson}, 10, '2026-11-20T11:01:00Z'),
      ('rev-pausada', 's-02-1', ${JSON.stringify({
        resultados: [
          {
            ficha: "CT-IDENT-03",
            estado: "ATENDE",
            confianca: 0.8,
            justificativa: "Bloco 2 (primeiro no plano).",
            lacunas: [],
            oQueFazer: "",
            trechos: [],
            fontes: [],
            revisaoHumana: false,
          },
        ],
        resumo: null,
        tentativas: 1,
      })}, ${usoJson}, 9, '2026-11-20T11:01:30Z')
  `;
  yield* sql`
    INSERT INTO listas_pendencias (id, arquivo, sha256, revisao_id, provider, modelo, cnct, forma, markdown,
      linhas_texto_ia, nonce, resultado, versao, versao_copia, criada_em, atualizada_em)
    VALUES
      ('lista-ia', '/tmp/PPC.docx', 'hash-1', 'rev-1', 'claude', 'claude-sonnet', 'tecnico-em-informatica', 'integrado',
        '# PPC', '[]', 'nonce-1', ${resultadoV1("lista-ia", true)}, 2, 2, '2026-11-20T10:00:00Z', '2026-11-20T10:05:00Z'),
      ('lista-pre', '/tmp/Outro.docx', 'hash-2', NULL, NULL, NULL, NULL, NULL,
        '# Outro', '[]', 'nonce-2', ${resultadoV1("lista-pre", false)}, 0, 0, '2026-11-20T09:00:00Z', '2026-11-20T09:00:00Z'),
      ('lista-pausada', '/tmp/Pausado.docx', 'hash-3', 'rev-pausada', 'claude', 'claude-sonnet', 'tecnico-em-informatica', 'integrado',
        '# Pausado', '[]', 'nonce-3', ${resultadoV1("lista-pausada", false)}, 1, 0, '2026-11-20T11:00:00Z', '2026-11-20T11:02:00Z'),
      ('lista-vazia', '/tmp/Vazio.docx', 'hash-4', 'rev-vazia', 'claude', 'claude-sonnet', NULL, NULL,
        '# Vazio', '[]', 'nonce-4', ${resultadoV1("lista-vazia", false)}, 0, 0, '2026-11-20T11:10:00Z', '2026-11-20T11:10:00Z')
  `;
  yield* sql`
    INSERT INTO pendencias_vivas (lista_id, chave, ordem, pendencia, situacao, resolvida_por, sugestao)
    VALUES ('lista-ia', 'CT-IDENT-01:abc', 0, ${pendenciaJson}, 'resolvida', 'pessoa', NULL)
  `;
  yield* sql`
    INSERT INTO eventos_pendencia (lista_id, chave, em, acao, situacao, texto, motivo, uso)
    VALUES ('lista-ia', 'CT-IDENT-01:abc', '2026-11-20T10:06:00Z', 'marcar', 'resolvida', 'Marcada.', NULL, NULL)
  `;
  yield* sql`
    INSERT INTO acoes_ia (lista_id, chave, acao, numero, uso, segundos, ferramentas, criada_em)
    VALUES ('lista-ia', 'CT-IDENT-01:abc', 'sugerir', 1, ${usoJson}, 3.2, '[]', '2026-11-20T10:06:00Z')
  `;
});

const emMemoria = Layer.mergeAll(Listas.layer, Revisoes.layer).pipe(
  Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
);

describe("migrações do banco das conversas", () => {
  it.effect(
    "upgrade 1 → 2 preserva filhos, preenche leituraIa e resultados_ia de forma coerente e muda FK para ON DELETE SET NULL",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const listas = yield* Listas.Listas;
        const revisoes = yield* Revisoes.Revisoes;

        const m1 = yield* Banco.rodarMigracoes(1);
        assert.deepStrictEqual(m1, [[1, "Inicial"]]);
        yield* popularV1;

        const m2 = yield* Banco.rodarMigracoes(2);
        assert.deepStrictEqual(m2, [[2, "ResultadosIaNaLista"]]);

        const fk = yield* sql<{ foreign_keys: number }>`PRAGMA foreign_keys;`;
        assert.strictEqual(fk[0]?.foreign_keys, 1);

        // Lista concluída: leituraIa = "completa", parcial = false.
        const listaIa = yield* listas.buscar("lista-ia");
        assert.isNotNull(listaIa);
        assert.strictEqual(listaIa!.resultado.leituraIa, "completa");
        assert.isNotNull(listaIa!.resultadosIa);
        assert.strictEqual(listaIa!.resultadosIa!.resultados.length, 1);
        assert.deepStrictEqual(listaIa!.resultadosIa!.fora, ["CT-EXT-01"]);
        assert.strictEqual(listaIa!.resultadosIa!.parcial, false);

        // Lista sem revisão: leituraIa = "nenhuma", resultadosIa = null.
        const listaPre = yield* listas.buscar("lista-pre");
        assert.isNotNull(listaPre);
        assert.strictEqual(listaPre!.resultado.leituraIa, "nenhuma");
        assert.isNull(listaPre!.resultadosIa);

        // Lista ligada a revisão pausada: leituraIa = "parcial", parcial = true, respeitando ordem do plano.
        const listaPausada = yield* listas.buscar("lista-pausada");
        assert.isNotNull(listaPausada);
        assert.strictEqual(listaPausada!.resultado.leituraIa, "parcial");
        assert.strictEqual(listaPausada!.resultadosIa?.parcial, true);
        assert.deepStrictEqual(
          listaPausada!.resultadosIa?.resultados.map((r) => r.ficha),
          ["CT-IDENT-03", "CT-IDENT-02"],
        );

        // Lista ligada a revisão sem blocos: resultadosIa continua null e não quebra.
        const listaVazia = yield* listas.buscar("lista-vazia");
        assert.isNotNull(listaVazia);
        assert.strictEqual(listaVazia!.resultado.leituraIa, "parcial");
        assert.isNull(listaVazia!.resultadosIa);

        // Revisões: com resultado preenchido e com resultado NULL.
        const rev1 = yield* revisoes.buscar("rev-1");
        assert.strictEqual(rev1?.resultado?.leituraIa, "completa");
        const revPausada = yield* revisoes.buscar("rev-pausada");
        assert.isNull(revPausada?.resultado);

        // Filhos preservados (recriar `listas_pendencias` não disparou `ON DELETE CASCADE`).
        // (contadas pelo SQL: na versão 2 a pendência ainda tem `mensagem`, que o serviço não lê mais)
        const vivas = sql<{ n: number }>`SELECT COUNT(*) AS n FROM pendencias_vivas WHERE lista_id = 'lista-ia'`;
        assert.strictEqual((yield* vivas)[0]?.n, 1);
        assert.strictEqual((yield* listas.eventos("lista-ia")).length, 1);
        assert.strictEqual((yield* listas.uso("lista-ia")).entrada, 100);

        // Apagar a revisão agora só desliga `revisao_id` (`ON DELETE SET NULL`), mantendo lista e `resultados_ia`.
        yield* revisoes.apagar("rev-1");
        const depois = yield* listas.buscar("lista-ia");
        assert.isNotNull(depois);
        assert.isNull(depois!.revisao);
        assert.strictEqual(depois!.resultadosIa?.resultados.length, 1);
        assert.strictEqual((yield* vivas)[0]?.n, 1);
      }).pipe(Effect.provide(emMemoria)),
  );

  it.effect("upgrade 2 → 3 cria a fila do que falta apagar fora do banco, vazia, sem tocar nas conversas", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* Banco.rodarMigracoes(2);
      yield* sql`
        INSERT INTO conversas (id, provider, pasta_trabalho, estado, criada_em, atualizada_em)
        VALUES ('c1', 'claude', '/tmp/tarefa', 'liberada', '2026-11-20T10:00:00Z', '2026-11-20T10:00:00Z')
      `;
      const m3 = yield* Banco.rodarMigracoes(3);
      assert.deepStrictEqual(m3, [[3, "ApagamentosPendentes"]]);
      assert.strictEqual((yield* sql`SELECT * FROM conversas`).length, 1);
      assert.strictEqual((yield* sql`SELECT * FROM apagamentos_pendentes`).length, 0);
    }).pipe(Effect.provide(emMemoria)),
  );

  it.effect(
    "upgrade 3 → 4 separa a mensagem da pendência em título, explicação e faltas, nos três lugares em que ela fica gravada",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const listas = yield* Listas.Listas;
        const revisoes = yield* Revisoes.Revisoes;
        yield* Banco.rodarMigracoes(1);
        yield* popularV1;
        yield* Banco.rodarMigracoes(3);

        // Uma pendência da IA no formato antigo: a justificativa e, no fim, as lacunas numa frase só.
        const daIa = JSON.stringify({
          ...(JSON.parse(pendenciaJson) as object),
          ficha: "CT-IDENT-02",
          origem: "ia",
          mensagem:
            "O quadro traz o campus e a forma, mas o prazo máximo não aparece. A carga total (3.173 h) diverge da matriz. Falta: Prazo máximo não informado; Carga total diverge da matriz (3.367 h).",
        });
        yield* sql`UPDATE pendencias_vivas SET pendencia = ${daIa} WHERE lista_id = 'lista-ia'`;
        const comPendencias = JSON.stringify({
          ...(JSON.parse(resultadoV1("lista-ia", true)) as object),
          leituraIa: "completa",
          pendencias: [JSON.parse(daIa), JSON.parse(pendenciaJson)],
        });
        yield* sql`UPDATE listas_pendencias SET resultado = ${comPendencias} WHERE id = 'lista-ia'`;
        yield* sql`UPDATE revisoes_ia SET resultado = ${comPendencias} WHERE id = 'rev-1'`;

        const m4 = yield* Banco.rodarMigracoes(4);
        assert.deepStrictEqual(m4, [[4, "TextoDaPendenciaEmPartes"]]);

        const emPartes = {
          titulo: "O quadro traz o campus e a forma, mas o prazo máximo não aparece.",
          explicacao: "A carga total (3.173 h) diverge da matriz.",
          faltas: ["Prazo máximo não informado", "Carga total diverge da matriz (3.367 h)"],
        };
        const [viva] = yield* listas.pendencias("lista-ia");
        assert.deepInclude(viva!.pendencia, emPartes);
        assert.notProperty(viva!.pendencia, "mensagem");
        // a chave da pendência e o resto dela não mudam
        assert.strictEqual(viva!.chave, "CT-IDENT-01:abc");
        assert.strictEqual(viva!.pendencia.oQueFazer, "Ajuste o nome.");

        const lista = yield* listas.buscar("lista-ia");
        assert.deepInclude(lista!.resultado.pendencias[0], emPartes);
        // a do código, de uma frase só: o título é a frase, sem explicação nem faltas
        assert.deepInclude(lista!.resultado.pendencias[1], {
          titulo: "Confira a denominação.",
          explicacao: null,
          faltas: [],
        });
        assert.notProperty(lista!.resultado.pendencias[1], "mensagem");
        const revisao = yield* revisoes.buscar("rev-1");
        assert.deepInclude(revisao!.resultado!.pendencias[0], emPartes);

        // rodar de novo não faz nada: o banco já está na versão 4
        assert.deepStrictEqual(yield* Banco.rodarMigracoes(4), []);
      }).pipe(Effect.provide(emMemoria)),
  );

  it.effect("recusa banco criado por versão mais nova do app (downgrade) e histórico incompatível", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* Banco.rodarMigracoes(4);

      // Simula um banco que recebeu uma migração 5 de uma versão mais nova do app.
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (5, 'Futura')`;
      const erroDowngrade = yield* Banco.rodarMigracoes(4).pipe(Effect.flip);
      assert.strictEqual(erroDowngrade._tag, "BancoIncompativel");
      assert.include(erroDowngrade.message, "versão mais nova");

      // Simula histórico incompatível (ex.: nome trocado ou banco de dev antigo).
      yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = 5`;
      yield* sql`UPDATE effect_sql_migrations SET name = 'AntigaDiferente' WHERE migration_id = 2`;
      const erroIncompativel = yield* Banco.rodarMigracoes(4).pipe(Effect.flip);
      assert.strictEqual(erroIncompativel._tag, "BancoIncompativel");
      assert.include(erroIncompativel.message, "não é compatível");
    }).pipe(Effect.provide(emMemoria)),
  );

  it.effect("violação de FK dentro de uma migração faz rollback e mantém o banco na versão anterior", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* Banco.rodarMigracoes(4);

      const migracaoQuebrada: Banco.EntradaMigracao = [
        5,
        "QuebraFk",
        Effect.gen(function* () {
          const s = yield* SqlClient.SqlClient;
          // Insere um filho órfão (com `foreign_keys = OFF` passa no INSERT, mas `foreign_key_check` pega).
          yield* s`
            INSERT INTO pendencias_vivas (lista_id, chave, ordem, pendencia, situacao)
            VALUES ('lista-inexistente', 'CT-X:1', 0, '{}', 'aberta')
          `;
        }),
      ];
      const erro = yield* Banco.rodarMigracoes(5, {
        migracoes: [...Banco.MIGRACOES, migracaoQuebrada],
      }).pipe(Effect.flip);
      assert.strictEqual(erro._tag, "MigrationError");
      assert.include(String(erro.cause), "MigracaoViolouIntegridade");

      // Transação desfeita: o órfão não ficou e a migração 5 não foi registrada.
      const orfaos = yield* sql`SELECT * FROM pendencias_vivas WHERE lista_id = 'lista-inexistente'`;
      assert.strictEqual(orfaos.length, 0);
      const aplicada = yield* sql`SELECT * FROM effect_sql_migrations WHERE migration_id = 5`;
      assert.strictEqual(aplicada.length, 0);
      // `foreign_keys` foi religado mesmo após o erro.
      const fk = yield* sql<{ foreign_keys: number }>`PRAGMA foreign_keys;`;
      assert.strictEqual(fk[0]?.foreign_keys, 1);
    }).pipe(Effect.provide(emMemoria)),
  );

  it.live("em arquivo, grava .v<id>.bak antes de migrar, nunca sobrescreve e não regrava em dia", () =>
    Effect.gen(function* () {
      const arquivo = NodePath.join(pasta, "conversas.sqlite");
      const backup = `${arquivo}.v1.bak`;

      // Cria o arquivo na migração 1 com dados.
      yield* Effect.gen(function* () {
        yield* Banco.rodarMigracoes(1);
        yield* popularV1;
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: arquivo })));
      assert.isFalse(NodeFS.existsSync(backup));

      // Abre com `layerArquivo`: migra para 2 e cria `.v1.bak` antes.
      yield* Effect.gen(function* () {
        const listas = yield* Listas.Listas;
        const l = yield* listas.buscar("lista-ia");
        assert.strictEqual(l?.resultado.leituraIa, "completa");
      }).pipe(
        Effect.provide(
          Listas.layer.pipe(Layer.provide(Banco.layerArquivo(arquivo)), Layer.provide(NodeServices.layer)),
        ),
      );
      assert.isTrue(NodeFS.existsSync(backup));

      // O `.v1.bak` ainda está na versão 1 (snapshot anterior ao upgrade).
      const versaoBackup = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const rows = yield* sql<{ id: number }>`SELECT MAX(migration_id) AS id FROM effect_sql_migrations`;
        return rows[0]?.id;
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: backup })));
      assert.strictEqual(versaoBackup, 1);

      // Segunda abertura sem migrações pendentes não recria o `.v1.bak`, e expira backups mais velhos que 14 dias.
      NodeFS.rmSync(backup);
      const antigo = `${arquivo}.v0.bak`;
      NodeFS.writeFileSync(antigo, "antigo");
      // 2020-01-01T00:00:00Z em segundos Unix.
      NodeFS.utimesSync(antigo, 1577836800, 1577836800);
      yield* Effect.void.pipe(Effect.provide(Banco.layerArquivo(arquivo).pipe(Layer.provide(NodeServices.layer))));
      assert.isFalse(NodeFS.existsSync(backup));
      assert.isFalse(NodeFS.existsSync(antigo));
    }),
  );
});
