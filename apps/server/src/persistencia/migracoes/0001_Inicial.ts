/**
 * Migração 1: o banco inteiro.
 *
 * Conversas:
 * - `conversas`: uma por conversa do app. `id_nativo` é o id da conversa no provider (o `session_id`
 *   do Claude, o `threadId` do Codex, o `sessionId` do ACP), para a retomada; `estado` é o
 *   `EstadoConversa` do contrato; `tarefa` é a skill, ou `conversa` para a caixa livre do Início;
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
 * Revisão de PPC com IA:
 * - `revisoes_ia`: uma por revisão, ligada à lista de onde nasceu (`lista_id`, `ON DELETE SET NULL`).
 *   `plano` é o JSON do plano montado em código (os blocos, o texto de cada pedido, o Markdown do PPC
 *   convertido, as fichas e o contexto das transversais): a retomada não o refaz. `sha256` é o do
 *   `.docx` lido na preparação; o resultado final só sai se o arquivo não mudou. `estimativa`, `uso`
 *   e `resultado` em JSON.
 * - `blocos_ia`: o resultado conferido de cada bloco, gravado ao terminar, para a retomada depois de
 *   cota esgotada, limite de taxa, app fechado ou provider caído.
 * - `tentativas_ia`: o uso de cada tentativa, gravado ao fim dela, mesmo quando o bloco não termina
 *   (pausa, limite de taxa, "Pausar", a falha de outro bloco que interrompe este). O uso mostrado na
 *   tela é a soma destas linhas: nada do que se gastou some, nem conta duas vezes.
 *
 * Lista viva de pendências: a lista (com o texto do PPC que as ações com IA usam e os resultados da
 * leitura com IA em `resultados_ia`), a situação e a sugestão de cada pendência, o histórico e o uso
 * de cada ação com IA. Apagar a revisão com IA só desliga `revisao_id` (`ON DELETE SET NULL`). `versao`
 * sobe a cada mudança nas pendências; `versao_copia` é a versão que a cópia comentada reflete (nula:
 * nenhuma), e "Abrir no Word" só a regrava se elas diferem.
 *
 * `copias_comentadas`: o sha256 da última cópia comentada que o app gravou em cada caminho. Um arquivo
 * nesse caminho com outro conteúdo foi editado pela pessoa (ou não é do app) e não é sobrescrito.
 *
 * `preferencias`: as preferências deste computador, uma linha por chave, com o valor em JSON
 * (`perfil`, `aviso_aceito_em`, `boas_vindas_em`, `ias_desligadas`). Ver `Preferencias.ts`.
 *
 * Guarda o texto do PPC da pessoa (no `plano` e na lista), como as conversas guardam os anexos: fica só
 * no banco local, na pasta de estado do app.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

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
      tentativas INTEGER NOT NULL DEFAULT 0,
      ultima_tentativa_em TEXT
    )
  `;

  yield* sql`
    CREATE TABLE revisoes_ia (
      id TEXT PRIMARY KEY,
      lista_id TEXT REFERENCES listas_pendencias (id) ON DELETE SET NULL,
      arquivo TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      provider TEXT NOT NULL,
      modelo TEXT,
      modo TEXT NOT NULL,
      situacao TEXT NOT NULL,
      motivo TEXT,
      limite INTEGER NOT NULL DEFAULT 0,
      plano TEXT NOT NULL,
      estimativa TEXT NOT NULL,
      resultado TEXT,
      criada_em TEXT NOT NULL,
      atualizada_em TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX revisoes_ia_atualizada_em ON revisoes_ia (atualizada_em DESC)`;
  yield* sql`CREATE INDEX revisoes_ia_lista ON revisoes_ia (lista_id)`;

  yield* sql`
    CREATE TABLE blocos_ia (
      revisao_id TEXT NOT NULL REFERENCES revisoes_ia (id) ON DELETE CASCADE,
      bloco_id TEXT NOT NULL,
      resultado TEXT NOT NULL,
      uso TEXT NOT NULL,
      segundos REAL NOT NULL,
      criado_em TEXT NOT NULL,
      PRIMARY KEY (revisao_id, bloco_id)
    ) WITHOUT ROWID
  `;

  yield* sql`
    CREATE TABLE tentativas_ia (
      revisao_id TEXT NOT NULL REFERENCES revisoes_ia (id) ON DELETE CASCADE,
      bloco_id TEXT NOT NULL,
      numero INTEGER NOT NULL,
      uso TEXT NOT NULL,
      segundos REAL NOT NULL,
      ferramentas TEXT NOT NULL,
      criada_em TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX tentativas_ia_revisao ON tentativas_ia (revisao_id)`;

  yield* sql`
    CREATE TABLE listas_pendencias (
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
      resultado TEXT NOT NULL,
      resultados_ia TEXT,
      versao INTEGER NOT NULL,
      versao_copia INTEGER,
      criada_em TEXT NOT NULL,
      atualizada_em TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX listas_pendencias_atualizada_em ON listas_pendencias (atualizada_em DESC)`;
  yield* sql`
    CREATE TABLE pendencias_vivas (
      lista_id TEXT NOT NULL REFERENCES listas_pendencias (id) ON DELETE CASCADE,
      chave TEXT NOT NULL,
      ordem INTEGER NOT NULL,
      pendencia TEXT NOT NULL,
      situacao TEXT NOT NULL,
      resolvida_por TEXT,
      sugestao TEXT,
      PRIMARY KEY (lista_id, chave)
    ) WITHOUT ROWID
  `;
  yield* sql`
    CREATE TABLE eventos_pendencia (
      lista_id TEXT NOT NULL REFERENCES listas_pendencias (id) ON DELETE CASCADE,
      chave TEXT NOT NULL,
      em TEXT NOT NULL,
      acao TEXT NOT NULL,
      situacao TEXT NOT NULL,
      texto TEXT NOT NULL,
      motivo TEXT,
      uso TEXT
    )
  `;
  yield* sql`CREATE INDEX eventos_pendencia_lista ON eventos_pendencia (lista_id, chave)`;
  yield* sql`
    CREATE TABLE acoes_ia (
      lista_id TEXT NOT NULL REFERENCES listas_pendencias (id) ON DELETE CASCADE,
      chave TEXT NOT NULL,
      acao TEXT NOT NULL,
      numero INTEGER NOT NULL,
      uso TEXT NOT NULL,
      segundos REAL NOT NULL,
      ferramentas TEXT NOT NULL,
      criada_em TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX acoes_ia_lista ON acoes_ia (lista_id)`;
  yield* sql`
    CREATE TABLE copias_comentadas (
      caminho TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL,
      gravada_em TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE preferencias (
      chave TEXT PRIMARY KEY,
      valor TEXT NOT NULL,
      atualizada_em TEXT NOT NULL
    )
  `;
});
