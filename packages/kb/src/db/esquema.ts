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
 * - `meta`: versão do esquema, data de referência, hashes das fontes e contagens; `versao`, `commit` e
 *   `canal` só quando o build os informa (nada vem do relógio);
 * - FTS5 sem conteúdo próprio (`content=''`): o texto fica uma vez só, nas tabelas comuns, e o
 *   `rowid` do FTS é o da tabela de origem.
 */

export const VERSAO_ESQUEMA = 4;

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

-- Metadados de cada norma (título, aliases, palavras-chave, ementa) para a busca pela identidade da
-- norma; o texto normativo está em dispositivos. path/linha: o Markdown (linha 1) ou o stub em stubs.yaml.
CREATE TABLE normas_metadados (
  rowid INTEGER PRIMARY KEY,
  norma_id TEXT NOT NULL UNIQUE REFERENCES normas(id),
  texto TEXT NOT NULL,
  path TEXT NOT NULL,
  linha INTEGER NOT NULL
);

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
  -- tamanho do arquivo em caracteres (String.length, fim de linha como no arquivo): o pacote de
  -- contexto compara o pacote com o PPC inteiro sem abrir o Markdown
  caracteres INTEGER NOT NULL,
  proveniencia_json TEXT NOT NULL
);

-- Markdown integral das normas da base e dos PPCs, como está no arquivo (front matter incluído, quebras
-- de linha LF), para o leitor do app (M1.6), que gera o HTML na hora. path: o mesmo de normas.path e ppcs.path.
CREATE TABLE documentos (
  rowid INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  texto TEXT NOT NULL
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

-- Fichas da revisar-ppc, referências estruturadas, tópicos e marcos normativos.
CREATE TABLE fichas (
  id TEXT PRIMARY KEY,
  titulo TEXT NOT NULL,
  dominio TEXT,
  criticidade TEXT,
  tipo_escopo TEXT,
  pergunta TEXT,
  rubrica TEXT,
  path TEXT NOT NULL,
  dados_json TEXT NOT NULL,
  -- o arquivo da ficha em JSON compacto, com as chaves na ordem do arquivo (dados_json segue o
  -- esquema de leitura): o impacto percorre os textos da ficha nessa ordem
  arquivo_json TEXT NOT NULL
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

-- ordem: a do arquivo (topicos-fichas.json), que decide o grupo da ficha e a ordem dos grupos;
-- dados_json: o tópico como no arquivo.
CREATE TABLE topicos (
  id TEXT PRIMARY KEY,
  ordem INTEGER NOT NULL UNIQUE,
  titulo TEXT NOT NULL,
  grupo TEXT,
  tipo_escopo TEXT,
  descricao TEXT,
  termos_json TEXT NOT NULL,
  path TEXT NOT NULL,
  dados_json TEXT NOT NULL
);

-- Tópicos das fichas → tipos de seção do PPC (packages/kb/dados/topicos-secoes.yaml), na ordem do arquivo.
CREATE TABLE topicos_secoes (
  ordem INTEGER PRIMARY KEY,
  topico TEXT NOT NULL UNIQUE,
  tipos_json TEXT NOT NULL,
  path TEXT NOT NULL
);

-- Léxico da busca de seções (packages/kb/dados/sinonimos.yaml), na ordem do arquivo: termos de cada
-- tipo de seção (expansão do documento) e grupos de termos equivalentes (expansão da consulta).
CREATE TABLE sinonimos_tipos (
  ordem INTEGER PRIMARY KEY,
  tipo TEXT NOT NULL UNIQUE,
  termos_json TEXT NOT NULL
);
CREATE TABLE sinonimos_grupos (
  ordem INTEGER PRIMARY KEY,
  termos_json TEXT NOT NULL
);

CREATE TABLE fichas_topicos (
  ficha_id TEXT NOT NULL,
  topico_id TEXT NOT NULL,
  PRIMARY KEY (ficha_id, topico_id)
) WITHOUT ROWID;

-- vigente e normas_json (linha, data_referencia, vigente, substitui, antecessoras_historicas,
-- dispositivos_revogados) derivados por derivarLinha (fase 5) na data_referencia.
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

-- Fase 5 (carga por FontesNormativas: normas/fontes-db.ts sobre a API de normas/).
-- Dispositivos de todas as normas da base, compilação da LDB inclusive (id com ~variante);
-- canonico = 1 no dispositivo que o índice do ato usa (o texto integral prevalece).
CREATE TABLE dispositivos (
  rowid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  ato_id TEXT NOT NULL,
  norma_id TEXT NOT NULL,
  dispositivo TEXT NOT NULL,
  tipo TEXT NOT NULL,
  rotulo TEXT NOT NULL,
  pai TEXT,
  ordem INTEGER NOT NULL,
  texto TEXT NOT NULL,
  caput_json TEXT NOT NULL,
  texto_com_caput TEXT NOT NULL,
  estrutura_json TEXT NOT NULL,
  notas_json TEXT NOT NULL,
  revogado INTEGER NOT NULL,
  vetado INTEGER NOT NULL,
  canonico INTEGER NOT NULL,
  path TEXT NOT NULL,
  linha_inicio INTEGER NOT NULL,
  linha_fim INTEGER NOT NULL
);
CREATE INDEX dispositivos_ato ON dispositivos(ato_id, dispositivo);
CREATE INDEX dispositivos_norma ON dispositivos(norma_id, ordem);

-- Só os dispositivos canônicos. texto: texto_com_caput em tokens; radicais: radicais Snowball dele.
CREATE VIRTUAL TABLE dispositivos_fts USING fts5(
  texto, radicais, content='', columnsize=1, ${TOKENIZADOR}
);

CREATE TABLE relacoes (
  ordem INTEGER PRIMARY KEY,
  tipo TEXT NOT NULL,
  origem TEXT NOT NULL,
  operador TEXT,
  alvo TEXT NOT NULL,
  alvo_dispositivo TEXT,
  alcance TEXT,
  efeito_de TEXT NOT NULL,
  efeito_em TEXT,
  efeito_minimo TEXT,
  evidencia_em TEXT NOT NULL,
  evidencia_trecho TEXT NOT NULL,
  confirmado_em TEXT,
  proposta TEXT NOT NULL,
  nota TEXT,
  path TEXT NOT NULL
);
CREATE INDEX relacoes_alvo ON relacoes(alvo);
CREATE INDEX relacoes_origem ON relacoes(origem);

-- statusEm em intervalos: [de, ate), null = aberto. A consulta escolhe a data; nada do relógio.
CREATE TABLE vigencias (
  alvo TEXT NOT NULL,
  ordem INTEGER NOT NULL,
  de TEXT,
  ate TEXT,
  status TEXT NOT NULL,
  certo INTEGER NOT NULL,
  fonte TEXT NOT NULL,
  PRIMARY KEY (alvo, ordem)
) WITHOUT ROWID;

-- Regras de transição; a situação numa data sai de situacaoNaData(inicio_em, inicio_minimo, fim_em, fim).
CREATE TABLE transicoes (
  id TEXT PRIMARY KEY,
  norma_id TEXT NOT NULL,
  dispositivo TEXT NOT NULL,
  tipo TEXT NOT NULL,
  norma_anterior TEXT,
  aplica_a TEXT NOT NULL,
  regra TEXT NOT NULL,
  inicio TEXT NOT NULL,
  fim TEXT NOT NULL,
  inicio_em TEXT,
  inicio_minimo TEXT,
  fim_em TEXT,
  evidencia TEXT NOT NULL,
  path TEXT NOT NULL
);
CREATE INDEX transicoes_norma ON transicoes(norma_id);

-- Citações resolvidas no texto das normas da base (dispositivos e preâmbulo), uma por citação com
-- ID, para o impacto sem reprocessar os Markdown (normas/citacoes-normas.ts). Ordem: normas por
-- caminho, segmentos e citações na ordem do texto. segmento: sufixo do dispositivo citante
-- (#art5-ii) ou 'preâmbulo'.
CREATE TABLE normas_citacoes (
  rowid INTEGER PRIMARY KEY,
  norma_id TEXT NOT NULL,
  ato_id TEXT NOT NULL,
  segmento TEXT NOT NULL,
  citado_id TEXT NOT NULL,
  citado_ato TEXT NOT NULL,
  dispositivos_json TEXT NOT NULL,
  trecho TEXT NOT NULL,
  path TEXT NOT NULL,
  linha_inicio INTEGER NOT NULL
);
CREATE INDEX normas_citacoes_citado ON normas_citacoes(citado_ato);
CREATE INDEX transicoes_anterior ON transicoes(norma_anterior);

CREATE TABLE correspondencias_tabelas (
  arquivo TEXT PRIMARY KEY,
  origem TEXT NOT NULL,
  destino TEXT NOT NULL,
  status TEXT NOT NULL,
  elaborado_em TEXT,
  revisado_por TEXT,
  metodo TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE correspondencias (
  tabela TEXT NOT NULL REFERENCES correspondencias_tabelas(arquivo),
  ordem INTEGER NOT NULL,
  origem TEXT NOT NULL,
  tipo TEXT NOT NULL,
  destino_json TEXT NOT NULL,
  nota TEXT,
  PRIMARY KEY (tabela, ordem)
) WITHOUT ROWID;
CREATE INDEX correspondencias_origem ON correspondencias(origem);
`;
