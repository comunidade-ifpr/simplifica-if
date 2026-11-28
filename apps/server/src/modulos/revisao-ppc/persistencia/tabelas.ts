/**
 * As tabelas do módulo `revisao-ppc` no banco das conversas (`conversas.sqlite`), todas com o prefixo
 * `revisao_ppc_`. A migração inicial do núcleo (`persistencia/migracoes/0001_Inicial.ts`, arquivo de
 * composição) chama `criar` num bloco à parte, e as seguintes chamam as mudanças (`0002`:
 * `adicionarProblemasDasTentativas`; `0003`: `adicionarArquivoAcompanhado`; `0004`: `adicionarConversaAoLado`; `0005`: `adicionarIaPorBloco`;
 * `0006`: `migrarVocabularioRevisaoPpc`; `0007`: `separarConversasDaRevisao`);
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
 * As conversas ao lado (migração 7, `revisao_ppc_conversas`): várias por revisão, cada uma na sua pasta, com
 * o Markdown do PPC. Uma linha por conversa (`conversa_id` único), com a lista (`ON DELETE CASCADE`: a
 * revisão apagada ou expirada leva as linhas; as conversas e as pastas ficam), a pasta e a pendência de que
 * ela nasceu (`pendencia`, a chave; nula na conversa geral sobre a revisão). A migração 4 guardava uma só na
 * lista (`conversa_id`, `conversa_pasta`), que a 7 passou à tabela, como conversa geral, e tirou da lista.
 * A linha acompanha a cadeia de continuações (outra IA, no limite) por dois gatilhos sobre a tabela
 * `conversas` do núcleo, que não conhece o módulo: a continuação criada toma a linha da que ela continua
 * (`revisao_ppc_conversas_continuada`, onde quer que se continue, no painel ou na tela cheia), e a conversa
 * apagada que continuava outra devolve a linha a essa (`revisao_ppc_conversas_apagada`: a continuação que
 * não abriu, ou a que a pessoa apagou). Assim apagar a original não deixa a continuação órfã.
 * `markdown_conferido` (migração 4), o texto do último arquivo conferido ao salvar (sem as linhas de texto
 * dirigido a IA), que as pastas das conversas recebem no lugar do revisado (nulo sem conferência, ou depois
 * de "Enviar a versão corrigida").
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

/**
 * Migração 7: várias conversas ao lado por revisão, uma pasta por conversa. A conversa que a lista guardava
 * (`conversa_id`, `conversa_pasta`) passa à tabela nova como conversa geral (sem pendência), e as colunas saem
 * da lista (nenhum índice nem chave as usa: o `DROP COLUMN` do SQLite as tira direto).
 */
export const separarConversasDaRevisao = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE revisao_ppc_conversas (
      conversa_id TEXT PRIMARY KEY,
      lista_id TEXT NOT NULL REFERENCES revisao_ppc_listas_pendencias (id) ON DELETE CASCADE,
      pasta TEXT NOT NULL,
      pendencia TEXT,
      criada_em TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX revisao_ppc_conversas_lista ON revisao_ppc_conversas (lista_id, criada_em)`;
  yield* sql`
    INSERT OR IGNORE INTO revisao_ppc_conversas (conversa_id, lista_id, pasta, pendencia, criada_em)
    SELECT conversa_id, id, conversa_pasta, NULL, atualizada_em FROM revisao_ppc_listas_pendencias
    WHERE conversa_id IS NOT NULL AND conversa_pasta IS NOT NULL
  `;
  yield* sql`ALTER TABLE revisao_ppc_listas_pendencias DROP COLUMN conversa_id`;
  yield* sql`ALTER TABLE revisao_ppc_listas_pendencias DROP COLUMN conversa_pasta`;
});

/**
 * Migração 8: a linha de `revisao_ppc_conversas` segue a cadeia de continuações. As linhas que já existem
 * passam à última da cadeia; daí em diante, os gatilhos sobre `conversas` levam a linha à continuação quando
 * ela nasce (no painel ou na tela cheia) e de volta à anterior quando a continuação é apagada.
 */
export const seguirContinuacoesDasConversas = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // A linha passa à última da cadeia de continuações (a mais nova de cada passo, como o `Historico`); a
  // cadeia é curta, e o limite só evita um laço num banco fora de forma.
  for (let passo = 0; passo < 100; passo += 1) {
    const seguintes = yield* sql<{ antiga: string; nova: string; pasta: string }>`
      SELECT r.conversa_id AS antiga, n.id AS nova, n.pasta_trabalho AS pasta
      FROM revisao_ppc_conversas r
      JOIN conversas n
        ON n.id = (SELECT m.id FROM conversas m WHERE m.continua_de = r.conversa_id ORDER BY m.criada_em DESC LIMIT 1)
    `;
    if (seguintes.length === 0) break;
    for (const s of seguintes) {
      yield* sql`
        UPDATE OR IGNORE revisao_ppc_conversas SET conversa_id = ${s.nova}, pasta = ${s.pasta}
        WHERE conversa_id = ${s.antiga}
      `;
      yield* sql`DELETE FROM revisao_ppc_conversas WHERE conversa_id = ${s.antiga}`;
    }
  }
  yield* sql`
    CREATE TRIGGER revisao_ppc_conversas_continuada AFTER INSERT ON conversas
    WHEN NEW.continua_de IS NOT NULL
    BEGIN
      UPDATE OR IGNORE revisao_ppc_conversas SET conversa_id = NEW.id, pasta = NEW.pasta_trabalho
      WHERE conversa_id = NEW.continua_de;
    END
  `;
  yield* sql`
    CREATE TRIGGER revisao_ppc_conversas_apagada BEFORE DELETE ON conversas
    WHEN OLD.continua_de IS NOT NULL
    BEGIN
      UPDATE OR IGNORE revisao_ppc_conversas
      SET conversa_id = OLD.continua_de,
        pasta = (SELECT c.pasta_trabalho FROM conversas c WHERE c.id = OLD.continua_de)
      WHERE conversa_id = OLD.id
        AND EXISTS (SELECT 1 FROM conversas c WHERE c.id = OLD.continua_de);
    END
  `;
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

const ESTADOS_ANTIGOS: Readonly<Record<string, string>> = {
  ATENDE: "atende",
  NAO_ATENDE: "nao_atende",
  INCONCLUSIVO: "a_conferir",
  NAO_APLICAVEL: "nao_se_aplica",
};
const TIPOS_BLOCO_ANTIGOS: Readonly<Record<string, string>> = {
  S: "focal",
  J: "tematico",
  T: "transversal",
};
const CRITICIDADES_ANTIGAS: Readonly<Record<string, string>> = {
  BLOQ: "bloqueante",
  OBRIG: "obrigatorio",
  REC: "recomendado",
};

const migrarIdBloco = (id: string): string => {
  if (id === "t") return "transversal";
  if (id.startsWith("s-")) return `focal-${id.slice(2)}`;
  if (id.startsWith("j-")) return `tematico-${id.slice(2)}`;
  return id;
};

const migrarResultadosJson = (texto: string): string | null => {
  let dados: unknown;
  try {
    dados = JSON.parse(texto);
  } catch {
    return null;
  }
  if (typeof dados !== "object" || dados === null || !Array.isArray((dados as { resultados?: unknown }).resultados))
    return null;
  let mudou = false;
  const resultados = (dados as { resultados: unknown[] }).resultados.map((item) => {
    if (typeof item !== "object" || item === null) return item;
    const est = (item as { estado?: unknown }).estado;
    if (typeof est === "string" && Object.hasOwn(ESTADOS_ANTIGOS, est)) {
      mudou = true;
      return { ...item, estado: ESTADOS_ANTIGOS[est] };
    }
    return item;
  });
  return mudou ? JSON.stringify({ ...dados, resultados }) : null;
};

const migrarPlanoJson = (texto: string): string | null => {
  let dados: unknown;
  try {
    dados = JSON.parse(texto);
  } catch {
    return null;
  }
  if (typeof dados !== "object" || dados === null) return null;
  const obj = dados as Record<string, unknown>;
  let mudou = false;
  const blocos = Array.isArray(obj["blocos"])
    ? obj["blocos"].map((b) => {
        if (typeof b !== "object" || b === null) return b;
        const bloco = b as Record<string, unknown>;
        const idAntigo = typeof bloco["id"] === "string" ? bloco["id"] : "";
        const idNovo = migrarIdBloco(idAntigo);
        const tipoAntigo = typeof bloco["tipo"] === "string" ? bloco["tipo"] : "";
        const tipoNovo = TIPOS_BLOCO_ANTIGOS[tipoAntigo] ?? tipoAntigo;
        if (idNovo !== idAntigo || tipoNovo !== tipoAntigo) {
          mudou = true;
          return { ...bloco, id: idNovo, tipo: tipoNovo };
        }
        return bloco;
      })
    : obj["blocos"];
  const fichas = Array.isArray(obj["fichas"])
    ? obj["fichas"].map((f) => {
        if (typeof f !== "object" || f === null) return f;
        const ficha = { ...(f as Record<string, unknown>) };
        let fMudou = false;
        if (ficha["modo"] === "D") {
          ficha["modo"] = "hibrido";
          fMudou = true;
        } else if (ficha["modo"] === "S") {
          ficha["modo"] = "focal";
          fMudou = true;
        } else if (ficha["modo"] === "J") {
          ficha["modo"] = ficha["tipo_escopo"] === "transversal" ? "transversal" : "tematico";
          fMudou = true;
        }
        if ("tipo_escopo" in ficha) {
          delete ficha["tipo_escopo"];
          fMudou = true;
        }
        if (typeof ficha["criticidade"] === "string" && Object.hasOwn(CRITICIDADES_ANTIGAS, ficha["criticidade"])) {
          ficha["criticidade"] = CRITICIDADES_ANTIGAS[ficha["criticidade"]];
          fMudou = true;
        }
        if (Array.isArray(ficha["estados_permitidos"])) {
          const novos = ficha["estados_permitidos"].map((e) =>
            typeof e === "string" && Object.hasOwn(ESTADOS_ANTIGOS, e) ? ESTADOS_ANTIGOS[e] : e,
          );
          if (novos.some((e, i) => e !== (ficha["estados_permitidos"] as unknown[])[i])) {
            ficha["estados_permitidos"] = novos;
            fMudou = true;
          }
        }
        if (fMudou) mudou = true;
        return fMudou ? ficha : f;
      })
    : obj["fichas"];
  return mudou ? JSON.stringify({ ...obj, blocos, fichas }) : null;
};

/** Migração 6: converte blocos (`S`/`J`/`T`) e estados (`ATENDE`/…) já gravados para o vocabulário unificado. */
export const migrarVocabularioRevisaoPpc = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const revisoes = yield* sql<{ id: string; plano: string }>`SELECT id, plano FROM revisao_ppc_revisoes_ia`;
  for (const r of revisoes) {
    const novo = migrarPlanoJson(r.plano);
    if (novo !== null) yield* sql`UPDATE revisao_ppc_revisoes_ia SET plano = ${novo} WHERE id = ${r.id}`;
  }
  const blocos = yield* sql<{ revisao_id: string; bloco_id: string; resultado: string }>`
    SELECT revisao_id, bloco_id, resultado FROM revisao_ppc_blocos_ia
  `;
  for (const b of blocos) {
    const novoId = migrarIdBloco(b.bloco_id);
    const novoRes = migrarResultadosJson(b.resultado);
    if (novoId !== b.bloco_id || novoRes !== null) {
      yield* sql`
        UPDATE revisao_ppc_blocos_ia
        SET bloco_id = ${novoId}, resultado = ${novoRes ?? b.resultado}
        WHERE revisao_id = ${b.revisao_id} AND bloco_id = ${b.bloco_id}
      `;
    }
  }
  const tentativas = yield* sql<{ revisao_id: string; bloco_id: string; numero: number }>`
    SELECT revisao_id, bloco_id, numero FROM revisao_ppc_tentativas_ia
  `;
  for (const t of tentativas) {
    const novoId = migrarIdBloco(t.bloco_id);
    if (novoId !== t.bloco_id) {
      yield* sql`
        UPDATE revisao_ppc_tentativas_ia
        SET bloco_id = ${novoId}
        WHERE revisao_id = ${t.revisao_id} AND bloco_id = ${t.bloco_id} AND numero = ${t.numero}
      `;
    }
  }
  const listas = yield* sql<{ id: string; resultados_ia: string | null }>`
    SELECT id, resultados_ia FROM revisao_ppc_listas_pendencias WHERE resultados_ia IS NOT NULL
  `;
  for (const l of listas) {
    if (l.resultados_ia === null) continue;
    const novo = migrarResultadosJson(l.resultados_ia);
    if (novo !== null) yield* sql`UPDATE revisao_ppc_listas_pendencias SET resultados_ia = ${novo} WHERE id = ${l.id}`;
  }
});
