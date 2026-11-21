// @effect-diagnostics nodeBuiltinImport:off -- fixture de teste: lê a ficha real da revisão de PPC do checkout
/**
 * O que o Explorar do app precisa além das normas da fixture (`fixture.ts` + `fixture-normas.ts`): o
 * CNCT do Técnico em Enfermagem ligado ao curso, ofertas, os horários e o calendário de um campus,
 * uma reunião do Consepe com um item ligado ao curso, uma ficha da revisão de PPC, fatos do PPC com uma
 * divergência PPC × SUAP e o índice FTS das seções. É o banco do servidor de teste da interface
 * (`apps/web/test/servidor-teste.ts`) e o dos testes do RPC do Explorar.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { radicais } from "@simplifica-if/kb/busca/tokens";
import { emTransacao } from "@simplifica-if/kb/db/transacao";

export const CURSO_ENFERMAGEM = "curitiba/tecnico-em-enfermagem";
export const REUNIAO_CONSEPE = "consepe:reuniao:2026-03-20";

const MD_ENFERMAGEM = "base-conhecimento/institucional/ifpr/ppcs/curitiba/tecnico-em-enfermagem.md";

/** Acrescenta os dados do Explorar ao banco em `caminho` (criado por `criarBancoFixture` + `inserirNormas`). */
export function inserirExplorar(caminho: string): void {
  const db = new NodeSqlite.DatabaseSync(caminho);
  const inserir = (tabela: string, linha: Record<string, string | number | null>) => {
    const colunas = Object.keys(linha);
    db.prepare(`INSERT INTO ${tabela} (${colunas.join(", ")}) VALUES (${colunas.map(() => "?").join(", ")})`).run(
      ...Object.values(linha),
    );
  };
  emTransacao(db, () => {
    db.exec(
      `UPDATE campi SET site = 'https://curitiba.ifpr.edu.br/',
         calendario_academico = 'https://ifpr.edu.br/curitiba/calendario/',
         horarios_url = 'https://ifpr.edu.br/curitiba/horarios/', horarios_coletado_em = '2026-05-14T11:48:00.000-03:00'
       WHERE campus_id = 'curitiba'`,
    );

    // o JSON de cada curso no formato do catálogo: a revisão prévia do servidor de teste o lê inteiro
    const cursoCnct = (slug: string, denominacao: string, eixo: string, campos: Record<string, string>) =>
      inserir("cnct", {
        id: `cnct:${slug}`,
        slug,
        denominacao,
        eixo_tecnologico: eixo,
        carga_horaria_minima_h: 1200,
        path: `base-conhecimento/catalogos/cnct/cursos/${slug}.json`,
        dados_json: JSON.stringify({
          id: slug,
          denominacao,
          denominacao_normalizada: denominacao.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, ""),
          eixo_tecnologico: eixo,
          carga_horaria_minima_horas: "1200",
          ...campos,
        }),
      });
    cursoCnct("tecnico-em-enfermagem", "Técnico em Enfermagem", "Ambiente e Saúde", {
      perfil_profissional: "Atua na promoção, prevenção, recuperação e reabilitação da saúde.",
      campo_atuacao: "Hospitais, clínicas e unidades básicas de saúde.",
    });
    cursoCnct("tecnico-em-informatica", "Técnico em Informática", "Informação e Comunicação", {});
    db.exec(
      `UPDATE cursos SET forma_oferta = 'subsequente', modalidade = 'presencial', situacao = 'ativo',
         cnct_id = 'cnct:tecnico-em-enfermagem', ppc_id = 'ppc:${CURSO_ENFERMAGEM}', ppc_ano_documento = 2023,
         ppc_markdown_path = 'institucional/ifpr/ppcs/${CURSO_ENFERMAGEM}.md',
         pagina_oficial = 'https://ifpr.edu.br/curitiba/cursos/enfermagem/'
       WHERE id = 'curso:${CURSO_ENFERMAGEM}'`,
    );
    db.exec(
      `UPDATE cursos SET forma_oferta = 'licenciatura', situacao = 'ativo'
       WHERE id = 'curso:foz-do-iguacu/licenciatura-em-fisica'`,
    );
    db.exec(`UPDATE ppcs SET curso_id = 'curso:${CURSO_ENFERMAGEM}', ano_documento = 2023`);

    for (const [id, curso, turno, vagas, processo] of [
      ["o1", CURSO_ENFERMAGEM, "matutino", 30, "processo-seletivo-2026"],
      ["o2", CURSO_ENFERMAGEM, "noturno", 30, "processo-seletivo-2025"],
    ] as const) {
      inserir("ofertas", {
        id: `${processo}/${id}`,
        oferta_id: id,
        curso_nome: "Técnico em Enfermagem",
        tipo_oferta: "subsequente",
        vagas,
        turno,
        campus_id: "curitiba",
        url_fonte: "https://exemplo.ifpr.edu.br/edital.pdf",
        editais_json: "[]",
        path: `base-conhecimento/institucional/ifpr/ofertas/${processo}/${id}.json`,
        linha_turno: 7,
      });
      inserir("ofertas_cursos", { oferta_id: `${processo}/${id}`, curso_id: `curso:${curso}` });
      inserir("ofertas_processos", { oferta_id: `${processo}/${id}`, processo_id: processo });
    }
    for (const [id, nome, ano] of [
      ["processo-seletivo-2025", "Processo Seletivo 2025", 2025],
      ["processo-seletivo-2026", "Processo Seletivo 2026", 2026],
    ] as const) {
      inserir("processos", {
        id,
        nome,
        ano_ingresso: ano,
        path: `base-conhecimento/institucional/ifpr/processos-seletivos/${id}.json`,
      });
    }

    // a ficha real do repositório, como a compilação a grava: a revisão prévia do servidor de teste lê a
    // tabela `fichas` inteira, e uma ficha incompleta a quebraria
    const arquivoFicha = "base-conhecimento/revisao-ppc/fichas/ct-curr-12.json";
    const ficha = JSON.parse(
      NodeFS.readFileSync(NodePath.resolve(import.meta.dirname, "../../..", arquivoFicha), "utf8"),
    ) as Record<string, string | null>;
    inserir("fichas", {
      id: ficha.id!,
      titulo: ficha.titulo!,
      dominio: ficha.dominio ?? null,
      criticidade: ficha.criticidade ?? null,
      tipo_escopo: ficha.tipo_escopo ?? null,
      pergunta: ficha.pergunta ?? null,
      rubrica: ficha.rubrica ?? null,
      path: arquivoFicha,
      dados_json: JSON.stringify(ficha),
      arquivo_json: JSON.stringify(ficha),
    });

    /* ---------- fatos do PPC e o cruzamento com o SUAP */
    inserir("ppc_fatos", {
      ppc_id: `ppc:${CURSO_ENFERMAGEM}`,
      fato: "carga_horaria_total_h",
      valor: "1600",
      valor_num: 1600,
      unidade: "h",
      status_curadoria: "extraido",
      regra: "rotulo-corpo",
      trecho_fonte: "Carga horária total em hora relógio: 1.600 horas",
      path: MD_ENFERMAGEM,
      linha: 122,
      alternativas_json: "[]",
    });
    // o ano do documento vem dos dados institucionais, ainda sem revisão da curadoria
    inserir("ppc_fatos", {
      ppc_id: `ppc:${CURSO_ENFERMAGEM}`,
      fato: "ano_documento",
      valor: "2023",
      valor_num: 2023,
      unidade: null,
      status_curadoria: "Precisa de revisão",
      regra: "dados-institucionais",
      trecho_fonte: "ano_documento: 2023",
      path: "base-conhecimento/institucional/ifpr/cursos/curitiba/tecnico-em-enfermagem.json",
      linha: 30,
      alternativas_json: "[]",
    });
    inserir("ppc_suap", {
      ppc_id: `ppc:${CURSO_ENFERMAGEM}`,
      aspecto: "ano",
      resultado: "ppc-mais-recente-que-matrizes",
      valor_ppc: "2023",
      valor_suap: "2019",
      explicacao: "o PPC é de 2023; a matriz mais recente do SUAP é de 2019",
    });
    inserir("ppc_suap", {
      ppc_id: `ppc:${CURSO_ENFERMAGEM}`,
      aspecto: "carga_horaria",
      resultado: "diverge",
      valor_ppc: "1600",
      valor_suap: "1400",
      explicacao: "o PPC declara 1600 h; a matriz 538 do SUAP mostra 1400 h",
    });

    /* ---------- Consepe */
    inserir("conselhos", {
      id: "consepe",
      sigla: "Consepe",
      nome: "Conselho de Ensino, Pesquisa e Extensão",
      situacao: "ativo",
      pagina_oficial: "https://ifpr.edu.br/consepe/",
      path: "base-conhecimento/institucional/ifpr/conselhos/consepe/conselho.json",
    });
    const reuniaoPath = "base-conhecimento/institucional/ifpr/conselhos/consepe/reunioes/2026-03-20.json";
    inserir("conselhos_reunioes", {
      id: REUNIAO_CONSEPE,
      conselho_id: "consepe",
      data: "2026-03-20",
      titulo: "Reunião Ordinária CONSEPE - 20/03/2026",
      tipo: "ordinária",
      situacao: "realizada",
      fonte: "https://ifpr.edu.br/consepe/pautas-2026/",
      path: reuniaoPath,
    });
    inserir("conselhos_documentos", {
      reuniao_id: REUNIAO_CONSEPE,
      ordem: 0,
      documento_id: "consepe:parecer:2026:07",
      tipo: "parecer",
      titulo: "Parecer Consepe 07/2026",
      numero: "07/2026",
      ano: 2026,
      data: "2026-03-20",
      resumo: "Favorável ao ajuste curricular do Curso Técnico em Enfermagem, do Campus Curitiba.",
      url: "https://ifpr.edu.br/consepe/parecer-07-2026.pdf",
      path: reuniaoPath,
      linha: 12,
    });
    inserir("conselhos_itens", {
      reuniao_id: REUNIAO_CONSEPE,
      ordem: 7, // a ordem oficial da pauta, não a posição no arquivo
      item_id: "consepe:item:2026:parecer:07",
      titulo:
        "Parecer Consepe 07/2026 - Favorável ao ajuste curricular do Curso Técnico em Enfermagem, do Campus Curitiba.",
      resumo: "Favorável ao ajuste curricular do Curso Técnico em Enfermagem, do Campus Curitiba.",
      tipo_demanda: "Ajuste curricular",
      resultado: "Favorável",
      documento_id: "consepe:parecer:2026:07",
      processo_sei: "23411.000001/2026-01",
      campus_texto: "Curitiba",
      campus_id: "curitiba",
      curso_texto: "Técnico em Enfermagem",
      curso_id: CURSO_ENFERMAGEM,
      palavras_chave_json: JSON.stringify(["Ajuste curricular", "Curitiba"]),
      path: reuniaoPath,
      linha: 30,
    });

    // O índice FTS das seções, como na compilação, com um texto que a busca acha.
    db.exec(
      `UPDATE secoes SET texto = 'O acompanhamento de egressos do curso é feito pela coordenação.' WHERE id LIKE '%#avaliacao-1'`,
    );
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
  });
  db.close();
}
