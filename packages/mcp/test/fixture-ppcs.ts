/**
 * Banco de teste das ferramentas de PPCs e cursos (T3): o da `fixture.ts`, ampliado com normas,
 * relações, uma regra de transição, uma ficha, CNCT, ofertas, mais dois PPCs, citações, fatos,
 * matrizes do SUAP, uma seção longa e o índice FTS das seções. Os valores imitam os da base real
 * (Res. CNE/CP 1/2021 revogada pela 2/2026, art. 71), em escala mínima.
 */
import * as NodeSqlite from "node:sqlite";
import { emTransacao } from "@simplifica-if/kb/db/transacao";
import { radicais } from "@simplifica-if/kb/busca/tokens";
import { criarBancoFixture, type OpcoesFixture } from "./fixture.ts";

export const CURSO_ENFERMAGEM = "curitiba/tecnico-em-enfermagem";
export const CURSO_INFORMATICA = "curitiba/tecnico-em-informatica";
export const CURSO_FISICA = "foz-do-iguacu/licenciatura-em-fisica";
/** Os PPCs vigentes (chave `campus/curso/versao`). */
export const PPC_ENFERMAGEM = `${CURSO_ENFERMAGEM}/2023`;
export const PPC_INFORMATICA = `${CURSO_INFORMATICA}/2022`;
export const PPC_FISICA = `${CURSO_FISICA}/2019`;
/** PPC substituído de Enfermagem: fica na base, fora das consultas por padrão. */
export const PPC_ENFERMAGEM_ANTERIOR = `${CURSO_ENFERMAGEM}/2018`;
/** Seção acima do teto de `ler_secao` (pagina por linhas). */
export const SECAO_LONGA = `${PPC_ENFERMAGEM}#anexos-1`;
export const LINHAS_SECAO_LONGA = 1500;

const md = (ppc: string) => `base-conhecimento/institucional/ifpr/ppcs/${ppc}.md`;

const A_CONFIRMAR_2021 =
  "início de vigência de Resolução CNE/CP nº 1/2021 a confirmar (ato de 2021-01-05; publicação não registrada): presumida vigente";

export function criarBancoFixturePpcs(opcoes: OpcoesFixture = {}): string {
  const caminho = criarBancoFixture(opcoes);
  const db = new NodeSqlite.DatabaseSync(caminho);
  emTransacao(db, () => povoar(db));
  db.close();
  return caminho;
}

function povoar(db: NodeSqlite.DatabaseSync): void {
  const inserir = (tabela: string, linha: Record<string, string | number | null>) => {
    const colunas = Object.keys(linha);
    db.prepare(`INSERT INTO ${tabela} (${colunas.join(", ")}) VALUES (${colunas.map(() => "?").join(", ")})`).run(
      ...Object.values(linha),
    );
  };

  /* ---------- normas */
  const norma = (
    id: string,
    titulo: string,
    status: string,
    data: string,
    frontMatter: Record<string, string> | null,
  ) =>
    inserir("normas", {
      id,
      situacao: "base",
      titulo,
      data_publicacao: data,
      status_vigencia: status,
      ementa: `Ementa de ${titulo}.`,
      path: `base-conhecimento/normas/${id.replaceAll("/", "_")}.md`,
      aliases_json: JSON.stringify([titulo]),
      keywords_json: "[]",
      front_matter_json: frontMatter && JSON.stringify({ id, ...frontMatter }),
    });
  norma("br/cne-cp/res/2021/1", "Resolução CNE/CP nº 1/2021", "revogada", "2021-01-05", {
    assinada_em: "2021-01-05",
    publicada_em: "a confirmar",
    vigente_de: "a confirmar",
    vigencia_a_confirmar: A_CONFIRMAR_2021,
  });
  norma("br/cne-cp/res/2026/2", "Resolução CNE/CP nº 2/2026", "vigente", "2026-11-11", {
    assinada_em: "2026-11-11",
    publicada_em: "a confirmar",
    vigente_de: "a confirmar",
  });
  norma("br/lei/1996/9394", "Lei nº 9.394/1996", "vigente", "1996-12-20", {
    assinada_em: "1996-12-20",
    publicada_em: "1996-12-23",
    vigente_de: "1996-12-23",
  });
  inserir("relacoes", {
    ordem: 1,
    tipo: "revoga",
    origem: "br/cne-cp/res/2026/2",
    operador: "#art74-ii",
    alvo: "br/cne-cp/res/2021/1",
    efeito_de: "vigencia-da-origem",
    evidencia_em: "br/cne-cp/res/2026/2#art74-ii",
    evidencia_trecho: "a Resolução CNE/CP nº 1, de 5 de janeiro de 2021",
    confirmado_em: "2026-11-13",
    proposta: "front-matter",
    path: "base-conhecimento/relacoes.yaml",
  });
  inserir("transicoes", {
    id: "dcnept-2026-art71",
    norma_id: "br/cne-cp/res/2026/2",
    dispositivo: "#art71",
    tipo: "prazo-de-adequacao",
    norma_anterior: "br/cne-cp/res/2021/1",
    aplica_a: "Cursos técnicos e cursos superiores de tecnologia autorizados e em oferta.",
    regra:
      "Período de transição de até dois anos, a partir da vigência da Res. CNE/CP nº 2/2026, para a adequação dos cursos.",
    inicio: "vigencia",
    fim: "P2Y",
    inicio_minimo: "2026-11-11",
    evidencia: "é assegurado período de transição de até dois anos, a partir da vigência desta Resolução",
    path: "base-conhecimento/transicoes.yaml",
  });
  inserir("normas_citacoes", {
    norma_id: "br/cne-cp/res/2026/2",
    segmento: "#art71-parunico",
    citado_id: "br/cne-cp/res/2021/1",
    dispositivos_json: "[]",
    trecho: "Resolução CNE/CP nº 1/2021",
    path: "base-conhecimento/normas/br_cne-cp_res_2026_2.md",
    linha_inicio: 900,
  });
  const ficha = { id: "CT-CURR-12", referencias: [{ ref: "br/cne-cp/res/2021/1", dispositivo: "#art20" }] };
  inserir("fichas", {
    id: "CT-CURR-12",
    titulo: "Progressão formativa explicitada na organização curricular",
    path: "base-conhecimento/revisao-ppc/fichas/ct-curr-12.json",
    dados_json: JSON.stringify(ficha),
    arquivo_json: JSON.stringify(ficha, null, 2),
  });

  /* ---------- CNCT, cursos, ofertas */
  for (const [slug, nome, eixo] of [
    ["tecnico-em-enfermagem", "Técnico em Enfermagem", "Ambiente e Saúde"],
    ["tecnico-em-informatica", "Técnico em Informática", "Informação e Comunicação"],
  ] as const) {
    inserir("cnct", {
      id: `cnct:${slug}`,
      slug,
      denominacao: nome,
      eixo_tecnologico: eixo,
      carga_horaria_minima_h: 1200,
      dados_json: "{}",
    });
  }
  db.exec(
    `UPDATE cursos SET forma_oferta = 'subsequente', modalidade = 'presencial', situacao = 'ativo',
       cnct_id = 'cnct:tecnico-em-enfermagem', ppc_id = 'ppc:${PPC_ENFERMAGEM}',
       ppc_markdown_path = 'institucional/ifpr/ppcs/${PPC_ENFERMAGEM}.md', ppc_ano_documento = 2023,
       suap_id = 151, suap_codigo = 'CTB008', suap_matrizes_situacao = 'Única ativa'
     WHERE id = 'curso:${CURSO_ENFERMAGEM}'`,
  );
  db.exec(
    `UPDATE cursos SET forma_oferta = 'licenciatura', situacao = 'ativo', ppc_id = 'ppc:${PPC_FISICA}',
       ppc_markdown_path = 'institucional/ifpr/ppcs/${PPC_FISICA}.md', ppc_ano_documento = 2019
     WHERE id = 'curso:${CURSO_FISICA}'`,
  );
  inserir("cursos", {
    id: `curso:${CURSO_INFORMATICA}`,
    campus_id: "curitiba",
    curso_slug: "tecnico-em-informatica",
    nome: "Técnico em Informática",
    nivel: "médio",
    forma_oferta: "integrado",
    modalidade: "presencial",
    situacao: "ativo",
    cnct_id: "cnct:tecnico-em-informatica",
    ppc_id: `ppc:${PPC_INFORMATICA}`,
    ppc_markdown_path: `institucional/ifpr/ppcs/${PPC_INFORMATICA}.md`,
    ppc_ano_documento: 2022,
    path: `base-conhecimento/institucional/ifpr/cursos/${CURSO_INFORMATICA}.json`,
  });
  // Curso técnico em oferta sem PPC convertido: indicador sem-ppc-convertido.
  inserir("cursos", {
    id: "curso:foz-do-iguacu/tecnico-em-aquicultura",
    campus_id: "foz-do-iguacu",
    curso_slug: "tecnico-em-aquicultura",
    nome: "Técnico em Aquicultura",
    nivel: "médio",
    forma_oferta: "subsequente",
    situacao: "ativo",
    path: "base-conhecimento/institucional/ifpr/cursos/foz-do-iguacu/tecnico-em-aquicultura.json",
  });
  for (const [id, curso, turno, vagas, processo] of [
    ["o1", CURSO_ENFERMAGEM, "matutino", 30, "processo-seletivo-2026"],
    ["o2", CURSO_ENFERMAGEM, "matutino", 30, "processo-seletivo-2025"],
    ["o3", CURSO_INFORMATICA, "noturno", 40, "processo-seletivo-2026"],
  ] as const) {
    inserir("ofertas", {
      id: `oferta:${id}`,
      oferta_id: id,
      curso_nome: curso,
      tipo_oferta: "subsequente",
      vagas,
      turno,
      url_fonte: "https://exemplo.ifpr.edu.br/edital.pdf",
      editais_json: "[]",
      path: `base-conhecimento/institucional/ifpr/ofertas/${id}.json`,
      linha_turno: 7,
    });
    inserir("ofertas_cursos", { oferta_id: `oferta:${id}`, curso_id: `curso:${curso}` });
    inserir("ofertas_processos", { oferta_id: `oferta:${id}`, processo_id: processo });
  }

  /* ---------- PPCs, seções, citações e fatos */
  for (const [ppc, campus, campusNome, slug, nome, nivel, forma] of [
    [PPC_INFORMATICA, "curitiba", "Curitiba", "tecnico-em-informatica", "Técnico em Informática", "médio", "integrado"],
    [
      PPC_FISICA,
      "foz-do-iguacu",
      "Foz do Iguaçu",
      "licenciatura-em-fisica",
      "Licenciatura em Física",
      "superior",
      "licenciatura",
    ],
  ] as const) {
    inserir("ppcs", {
      id: `ppc:${ppc}`,
      chave: ppc,
      chave_curso: ppc.split("/").slice(0, 2).join("/"),
      versao: ppc.split("/")[2]!,
      vigente: 1,
      campus_id: campus,
      campus_nome: campusNome,
      curso_slug: slug,
      curso_nome: nome,
      curso_id: `curso:${ppc.split("/").slice(0, 2).join("/")}`,
      nivel,
      tipo_oferta: forma,
      path: md(ppc),
      linhas: 400,
      caracteres: 20000,
      proveniencia_json: "{}",
    });
  }
  db.exec(`UPDATE ppcs SET curso_id = 'curso:${CURSO_ENFERMAGEM}' WHERE id = 'ppc:${PPC_ENFERMAGEM}'`);
  inserir("ppcs", {
    id: `ppc:${PPC_ENFERMAGEM_ANTERIOR}`,
    chave: PPC_ENFERMAGEM_ANTERIOR,
    chave_curso: CURSO_ENFERMAGEM,
    versao: "2018",
    vigente: 0,
    substituido_por: `ppc:${PPC_ENFERMAGEM}`,
    campus_id: "curitiba",
    campus_nome: "Curitiba",
    curso_slug: "tecnico-em-enfermagem",
    curso_nome: "Técnico em Enfermagem",
    curso_id: `curso:${CURSO_ENFERMAGEM}`,
    nivel: "médio",
    tipo_oferta: "subsequente",
    ano_documento: 2018,
    path: md(PPC_ENFERMAGEM_ANTERIOR),
    linhas: 200,
    caracteres: 9000,
    proveniencia_json: "{}",
  });

  const longa = Array.from({ length: LINHAS_SECAO_LONGA }, (_, i) => `Linha ${i + 1} do anexo com o plano de estágio.`);
  for (const [ppc, secao, tipo, titulo, inicio, texto] of [
    [
      PPC_INFORMATICA,
      "estagio_praticas-1",
      "estagio_praticas",
      "Estágio supervisionado",
      150,
      "O estágio obrigatório tem 120 horas.",
    ],
    [PPC_FISICA, "avaliacao-1", "avaliacao", "Avaliação da aprendizagem", 90, "A avaliação é contínua e diagnóstica."],
    [PPC_ENFERMAGEM, "anexos-1", "anexos", "Anexo I", 1000, longa.join("\n")],
    [
      PPC_ENFERMAGEM_ANTERIOR,
      "estagio_praticas-1",
      "estagio_praticas",
      "Estágio supervisionado",
      80,
      "O estágio obrigatório tem 400 horas.",
    ],
  ] as const) {
    const linhas = texto.split("\n").length;
    inserir("secoes", {
      id: `${ppc}#${secao}`,
      ppc_id: `ppc:${ppc}`,
      tipo,
      titulo,
      path: md(ppc),
      linha_inicio: inicio,
      linha_fim: inicio + 1 + linhas,
      linha_texto: inicio + 2,
      texto,
    });
  }
  // Índice FTS de todas as seções, como na compilação (radicais do título e do texto).
  const secoes = db.prepare("SELECT rowid, titulo, texto FROM secoes ORDER BY rowid").all() as {
    rowid: number;
    titulo: string;
    texto: string;
  }[];
  for (const s of secoes) {
    db.prepare(
      "INSERT INTO secoes_fts (rowid, titulo, texto, titulo_radicais, radicais, expansao) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(s.rowid, s.titulo, s.texto, radicais(s.titulo).join(" "), radicais(s.texto).join(" "), "");
  }

  let ordem = 0;
  const citacao = (
    ppc: string,
    linha: number,
    trecho: string,
    ato: string | null,
    regra: string,
    confianca: number,
    dispositivos: string[] = [],
  ) =>
    inserir("citacoes", {
      ppc_id: `ppc:${ppc}`,
      ordem: (ordem += 1),
      linha,
      trecho,
      norma_id: ato,
      dispositivos_json: JSON.stringify(dispositivos),
      regra,
      confianca,
      situacao: ato ? "base" : "nao-resolvida",
      papel: "fundamentacao",
      path: md(ppc),
    });
  citacao(PPC_ENFERMAGEM, 213, "Resolução nº 1/2021, art. 20", "br/cne-cp/res/2021/1", "orgao-no-documento", 0.85, [
    "#art20",
  ]);
  citacao(PPC_ENFERMAGEM, 661, "Resolução CNE/CP nº 1/2021", "br/cne-cp/res/2021/1", "estrutural", 0.98);
  citacao(PPC_ENFERMAGEM, 700, "Lei nº 9.394/1996, art. 36", "br/lei/1996/9394", "estrutural", 0.98, ["#art36"]);
  citacao(PPC_ENFERMAGEM, 710, "Resolução nº 99/2099", null, "sem-ano", 0.3);
  citacao(PPC_INFORMATICA, 30, "Resolução CNE/CP nº 1/2021", "br/cne-cp/res/2021/1", "estrutural", 0.98);
  citacao(PPC_FISICA, 40, "Lei nº 9.394/1996", "br/lei/1996/9394", "estrutural", 0.98);
  citacao(PPC_ENFERMAGEM_ANTERIOR, 20, "Resolução CNE/CP nº 1/2021", "br/cne-cp/res/2021/1", "estrutural", 0.98);

  for (const [fato, valor, num, unidade, trecho, linha] of [
    ["carga_horaria_total_h", "1600", 1600, "h", "Carga horária total em hora relógio: 1.600 horas", 122],
    [
      "estagio_obrigatorio",
      "sim",
      null,
      null,
      "Carga horária de Prática Profissional Supervisionada (estágio curricular): 400 horas",
      126,
    ],
  ] as const) {
    inserir("ppc_fatos", {
      ppc_id: `ppc:${PPC_ENFERMAGEM}`,
      fato,
      valor,
      valor_num: num,
      unidade,
      status_curadoria: "extraido",
      regra: "rotulo-corpo",
      trecho_fonte: trecho,
      path: md(PPC_ENFERMAGEM),
      linha,
      alternativas_json: "[]",
    });
  }
  inserir("ppc_suap", {
    ppc_id: `ppc:${PPC_ENFERMAGEM}`,
    aspecto: "carga_horaria",
    resultado: "confere",
    valor_ppc: "1600",
    valor_suap: "1600",
    explicacao: "igual à matriz 538 (2024): 1600 h",
  });
  inserir("ppc_suap", {
    ppc_id: `ppc:${PPC_ENFERMAGEM}`,
    aspecto: "estagio",
    resultado: "diverge",
    valor_ppc: "sim",
    valor_suap: "não",
    explicacao: "PPC prevê estágio obrigatório; SUAP não exige",
  });
  inserir("ppc_suap", {
    ppc_id: `ppc:${PPC_INFORMATICA}`,
    aspecto: "carga_horaria",
    resultado: "sem-fato-ppc",
    explicacao: "o PPC não declara a carga horária total",
  });
  inserir("suap_matrizes", {
    curso_id: `curso:${CURSO_ENFERMAGEM}`,
    ordem: 0,
    matriz_id: 538,
    descricao: "TÉCNICO EM ENFERMAGEM SUBSEQUENTE - 2024 CURITIBA",
    ano: 2024,
    ch_exibida_h: 1600,
    estagio_exigido: 0,
    trecho: "538 — TÉCNICO EM ENFERMAGEM SUBSEQUENTE - 2024 CURITIBA — CH exibida: 1600 h; estágio exigido: Não",
    path: `base-conhecimento/institucional/ifpr/cursos/${CURSO_ENFERMAGEM}.json`,
    linha: 18,
  });
}
