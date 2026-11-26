/**
 * Migração 1: o banco inteiro.
 *
 * Conversas:
 * - `conversas`: uma por conversa do app. `id_nativo` é o id da conversa no provider (o `session_id`
 *   do Claude, o `threadId` do Codex, o `sessionId` do ACP), para a retomada; `estado` é o
 *   `EstadoConversa` do contrato; `tarefa` é o `id` da tarefa do catálogo, ou nulo na conversa livre;
 *   `esforco` é o nível de raciocínio escolhido (`EntradaIniciar.esforco`), para a retomada. Datas em
 *   ISO 8601.
 * - `eventos`: o histórico, na `ordem` da conversa. `tipo` é `mensagem` (o texto da pessoa, que abre
 *   o turno), `evento` (um `Evento` normalizado do motor, em JSON, exceto o `TextoParcial`) ou
 *   `decisao` (a resposta a um pedido de aprovação).
 * - `avaliacoes`: o 👍/👎 de cada turno. `anexos_pasta`: os arquivos que entraram na pasta de trabalho
 *   pelo "Anexar" do app.
 * - `relatos`: "Isto está errado", um por envio (issue aberta no navegador, arquivo salvo na pasta da
 *   tarefa ou texto copiado), com o título e o corpo como a pessoa os aprovou.
 * - `apagamentos_pendentes`: fila do que falta apagar fora do banco depois de apagar uma conversa
 *   (cópias do Desfazer e registro do provider).
 *
 * Módulos: as tabelas de cada módulo, com o nome do módulo de prefixo, criadas por uma função do próprio
 * módulo (a revisão de PPC: `revisao_ppc_*`, em `modulos/revisao-ppc/persistencia/tabelas.ts`). Este
 * arquivo é de composição: o bloco de cada módulo fica identificado, e a migração é a mesma.
 *
 * `preferencias`: as preferências deste computador, uma linha por chave, com o valor em JSON
 * (`perfil`, `aviso_aceito_em`, `boas_vindas_em`, `ias_desligadas`). Ver `Preferencias.ts`.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as TabelasRevisaoPpc from "../../modulos/revisao-ppc/persistencia/tabelas.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE conversas (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      pasta_trabalho TEXT NOT NULL,
      modelo TEXT,
      titulo TEXT NOT NULL DEFAULT '',
      id_nativo TEXT,
      estado TEXT NOT NULL,
      criada_em TEXT NOT NULL,
      atualizada_em TEXT NOT NULL,
      tarefa TEXT,
      sem_web INTEGER NOT NULL DEFAULT 0,
      esforco TEXT
    )
  `;
  yield* sql`CREATE INDEX conversas_atualizada_em ON conversas (atualizada_em DESC)`;

  yield* sql`
    CREATE TABLE eventos (
      conversa_id TEXT NOT NULL REFERENCES conversas (id) ON DELETE CASCADE,
      ordem INTEGER NOT NULL,
      turno INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      dados TEXT NOT NULL,
      criado_em TEXT NOT NULL,
      PRIMARY KEY (conversa_id, ordem)
    ) WITHOUT ROWID
  `;

  yield* sql`
    CREATE TABLE avaliacoes (
      conversa_id TEXT NOT NULL REFERENCES conversas (id) ON DELETE CASCADE,
      turno INTEGER NOT NULL,
      nota TEXT NOT NULL,
      avaliada_em TEXT NOT NULL,
      PRIMARY KEY (conversa_id, turno)
    )
  `;

  yield* sql`
    CREATE TABLE anexos_pasta (
      pasta TEXT NOT NULL,
      nome TEXT NOT NULL,
      anexado_em TEXT NOT NULL,
      PRIMARY KEY (pasta, nome)
    )
  `;

  yield* sql`
    CREATE TABLE relatos (
      id INTEGER PRIMARY KEY,
      conversa_id TEXT NOT NULL REFERENCES conversas (id) ON DELETE CASCADE,
      turno INTEGER NOT NULL,
      via TEXT NOT NULL,
      titulo TEXT NOT NULL,
      corpo TEXT NOT NULL,
      arquivo TEXT,
      criado_em TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE apagamentos_pendentes (
      conversa TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      id_nativo TEXT,
      pasta_trabalho TEXT NOT NULL,
      criado_em TEXT NOT NULL,
      tentativas INTEGER NOT NULL DEFAULT 0
    )
  `;

  // Composição: as tabelas do módulo `revisao-ppc` (`revisao_ppc_*`), num bloco à parte.
  yield* TabelasRevisaoPpc.criar;

  yield* sql`
    CREATE TABLE preferencias (
      chave TEXT PRIMARY KEY,
      valor TEXT NOT NULL,
      atualizada_em TEXT NOT NULL
    )
  `;
});
