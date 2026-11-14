import { describe, expect, test } from "vite-plus/test";
import {
  classificarTitulo,
  ehCabecalhoDePagina,
  limparTitulo,
  numeracaoDoTitulo,
  palavrasDeCampi,
  secoesComChave,
  secoesIndexadas,
  segmentarPpc,
  TAXONOMIAS,
  taxonomiaDoNivel,
  textoDaSecao,
  tituloDaLinha,
} from "./secoes.ts";

describe("títulos", () => {
  test("reconhece títulos markdown e em negrito com marcadores", () => {
    expect(tituloDaLinha("## 3.1 –Objetivos  ##")).toBe("3.1 – Objetivos");
    expect(tituloDaLinha("**4. MATRIZ CURRICULAR**")).toBe("4. MATRIZ CURRICULAR");
    expect(tituloDaLinha("**Texto qualquer em negrito**")).toBeNull();
    expect(limparTitulo("2.1-  <br>Justificativa |")).toBe("2.1- Justificativa");
  });

  test("separa a numeração, sem confundir ano ou ordinal", () => {
    expect(numeracaoDoTitulo("6.1.1 Recuperação Paralela")).toEqual({
      numeracao: "6.1.1",
      resto: "Recuperação Paralela",
    });
    expect(numeracaoDoTitulo("4. MATRIZ CURRICULAR").numeracao).toBe("4");
    expect(numeracaoDoTitulo("2023").numeracao).toBeNull();
    expect(numeracaoDoTitulo("1º ano").numeracao).toBeNull();
    expect(numeracaoDoTitulo("Curitiba 2023").numeracao).toBeNull();
  });

  test("cabeçalhos de página só têm nomes institucionais e de campi", () => {
    const campi = palavrasDeCampi(["Curitiba", "União da Vitória"]);
    expect(ehCabecalhoDePagina("Campus Curitiba do IFPR", campi)).toBe(true);
    expect(ehCabecalhoDePagina("INSTITUTO FEDERAL DO PARANÁ – PROENS", campi)).toBe(true);
    expect(ehCabecalhoDePagina("Campus União da Vitória do IFPR", campi)).toBe(true);
    expect(ehCabecalhoDePagina("Informações do Campus", campi)).toBe(false);
  });
});

describe("taxonomias", () => {
  test("técnicos cobrem os 18 incisos do art. 28 e o § 4º", () => {
    const cobertos = new Set(TAXONOMIAS.tecnico.tipos.flatMap((d) => d.art28 ?? []));
    const romanos = "I II III IV V VI VII VIII IX X XI XII XIII XIV XV XVI XVII XVIII".split(" ");
    for (const inciso of romanos) expect(cobertos.has(inciso)).toBe(true);
    expect(cobertos.has("§4º")).toBe(true);
    expect(TAXONOMIAS.geral.tipos.some((d) => d.art28)).toBe(false);
  });

  test("nível do curso escolhe a taxonomia", () => {
    expect(taxonomiaDoNivel("médio")).toBe("tecnico");
    expect(taxonomiaDoNivel("superior")).toBe("geral");
    expect(taxonomiaDoNivel("formação inicial e continuada")).toBe("geral");
  });

  test("classifica pelo título, com tradução por nível", () => {
    expect(classificarTitulo("4.3 ACOMPANHAMENTO DO EGRESSO", "tecnico")).toBe("acompanhamento_egresso");
    expect(classificarTitulo("2.5.2 Acompanhamento de Egressos", "geral")).toBe("acompanhamento_egresso");
    expect(classificarTitulo("4 PERFIL DO EGRESSO", "tecnico")).toBe("perfil_egresso");
    expect(classificarTitulo("6.2 Aproveitamento de estudos anteriores", "tecnico")).toBe("aproveitamento_estudos");
    expect(classificarTitulo("6.4 Representação gráfica do processo formativo", "tecnico")).toBe(
      "itinerario_formativo",
    );
    expect(classificarTitulo("6.4 Representação gráfica do processo formativo", "geral")).toBe(
      "organizacao_curricular",
    );
    expect(classificarTitulo("1.1.6 Forma de Oferta", "tecnico")).toBe("formato_oferta");
    expect(classificarTitulo("6.1.2 Forma de Emissão de Resultados", "tecnico")).toBe("avaliacao");
    expect(classificarTitulo("1.3.1 Contexto histórico do IFPR", "tecnico")).toBe("justificativa");
    expect(classificarTitulo("1.3.1 Contexto histórico do IFPR", "geral")).toBe("contexto_institucional");
    expect(classificarTitulo("3.1.3 Núcleo Docente Estruturante (NDE)", "geral")).toBe("gestao_curso");
    expect(classificarTitulo("10 AVALIAÇÃO DO CURSO", "tecnico")).toBe("avaliacao_curso");
    expect(classificarTitulo("Título sem regra", "tecnico")).toBeNull();
  });

  test("folha de rosto, bolsas e objetivos do componente não caem em avaliação, inclusão e objetivos", () => {
    // Folha de rosto repetida no meio do PPC: o "( X )" de aprovação não é avaliação da aprendizagem.
    for (const titulo of [
      "APROVAÇÃO DO PROJETO PEDAGÓGICO DE CURSO ( ) AJUSTE CURRICULAR DO PROJETO PEDAGÓGICO DE CURSO ( X )",
      "RESOLUÇÃO DE CRIAÇÃO: Resolução 78/10 do Conselho Superior APROVAÇÃO DO PROJETO PEDAGÓGICO DO CURSO ( ) AJUSTE CURRICULAR DO PROJETO PEDAGÓGICO DO CURSO (X)",
    ])
      expect(classificarTitulo(titulo, "tecnico")).toBe("pretextual");
    // Programas e bolsas de pesquisa, extensão e inclusão social são apoio ao estudante.
    for (const titulo of [
      "5.1.1 Programas de Ensino, Pesquisa, Extensão, Inovação, Inclusão Social e Assistência estudantil",
      "5.1.1 Programas de Pesquisa, Extensão, Inovação, Inclusão Social, Monitoria e Bolsa-Atleta",
      "3.4.1 Bolsas de Pesquisa, Bolsas de Extensão e Inclusão Social",
      "5.1.10 Bolsas de pesquisa, bolsas de extensão e inclusão social",
      "PBIS - Programa de Bolsas Acadêmicas de Inclusão Social",
      "Bolsas de inclusão",
    ])
      expect([titulo, classificarTitulo(titulo, "tecnico")]).toEqual([titulo, "atendimento_estudante"]);
    expect(classificarTitulo("Programa Institucional de Bolsas de Iniciação Científica (PIBIC)", "tecnico")).toBe(
      "ensino_pesquisa_extensao",
    );
    expect(classificarTitulo("5.2 Educação inclusiva e acessibilidade", "tecnico")).toBe("acessibilidade_inclusao");
    expect(classificarTitulo("5.3 Inclusão social e acessibilidade", "tecnico")).toBe("acessibilidade_inclusao");
    // Objetivos do componente pertencem ao plano de ensino (ementário), não aos objetivos do curso.
    for (const titulo of [
      "3. OBJETIVOS DO COMPONENTE CURRICULAR (geral e específicos)",
      "Objetivos do Componente Curricular: Objetivo Geral:",
      "OBJETIVOS DO COMPONENTE (GERAL E ESPECÍFICO) Objetivo Geral:",
    ])
      expect(classificarTitulo(titulo, "tecnico")).toBe("ementas");
    expect(classificarTitulo("3 OBJETIVOS DO CURSO", "tecnico")).toBe("objetivos");
  });
});

describe("segmentação", () => {
  const ppc = [
    "---",
    "id: ppc:a/b",
    "---",
    "## PROJETO PEDAGÓGICO DE CURSO TÉCNICO EM ENFERMAGEM FORMA DE OFERTA SUBSEQUENTE",
    "",
    "## Reitor",
    "Fulano de Tal",
    "## 1 JUSTIFICATIVA",
    "",
    "Texto da justificativa.",
    "## Campus Curitiba do IFPR",
    "continua a justificativa",
    "",
    "## 1.1 Considerações",
    "Subseção sem regra, herda pela numeração.",
    "## 2 EMENTÁRIO",
    "COMPONENTE CURRICULAR: Química I",
    "## EMENTA:",
    "Ementa de química.",
    "## BIBLIOGRAFIA BÁSICA",
    "- Livro.",
    "**Componente curricular:** Física I",
    "## Objetivos",
    "Objetivo do componente.",
    "## 3 ACOMPANHAMENTO DO EGRESSO",
    "Mecanismo permanente.",
    "## Instrumentos",
    "Questionário anual.",
    "## ANEXO I – REGULAMENTO DE ESTÁGIO",
    "## CAPÍTULO I DAS DISPOSIÇÕES",
    "Texto do regulamento.",
  ].join("\n");
  const secoes = segmentarPpc(ppc, "tecnico", palavrasDeCampi(["Curitiba"]));
  const resumo = secoes.map((s) => [s.linhaInicio, s.linhaFim, s.tipo, s.origem, s.titulo]);

  test("classifica, herda e respeita rótulos, cabeçalhos e anexos", () => {
    expect(resumo).toEqual([
      [
        4,
        4,
        "pretextual",
        "pretextual",
        "PROJETO PEDAGÓGICO DE CURSO TÉCNICO EM ENFERMAGEM FORMA DE OFERTA SUBSEQUENTE",
      ],
      [6, 7, "pretextual", "pretextual", "Reitor"],
      [8, 12, "justificativa", "titulo", "1 JUSTIFICATIVA"],
      [14, 15, "justificativa", "numeracao", "1.1 Considerações"],
      [16, 16, "ementas", "titulo", "2 EMENTÁRIO"],
      [17, 21, "ementas", "contexto", "COMPONENTE CURRICULAR: Química I"],
      [22, 24, "ementas", "contexto", "Componente curricular: Física I"],
      [25, 26, "acompanhamento_egresso", "titulo", "3 ACOMPANHAMENTO DO EGRESSO"],
      [27, 28, "acompanhamento_egresso", "contexto", "Instrumentos"],
      [29, 29, "anexos", "titulo", "ANEXO I – REGULAMENTO DE ESTÁGIO"],
      [30, 31, "anexos", "contexto", "CAPÍTULO I DAS DISPOSIÇÕES"],
    ]);
  });

  test("o texto é o Markdown do corpo, com rótulos e cabeçalhos de página", () => {
    for (const secao of secoes) expect(textoDaSecao(ppc, secao.linhaInicio, secao.linhaFim)).toBe(secao.texto);
    expect(secoes[2]!.texto).toBe("Texto da justificativa.\n## Campus Curitiba do IFPR\ncontinua a justificativa");
    expect(secoes[5]!.texto).toBe("## EMENTA:\nEmenta de química.\n## BIBLIOGRAFIA BÁSICA\n- Livro.");
    expect(secoes[5]!.numeracao).toBeNull();
    expect(secoes[3]!.numeracao).toBe("1.1");
  });
});

describe("texto integral pelas linhas", () => {
  const md = "---\nid: ppc:a/b\n---\n## 1 Objetivos\n\nLinha um.\nLinha dois.\n\n## 2 Ementário\n";
  test("devolve o corpo, com ou sem o título, e recusa linhas inválidas", () => {
    expect(textoDaSecao(md, 4, 7)).toBe("Linha um.\nLinha dois.");
    expect(textoDaSecao(md, 4, 7, { incluirTitulo: true })).toBe("## 1 Objetivos\nLinha um.\nLinha dois.");
    expect(textoDaSecao(md, 9, 9)).toBe("");
    expect(() => textoDaSecao(md, 7, 4)).toThrow(RangeError);
    expect(() => textoDaSecao(md, 4, 99)).toThrow(RangeError);
  });
});

describe("chaves das seções", () => {
  const md = [
    "## **PROJETO PEDAGÓGICO DO CURSO TÉCNICO EM INFORMÁTICA FORMA DE OFERTA: INTEGRADO**",
    "",
    "## 1 IDENTIFICAÇÃO",
    "",
    "## 1.1 Denominação",
    "",
    "Técnico em Informática",
    "",
    "## 1.2 Forma de oferta",
    "",
    "Integrado ao ensino médio, na modalidade presencial, com matrícula anual por série.",
    "",
    "## 2 ESTÁGIO",
    "",
    "O estágio supervisionado é não obrigatório e segue o regulamento de estágio do campus.",
  ].join("\n");

  test("as indexáveis numeram como o índice; as outras, numa série própria", () => {
    const todas = secoesComChave(md, "tecnico");
    expect(todas.map((s) => [s.chave, s.indexada])).toEqual([
      ["pretextual-x1", false],
      ["identificacao-x1", false],
      ["identificacao-x2", false],
      ["formato_oferta-1", true],
      ["estagio_praticas-1", true],
    ]);
    expect(secoesIndexadas(md, "tecnico").map((s) => s.chave)).toEqual(["formato_oferta-1", "estagio_praticas-1"]);
  });
});
