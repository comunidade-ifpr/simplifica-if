/**
 * As tabelas do módulo `revisao-ppc` no banco das conversas (`conversas.sqlite`), todas com o prefixo
 * `revisao_ppc_`. A migração inicial do núcleo (`persistencia/migracoes/0001_Inicial.ts`, arquivo de
 * composição) chama `criar` num bloco à parte; o módulo não tem migrador próprio.
 *
 * Revisão de PPC com IA:
 * - `revisao_ppc_revisoes_ia`: uma por revisão, ligada à lista de onde nasceu (`lista_id`, `ON DELETE SET NULL`).
 *   `plano` é o JSON do plano montado em código (os blocos, o texto de cada pedido, o Markdown do PPC
 *   convertido, as fichas e o contexto das transversais): a retomada não o refaz. `sha256` é o do
 *   `.docx` lido na preparação; o resultado final só sai se o arquivo não mudou. `estimativa`, `uso`
 *   e `resultado` em JSON.
 * - `revisao_ppc_blocos_ia`: o resultado conferido de cada bloco, gravado ao terminar, para a retomada depois de
 *   cota esgotada, limite de taxa, app fechado ou provider caído.
 * - `revisao_ppc_tentativas_ia`: o uso de cada tentativa, gravado ao fim dela, mesmo quando o bloco não termina
 *   (pausa, limite de taxa, "Pausar", a falha de outro bloco que interrompe este). O uso mostrado na
 *   tela é a soma destas linhas: nada do que se gastou some, nem conta duas vezes.
 *
 * Lista viva de pendências: a lista (com o texto do PPC que as ações com IA usam e os resultados da
 * leitura com IA em `resultados_ia`), a situação e a sugestão de cada pendência, o histórico e o uso
 * de cada ação com IA. Apagar a revisão com IA só desliga `revisao_id` (`ON DELETE SET NULL`). `versao`
 * sobe a cada mudança nas pendências; `versao_copia` é a versão que a cópia comentada reflete (nula:
 * nenhuma), e "Abrir no Word" só a regrava se elas diferem.
 *
 * `revisao_ppc_copias_comentadas`: o sha256 da última cópia comentada que o app gravou em cada caminho. Um arquivo
 * nesse caminho com outro conteúdo foi editado pela pessoa (ou não é do app) e não é sobrescrito.
 *
 * Guarda o texto do PPC da pessoa (no `plano` e na lista), como as conversas guardam os anexos: fica só
 * no banco local, na pasta de estado do app.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Cria as tabelas e os índices do módulo. Só a migração a chama. */
export const criar = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE revisao_ppc_revisoes_ia (
      id TEXT PRIMARY KEY,
      lista_id TEXT REFERENCES revisao_ppc_listas_pendencias (id) ON DELETE SET NULL,
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
  yield* sql`CREATE INDEX revisao_ppc_revisoes_ia_atualizada_em ON revisao_ppc_revisoes_ia (atualizada_em DESC)`;
  yield* sql`CREATE INDEX revisao_ppc_revisoes_ia_lista ON revisao_ppc_revisoes_ia (lista_id)`;

  yield* sql`
    CREATE TABLE revisao_ppc_blocos_ia (
      revisao_id TEXT NOT NULL REFERENCES revisao_ppc_revisoes_ia (id) ON DELETE CASCADE,
      bloco_id TEXT NOT NULL,
      resultado TEXT NOT NULL,
      uso TEXT NOT NULL,
      segundos REAL NOT NULL,
      criado_em TEXT NOT NULL,
      PRIMARY KEY (revisao_id, bloco_id)
    ) WITHOUT ROWID
  `;

  yield* sql`
    CREATE TABLE revisao_ppc_tentativas_ia (
      revisao_id TEXT NOT NULL REFERENCES revisao_ppc_revisoes_ia (id) ON DELETE CASCADE,
      bloco_id TEXT NOT NULL,
      numero INTEGER NOT NULL,
      uso TEXT NOT NULL,
      segundos REAL NOT NULL,
      ferramentas TEXT NOT NULL,
      criada_em TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX revisao_ppc_tentativas_ia_revisao ON revisao_ppc_tentativas_ia (revisao_id)`;

  yield* sql`
    CREATE TABLE revisao_ppc_listas_pendencias (
      id TEXT PRIMARY KEY,
      arquivo TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      revisao_id TEXT REFERENCES revisao_ppc_revisoes_ia (id) ON DELETE SET NULL,
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
  yield* sql`CREATE INDEX revisao_ppc_listas_pendencias_atualizada_em ON revisao_ppc_listas_pendencias (atualizada_em DESC)`;
  yield* sql`
    CREATE TABLE revisao_ppc_pendencias_vivas (
      lista_id TEXT NOT NULL REFERENCES revisao_ppc_listas_pendencias (id) ON DELETE CASCADE,
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
    CREATE TABLE revisao_ppc_eventos_pendencia (
      lista_id TEXT NOT NULL REFERENCES revisao_ppc_listas_pendencias (id) ON DELETE CASCADE,
      chave TEXT NOT NULL,
      em TEXT NOT NULL,
      acao TEXT NOT NULL,
      situacao TEXT NOT NULL,
      texto TEXT NOT NULL,
      motivo TEXT,
      uso TEXT
    )
  `;
  yield* sql`CREATE INDEX revisao_ppc_eventos_pendencia_lista ON revisao_ppc_eventos_pendencia (lista_id, chave)`;
  yield* sql`
    CREATE TABLE revisao_ppc_acoes_ia (
      lista_id TEXT NOT NULL REFERENCES revisao_ppc_listas_pendencias (id) ON DELETE CASCADE,
      chave TEXT NOT NULL,
      acao TEXT NOT NULL,
      numero INTEGER NOT NULL,
      uso TEXT NOT NULL,
      segundos REAL NOT NULL,
      ferramentas TEXT NOT NULL,
      criada_em TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX revisao_ppc_acoes_ia_lista ON revisao_ppc_acoes_ia (lista_id)`;
  yield* sql`
    CREATE TABLE revisao_ppc_copias_comentadas (
      caminho TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL,
      gravada_em TEXT NOT NULL
    )
  `;
});
