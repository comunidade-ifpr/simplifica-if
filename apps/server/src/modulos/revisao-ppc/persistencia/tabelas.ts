/**
 * As tabelas do módulo `revisao-ppc` no banco das conversas (`conversas.sqlite`), todas com o prefixo
 * `revisao_ppc_`. A migração inicial do núcleo (`persistencia/migracoes/0001_Inicial.ts`, arquivo de
 * composição) chama `criar` num bloco à parte, e as seguintes chamam as mudanças (`0002`:
 * `adicionarProblemasDasTentativas`; `0003`: `adicionarArquivoAcompanhado`; `0004`: `adicionarConversaAoLado`; `0005`: `adicionarIaPorBloco`);
 * o módulo não tem migrador próprio.
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
 *   tela é a soma destas linhas: nada do que se gastou some, nem conta duas vezes. `problemas` (migração
 *   2) é o que a conferência recusou na resposta, em JSON (`{ "<ficha>" | "*": [problema] }`, `{}` quando
 *   passou), para saber por que houve nova tentativa; nulo quando a resposta não chegou a ser conferida
 *   (pausa, ferramenta anunciada, ações por pendência). Só texto do app, nunca o texto da IA.
 *
 * Lista viva de pendências: a lista (com o texto do PPC que as ações com IA usam e os resultados da
 * leitura com IA em `resultados_ia`), a situação e a sugestão de cada pendência, o histórico e o uso
 * de cada ação com IA. Apagar a revisão com IA só desliga `revisao_id` (`ON DELETE SET NULL`). `versao`
 * sobe a cada mudança nas pendências; `versao_copia` é a versão que a cópia comentada reflete (nula:
 * nenhuma), e "Abrir no Word" só a regrava se elas diferem.
 *
 * O arquivo que a revisão acompanha no Word (`arquivo_acompanhado`, migração 3) e o sha256 dele na última
 * conferência ao salvar (`sha256_conferido`) ficam na lista, à parte do arquivo revisado (`arquivo`,
 * `sha256`), que a conferência não troca. Nulos: a revisão não acompanha arquivo nenhum, ou o
 * acompanhado ainda não foi conferido. `codigo_conferido` (0 ou 1): as pendências e os critérios do
 * código vieram de uma conferência ao salvar, e não do texto revisado.
 *
 * A conversa ao lado (migração 4): `conversa_id` e `conversa_pasta`, a conversa livre que a revisão abriu
 * e a pasta dela, com o Markdown do PPC (nulos antes da primeira mensagem); `markdown_conferido`, o texto
 * do último arquivo conferido ao salvar (sem as linhas de texto dirigido a IA), que a pasta da conversa
 * recebe no lugar do revisado (nulo sem conferência, ou depois de "Enviar a versão corrigida").
 *
 * A IA de cada bloco e de cada pendência (migração 5): `revisao_ppc_blocos_ia.provider`, a IA que leu o bloco,
 * e `revisao_ppc_pendencias_vivas.ia`, a que julgou a pendência da IA. A leitura pausada no limite da
 * assinatura continua com outra IA (`RevisaoIa.continuarCom`), e cada pendência diz qual a julgou. Nulos
 * nos blocos e pendências de antes da migração (a IA era a da revisão) e nas pendências do código.
 *
 * `revisao_ppc_copias_comentadas`: o sha256 da última cópia comentada que o app gravou em cada caminho. Um arquivo
 * nesse caminho com outro conteúdo foi editado pela pessoa (ou não é do app) e não é sobrescrito.
 *
 * Guarda o texto do PPC da pessoa (no `plano` e na lista), como as conversas guardam os anexos: fica só
 * no banco local, na pasta de estado do app.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Migração 2: o que a conferência recusou em cada tentativa (`revisao_ppc_tentativas_ia.problemas`). */
export const adicionarProblemasDasTentativas = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE revisao_ppc_tentativas_ia ADD COLUMN problemas TEXT`;
});

/** Migração 3: o arquivo acompanhado no Word, o sha256 da última conferência ao salvar e se ela já houve. */
export const adicionarArquivoAcompanhado = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE revisao_ppc_listas_pendencias ADD COLUMN arquivo_acompanhado TEXT`;
  yield* sql`ALTER TABLE revisao_ppc_listas_pendencias ADD COLUMN sha256_conferido TEXT`;
  yield* sql`ALTER TABLE revisao_ppc_listas_pendencias ADD COLUMN codigo_conferido INTEGER NOT NULL DEFAULT 0`;
});

/** Migração 4: a conversa ao lado da revisão e o texto do último arquivo conferido ao salvar. */
export const adicionarConversaAoLado = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE revisao_ppc_listas_pendencias ADD COLUMN conversa_id TEXT`;
  yield* sql`ALTER TABLE revisao_ppc_listas_pendencias ADD COLUMN conversa_pasta TEXT`;
  yield* sql`ALTER TABLE revisao_ppc_listas_pendencias ADD COLUMN markdown_conferido TEXT`;
});

/** Migração 5: a IA que leu cada bloco e a que julgou cada pendência da IA. */
export const adicionarIaPorBloco = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE revisao_ppc_blocos_ia ADD COLUMN provider TEXT`;
  yield* sql`ALTER TABLE revisao_ppc_pendencias_vivas ADD COLUMN ia TEXT`;
});

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
