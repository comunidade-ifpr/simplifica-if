/**
 * Esquema SQL do `kb.sqlite`. O banco é derivado dos arquivos do git (Princípio 1) e recriado
 * inteiro a cada compilação; não há migração. Mudou o esquema, sobe `VERSAO_ESQUEMA`.
 *
 * Convenções:
 * - IDs canônicos do plano (`br/cne-cp/res/2026/2`, `ppc:curitiba/tecnico-em-enfermagem`,
 *   `curso:curitiba/tecnico-em-enfermagem`, `cnct:tecnico-em-enfermagem`, `ficha:CT-CURR-12` sem o
 *   prefixo na coluna `id` da ficha);
 * - toda linha com texto tem a proveniência: `path` (relativo à raiz do repositório, salvo onde dito)
 *   e linhas (`linha`, `linha_inicio`, `linha_fim`, desde 1, no arquivo com o front matter);
 * - listas e objetos auxiliares em colunas `*_json` (JSON compacto, chaves na ordem do arquivo).
 * - FTS5 sem conteúdo próprio (`content=''`): o texto fica uma vez só, nas tabelas comuns, e o
 *   `rowid` do FTS é o da tabela de origem.
 */

export const VERSAO_ESQUEMA = 1;

const TOKENIZADOR = `tokenize="unicode61 remove_diacritics 2"`;

export const DDL = `
CREATE TABLE meta (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
) WITHOUT ROWID;

-- Normas: manifest.json (situacao 'base'), stubs.yaml ('stub' e 'externo').
CREATE TABLE normas (
  id TEXT PRIMARY KEY,
  situacao TEXT NOT NULL,
  titulo TEXT NOT NULL,
  tipo_documento TEXT,
  numero TEXT,
  ano INTEGER,
  orgao TEXT,
  jurisdicao TEXT,
  data_publicacao TEXT,
  status_vigencia TEXT,
  status_fonte TEXT,
  ementa TEXT,
  fonte TEXT,
  curadoria TEXT,
  -- Markdown, relativo à raiz do repositório (null em stub e externo)
  path TEXT,
  aliases_json TEXT NOT NULL,
  keywords_json TEXT NOT NULL,
  -- front matter do Markdown (null em stub e externo)
  front_matter_json TEXT
);

-- Texto das normas por bloco (título até o próximo título), como os Markdown estão hoje.
CREATE TABLE normas_blocos (
  rowid INTEGER PRIMARY KEY,
  norma_id TEXT NOT NULL REFERENCES normas(id),
  ordem INTEGER NOT NULL,
  titulo TEXT,
  nivel INTEGER NOT NULL,
  caminho TEXT NOT NULL,
  artigo TEXT,
  dispositivo TEXT,
  path TEXT NOT NULL,
  linha_inicio INTEGER NOT NULL,
  linha_fim INTEGER NOT NULL,
  texto TEXT NOT NULL
);
CREATE INDEX normas_blocos_norma ON normas_blocos(norma_id, ordem);
CREATE INDEX normas_blocos_artigo ON normas_blocos(norma_id, artigo);

-- Metadados da norma (título, aliases, palavras-chave, ementa) e texto dos blocos.
CREATE VIRTUAL TABLE normas_fts USING fts5(
  titulo, texto, radicais, content='', columnsize=1, ${TOKENIZADOR}
);

CREATE TABLE campi (
  id TEXT PRIMARY KEY,
  campus_id TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  site TEXT,
  path TEXT NOT NULL
);

CREATE TABLE cnct (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  denominacao TEXT NOT NULL,
  eixo_tecnologico TEXT NOT NULL,
  area_tecnologica TEXT,
  carga_horaria_minima_h INTEGER,
  -- arquivo do curso no catálogo, relativo à raiz do repositório
  path TEXT,
  dados_json TEXT NOT NULL
);
CREATE INDEX cnct_eixo ON cnct(eixo_tecnologico);

CREATE TABLE cursos (
  id TEXT PRIMARY KEY,
  campus_id TEXT NOT NULL,
  curso_slug TEXT NOT NULL,
  nome TEXT NOT NULL,
  nivel TEXT,
  forma_oferta TEXT,
  modalidade TEXT,
  situacao TEXT,
  pagina_oficial TEXT,
  cnct_id TEXT,
  cnct_ausencia TEXT,
  suap_id INTEGER,
  suap_codigo TEXT,
  suap_vagas INTEGER,
  suap_matrizes_situacao TEXT,
  suap_ch_comum_h INTEGER,
  ppc_id TEXT,
  ppc_url TEXT,
  ppc_markdown_path TEXT,
  ppc_ano_documento INTEGER,
  ppc_curadoria_ano TEXT,
  path TEXT NOT NULL
);
CREATE INDEX cursos_campus ON cursos(campus_id);
CREATE INDEX cursos_cnct ON cursos(cnct_id);

-- Matrizes do SUAP (uma por linha de suap.matrizes.resumo).
CREATE TABLE suap_matrizes (
  curso_id TEXT NOT NULL REFERENCES cursos(id),
  ordem INTEGER NOT NULL,
  matriz_id INTEGER NOT NULL,
  descricao TEXT NOT NULL,
  ano INTEGER,
  ch_exibida_h INTEGER NOT NULL,
  estagio_exigido INTEGER NOT NULL,
  ch_estagio_h INTEGER,
  trecho TEXT NOT NULL,
  path TEXT NOT NULL,
  linha INTEGER NOT NULL,
  PRIMARY KEY (curso_id, ordem)
) WITHOUT ROWID;

CREATE TABLE processos (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  ano_ingresso INTEGER,
  status_curadoria TEXT,
  path TEXT NOT NULL
);

CREATE TABLE editais (
  id TEXT PRIMARY KEY,
  titulo TEXT NOT NULL,
  url TEXT NOT NULL,
  numero TEXT,
  ano INTEGER,
  tipo TEXT,
  processos_json TEXT NOT NULL,
  path TEXT NOT NULL
);

-- id: <processo>/<oferta_id> (o caminho em dados/institucional/ofertas/), porque o oferta_id se repete entre processos.
CREATE TABLE ofertas (
  id TEXT PRIMARY KEY,
  oferta_id TEXT NOT NULL,
  curso_nome TEXT NOT NULL,
  tipo_oferta TEXT NOT NULL,
  vagas INTEGER,
  turno TEXT,
  turno_original TEXT,
  turno_nota TEXT,
  modalidade TEXT,
  status_curadoria TEXT,
  campus_id TEXT,
  url_fonte TEXT NOT NULL,
  pagina_fonte INTEGER,
  trecho_fonte TEXT,
  editais_json TEXT NOT NULL,
  path TEXT NOT NULL,
  linha_turno INTEGER NOT NULL
);

CREATE TABLE ofertas_processos (
  oferta_id TEXT NOT NULL REFERENCES ofertas(id),
  processo_id TEXT NOT NULL,
  PRIMARY KEY (oferta_id, processo_id)
) WITHOUT ROWID;

CREATE TABLE ofertas_cursos (
  oferta_id TEXT NOT NULL REFERENCES ofertas(id),
  curso_id TEXT NOT NULL,
  PRIMARY KEY (oferta_id, curso_id)
) WITHOUT ROWID;
CREATE INDEX ofertas_cursos_curso ON ofertas_cursos(curso_id);

-- PPCs convertidos (index.json + front matter de proveniência).
CREATE TABLE ppcs (
  id TEXT PRIMARY KEY,
  chave TEXT NOT NULL UNIQUE,
  campus_id TEXT NOT NULL,
  campus_nome TEXT NOT NULL,
  curso_slug TEXT NOT NULL,
  curso_nome TEXT NOT NULL,
  curso_id TEXT,
  nivel TEXT NOT NULL,
  taxonomia TEXT,
  tipo_oferta TEXT NOT NULL,
  ano_documento INTEGER,
  curso_url TEXT,
  fonte_pdf TEXT,
  path TEXT NOT NULL,
  linhas INTEGER NOT NULL,
  proveniencia_json TEXT NOT NULL
);

-- Seções do índice v2, com o texto integral recortado pelas linhas (lerTextoSecao).
CREATE TABLE secoes (
  rowid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  ppc_id TEXT NOT NULL REFERENCES ppcs(id),
  tipo TEXT NOT NULL,
  origem_tipo TEXT,
  titulo TEXT NOT NULL,
  numeracao TEXT,
  path TEXT NOT NULL,
  linha_inicio INTEGER NOT NULL,
  linha_fim INTEGER NOT NULL,
  -- linha do arquivo em que começa o texto (o corpo sem as linhas vazias do início)
  linha_texto INTEGER NOT NULL,
  texto TEXT NOT NULL
);
CREATE INDEX secoes_ppc ON secoes(ppc_id, linha_inicio);
CREATE INDEX secoes_tipo ON secoes(tipo);

-- titulo/texto: tokens unicode61; titulo_radicais/radicais: radicais Snowball (busca/tokens.ts);
-- expansao: radicais do léxico do tipo da seção (packages/kb/dados/sinonimos.yaml).
CREATE VIRTUAL TABLE secoes_fts USING fts5(
  titulo, texto, titulo_radicais, radicais, expansao, content='', columnsize=1, ${TOKENIZADOR}
);

-- Citações normativas dos PPCs (resolvedor da fase 2), com a seção e o papel.
CREATE TABLE citacoes (
  ppc_id TEXT NOT NULL REFERENCES ppcs(id),
  ordem INTEGER NOT NULL,
  linha INTEGER NOT NULL,
  trecho TEXT NOT NULL,
  norma_id TEXT,
  ato_id TEXT,
  dispositivos_json TEXT NOT NULL,
  regra TEXT NOT NULL,
  confianca REAL NOT NULL,
  situacao TEXT NOT NULL,
  secao_id TEXT,
  secao_tipo TEXT,
  -- fundamento | referencia-bibliografica
  papel TEXT NOT NULL,
  path TEXT NOT NULL,
  PRIMARY KEY (ppc_id, ordem)
) WITHOUT ROWID;
CREATE INDEX citacoes_ato ON citacoes(ato_id);

-- Fatos de PPC: extraídos do texto (status 'extraido') ou vindos de dados/institucional.
CREATE TABLE ppc_fatos (
  ppc_id TEXT NOT NULL REFERENCES ppcs(id),
  fato TEXT NOT NULL,
  valor TEXT NOT NULL,
  valor_num INTEGER,
  unidade TEXT,
  status_curadoria TEXT NOT NULL,
  regra TEXT NOT NULL,
  trecho_fonte TEXT NOT NULL,
  path TEXT NOT NULL,
  linha INTEGER NOT NULL,
  alternativas_json TEXT NOT NULL,
  PRIMARY KEY (ppc_id, fato)
) WITHOUT ROWID;

-- Cruzamento PPC × SUAP (fatos/divergencias.ts).
CREATE TABLE ppc_suap (
  ppc_id TEXT NOT NULL REFERENCES ppcs(id),
  aspecto TEXT NOT NULL,
  resultado TEXT NOT NULL,
  valor_ppc TEXT,
  valor_suap TEXT,
  explicacao TEXT NOT NULL,
  PRIMARY KEY (ppc_id, aspecto)
) WITHOUT ROWID;

-- Fichas da analise-ppc, referências estruturadas, tópicos e marcos normativos.
CREATE TABLE fichas (
  id TEXT PRIMARY KEY,
  titulo TEXT NOT NULL,
  dominio TEXT,
  criticidade TEXT,
  tipo_escopo TEXT,
  pergunta TEXT,
  rubrica TEXT,
  path TEXT NOT NULL,
  dados_json TEXT NOT NULL
);

CREATE TABLE fichas_referencias (
  ficha_id TEXT NOT NULL REFERENCES fichas(id),
  ordem INTEGER NOT NULL,
  ref TEXT NOT NULL,
  dispositivo TEXT,
  papel TEXT NOT NULL,
  nota TEXT,
  PRIMARY KEY (ficha_id, ordem)
) WITHOUT ROWID;
CREATE INDEX fichas_referencias_ref ON fichas_referencias(ref);

CREATE TABLE topicos (
  id TEXT PRIMARY KEY,
  titulo TEXT NOT NULL,
  grupo TEXT,
  tipo_escopo TEXT,
  descricao TEXT,
  termos_json TEXT NOT NULL,
  path TEXT NOT NULL
);

CREATE TABLE fichas_topicos (
  ficha_id TEXT NOT NULL,
  topico_id TEXT NOT NULL,
  PRIMARY KEY (ficha_id, topico_id)
) WITHOUT ROWID;

CREATE TABLE marcos (
  id TEXT PRIMARY KEY,
  tema TEXT NOT NULL,
  vigente TEXT NOT NULL,
  aplica_a TEXT,
  transicao TEXT,
  orientacao_analise TEXT,
  normas_json TEXT NOT NULL,
  path TEXT NOT NULL,
  dados_json TEXT NOT NULL
);

-- Fase 5 (carga por FontesNormativas, em fontes-normativas.ts; vazias até o merge).
CREATE TABLE dispositivos (
  id TEXT PRIMARY KEY,
  norma_id TEXT NOT NULL,
  dispositivo TEXT NOT NULL,
  pai TEXT,
  ordem INTEGER NOT NULL,
  rotulo TEXT NOT NULL,
  texto TEXT NOT NULL,
  texto_com_caput TEXT NOT NULL,
  path TEXT NOT NULL,
  linha_inicio INTEGER NOT NULL,
  linha_fim INTEGER NOT NULL,
  notas_json TEXT NOT NULL
);
CREATE INDEX dispositivos_norma ON dispositivos(norma_id, ordem);

CREATE TABLE relacoes (
  origem TEXT NOT NULL,
  alvo TEXT NOT NULL,
  tipo TEXT NOT NULL,
  efeito_de TEXT,
  dispositivo_operador TEXT,
  curadoria TEXT NOT NULL,
  fonte TEXT,
  PRIMARY KEY (origem, alvo, tipo)
) WITHOUT ROWID;
CREATE INDEX relacoes_alvo ON relacoes(alvo);

CREATE TABLE vigencias (
  alvo TEXT NOT NULL,
  vigente_de TEXT,
  vigente_ate TEXT,
  fonte TEXT NOT NULL
);
CREATE INDEX vigencias_alvo ON vigencias(alvo);

CREATE TABLE transicoes (
  id TEXT PRIMARY KEY,
  norma_id TEXT NOT NULL,
  dispositivo TEXT,
  descricao TEXT NOT NULL,
  inicio TEXT,
  fim TEXT,
  aplica_a TEXT NOT NULL
);

CREATE TABLE correspondencias (
  origem TEXT NOT NULL,
  alvo TEXT,
  tipo TEXT NOT NULL,
  nota TEXT,
  curadoria TEXT NOT NULL
);
CREATE INDEX correspondencias_origem ON correspondencias(origem);
`;
