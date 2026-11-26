// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- os testes leem os gabaritos do disco e fixam o relógio com datas dadas
/**
 * Conversão DOCX do PPC (`src/conversao-docx/`): a leitura, as regras de domínio e os artefatos,
 * sobre os documentos sintéticos de `src/testes/documentos.ts`.
 *
 * Os gabaritos de `fixtures/conversao-docx/` são os artefatos de cada documento sintético, gravados
 * em 17/11/2026: a conversão tem de reproduzi-los byte a byte. Uma mudança deliberada na saída
 * regrava o gabarito do documento afetado, no mesmo commit.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, test } from "vite-plus/test";
import { conferirArquivoDocx, converterPpc } from "../src/conversao-docx/conversao.ts";
import {
  type Elemento,
  elementosDoDocumento,
  type Paragrafo,
  type Tabela,
  textoDosTrechos,
} from "@simplifica-if/docx/elementos";
import {
  extrairMatrizPpc,
  type MatrizPpc,
  mesclarMatrizes,
  substituirMatrizNoMarkdown,
  totaisDeclarados,
} from "../src/conversao-docx/matriz.ts";
import { dataW3cEmUtc, lerDocx } from "@simplifica-if/docx/leitor";
import { ErroDocx } from "@simplifica-if/docx/pacote";
import { analisarXml, descendentes } from "@simplifica-if/docx/xml";
import { detectarSecoes, listarSecoes } from "../src/conversao-docx/secoes.ts";
import {
  colunasDaTabela,
  formasDaTabela,
  normalizarTabela,
  tabelaEmMarkdown,
  type TabelaNormalizada,
  todasAsLinhas,
} from "@simplifica-if/docx/tabelas";
import { celula, hyperlink, linha, montarDocx, par, run, tabela, titulo } from "@simplifica-if/docx/testes/sintetico";
import { docxDaFixture, FIXTURES } from "../src/testes/documentos.ts";

const GABARITOS = NodePath.join(import.meta.dirname, "fixtures", "conversao-docx");

const elementos = (nome: string) => elementosDoDocumento(lerDocx(docxDaFixture(nome)));
const converter = (nome: string) => converterPpc(docxDaFixture(nome), `${nome}.docx`);
const tabelas = (itens: Elemento[]) => itens.filter((item): item is Tabela => item.tipo === "tabela");
const paragrafos = (itens: Elemento[]) => itens.filter((item): item is Paragrafo => item.tipo === "paragrafo");
const textos = (tabelaLida: Tabela) => tabelaLida.linhas.map((celulas) => celulas.map((item) => item.texto));

/** Os artefatos da conversão da fixture (Markdown normalizado, bruto e imagem se houver), por caminho. */
function bytesConvertidos(nome: string): Record<string, Buffer> {
  const c = converter(nome);
  const figura = c.representacaoGrafica?.arquivo;
  return {
    ...(figura ? { [figura.caminho]: Buffer.from(figura.bytes) } : {}),
    [`${nome}.md`]: Buffer.from(c.markdown),
    [`${nome}-bruto.md`]: Buffer.from(c.markdownBruto),
  };
}

// ---------------------------------------------------------------- leitor OOXML

describe("leitor OOXML", () => {
  test("mescla horizontal, vertical e em bloco: a repetida copia a célula; a leitura, só na vertical", () => {
    const [grade] = tabelas(elementos("mesclas"));
    // O modelo guarda cada célula uma vez, com as colunas que ocupa.
    expect(grade!.linhas[0]).toEqual([
      { texto: "A", colunas: 1, continuacao: false },
      { texto: "B e C", colunas: 2, continuacao: false },
      { texto: "D", colunas: 1, continuacao: false },
    ]);
    const { leitura, repetida } = formasDaTabela(grade!);
    expect(todasAsLinhas(repetida)).toEqual([
      ["A", "B e C", "B e C", "D"],
      ["Vertical", "x", "y", "z"],
      ["Vertical", "Bloco 2×2", "Bloco 2×2", "w"],
      ["fim", "Bloco 2×2", "Bloco 2×2", "v"],
    ]);
    expect(todasAsLinhas(leitura)).toEqual([
      ["A", "B e C", "", "D"],
      ["Vertical", "x", "y", "z"],
      ["Vertical", "Bloco 2×2", "", "w"],
      ["fim", "Bloco 2×2", "", "v"],
    ]);
  });

  test("mescla em L: a continuação repete a célula de cima só na largura dela; `gridBefore` desloca a linha", () => {
    const [, emL] = tabelas(elementos("mesclas"));
    expect(todasAsLinhas(formasDaTabela(emL!).repetida)).toEqual([
      ["Topo largo", "Topo largo", "1"],
      ["Topo largo", "perna", "2"],
      ["", "solta", "3"],
    ]);
  });

  test("mescla malformada não aborta: a continuação sem célula acima vale por si", () => {
    const [grade] = tabelas(elementos("mescla-malformada"));
    expect(todasAsLinhas(formasDaTabela(grade!).repetida)).toEqual([
      ["larga", "larga", "c"],
      ["a", "órfã", "c2"],
      ["a", "x", "y"],
    ]);
  });

  test("colunas da grade que nenhuma linha separa viram uma só na leitura", () => {
    const [quadro] = tabelas(elementos("ementario-mesclado"));
    const { leitura, repetida } = formasDaTabela(quadro!);
    expect(colunasDaTabela(repetida)).toBe(3);
    expect(colunasDaTabela(leitura)).toBe(1);
    expect(leitura.cabecalho).toEqual(["COMPONENTE CURRICULAR: Programação I"]);
  });

  test("tabela sem texto e célula de vários parágrafos", () => {
    const [, , vazia, comParagrafos] = tabelas(elementos("mesclas"));
    // Sem texto em nenhuma célula, vale a leitura direta, que mantém as células vazias.
    expect(textos(vazia!)).toEqual([
      ["", ""],
      ["", ""],
    ]);
    expect(tabelaEmMarkdown(normalizarTabela(vazia!))).toBe("|  |  |\n|---|---|\n|  |  |");
    expect(tabelaEmMarkdown(normalizarTabela(comParagrafos!))).toBe(
      // As duas colunas são numéricas ("1,5" e "2"; "10%" e "- 3"): alinhadas à direita.
      ["| Campo \\| com barra | linha 1<br>linha 2<br>linha 3 |", "|---:|---:|", "| 1,5 | 10% |", "| 2 | - 3 |"].join(
        "\n",
      ),
    );
  });

  test("controles de conteúdo: parágrafos e tabelas embrulhados em w:sdt entram na ordem", () => {
    const lidos = elementos("controles");
    expect(paragrafos(lidos).map(textoDosTrechos).slice(0, 1)).toEqual(["Parágrafo dentro de controle."]);
    // O parágrafo todo em negrito do controle aninhado não é numerado nem grande: continua parágrafo.
    expect(lidos[2]).toMatchObject({
      tipo: "paragrafo",
      trechos: [{ texto: "Parágrafo em controle aninhado.", negrito: true }],
    });
    const [emControle, celulasEmbrulhadas, mista, aninhada] = tabelas(lidos);
    // Tabela dentro de w:sdt: leitura direta, com colunas e marca de continuação.
    expect(emControle!.linhas).toEqual([
      [
        { texto: "Item", colunas: 1, continuacao: false },
        { texto: "Descrição", colunas: 2, continuacao: false },
      ],
      [
        { texto: "Grupo", colunas: 1, continuacao: false },
        { texto: "a", colunas: 1, continuacao: false },
        { texto: "b", colunas: 1, continuacao: false },
      ],
      [
        { texto: "", colunas: 1, continuacao: true },
        { texto: "c", colunas: 1, continuacao: false },
        { texto: "d\ne", colunas: 1, continuacao: false },
      ],
    ]);
    expect(normalizarTabela(emControle!).linhas).toEqual([
      ["Grupo", "a", "b"],
      ["Grupo", "c", "d<br>e"],
    ]);
    // Células embrulhadas (Google Docs): a linha não tem célula direta, e a leitura direta as acha.
    expect(textos(celulasEmbrulhadas!)).toEqual([
      ["Campus:", "Campus Embrulhado"],
      ["Turno:", "Noturno"],
    ]);
    // Com uma célula direta com texto vale a grade repetida, e a embrulhada em `w:sdt` é da linha.
    expect(textos(mista!)).toEqual([["direta", "embrulhada"]]);
    // O texto da tabela aninhada não entra na célula que a contém.
    expect(textos(aninhada!)).toEqual([["fora\ndepois", "ao lado"]]);
  });

  test("alterações controladas: as inserções ainda não aceitas entram, o removido não", () => {
    const documento = paragrafos(elementos("rastreadas")).map(textoDosTrechos);
    expect(documento).toEqual([
      "O curso tem quatro anos de duração.",
      "Parágrafo inteiro inserido na revisão.",
      "Movido: texto no destino",
      "Marca: Curitiba.",
      "Campo: 12 e controle em linha.",
      "Link revisado: norma inserida.",
      "Texto da seção inserida.",
    ]);
    // O título inserido na revisão é uma seção.
    expect(listarSecoes(detectarSecoes(elementos("rastreadas")))).toEqual([
      "1 ALTERAÇÕES CONTROLADAS",
      "2 TÍTULO INSERIDO",
    ]);
    // O hyperlink inserido mantém o endereço, e o texto removido (w:del) não aparece.
    expect(paragrafos(elementos("rastreadas"))[5]!.trechos[1]).toMatchObject({
      texto: "norma inserida",
      url: "https://exemplo.edu.br/norma",
    });
    expect(textos(tabelas(elementos("rastreadas"))[0]!)[1]).toEqual(["Duração: 4 anos", "sem alteração"]);
  });

  test("tabulação, quebras e hífen incondicional viram texto; quebra de página não", () => {
    const lidos = paragrafos(elementos("texto-especial")).map(textoDosTrechos);
    expect(lidos[0]).toBe("Coluna 1\tColuna 2\nsegunda linha");
    expect(lidos[1]).toBe("guarda-chuva depois da página\nnova linha\tà direita");
  });

  test("hyperlinks: endereço com âncora, link interno e relação quebrada", () => {
    const [, , links] = paragrafos(elementos("texto-especial"));
    expect(links!.trechos.map((trecho) => [trecho.texto, trecho.url])).toEqual([
      ["externo com âncora", "https://exemplo.edu.br/pagina#secao"],
      [" ", null],
      ["interno", null],
      [" ", null],
      ["relação quebrada", null],
      [" ", null],
      ["em dois ", "https://exemplo.edu.br/pagina"],
      ["pedaços", "https://exemplo.edu.br/pagina"],
    ]);
    // Os dois runs do mesmo link viram um link só, com um negrito só.
    expect(converter("texto-especial").markdownBruto).toContain(
      "[externo com âncora](https://exemplo.edu.br/pagina#secao) interno relação quebrada [**em dois pedaços**](https://exemplo.edu.br/pagina)",
    );
  });

  test("títulos pelo estilo e pela formatação direta", () => {
    const titulos = elementos("texto-especial")
      .filter((item) => item.tipo === "titulo")
      .map((item) => [item.texto, item.nivel, item.estilo]);
    expect(titulos).toEqual([
      ["Título pelo estilo", 1, "Heading 1"],
      ["Subtítulo pelo estilo", 2, "Heading 2"],
      ["2.1 Numerado em negrito", 2, null],
      ["2.1.1. Com ponto final", 3, null],
      ["2024 Número solto em negrito vira título", 1, null],
      ["Grande de 18", 1, null],
      ["Médio de 16", 2, null],
      ["Pequeno de 14", 3, null],
    ]);
    // Sete níveis de numeração, negrito de 12 e numerado sem negrito continuam parágrafos.
    const corridos = paragrafos(elementos("texto-especial")).map(textoDosTrechos);
    expect(corridos).toContain("1.2.3.4.5.6.7 Fundo demais para título");
    expect(corridos).toContain("Negrito de 12 não é título");
  });

  test("listas pelo estilo (com nível pelo recuo) e pelo texto", () => {
    const itens = paragrafos(elementos("texto-especial"))
      .filter((item) => item.itemDeLista)
      .map((item) => [textoDosTrechos(item), item.tipoLista, item.nivelLista]);
    expect(itens).toEqual([
      ["Item de lista pelo estilo", "marcador", 0],
      ["Item recuado", "marcador", 2],
      ["Numerado pelo estilo", "numerada", 1],
      ["1) primeiro", "numerada", 0],
      ["2. segundo", "numerada", 0],
      ["a) alínea", "numerada", 0],
      ["• marcador digitado", "marcador", 0],
      ["– travessão", "marcador", 0],
      ["• último item", "marcador", 0],
    ]);
    // "-x" tem só dois caracteres: não é item.
    expect(paragrafos(elementos("texto-especial")).find((item) => textoDosTrechos(item) === "-x")!.itemDeLista).toBe(
      false,
    );
  });

  test("namespaces: o que vale é a URI, não o prefixo", () => {
    const comOutrosPrefixos = (bytes: Uint8Array) => {
      const partes = unzipSync(bytes);
      const xml = strFromU8(partes["word/document.xml"]!)
        .replaceAll("xmlns:w=", "xmlns:word=")
        .replaceAll(/(<\/?|\s)w:/g, "$1word:")
        .replaceAll("xmlns:r=", "xmlns:rel=")
        .replaceAll(/(\s)r:(id|embed)=/g, "$1rel:$2=");
      return zipSync({ ...partes, "word/document.xml": strToU8(xml) });
    };
    for (const nome of ["ppc-minimo", "texto-especial", "controles"]) {
      const original = docxDaFixture(nome);
      expect(elementosDoDocumento(lerDocx(comOutrosPrefixos(original)))).toEqual(
        elementosDoDocumento(lerDocx(original)),
      );
    }
    const raiz = analisarXml(
      '<a:x xmlns:a="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns="urn:outro"><a:p a:val="1"/><p/></a:x>',
    );
    expect(raiz!.name).toBe("w:x");
    expect(descendentes(raiz!, "w:p").map((item) => item.attribs)).toEqual([{ "w:val": "1" }]);
    expect(descendentes(raiz!, "{urn:outro}p")).toHaveLength(1);
  });

  test("Strict Open XML: mesmos elementos, com os namespaces do formato estrito", () => {
    const estrito = (bytes: Uint8Array) => {
      const partes = unzipSync(bytes);
      const trocar = (nome: string) =>
        strToU8(
          strFromU8(partes[nome]!)
            .replaceAll(
              "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
              "http://purl.oclc.org/ooxml/wordprocessingml/main",
            )
            .replaceAll(
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
              "http://purl.oclc.org/ooxml/officeDocument/relationships",
            )
            .replaceAll("http://schemas.openxmlformats.org/drawingml/2006/", "http://purl.oclc.org/ooxml/drawingml/"),
        );
      return zipSync({
        ...partes,
        ...Object.fromEntries(
          ["word/document.xml", "word/styles.xml", "_rels/.rels", "word/_rels/document.xml.rels"].map((nome) => [
            nome,
            trocar(nome),
          ]),
        ),
      });
    };
    for (const nome of ["ppc-minimo", "texto-especial", "mesclas"]) {
      const original = docxDaFixture(nome);
      expect(elementosDoDocumento(lerDocx(estrito(original)))).toEqual(elementosDoDocumento(lerDocx(original)));
    }
    // A figura continua resolvida pela relação.
    const convertido = converterPpc(estrito(docxDaFixture("ppc-minimo")), "ppc.docx");
    expect(convertido.representacaoGrafica).toMatchObject({ metodo: "bitmap" });
  });

  test("datas das propriedades do documento em UTC", () => {
    expect(dataW3cEmUtc("2026-03-05T10:38:00Z")).toBe("2026-03-05T10:38:00+00:00");
    expect(dataW3cEmUtc("2026-04-22T00:06:00-03:00")).toBe("2026-04-22T03:06:00+00:00");
    expect(dataW3cEmUtc("2026-04-22T00:06:00+05:30")).toBe("2026-04-21T18:36:00+00:00");
    expect(dataW3cEmUtc("2026-03")).toBe("2026-03-01T00:00:00+00:00");
    expect(dataW3cEmUtc("ontem")).toBeNull();
  });

  test("documento sem texto é recusado, em vez de virar um PPC.md em branco", () => {
    const semTexto = montarDocx({ corpo: par("") + tabela([linha([celula(""), celula("")])]) });
    expect(() => converterPpc(semTexto, "vazio.docx")).toThrow(ErroDocx);
    expect(() => converterPpc(semTexto, "vazio.docx")).toThrow(/não tem texto.*digitalizado/);
    expect(() => converterPpc(strToU8("não é um zip"), "x.docx")).toThrow(ErroDocx);
  });
});

// ---------------------------------------------------------------- regras de domínio

function grade(linhas: string[][]): TabelaNormalizada {
  return { cabecalho: linhas[0]!, linhas: linhas.slice(1) };
}

const linhasLegadas = (ano: string, componentes: string[]): string[][] => [
  ["", "", "", "", ""],
  ...componentes.map((nome) => [ano, nome, "2", "80", "67"]),
  [ano, "Subtotal (Total do período)", "33", "1320", "1100*"],
];

const numerados = (prefixo: string, quantidade: number) =>
  Array.from({ length: quantidade }, (_, i) => `Componente ${prefixo}.${i + 1}`);

function linhasDeNucleos(): string[][] {
  const tecnico = (ano: string, nome: string, aulas: number) => [
    ano,
    nome,
    String(aulas),
    String(aulas * 40),
    "",
    "",
    String(aulas * 40),
    String(Math.round((aulas * 40 * 5) / 6)),
  ];
  const geral = (ano: string, nome: string, aulas: number) => [
    ano,
    nome,
    String(aulas),
    "",
    String(aulas * 40),
    "",
    String(aulas * 40),
    String(Math.round((aulas * 40 * 5) / 6)),
  ];
  const porAno: Record<string, string[][]> = {
    "1": [
      ...numerados("técnico 1", 5).map((nome) => tecnico("1", nome, 2)),
      ...numerados("geral 1", 9).map((nome) => geral("1", nome, 2)),
    ],
    "2": [
      ...numerados("técnico 2", 6).map((nome) => tecnico("2", nome, 2)),
      ...numerados("geral 2", 9).map((nome) => geral("2", nome, 2)),
    ],
    "3": [
      ...numerados("técnico 3", 5).map((nome) => tecnico("3", nome, 3)),
      ...numerados("geral 3", 9).map((nome) => geral("3", nome, 2)),
    ],
  };
  const linhas: string[][] = [
    Array<string>(8).fill("MATRIZ CURRICULAR CURSO TÉCNICO EM TESTES INTEGRADO AO ENSINO MÉDIO"),
    Array<string>(8).fill("LEGENDA"),
    [
      ...Array<string>(5).fill(
        "FGB: Formação Geral Básica FTP: Formação Técnico-Profissional (conforme CNCT) NP: Núcleo Politécnico",
      ),
      ...Array<string>(3).fill("CH: Carga horária HA: Hora-aula HR: Hora-relógio"),
    ],
    ["Semanas do ano letivo", "Semanas do ano letivo", "40", "", "", "", "", ""],
    ["CH em Hora-aula (min)", "CH em Hora-aula (min)", "50", "", "", "", "", ""],
  ];
  for (const ano of ["1", "2", "3"]) {
    linhas.push([
      "Ano",
      "Componente Curricular",
      "No. de aulas semanais",
      "Hora-aula FTP",
      "Hora-aula FGB",
      "Hora-aula NP",
      "Hora-aula TOTAL",
      "Hora relógio TOTAL",
    ]);
    linhas.push(...porAno[ano]!);
    linhas.push([...Array<string>(3).fill("TOTAL ANO HORA-AULA"), "480", "840", "0", "1320", ""]);
    linhas.push([...Array<string>(3).fill("TOTAL ANO HORA-RELÓGIO"), "400", "700", "0", "", "1100"]);
  }
  linhas.push(
    [...Array<string>(6).fill("(AC) Atividades Complementares (min. 200 horas-relógio)"), "", ""],
    [...Array<string>(6).fill("(ES) Estágio Supervisionado (min. 400 horas-relógio)"), "", ""],
    ["", "", "", "FTP", "FGB", "NP", "TOTAL", ""],
    [...Array<string>(3).fill("C.H. (HORA RELÓGIO) TOTAL DO CURSO"), "1200", "2100", "0", "3300", ""],
  );
  return linhas;
}

describe("matriz curricular", () => {
  test("matriz no formato legado, fragmentada em três tabelas", () => {
    const total = "CARGA HORÁRIA TOTAL DO CURSO";
    const partes = [
      grade([
        Array<string>(5).fill("MATRIZ CURRICULAR CURSO TÉCNICO EM TESTES INTEGRADO AO ENSINO MÉDIO"),
        ["", "Semanas do ano letivo", "40", "", ""],
        ["", "CH em Hora-aula (min)", "50", "", ""],
        [
          "Ano",
          "Componente Curricular",
          "Número de aulas semanais",
          "CH hora-aula no período",
          "CH hora-relógio no período",
        ],
        ...linhasLegadas("1º Ano", numerados("1", 14)).slice(1),
      ]),
      grade(linhasLegadas("2º Ano", numerados("2", 15))),
      grade([
        ...linhasLegadas("3º Ano", numerados("3", 14)),
        ["Hora-aula", "Hora-relógio", "", "", ""],
        [...Array<string>(2).fill("(AC) Atividades Complementares (min. 200 horas-relógio)"), "", "0", "0"],
        [...Array<string>(2).fill("(ES) Estágio Supervisionado (min. 400 horas-relógio)"), "", "0", "0"],
        [total, total, total, "3960", "3300"],
      ]),
    ];
    let matriz: MatrizPpc | null = null;
    for (const parte of partes) matriz = mesclarMatrizes(matriz, extrairMatrizPpc(parte)!);
    const ppc = matriz!;
    expect(ppc.formato).toBe("legacy");
    expect(ppc.anos.map((ano) => ano.componentes.length)).toEqual([14, 15, 14]);
    expect(ppc.anos.map((ano) => ano.ano)).toEqual(["1º Ano", "2º Ano", "3º Ano"]);
    expect(ppc.totais).toEqual({ ch_total_hora_aula: 3960, ch_total_hora_relogio: 3300 });
    expect(ppc.linhas_modelo).toHaveLength(2);
    expect(ppc.anos[0]!.subtotais).toEqual({
      aulas_semanais: 33,
      ch_total_hora_aula: 1320,
      ch_total_hora_relogio: 1100,
    });
  });

  test("matriz no formato de núcleos (FTP, FGB, NP)", () => {
    const matriz = extrairMatrizPpc(grade(linhasDeNucleos()))!;
    expect(matriz.formato).toBe("nucleos_ftp_fgb_np");
    expect(matriz.anos.map((ano) => ano.componentes.length)).toEqual([14, 15, 14]);
    expect(matriz.totais).toMatchObject({ ch_ftp: 1200, ch_fgb: 2100, ch_np: 0, ch_total_hora_relogio: 3300 });
    // Sem linha de total em hora-aula, vale a soma dos componentes.
    expect(matriz.totais.ch_total_hora_aula).toBe(3640);
    expect(matriz.minutos_hora_aula).toBe(50);
    expect(matriz.semanas_ano_letivo).toBe(40);
    // A célula mesclada da linha-modelo repete o nome, não uma carga.
    expect(matriz.linhas_modelo.every((item) => item.ch_hora_relogio === null && item.ch_ftp === null)).toBe(true);
    expect(matriz.anos[0]!.subtotais).toEqual({
      ch_ftp: 480,
      ch_fgb: 840,
      ch_np: 0,
      ch_total_hora_aula: 1320,
      ch_ftp_hora_relogio: 400,
      ch_fgb_hora_relogio: 700,
      ch_np_hora_relogio: 0,
      ch_total_hora_relogio: 1100,
    });
  });

  test("quadro docente não é matriz", () => {
    const quadro = grade([
      ["Nome", "Área de formação", "Perfil de Formação", "Componente Curricular"],
      ["Docente A", "Engenharia", "Mestre", "Estruturas"],
      ["Docente B", "Matemática", "Doutora", "Matemática I"],
    ]);
    expect(extrairMatrizPpc(quadro)).toBeNull();
  });

  test("o Markdown normalizado recebe a matriz canônica, sem o ruído das mesclas", () => {
    const matriz = extrairMatrizPpc(grade(linhasDeNucleos()))!;
    const markdown = [
      "## Sumário",
      "",
      "## 5.6 MATRIZ CURRICULAR 29",
      "",
      "## 5.6 MATRIZ CURRICULAR",
      "",
      "No Quadro 1, é apresentada a matriz curricular.",
      "",
      "| MATRIZ CURRICULAR CURSO TÉCNICO EM TESTES INTEGRADO AO ENSINO MÉDIO | MATRIZ CURRICULAR CURSO TÉCNICO EM TESTES INTEGRADO AO ENSINO MÉDIO |",
      "|---|---|",
      "| FGB: Formação Geral Básica FTP: Formação Técnico-Profissional (conforme CNCT) NP: Núcleo Politécnico | CH: Carga horária HA: Hora-aula HR: Hora-relógio |",
      "| Ano | Componente Curricular |",
      "| 1 | Componente técnico 1.1 |",
      "",
      "- **Nota sobre o somatório da Carga Horária**: texto.",
      "",
      "## 5.7 EMENTÁRIO",
      "",
    ].join("\n");
    const normalizado = substituirMatrizNoMarkdown(markdown, matriz);
    const secao = normalizado.split("## 5.6 MATRIZ CURRICULAR")[2]!.split("## 5.7 EMENTÁRIO")[0]!;
    expect(secao).not.toContain("MATRIZ CURRICULAR CURSO");
    expect(secao).not.toContain("FGB: Formação Geral Básica FTP");
    expect(secao).toContain("| Ano | Componente Curricular | No. de aulas semanais | Hora-aula FTP");
    expect(secao).toContain("| 3 | Componente geral 3.9 | 2 |  | 80 |  | 80 | 67 |");
    expect(secao).toContain("- **Nota sobre o somatório da Carga Horária**: texto.");
    // Sem a seção 5.6, nada muda.
    expect(substituirMatrizNoMarkdown("## 5.7 EMENTÁRIO\n", matriz)).toBe("## 5.7 EMENTÁRIO\n");
  });

  test("matriz de núcleos dividida em duas tabelas, a segunda sem cabeçalho", () => {
    const { matriz, markdown } = converter("ppc-nucleos");
    expect(matriz).toMatchObject({
      formato: "nucleos_ftp_fgb_np",
      anos: [
        {
          ano: "1º Ano",
          componentes: [
            { nome: "Matemática", ch_fgb: 160 },
            { nome: "Eletricidade", ch_ftp: 80 },
          ],
        },
        {
          ano: "2º Ano",
          componentes: [{ nome: "Projeto Integrador", ch_np: 80 }, { nome: "Física" }, { nome: "Automação" }],
        },
      ],
      linhas_modelo: [{ nome: "Atividades Complementares", ch_hora_aula: 60, ch_hora_relogio: 50 }],
      totais: { ch_ftp: 167, ch_fgb: 200, ch_np: 67, ch_total_hora_relogio: 484 },
    });
    expect(markdown).toContain("| 2 | Automação | 3 | 120 |  |  | 120 | 100 |");
    expect(markdown).toContain("| TOTAL ANO HORA-RELÓGIO |  |  | 67 | 133 | 0 |  | 200 |");
  });
});

describe("tabelas", () => {
  test("o Markdown da tabela preserva as quebras internas da célula", () => {
    const tabelaLida: Tabela = {
      tipo: "tabela",
      linhas: [
        [{ texto: "Campo", colunas: 1, continuacao: false }],
        [
          {
            texto:
              "BIBLIOGRAFIA BÁSICA:\nSILVA, Ana. Livro um. São Paulo: Atlas, 2020.\nSOUZA, Bruno. Livro dois. Curitiba: InterSaberes, 2021.",
            colunas: 1,
            continuacao: false,
          },
        ],
      ],
    };
    expect(tabelaEmMarkdown(normalizarTabela(tabelaLida))).toContain(
      "BIBLIOGRAFIA BÁSICA:<br>SILVA, Ana. Livro um. São Paulo: Atlas, 2020.<br>SOUZA, Bruno. Livro dois. Curitiba: InterSaberes, 2021.",
    );
  });
});

// ---------------------------------------------------------------- artefatos

describe("gabaritos da conversão", () => {
  const fixtures = NodeFS.readdirSync(GABARITOS);

  test("há gabarito para cada documento sintético", () => {
    expect(fixtures.sort()).toEqual(FIXTURES.map((fixture) => fixture.nome).sort());
  });

  test.each(fixtures)("%s: a conversão reproduz o gabarito byte a byte", (nome) => {
    const gerados = bytesConvertidos(nome);
    const esperados = NodeFS.readdirSync(NodePath.join(GABARITOS, nome), { recursive: true, encoding: "utf-8" }).filter(
      (arquivo) => NodeFS.statSync(NodePath.join(GABARITOS, nome, arquivo)).isFile(),
    );
    for (const arquivo of esperados) {
      expect(gerados[arquivo]?.equals(NodeFS.readFileSync(NodePath.join(GABARITOS, nome, arquivo))), arquivo).toBe(
        true,
      );
    }
    expect(Object.keys(gerados).sort()).toEqual(esperados.sort());
  });
});

// ---------------------------------------------------------------- regras da conversão

describe("regras da conversão", () => {
  const bruto = (corpo: string, opcoes: Partial<Parameters<typeof converterPpc>[2]> = {}, extras = {}) =>
    converterPpc(montarDocx({ corpo: titulo("1 SEÇÃO") + corpo, ...extras }), "x.docx", opcoes)
      .markdownBruto.split("\n")
      .slice(2)
      .join("\n");

  test("texto de corpo com estilo de título sai como parágrafo, e a seção fica com o texto dela", () => {
    expect(listarSecoes(detectarSecoes(elementos("titulos-de-corpo")))).toEqual([
      "5.9 ESTÁGIO CURRICULAR",
      // Título longo demais para ser título (mais de 200 caracteres) não está aqui; o numerado e curto, sim.
      "1.1.3 Comissão de Estruturação de Curso (CEC) e Comissão de Ajuste Curricular (CAJ):",
      "5.10 PROJETO FINAL",
      "Título curto sem número.",
    ]);
    const { markdown } = converter("titulos-de-corpo");
    expect(markdown).toContain(
      [
        "## 5.9 ESTÁGIO CURRICULAR",
        "",
        "O curso não prevê estágio curricular obrigatório, de modo que o estágio não integra a matriz e não é requisito para a conclusão do curso.",
        "",
        "Sem prejuízo disso, o curso admite o estágio não obrigatório, por iniciativa do estudante:",
        "",
        "- cumprir e fazer cumprir as normas e os procedimentos institucionais;",
        "- zelar pelos laboratórios;",
      ].join("\n"),
    );
  });

  test("listas: numeração automática do Word, número digitado e alíneas", () => {
    expect(converter("listas-automaticas").markdownBruto.split("\n").slice(2)).toEqual([
      "São objetivos do curso:",
      "",
      "- formar técnicos;",
      "- integrar ensino e pesquisa:",
      "  - na iniciação científica.",
      "",
      "Etapas:",
      "",
      "1. diagnóstico;",
      "  1. certificado de conclusão;",
      "1. avaliação.",
      "- redefinido como marcador;",
      "",
      "numeração desligada (numId 0).",
      "",
      "numeração que não existe.",
      "",
      "- **Item em negrito** e normal",
      "",
      "Parágrafo depois da lista.",
      "",
      "2. segundo item digitado",
      "3) terceiro",
      "- b) alínea digitada",
      "- **c)** alínea com a letra em negrito",
    ]);
  });

  test("negrito unido: runs de mesma formatação num marcador só, com os espaços fora dele", () => {
    const negrito = { negrito: true };
    expect(
      bruto(par(run("Pró-Reitoria", negrito) + run(" de ", negrito) + run("Ensino ", negrito) + run("e fim"))),
    ).toBe("**Pró-Reitoria de Ensino** e fim");
    expect(
      bruto(
        par(
          run("a", negrito) +
            run(" ", negrito) +
            run("b", { italico: true }) +
            run(" c", { negrito: true, italico: true }),
        ),
      ),
    ).toBe("**a** *b* ***c***");
    expect(bruto(par(run("normal ") + run("   ", negrito) + run("fim")))).toBe("normal    fim");
    expect(bruto(par(run("riscado ", { tachado: true }) + run("e mais", { tachado: true })))).toBe(
      "~~riscado e mais~~",
    );
    expect(bruto(par(run("a", negrito) + run("b", negrito)))).toBe("**ab**");
  });

  test("links seguros: só http, https e mailto; parênteses e espaços escapados", () => {
    const relacoes = [
      { id: "rId11", tipo: "hyperlink" as const, alvo: "javascript:alert(1))[x](http://evil", externa: true },
      { id: "rId12", tipo: "hyperlink" as const, alvo: "https://exemplo.edu.br/a (b)/c d", externa: true },
      { id: "rId15", tipo: "hyperlink" as const, alvo: "https://exemplo.edu.br/", externa: true },
      { id: "rId13", tipo: "hyperlink" as const, alvo: "MAILTO:alguem@exemplo.edu.br", externa: true },
      { id: "rId14", tipo: "hyperlink" as const, alvo: "file:///etc/passwd", externa: true },
    ];
    const corpo = par(
      hyperlink("clique", 'r:id="rId11"') +
        run(" ") +
        hyperlink("texto ] com colchete", 'r:id="rId12"') +
        run(" ") +
        hyperlink("correio", 'r:id="rId13"') +
        run(" ") +
        hyperlink("arquivo", 'r:id="rId14"'),
    );
    expect(bruto(corpo, {}, { relacoes })).toBe(
      "clique [texto \\] com colchete](https://exemplo.edu.br/a%20%28b%29/c%20d) [correio](MAILTO:alguem@exemplo.edu.br) arquivo",
    );
    // A barra invertida no fim do texto escaparia o colchete que fecha o link.
    expect(bruto(par(hyperlink("C:\\pasta\\", 'r:id="rId15"')), {}, { relacoes })).toBe(
      "[C:\\\\pasta\\\\](https://exemplo.edu.br/)",
    );
  });

  test("matriz dividida em tabelas sem linha de total: os totais são os do curso, não os da última parte", () => {
    const cabecalho = [
      "Ano",
      "Componente Curricular",
      "Número de aulas semanais",
      "CH hora-aula no período",
      "CH hora-relógio no período",
    ];
    const primeira = extrairMatrizPpc({
      cabecalho,
      linhas: [
        ["1", "Matemática", "4", "160", "133"],
        ["1", "Física", "2", "80", "67"],
      ],
    })!;
    const segunda = extrairMatrizPpc({
      cabecalho,
      linhas: [
        ["2", "Química", "2", "80", "67"],
        ["2", "Biologia", "2", "80", "67"],
      ],
    })!;
    expect(segunda.totais).toEqual({ ch_total_hora_aula: 160, ch_total_hora_relogio: 134 });
    expect((mesclarMatrizes(primeira, segunda) as MatrizPpc).totais).toEqual({
      ch_total_hora_aula: 400,
      ch_total_hora_relogio: 334,
    });

    // O total declarado vale, venha na primeira ou na última tabela; o não declarado é recalculado.
    const total = "CARGA HORÁRIA TOTAL DO CURSO";
    const comTotal = extrairMatrizPpc({
      cabecalho,
      linhas: [
        ["3", "Projeto", "2", "80", "67"],
        [total, total, total, "999", ""],
      ],
    })!;
    expect([...totaisDeclarados(comTotal)]).toEqual(["ch_total_hora_aula"]);
    const noFim = mesclarMatrizes(mesclarMatrizes(primeira, segunda), comTotal) as MatrizPpc;
    expect(noFim.totais).toEqual({ ch_total_hora_aula: 999, ch_total_hora_relogio: 401 });
    const noComeco = mesclarMatrizes(mesclarMatrizes(comTotal, primeira), segunda) as MatrizPpc;
    expect(noComeco.totais).toEqual({ ch_total_hora_aula: 999, ch_total_hora_relogio: 401 });
    // A marca do que foi declarado não vai para o JSON.
    expect(JSON.parse(JSON.stringify(noFim))).not.toHaveProperty("totais_declarados");
    expect(Object.keys(noFim)).toEqual([
      "tipo",
      "formato",
      "minutos_hora_aula",
      "semanas_ano_letivo",
      "anos",
      "linhas_modelo",
      "totais",
    ]);
  });

  test("matriz com linha, célula e parágrafo embrulhados em w:sdt e linha removida na revisão", () => {
    const nomes = (
      converter("tabelas-em-controle").matriz!.anos as Array<{ componentes: Array<{ nome: string }> }>
    )[0]!.componentes.map((item) => item.nome);
    expect(nomes).toEqual(["Matemática", "Linha em controle", "Célula em controle", "Parágrafo em controle"]);
    const { markdown, representacaoGrafica } = converter("tabelas-em-controle");
    expect(markdown).toContain("| Período: 1º ano<br>caixa de texto | ao lado |");
    // A figura apagada na revisão não é a representação gráfica; sobra o desenho com formas.
    expect(representacaoGrafica).toMatchObject({ metodo: "vetorial_nao_renderizada", temBitmap: false });
  });

  test("documento enorme converte sem estourar a pilha: 20 mil parágrafos, um deles com 100 mil runs inseridos", () => {
    const runs = `<w:ins w:id="1" w:author="a">${run("x").repeat(100_000)}</w:ins>`;
    const matriz = tabela([
      linha(
        [
          "Ano",
          "Componente Curricular",
          "Número de aulas semanais",
          "CH hora-aula no período",
          "CH hora-relógio no período",
        ].map((item) => celula(item)),
      ),
      linha(["1º Ano", "Matemática", "2", "80", "67"].map((item) => celula(item))),
    ]);
    // 20 mil parágrafos passam da profundidade de pilha de uma recursão por elemento.
    const corpo =
      titulo("5.6 MATRIZ CURRICULAR") + matriz + par(runs) + par("Parágrafo de corpo, um entre muitos.").repeat(20_000);
    // O texto repetido comprime demais para o limite padrão, e o parágrafo de runs passa do teto por bloco.
    const convertido = converterPpc(montarDocx({ corpo, validar: false }), "grande.docx", {
      limites: { razaoDeCompressao: 5000 },
      limitesDeTexto: { caracteresPorBloco: 1_000_000 },
    });
    expect(convertido.elementos.length).toBeGreaterThan(20_000);
    expect(convertido.markdown).toContain("| 1º Ano | Matemática | 2 | 80 | 67 |");
  });

  test("texto de célula multiplicado pela mescla vertical é recusado depressa", { timeout: 10_000 }, () => {
    const mesclada = (texto: string, linhas: number) =>
      montarDocx({
        corpo:
          titulo("1 TABELA") +
          tabela([
            linha([celula(texto, { vertical: "inicio" }), celula("a")]),
            ...Array.from({ length: linhas }, () => linha([celula("", { vertical: "continua" }), celula("b")])),
          ]),
      });
    // 1 MB de texto repetido em 2 mil linhas: 2 GB de tabela (antes, 113 s até `Invalid string length`).
    expect(() => converterPpc(mesclada("palavra ".repeat(131_072), 2000), "x.docx")).toThrow(
      /uma célula de tabela com mais de 50 mil caracteres/,
    );
    // Abaixo do limite, a célula mesclada se repete, limpa uma vez só.
    const { markdownBruto } = converterPpc(mesclada("palavra ".repeat(1024), 500), "x.docx");
    expect(markdownBruto.split("\n").filter((item) => item.startsWith("| palavra palavra"))).toHaveLength(501);
  });

  test(
    "orçamento do documento: tabelas que, cada uma, passam pelo teto por tabela são recusadas depressa",
    { timeout: 5_000 },
    () => {
      // O caso da re-verificação: 60 tabelas num ZIP de 18 KB; cerca de 2 s por tabela e
      // `Invalid string length` aos 119 s.
      const tabelaMesclada = (texto: string) =>
        tabela([
          linha([celula(texto, { vertical: "inicio" }), celula("a")]),
          ...Array.from({ length: 100 }, () => linha([celula("", { vertical: "continua" }), celula("b")])),
        ]);
      // Células de 40 mil caracteres (abaixo do teto por bloco), repetidas 101 vezes: 4 milhões por tabela.
      const corpo = par("x") + Array.from({ length: 60 }, (_, i) => tabelaMesclada(i + "a ".repeat(20_000))).join("");
      const docx = montarDocx({ corpo, validar: false });
      expect(docx.length).toBeLessThan(64 * 1024);
      expect(() => converterPpc(docx, "x.docx")).toThrow(
        /texto demais para ser convertido \(mais de 8 milhões de caracteres/,
      );
      // Com as células de 160 mil caracteres do caso original, a recusa vem antes, no teto por bloco.
      const maior = montarDocx({ corpo: par("x") + tabelaMesclada("a ".repeat(80_000)) });
      expect(() => converterPpc(maior, "x.docx")).toThrow(/uma célula de tabela com mais de 50 mil caracteres/);
      // Uma tabela dessas cabe.
      const uma = montarDocx({ corpo: par("x") + tabelaMesclada("a ".repeat(20_000)), validar: false });
      expect(converterPpc(uma, "x.docx").elementos).toHaveLength(2);
    },
  );

  test("80 mil tabulações ou espaços seguidos num parágrafo: recusado em milissegundos", { timeout: 10_000 }, () => {
    // ZIP de 3 KB; antes, 89 s (tabulações) e 17 s (espaços) no aparo por expressão regular.
    const casos = [
      par(`<w:r><w:t>a</w:t>${"<w:tab/>".repeat(80_000)}<w:t>b</w:t></w:r>`),
      par(`<w:r><w:t xml:space="preserve">a${" ".repeat(80_000)}b</w:t></w:r>`),
      par(`<w:r><w:t xml:space="preserve">a${"\u2003".repeat(40_000)}b</w:t></w:r>`),
      par(`<w:r><w:t xml:space="preserve">a${".,;: ".repeat(8_000)}b</w:t></w:r>`),
      tabela([linha([celula(par(`<w:r><w:t>a</w:t>${"<w:tab/>".repeat(40_000)}<w:t>b</w:t></w:r>`))])]),
    ];
    for (const corpo of casos) {
      expect(() =>
        converterPpc(montarDocx({ corpo }), "x.docx", {
          limitesDeTexto: { caracteresPorBloco: 1_000_000 },
        }),
      ).toThrow(/mais de 1000 espaços, tabulações ou sinais de pontuação seguidos/);
    }
    // Sem o teto de sequência (só para medir): o aparo e o normalizador dão conta das 80 mil tabulações.
    const folgado = { caracteresPorBloco: 1_000_000, sequenciaSemTexto: 1_000_000 };
    const { markdown } = converterPpc(montarDocx({ corpo: casos[0]! }), "x.docx", {
      limitesDeTexto: folgado,
    });
    expect(markdown).toBe("a b\n");
    // Mil tabulações (37 vezes a maior sequência dos PPCs reais) passam com os tetos padrão.
    const mil = montarDocx({ corpo: par(`<w:r><w:t>a</w:t>${"<w:tab/>".repeat(1000)}<w:t>b</w:t></w:r>`) });
    expect(converterPpc(mil, "x.docx").markdown).toBe("a b\n");
  });

  test("tabela que expandida passaria de dois milhões de células é recusada", () => {
    const larga = { texto: "x", colunas: 63, continuacao: false };
    const tabelaHostil: Tabela = {
      tipo: "tabela",
      linhas: [
        Array.from({ length: 1000 }, () => larga),
        ...Array.from({ length: 40 }, () => [{ texto: "y", colunas: 1, continuacao: false }]),
      ],
    };
    expect(() => normalizarTabela(tabelaHostil)).toThrow(ErroDocx);
  });
});

describe("representação gráfica", () => {
  test("imagem PNG embutida é copiada e referenciada no Markdown", () => {
    const { representacaoGrafica, markdown } = converter("ppc-minimo");
    expect(representacaoGrafica).toMatchObject({
      secao: "5.11 REPRESENTAÇÃO GRÁFICA DO PROCESSO FORMATIVO",
      temBitmap: true,
      temDesenhosVetoriais: false,
      metodo: "bitmap",
      arquivo: { caminho: "imagens/representacao_grafica.png" },
    });
    expect(markdown).toContain(
      "## 5.11 REPRESENTAÇÃO GRÁFICA DO PROCESSO FORMATIVO\n\n![Representação Gráfica do Processo Formativo](imagens/representacao_grafica.png)\n\nFigura 1: itinerário formativo.",
    );
  });

  test("JPEG sai com a extensão dele, não como .png", () => {
    const { representacaoGrafica, markdown } = converter("figura-jpeg");
    expect(representacaoGrafica).toMatchObject({
      metodo: "bitmap",
      arquivo: { caminho: "imagens/representacao_grafica.jpeg" },
    });
    expect(markdown).toContain("![Representação Gráfica do Processo Formativo](imagens/representacao_grafica.jpeg)");
  });

  test.each(["figura-vetorial", "figura-legada"])(
    "%s: desenho com formas não é renderizado, e o PPC.md avisa",
    (nome) => {
      const { representacaoGrafica, markdown, markdownBruto } = converter(nome);
      expect(representacaoGrafica).toMatchObject({
        temBitmap: false,
        temDesenhosVetoriais: true,
        metodo: "vetorial_nao_renderizada",
        arquivo: null,
      });
      expect(markdown).toContain(
        "## 5.11 REPRESENTAÇÃO GRÁFICA DO PROCESSO FORMATIVO\n\n**Aviso da conversão:** a figura desta seção foi desenhada com formas do Word (desenho vetorial) e não foi convertida em imagem. Consulte a representação gráfica no documento original.\n\nTexto antes da figura.",
      );
      // O aviso entra uma vez só, também no Markdown bruto.
      expect(markdownBruto.split("Aviso da conversão").length).toBe(2);
    },
  );

  test.each(["figura-emf", "figura-legada-emf"])(
    "%s: EMF embutido é exportado como está, sem contar como imagem extraída",
    (nome) => {
      const { representacaoGrafica, markdown } = converter(nome);
      expect(representacaoGrafica).toMatchObject({
        temBitmap: true,
        metodo: "vetorial_arquivo_cru",
        arquivo: { caminho: "imagens/representacao_grafica.emf" },
      });
      expect(markdown).toContain(
        "**Aviso da conversão:** a figura desta seção está num formato vetorial (EMF) que não é exibido aqui.",
      );
      expect(markdown).not.toContain("![Representação");
    },
  );

  test("seção sem figura reconhecida: aviso próprio", () => {
    const { representacaoGrafica, markdown } = converter("figura-ausente");
    expect(representacaoGrafica).toMatchObject({
      temBitmap: false,
      temDesenhosVetoriais: true,
      metodo: "figura_nao_localizada",
      arquivo: null,
    });
    expect(markdown).toContain("**Aviso da conversão:** a conversão não encontrou figura nesta seção.");
  });

  test("seção reconhecida por 'fluxograma', com a figura feita de formas", () => {
    const { representacaoGrafica } = converter("ppc-nucleos");
    expect(representacaoGrafica).toMatchObject({
      secao: "5.8 FLUXOGRAMA DO CURSO",
      metodo: "vetorial_nao_renderizada",
      arquivo: null,
    });
  });

  test("documento sem a seção não tem o bloco", () => {
    expect(converter("mesclas").representacaoGrafica).toBeNull();
  });
});

describe("entrada e rodada", () => {
  test("entrada que não é .docx, ou grande demais, é recusada antes da leitura", () => {
    expect(() => conferirArquivoDocx("/pasta/ppc.txt", 5)).toThrow(/deve ser \.docx/);
    expect(() => conferirArquivoDocx("/pasta/.docx", 5)).toThrow(/deve ser \.docx/);
    expect(() => conferirArquivoDocx("/pasta/PPC.DOCX", 5)).not.toThrow();
    expect(() => conferirArquivoDocx("/pasta/ppc.docx", 11, 10)).toThrow(ErroDocx);
  });

  test("todas as fixtures convertem", () => {
    for (const fixture of FIXTURES) expect(() => converter(fixture.nome), fixture.nome).not.toThrow();
  });
});
