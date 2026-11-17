/**
 * Documentos sintéticos de PPC para os testes da conversão. São fictícios: nenhum trecho de PPC
 * real.
 */
import {
  EMF_MINIMO,
  PNG_MINIMO,
  celula,
  controle,
  desenhoLegado,
  formas,
  hyperlink,
  imagem,
  linha,
  montarDocx,
  NUMERACAO_PADRAO,
  par,
  run,
  tabela,
  tabelaDeTextos,
  titulo,
  type PartesDocx,
} from "@simplifica-if/docx/testes/sintetico";

// ---------------------------------------------------------------- documentos

const SECAO_GRAFICA = titulo("5.11 REPRESENTAÇÃO GRÁFICA DO PROCESSO FORMATIVO");

const QUADRO_EMENTA = (
  nome: string,
  periodo: string,
  carga: number,
  ementa: string,
  basica: string[],
  complementar: string[],
) =>
  [
    `COMPONENTE CURRICULAR: ${nome}`,
    `Período letivo: ${periodo}\tCarga horária total: ${carga} horas-aula`,
    `EMENTA: ${ementa}`,
    `BIBLIOGRAFIA BÁSICA:\n${basica.join("\n")}`,
    `BIBLIOGRAFIA COMPLEMENTAR:\n${complementar.join("\n")}`,
  ].map((texto) => [texto]);

const ANO = (texto: string, continua = false) =>
  celula(continua ? "" : texto, { vertical: continua ? "continua" : "inicio" });

/** PPC fictício completo: identificação, matriz no formato legado, ementário e figura PNG. */
function ppcMinimo(): PartesDocx {
  const cabecalhoMatriz = [
    "Ano",
    "Componente Curricular",
    "Número de aulas semanais",
    "CH hora-aula no período",
    "CH hora-relógio no período",
  ];
  const total = "CARGA HORÁRIA TOTAL DO CURSO";
  return {
    relacoes: [
      { id: "rId10", tipo: "image", alvo: "media/image1.png" },
      { id: "rId11", tipo: "hyperlink", alvo: "https://exemplo.edu.br/cnct", externa: true },
    ],
    midia: { "image1.png": PNG_MINIMO },
    corpo: [
      par("INSTITUTO FEDERAL DE TESTE", { negrito: true, tamanho: 12 }),
      par("PROJETO PEDAGÓGICO DO CURSO TÉCNICO EM TESTES"),
      par("SUMÁRIO", { negrito: true }),
      par("1 APRESENTAÇÃO\t3"),
      par("5.6 MATRIZ CURRICULAR\t12"),
      titulo("1 APRESENTAÇÃO"),
      par("Este projeto apresenta o curso fictício usado nos testes da conversão."),
      tabelaDeTextos([
        ["Nome do curso:", "Curso Técnico em Testes"],
        ["Forma de oferta:", "Integrado"],
        ["Modalidade:", "Presencial"],
        ["Eixo tecnológico:", "Informação e Comunicação"],
        ["Câmpus:", "Campus Foz do Iguaçu"],
        ["Turno:", "Matutino e vespertino"],
        ["Total de vagas:", "40 vagas anuais"],
        ["Carga horária total:", "3.200 horas\nDistribuídas em três anos."],
        ["Base legal específica do curso:", "Resolução fictícia nº 1/2026 | CNCT"],
        ["2026", "Ano de início"],
      ]),
      tabelaDeTextos([["Tipo de matrícula: Por componente curricular"], ["Periodicidade: Anual"]]),
      titulo("1.1 JUSTIFICATIVA"),
      par(
        run("O curso atende à demanda regional, conforme o ") +
          hyperlink("Catálogo Nacional", 'r:id="rId11"') +
          run(" e o ") +
          run("plano", { italico: true }) +
          run(" institucional", { negrito: true, italico: true }) +
          run(" (versão antiga)", { tachado: true }) +
          run("."),
      ),
      par("a) formar profissionais para a região;"),
      par("b) integrar ensino, pesquisa e extensão."),
      par("Texto depois da lista."),
      titulo("5 ORGANIZAÇÃO CURRICULAR"),
      titulo("5.6 MATRIZ CURRICULAR"),
      tabela([
        linha([celula("MATRIZ CURRICULAR DO CURSO TÉCNICO EM TESTES", { colunas: 5 })]),
        linha([celula("Hora aula de 45 min", { colunas: 2 }), celula("Semanas do ano letivo: 40", { colunas: 3 })]),
        linha(cabecalhoMatriz.map((item) => celula(item))),
        linha([ANO("1º Ano"), celula("Língua Portuguesa"), celula("3"), celula("120"), celula("90")]),
        linha([ANO("", true), celula("Lógica de Programação"), celula("4"), celula("160"), celula("120")]),
        linha([ANO("", true), celula("Subtotal (Total do período)"), celula("7"), celula("280"), celula("210")]),
        linha([ANO("2º Ano"), celula("Banco de Dados"), celula("4"), celula("160"), celula("120")]),
        linha([ANO("", true), celula("Subtotal (Total do período)"), celula("4"), celula("160"), celula("120")]),
        linha([celula("Estágio Supervisionado", { colunas: 3 }), celula("240"), celula("200")]),
        linha([celula(total, { colunas: 3 }), celula("680"), celula("530")]),
      ]),
      par("Nota: a matriz acima é fictícia."),
      titulo("5.7 EMENTÁRIO"),
      tabelaDeTextos(
        QUADRO_EMENTA(
          "Língua Portuguesa",
          "1º ano",
          120,
          "Leitura e produção de textos.\nGêneros textuais.",
          [
            "SILVA, Maria. Gramática de teste. Sao Paulo: Editora Fictícia, 2020.",
            "- SOUZA, João de. Redação. 2. ed. Curitiba: Exemplo, 2019. ISBN 978-85-0000-000-0.",
          ],
          [
            "COSTA, Ana. Leitura. Rio de Janeiro: Teste, 2013.PEREIRA, Carlos. Texto e contexto. Porto Alegre: Modelo, 2018. v. 2.OLIVEIRA, Rita. Escrita. Campinas: Amostra, 2021.",
            "BRASIL. Lei nº 9.394, de 20 de dezembro de 1996. Disponível em: https://exemplo.gov.br. Acesso em: 1 jan. 2026.",
          ],
        ),
      ),
      // Quadro do Google Docs: tabela e células embrulhadas em controles, com colunas vazias.
      controle(
        tabela(
          QUADRO_EMENTA(
            "Banco de Dados",
            "2º Ano",
            160,
            "Modelagem de dados.",
            ["DATE, Christopher. Introdução a sistemas de bancos de dados. Rio de Janeiro: Elsevier, 2004."],
            ["ELMASRI, Ramez; NAVATHE, Shamkant. Sistemas de banco de dados. São Paulo: Pearson, 2011."],
          ).map(([texto]) => linha([controle(celula(texto!)), celula(""), celula("")])),
        ),
      ),
      SECAO_GRAFICA,
      par(imagem("rId10", "Fluxograma do curso")),
      par("Figura 1: itinerário formativo."),
      titulo("6 REFERÊNCIAS"),
      par("BRASIL. Catálogo Nacional de Cursos Técnicos. Brasília, 2021."),
    ].join(""),
  };
}

/** Matriz no formato de núcleos (FTP, FGB, NP), dividida em duas tabelas; a segunda continua sem cabeçalho. */
function ppcNucleos(): PartesDocx {
  const cabecalho = [
    "Ano",
    "Componente Curricular",
    "Nº de aulas semanais",
    "Hora-aula FTP",
    "Hora-aula FGB",
    "Hora-aula NP",
    "Hora-aula TOTAL",
    "Hora relógio TOTAL",
  ];
  return {
    corpo: [
      par("DOCUMENTO", { estilo: "Ttulo" }),
      par("Identificação do curso", { estilo: "Ttulo1" }),
      par("Curso: Técnico em Ensaios"),
      par("Campus: Campus de Teste"),
      par("Vagas: 35"),
      par("Organização curricular", { estilo: "Ttulo1" }),
      titulo("5.6 MATRIZ CURRICULAR"),
      tabela([
        linha(cabecalho.map((item) => celula(item))),
        linha([
          ANO("1"),
          celula("Matemática"),
          celula("4"),
          celula(""),
          celula("160"),
          celula(""),
          celula("160"),
          celula("133"),
        ]),
        linha([
          ANO("", true),
          celula("Eletricidade"),
          celula("2"),
          celula("80"),
          celula(""),
          celula(""),
          celula("80"),
          celula("67"),
        ]),
        linha([
          celula("TOTAL ANO HORA-AULA", { colunas: 3 }),
          celula("80"),
          celula("160"),
          celula("0"),
          celula("240"),
          celula(""),
        ]),
        linha([
          celula("TOTAL ANO HORA-RELÓGIO", { colunas: 3 }),
          celula("67"),
          celula("133"),
          celula("0"),
          celula(""),
          celula("200"),
        ]),
      ]),
      par(""),
      tabela([
        linha([
          celula("2º ano"),
          celula("Projeto Integrador"),
          celula("2"),
          celula(""),
          celula(""),
          celula("80"),
          celula("80"),
          celula("67"),
        ]),
        linha([
          celula("2º ano"),
          celula("Física"),
          celula("2"),
          celula(""),
          celula("80"),
          celula(""),
          celula("80"),
          celula("67"),
        ]),
        linha([
          celula("2º ano"),
          celula("Automação"),
          celula("3"),
          celula("120"),
          celula(""),
          celula(""),
          celula("120"),
          celula("100"),
        ]),
        linha([
          celula("Atividades Complementares", { colunas: 3 }),
          celula(""),
          celula(""),
          celula(""),
          celula("60"),
          celula("50"),
        ]),
        linha([
          celula("C.H. (HORA RELÓGIO) TOTAL DO CURSO", { colunas: 3 }),
          celula("167"),
          celula("200"),
          celula("67"),
          celula("484"),
          celula(""),
        ]),
      ]),
      titulo("5.8 FLUXOGRAMA DO CURSO"),
      par(formas()),
      par("O fluxograma acima resume o itinerário."),
    ].join(""),
  };
}

/** Mesclas horizontais, verticais, em bloco e em L, e linha que começa depois da primeira coluna. */
function mesclas(): PartesDocx {
  return {
    corpo: [
      titulo("1 MESCLAS"),
      tabela([
        linha([celula("A"), celula("B e C", { colunas: 2 }), celula("D")]),
        linha([celula("Vertical", { vertical: "inicio" }), celula("x"), celula("y"), celula("z")]),
        linha([
          celula("", { vertical: "continua" }),
          celula("Bloco 2×2", { colunas: 2, vertical: "inicio" }),
          celula("w"),
        ]),
        linha([celula("fim"), celula("", { colunas: 2, vertical: "continua" }), celula("v")]),
      ]),
      par("Em L: a continuação é mais estreita que a célula de cima."),
      tabela([
        linha([celula("Topo largo", { colunas: 2, vertical: "inicio" }), celula("1")]),
        linha([celula("", { vertical: "continua" }), celula("perna"), celula("2")]),
        linha([celula("solta"), celula("3")], { antes: 1 }),
      ]),
      par("Tabela sem texto e tabela com célula de vários parágrafos."),
      tabelaDeTextos([
        ["", ""],
        ["", ""],
      ]),
      tabelaDeTextos([
        ["Campo | com barra", "linha 1\n\n  linha   2  \nlinha 3"],
        ["1,5", "10%"],
        ["2", "- 3"],
      ]),
    ].join(""),
  };
}

/** Controles de conteúdo (`w:sdt`) no corpo, em volta de células e aninhados. */
function controles(): PartesDocx {
  return {
    corpo: [
      titulo("1 CONTROLES"),
      controle(
        par("Parágrafo dentro de controle.") + controle(par("Parágrafo em controle aninhado.", { negrito: true })),
      ),
      controle(
        tabela([
          linha([celula("Item"), celula("Descrição", { colunas: 2 })]),
          linha([celula("Grupo", { vertical: "inicio" }), celula("a"), celula("b")]),
          linha([celula("", { vertical: "continua" }), celula("c"), celula("d\ne")]),
        ]),
      ),
      par("Tabela do corpo com as células embrulhadas:"),
      tabela([
        linha([controle(celula("Campus:")), controle(celula("Campus Embrulhado"))]),
        linha([controle(celula("Turno:")), controle(celula("Noturno"))]),
      ]),
      par("Tabela com uma célula direta e outra embrulhada:"),
      tabela([linha([celula("direta"), controle(celula("embrulhada"))])]),
      par("Tabela aninhada numa célula:"),
      tabela([
        linha([celula(par("fora") + tabelaDeTextos([["dentro 1", "dentro 2"]]) + par("depois")), celula("ao lado")]),
      ]),
    ].join(""),
  };
}

/** Alterações controladas e outros envoltórios de runs. */
function rastreadas(): PartesDocx {
  const insercao = (conteudo: string) =>
    `<w:ins w:id="1" w:author="Revisora" w:date="2026-01-01T00:00:00Z">${conteudo}</w:ins>`;
  const remocao = (texto: string) =>
    `<w:del w:id="2" w:author="Revisora" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>${texto}</w:delText></w:r></w:del>`;
  return {
    relacoes: [{ id: "rId11", tipo: "hyperlink", alvo: "https://exemplo.edu.br/norma", externa: true }],
    corpo: [
      titulo("1 ALTERAÇÕES CONTROLADAS"),
      par(run("O curso tem ") + remocao("três") + insercao(run("quatro")) + run(" anos de duração.")),
      par(insercao(run("Parágrafo inteiro inserido na revisão."))),
      par(
        run("Movido: ") +
          `<w:moveFrom w:id="3" w:author="R">${run("texto na origem")}</w:moveFrom>` +
          `<w:moveTo w:id="4" w:author="R">${run("texto no destino")}</w:moveTo>`,
      ),
      par(run("Marca: ") + `<w:smartTag w:uri="urn:x" w:element="place">${run("Curitiba")}</w:smartTag>` + run(".")),
      par(
        run("Campo: ") +
          `<w:fldSimple w:instr=" PAGE ">${run("12")}</w:fldSimple>` +
          run(" e controle ") +
          controle(run("em linha")) +
          run("."),
      ),
      par(run("Link revisado: ") + insercao(hyperlink("norma inserida", 'r:id="rId11"')) + run(".")),
      par(insercao(run("2 TÍTULO INSERIDO", { negrito: true }))),
      par("Texto da seção inserida."),
      tabelaDeTextos([
        ["Campo", "Valor"],
        [`<w:tc>${par(run("Duração: ") + insercao(run("4 anos")) + remocao("3 anos"))}</w:tc>`, "sem alteração"],
      ]),
    ].join(""),
  };
}

/** Tabulações, quebras, hífen incondicional, hyperlinks, formatação, títulos e listas. */
function textoEspecial(): PartesDocx {
  return {
    // O hiperlink "relação quebrada" (`r:id` sem relação) exercita a leitura tolerante; o Word não
    // abriria este arquivo, por isso ele fica fora do validador estrutural.
    validar: false,
    relacoes: [{ id: "rId11", tipo: "hyperlink", alvo: "https://exemplo.edu.br/pagina", externa: true }],
    corpo: [
      par("Título pelo estilo", { estilo: "Ttulo1" }),
      par("Subtítulo pelo estilo", { estilo: "Ttulo2" }),
      par("", { estilo: "Ttulo1" }),
      par("Coluna 1\tColuna 2\nsegunda linha"),
      par(
        `<w:r><w:t>guarda</w:t><w:noBreakHyphen/><w:t>chuva</w:t><w:br w:type="page"/><w:t> depois da página</w:t><w:cr/>` +
          `<w:t>nova linha</w:t><w:ptab w:relativeTo="margin" w:alignment="right" w:leader="none"/><w:t>à direita</w:t></w:r>`,
      ),
      par(
        hyperlink("externo com âncora", 'r:id="rId11" w:anchor="secao"') +
          run(" ") +
          hyperlink("interno", 'w:anchor="_Toc1"') +
          run(" ") +
          hyperlink("relação quebrada", 'r:id="rId99"') +
          run(" ") +
          `<w:hyperlink r:id="rId11">${run("em dois ", { negrito: true })}${run("pedaços", { negrito: true })}</w:hyperlink>`,
      ),
      par(run("negrito", { negrito: true }) + run(" colado", { negrito: true }) + run(" e normal")),
      par(`<w:r><w:rPr><w:b w:val="0"/><w:i w:val="false"/><w:strike w:val="1"/></w:rPr><w:t>só tachado</w:t></w:r>`),
      par("2.1 Numerado em negrito", { negrito: true }),
      par("2.1.1. Com ponto final", { negrito: true }),
      par("1.2.3.4.5.6.7 Fundo demais para título", { negrito: true }),
      par("2024 Número solto em negrito vira título", { negrito: true }),
      par("3 Numerado sem negrito"),
      par("Grande de 18", { negrito: true, tamanho: 18 }),
      par("Médio de 16", { negrito: true, tamanho: 16 }),
      par("Pequeno de 14", { negrito: true, tamanho: 14 }),
      par("Negrito de 12 não é título", { negrito: true, tamanho: 12 }),
      par("Item de lista pelo estilo", { estilo: "PargrafodaLista" }),
      par("Item recuado", { estilo: "PargrafodaLista", recuo: 1440 }),
      par("Numerado pelo estilo", { estilo: "Numerada", recuo: 720 }),
      par("Parágrafo depois da lista."),
      par("1) primeiro"),
      par("2. segundo"),
      par("a) alínea"),
      par("• marcador digitado"),
      par("– travessão"),
      par("-x"),
      par("Fim."),
      tabelaDeTextos([["Depois de parágrafo", "tabela"]]),
      par("• último item"),
      tabelaDeTextos([["Depois de lista", "tabela"]]),
    ].join(""),
  };
}

/** Documento sem nenhum título: os elementos saem em sequência. */
function semSecoes(): PartesDocx {
  return {
    propriedades: false,
    corpo: [
      par("Documento sem títulos."),
      par("- item um"),
      par("- item dois"),
      par("Parágrafo comum."),
      tabelaDeTextos([
        ["Componente Curricular", "Carga horária", "Semestre", "CH total"],
        ["Algoritmos", "80", "1", "80 h"],
        ["Legenda", "", "", ""],
        ["Redes", "sessenta", "2", ""],
      ]),
      par("* item final"),
    ].join(""),
  };
}

const insercao = (conteudo: string) =>
  `<w:ins w:id="1" w:author="Revisora" w:date="2026-01-01T00:00:00Z">${conteudo}</w:ins>`;
const remocao = (conteudo: string) =>
  `<w:del w:id="2" w:author="Revisora" w:date="2026-01-01T00:00:00Z">${conteudo}</w:del>`;
const textoRemovido = (texto: string) => remocao(`<w:r><w:delText>${texto}</w:delText></w:r>`);

/** Texto de corpo digitado em parágrafos com estilo de título, direto e por alteração controlada. */
function titulosDeCorpo(): PartesDocx {
  const frase =
    "O curso não prevê estágio curricular obrigatório, de modo que o estágio não integra a matriz e não é requisito para a conclusão do curso.";
  return {
    numeracao: NUMERACAO_PADRAO,
    corpo: [
      par("5.9 ESTÁGIO CURRICULAR", { estilo: "Ttulo2" }),
      par(insercao(run(frase)), { estilo: "Ttulo2" }),
      par("Sem prejuízo disso, o curso admite o estágio não obrigatório, por iniciativa do estudante:", {
        estilo: "Ttulo2",
      }),
      par("cumprir e fazer cumprir as normas e os procedimentos institucionais;", {
        estilo: "Ttulo2",
        numeracao: { id: 1 },
      }),
      par("zelar pelos laboratórios;", { estilo: "Ttulo2", numeracao: { id: 1 } }),
      par(`8.1.1 ${"Atribuições da coordenação ".repeat(9)}do curso`, { estilo: "Ttulo2" }),
      par("1.1.3 Comissão de Estruturação de Curso (CEC) e Comissão de Ajuste Curricular (CAJ):", { estilo: "Ttulo2" }),
      par("5.10 PROJETO FINAL", { estilo: "Ttulo2" }),
      par("Título curto sem número.", { estilo: "Ttulo2" }),
      par("Texto do projeto."),
    ].join(""),
  };
}

/** Numeração automática do Word (`w:numPr`), com níveis, e marcadores digitados. */
function listasAutomaticas(): PartesDocx {
  return {
    numeracao: NUMERACAO_PADRAO,
    corpo: [
      titulo("1 LISTAS"),
      par("São objetivos do curso:"),
      par("formar técnicos;", { numeracao: { id: 1 } }),
      par("integrar ensino e pesquisa:", { numeracao: { id: 1 } }),
      par("na iniciação científica.", { numeracao: { id: 1, nivel: 1 } }),
      par("Etapas:"),
      par("diagnóstico;", { numeracao: { id: 2 }, estilo: "PargrafodaLista" }),
      par("certificado de conclusão;", { numeracao: { id: 2, nivel: 1 } }),
      par("avaliação.", { numeracao: { id: 3 } }),
      par("redefinido como marcador;", { numeracao: { id: 4 } }),
      par("numeração desligada (numId 0).", { numeracao: { id: 0 } }),
      par("numeração que não existe.", { numeracao: { id: 99 } }),
      par(run("Item em negrito ", { negrito: true }) + run("e normal"), { numeracao: { id: 1 } }),
      par("Parágrafo depois da lista."),
      par("2. segundo item digitado"),
      par("3) terceiro"),
      par("b) alínea digitada"),
      par(run("c)", { negrito: true }) + run(" alínea com a letra em negrito")),
    ].join(""),
  };
}

/** Linhas, células e parágrafos de tabela embrulhados em `w:sdt`; linhas e figuras removidas na revisão. */
function tabelasEmControle(): PartesDocx {
  const cabecalho = [
    "Ano",
    "Componente Curricular",
    "Número de aulas semanais",
    "CH hora-aula no período",
    "CH hora-relógio no período",
  ];
  const componente = (ano: string, nome: string) =>
    linha([celula(ano), celula(nome), celula("2"), celula("80"), celula("67")]);
  const linhaRemovida = `<w:tr><w:trPr><w:del w:id="9" w:author="R" w:date="2026-01-01T00:00:00Z"/></w:trPr>${["1º Ano", "Removida na revisão", "2", "80", "67"].map((texto) => `<w:tc>${par(textoRemovido(texto))}</w:tc>`).join("")}</w:tr>`;
  return {
    relacoes: [{ id: "rId10", tipo: "image", alvo: "media/image1.png" }],
    midia: { "image1.png": PNG_MINIMO },
    corpo: [
      titulo("5.6 MATRIZ CURRICULAR"),
      tabela([
        linha(cabecalho.map((item) => celula(item))),
        componente("1º Ano", "Matemática"),
        controle(componente("1º Ano", "Linha em controle")),
        linhaRemovida,
        linha([celula("1º Ano"), controle(celula("Célula em controle")), celula("2"), celula("80"), celula("67")]),
        linha([
          celula("1º Ano"),
          celula(controle(par("Parágrafo em controle"))),
          celula("2"),
          celula("80"),
          celula("67"),
        ]),
      ]),
      titulo("5.7 TEXTO PROFUNDO"),
      controle(
        tabela([
          linha([
            celula(
              par(
                run("Período:\t1º ano") +
                  `<w:moveFrom w:id="3" w:author="R">${run(" texto movido daqui")}</w:moveFrom>` +
                  textoRemovido(" removido"),
              ) +
                par(
                  `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:inline><a:graphic><a:graphicData><w:txbxContent>${par("caixa de texto")}</w:txbxContent></a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice>` +
                    `<mc:Fallback><w:pict><v:textbox><w:txbxContent>${par("caixa de texto")}</w:txbxContent></v:textbox></w:pict></mc:Fallback></mc:AlternateContent></w:r>`,
                ),
            ),
            celula("ao lado"),
          ]),
        ]),
      ),
      titulo("5.11 REPRESENTAÇÃO GRÁFICA DO PROCESSO FORMATIVO"),
      par(remocao(imagem("rId10", "Figura apagada")) + run("A figura antiga foi apagada na revisão.")),
      par(formas()),
    ].join(""),
  };
}

const figura = (conteudo: string, extras: Partial<PartesDocx> = {}): PartesDocx => ({
  corpo: [
    titulo("5 ORGANIZAÇÃO"),
    SECAO_GRAFICA,
    par("Texto antes da figura."),
    conteudo,
    titulo("5.12 OUTRA SEÇÃO"),
    par("Fim."),
  ].join(""),
  ...extras,
});

export type Fixture = {
  nome: string;
  partes: () => PartesDocx;
};

export const FIXTURES: Fixture[] = [
  { nome: "ppc-minimo", partes: ppcMinimo },
  { nome: "ppc-nucleos", partes: ppcNucleos },
  { nome: "mesclas", partes: mesclas },
  { nome: "controles", partes: controles },
  { nome: "rastreadas", partes: rastreadas },
  { nome: "texto-especial", partes: textoEspecial },
  { nome: "sem-secoes", partes: semSecoes },
  { nome: "titulos-de-corpo", partes: titulosDeCorpo },
  { nome: "listas-automaticas", partes: listasAutomaticas },
  { nome: "tabelas-em-controle", partes: tabelasEmControle },
  { nome: "figura-vetorial", partes: () => figura(par(formas())) },
  { nome: "figura-legada", partes: () => figura(par(desenhoLegado())) },
  { nome: "figura-ausente", partes: () => figura(par("Só texto.")) },
  // EMF embutido: copiado como está, sem contar como imagem extraída.
  {
    nome: "figura-emf",
    partes: () =>
      figura(par(imagem("rId10")), {
        relacoes: [{ id: "rId10", tipo: "image", alvo: "media/image1.emf" }],
        midia: { "image1.emf": EMF_MINIMO },
      }),
  },
  {
    nome: "figura-legada-emf",
    partes: () =>
      figura(par(desenhoLegado("rId10")), {
        relacoes: [{ id: "rId10", tipo: "image", alvo: "media/image1.emf" }],
        midia: { "image1.emf": EMF_MINIMO },
      }),
  },
  // JPEG: a imagem sai com a extensão dela.
  {
    nome: "figura-jpeg",
    partes: () =>
      figura(par(imagem("rId10")), {
        relacoes: [{ id: "rId10", tipo: "image", alvo: "media/image1.jpeg" }],
        midia: { "image1.jpeg": PNG_MINIMO },
      }),
  },
  // Mescla malformada: a continuação não tem célula acima na mesma coluna.
  {
    nome: "mescla-malformada",
    partes: () => ({
      corpo:
        titulo("1 MESCLA MALFORMADA") +
        tabela([
          linha([celula("larga", { colunas: 2 }), celula("c")]),
          linha([celula("a"), celula("órfã", { vertical: "continua" }), celula("c2")]),
          linha([celula("topo", { vertical: "continua" }), celula("x"), celula("y")]),
        ]),
    }),
  },
];

/** Bytes do DOCX de uma fixture. */
export function docxDaFixture(nome: string): Uint8Array {
  const fixture = FIXTURES.find((item) => item.nome === nome);
  if (!fixture) throw new Error(`Fixture desconhecida: ${nome}`);
  return montarDocx(fixture.partes());
}
