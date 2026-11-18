// @effect-diagnostics globalDate:off -- o teste ponta a ponta fixa o relógio da conversão com uma data dada
/** Pré-conferência sem IA (M1.11): ponta a ponta de um DOCX sintético. Os verificadores têm casos em `verificadores.test.ts`. */
import { raizRepositorio } from "@simplifica-if/kb/caminhos";
import { carregarRegistro } from "@simplifica-if/kb/normas/registro";
import { carregarRelacoes } from "@simplifica-if/kb/normas/relacoes";
import { describe, expect, test } from "vite-plus/test";
import { montarDocx, par, titulo } from "@simplifica-if/docx/testes/sintetico";
import { segmentarPpc } from "@simplifica-if/kb/ppcs/secoes";
import { converterPpc } from "../src/conversao-docx/conversao.ts";
import { preConferir, type CursoCnct } from "../src/pre-conferencia.ts";
import { carregarVigencia } from "../scripts/base-tecnica.ts";

const AGORA = new Date(2026, 10, 16, 12, 0, 0);

const CNCT: CursoCnct = {
  slug: "tecnico-em-agropecuaria",
  denominacao: "Técnico em Agropecuária",
  eixo_tecnologico: "Recursos Naturais",
  carga_horaria_minima_horas: 1200,
  legislacao_profissional: "Lei nº 5.524, de 5 de novembro de 1968\nDecreto nº 90.922, de 6 de fevereiro de 1985",
};

/** Seções do modelo em DOCX, como os PPCs costumam vir: título numerado em negrito, subseção com estilo. */
const SECOES_DOCX: Array<[string, string]> = [
  ["1 JUSTIFICATIVA", "O curso atende à demanda regional por técnicos."],
  ["2 OBJETIVOS", "Formar técnicos em agropecuária."],
  ["3 PERFIL PROFISSIONAL DE CONCLUSÃO", "O egresso atua na produção agropecuária."],
  ["4 ORGANIZAÇÃO CURRICULAR", "O curso se organiza em três anos."],
  ["4.1 MATRIZ CURRICULAR", "A matriz está no quadro a seguir."],
  ["4.2 EMENTÁRIO", "Ementas dos componentes."],
  ["4.3 AVALIAÇÃO DA APRENDIZAGEM", "A avaliação é contínua."],
  ["4.4 APROVEITAMENTO DE ESTUDOS ANTERIORES", "O aproveitamento segue a resolução."],
  ["4.5 CERTIFICADOS E DIPLOMAS", "O diploma é expedido ao concluinte."],
  ["5 CORPO DOCENTE", "Docentes do campus."],
  ["6 INFRAESTRUTURA", "Laboratórios e biblioteca."],
  ["7 ACOMPANHAMENTO DE EGRESSOS", "Pesquisa anual com os egressos."],
  ["8 AVALIAÇÃO DO CURSO", "A comissão avalia o PPC."],
  ["9 REFERÊNCIAS", "BRASIL. Lei nº 9.394, de 20 de dezembro de 1996."],
];

describe("ponta a ponta: DOCX → PPC.md → seções do kb → pré-conferência", () => {
  const corpo =
    par("PROJETO PEDAGÓGICO DO CURSO TÉCNICO EM AGROPECUÁRIA", { negrito: true, tamanho: 14 }) +
    SECOES_DOCX.map(([nome, texto]) =>
      [nome.includes(".") ? par(nome, { estilo: "Heading2" }) : titulo(nome), par(texto)].join(""),
    ).join("");
  const conversao = converterPpc(montarDocx({ corpo }), "ppc.docx", { agora: AGORA });

  test("a conversão escreve as seções a partir de `##`, como os PPCs da base", () => {
    expect(conversao.markdown).toMatch(/^## 1 JUSTIFICATIVA$/m);
    expect(conversao.markdown).toMatch(/^### 4\.1 MATRIZ CURRICULAR$/m);
    expect(conversao.markdown).not.toMatch(/^# /m);
  });

  test("o kb reconhece todas as seções do modelo, e nenhuma sai ausente", () => {
    const tipos = new Set(segmentarPpc(conversao.markdown, "tecnico").map((s) => s.tipo));
    for (const tipo of ["justificativa", "matriz_curricular", "ementas", "acompanhamento_egresso", "referencias"])
      expect(tipos).toContain(tipo);
    const { triagem, fichas } = preConferir(conversao.markdown, {
      cnct: CNCT,
      forma: "subsequente",
      registro: carregarRegistro(raizRepositorio()),
      relacoes: carregarRelacoes(raizRepositorio()),
      vigencia: carregarVigencia(),
    });
    expect(triagem.filter((a) => a.regra === "secoes-do-modelo")).toEqual([]);
    expect(fichas).toHaveLength(12);
  });
});
