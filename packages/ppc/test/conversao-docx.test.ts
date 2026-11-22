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
import type { Dicionario } from "@simplifica-if/kb/primitivas/valores";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, test } from "vite-plus/test";
import { artefatosDaConversao, conferirArquivoDocx, converterPpc } from "../src/conversao-docx/conversao.ts";
import {
  type Elemento,
  elementosDoDocumento,
  type Paragrafo,
  type Tabela,
  textoDosTrechos,
} from "@simplifica-if/docx/elementos";
import { extrairComponenteDoEmentario, separarReferencias } from "../src/conversao-docx/ementario.ts";
import { extrairDadosDeIdentificacao } from "../src/conversao-docx/identificacao-tabelas.ts";
import {
  extrairMatrizGenerica,
  extrairMatrizPpc,
  type Matriz,
  type MatrizPpc,
  mesclarMatrizes,
  substituirMatrizNoMarkdown,
  totaisDeclarados,
} from "../src/conversao-docx/matriz.ts";
import { dataW3cEmUtc, lerDocx } from "@simplifica-if/docx/leitor";
import { ErroDocx } from "@simplifica-if/docx/pacote";
import { analisarXml, descendentes } from "@simplifica-if/docx/xml";
import { detectarSecoes, dicasDeIdentificacao, listarSecoes } from "../src/conversao-docx/secoes.ts";
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

const AGORA = new Date(2026, 10, 16, 12, 0, 0);
const GABARITOS = NodePath.join(import.meta.dirname, "fixtures", "conversao-docx");

const elementos = (nome: string) => elementosDoDocumento(lerDocx(docxDaFixture(nome)));
const converter = (nome: string) => converterPpc(docxDaFixture(nome), `${nome}.docx`, { agora: AGORA });
const tabelas = (itens: Elemento[]) => itens.filter((item): item is Tabela => item.tipo === "tabela");
const paragrafos = (itens: Elemento[]) => itens.filter((item): item is Paragrafo => item.tipo === "paragrafo");
const textos = (tabelaLida: Tabela) => tabelaLida.linhas.map((celulas) => celulas.map((item) => item.texto));

/** Os artefatos da conversão da fixture, com os bytes que quem grava escreveria, por caminho. */
function bytesConvertidos(nome: string): Record<string, Buffer> {
  const { arquivos } = artefatosDaConversao(converter(nome), `${nome}.docx`);
  return Object.fromEntries(arquivos.map(({ caminho, conteudo }) => [caminho, Buffer.from(conteudo)]));
}

/** O mesmo, com o conteúdo em texto. */
function arquivosConvertidos(nome: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(bytesConvertidos(nome)).map(([arquivo, bytes]) => [arquivo, bytes.toString("utf-8")]),
  );
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
    // E o quadro, de uma coluna na leitura, é reconhecido como ementário.
    expect(converter("ementario-mesclado").resumos.ementario).toMatchObject({ total_componentes: 1 });
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
    const convertido = converterPpc(estrito(docxDaFixture("ppc-minimo")), "ppc.docx", { agora: AGORA });
    expect(convertido.representacaoGrafica).toMatchObject({ metodo: "bitmap" });
  });

  test("datas das propriedades do documento em UTC", () => {
    expect(dataW3cEmUtc("2026-03-05T10:38:00Z")).toBe("2026-03-05T10:38:00+00:00");
    expect(dataW3cEmUtc("2026-04-22T00:06:00-03:00")).toBe("2026-04-22T03:06:00+00:00");
    expect(dataW3cEmUtc("2026-04-22T00:06:00+05:30")).toBe("2026-04-21T18:36:00+00:00");
    expect(dataW3cEmUtc("2026-03")).toBe("2026-03-01T00:00:00+00:00");
    expect(dataW3cEmUtc("ontem")).toBeNull();
    expect(converter("ppc-minimo").dados.metadata_documento).toEqual({
      title: "PPC fictício",
      author: "Autora de Teste",
      created: "2026-03-05T10:38:00+00:00",
      modified: "2026-04-22T03:06:00+00:00",
      last_modified_by: "Revisor de Teste",
    });
    // Sem docProps/core.xml (Google Docs), nada é inventado.
    expect(converter("sem-secoes").dados.metadata_documento).toEqual({});
  });

  test("documento sem texto é recusado, em vez de virar um PPC.md em branco", () => {
    const semTexto = montarDocx({ corpo: par("") + tabela([linha([celula(""), celula("")])]) });
    expect(() => converterPpc(semTexto, "vazio.docx", { agora: AGORA })).toThrow(ErroDocx);
    expect(() => converterPpc(semTexto, "vazio.docx", { agora: AGORA })).toThrow(/não tem texto.*digitalizado/);
    expect(() => converterPpc(strToU8("não é um zip"), "x.docx", { agora: AGORA })).toThrow(ErroDocx);
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
    let matriz: Matriz | null = null;
    for (const parte of partes) matriz = mesclarMatrizes(matriz, extrairMatrizPpc(parte)!);
    const ppc = matriz as MatrizPpc;
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
    expect(extrairMatrizGenerica(quadro)).toBeNull();
  });

  test("matriz genérica: componente, carga e período, sem as linhas que não são componente", () => {
    const { matriz } = converter("sem-secoes");
    expect(matriz).toEqual({
      tipo: "matriz_curricular",
      headers: ["Componente Curricular", "Carga horária", "Semestre", "CH total"],
      componentes: [
        { nome: "Algoritmos", cargas: { "Carga horária": 80, Semestre: 1, "CH total": 80 }, total: 80 },
        { nome: "Redes", cargas: { "Carga horária": "sessenta", Semestre: 2 } },
      ],
      total_rows: 2,
    });
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

describe("tabelas e ementário", () => {
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

  test("o ementário trata <br> como quebra de referência", () => {
    const componente = extrairComponenteDoEmentario({
      cabecalho: ["COMPONENTE CURRICULAR: Química I"],
      linhas: [
        ["Período letivo: 1º Ano"],
        ["Carga horária total do componente: 80 horas-aula / 67 horas-relógio"],
        ["EMENTA: Introdução à Química."],
        [
          "BIBLIOGRAFIA BÁSICA: SILVA, Ana. Livro um. São Paulo: Atlas, 2020.<br>SOUZA, Bruno. Livro dois. Curitiba: InterSaberes, 2021.",
        ],
        ["BIBLIOGRAFIA COMPLEMENTAR: BRASIL. Catálogo Nacional de Cursos Técnicos. Brasília: MEC, 2024."],
      ],
    });
    expect(componente).toEqual({
      nome: "Química I",
      periodo_letivo: "1º Ano",
      carga_horaria_aula: 80,
      ementa: "Introdução à Química.",
      bibliografia_basica: [
        "SILVA, Ana. Livro um. São Paulo: Atlas, 2020.",
        "SOUZA, Bruno. Livro dois. Curitiba: InterSaberes, 2021.",
      ],
      bibliografia_complementar: ["BRASIL. Catálogo Nacional de Cursos Técnicos. Brasília: MEC, 2024."],
    });
    // O rótulo sozinho no primeiro parágrafo da célula, sem dois-pontos.
    const rotuloSozinho = extrairComponenteDoEmentario({
      cabecalho: ["COMPONENTE CURRICULAR: Química I"],
      linhas: [["EMENTA<br>Introdução à Química."], ["BIBLIOGRAFIA BÁSICA:<br>SILVA, Ana. Livro um. Atlas, 2020."]],
    });
    expect(rotuloSozinho?.ementa).toBe("Introdução à Química.");
  });

  test("referências emendadas são separadas por ano, hífen de lista, local aproximado e autor", () => {
    expect(
      separarReferencias(
        "COSTA, Ana. Leitura. Rio de Janeiro: Teste, 2013.PEREIRA, Carlos. Texto. Porto Alegre: Modelo, 2018. v. 2.OLIVEIRA, Rita. Escrita. Campinas: Amostra, 2021.",
      ),
    ).toEqual([
      "COSTA, Ana. Leitura. Rio de Janeiro: Teste, 2013.",
      "PEREIRA, Carlos. Texto. Porto Alegre: Modelo, 2018. v. 2.",
      "OLIVEIRA, Rita. Escrita. Campinas: Amostra, 2021.",
    ]);
    expect(
      separarReferencias(
        "SILVA, Maria. Gramática. Sao Paulo: Fictícia, 2020. - SOUZA, João de. Redação. Curitiba: Exemplo, 2019.",
      ),
    ).toEqual([
      "SILVA, Maria. Gramática. Sao Paulo: Fictícia, 2020.",
      "SOUZA, João de. Redação. Curitiba: Exemplo, 2019.",
    ]);
    // Referência repetida sai uma vez; texto que não parece referência é descartado.
    expect(
      separarReferencias(
        "SILVA, Ana. Livro um. São Paulo: Atlas, 2020.\n\nSILVA, Ana. Livro um. São Paulo: Atlas, 2020.\n\nver também o anexo",
      ),
    ).toEqual(["SILVA, Ana. Livro um. São Paulo: Atlas, 2020."]);
    expect(separarReferencias("")).toEqual([]);
  });

  test("quadro com colunas vazias (Google Docs) e período ausente", () => {
    const { ementario } = converter("ppc-minimo");
    expect(
      (ementario!.componentes as Dicionario[]).map((item) => [item.nome, item.periodo_letivo, item.carga_horaria_aula]),
    ).toEqual([
      ["Língua Portuguesa", "1º Ano", 120],
      ["Banco de Dados", "2º Ano", 160],
    ]);
    const semPeriodo = extrairComponenteDoEmentario(
      grade([
        ["COMPONENTE CURRICULAR: Libras"],
        ["EMENTA: Sinais."],
        ["BIBLIOGRAFIA BÁSICA: QUADROS, Ronice. Libras. Porto Alegre: Artmed, 2004."],
      ]),
    );
    expect(semPeriodo).toMatchObject({ nome: "Libras", periodo_letivo: null, carga_horaria_aula: null });
    // Duas colunas com conteúdo não são ementário.
    expect(extrairComponenteDoEmentario(grade([["COMPONENTE CURRICULAR: X", "ementa bibliografia"]]))).toBeNull();
  });
});

describe("identificação", () => {
  test("tabela de identificação ignora rótulo no meio da célula", () => {
    const dados = extrairDadosDeIdentificacao({
      cabecalho: [],
      linhas: [
        ["Base legal específica do curso", "Resolução CNE/CP nº 1/2021"],
        ["Denominação do curso", "Curso Técnico em Enfermagem"],
        ["Observação", "O campus fica no centro; modalidade presencial."],
        ["Campus", "Curitiba"],
      ],
    });
    expect(dados.has("nome_curso")).toBe(false);
    expect(dados.has("modalidade_ensino")).toBe(false);
    expect(dados.get("denominacao_do_curso")).toBe("Curso Técnico em Enfermagem");
    expect(dados.get("campus")).toBe("Curitiba");
  });

  test("célula única campo: valor continua extraída", () => {
    const dados = extrairDadosDeIdentificacao({
      cabecalho: [],
      linhas: [
        ["Nome do curso: Técnico em Química"],
        ["1.1.5 Modalidade: Presencial"],
        ["Forma de oferta: Integrado"],
        ["Eixo tecnológico: Produção Industrial"],
        ["Base legal específica do curso: Resolução CNE/CP nº 1/2021"],
      ],
    });
    expect([...dados]).toEqual([
      ["nome_curso", "Técnico em Química"],
      ["modalidade_ensino", "Presencial"],
      ["forma_oferta", "Integrado"],
      ["eixo_tecnologico", "Produção Industrial"],
    ]);
  });

  test("dicas da seção de apresentação exigem rótulo no início", () => {
    const corpo = [
      titulo("1 Apresentação"),
      par("Base legal específica do curso: Resolução CNE/CP nº 1/2021"),
      par("O campus oferta a modalidade presencial."),
      tabela([
        linha([celula("Coordenador do curso"), celula("Fulano de Tal")]),
        linha([celula("Denominação do curso"), celula("Curso Técnico em Enfermagem")]),
        linha([celula("Campus"), celula("Curitiba")]),
      ]),
      par("Modalidade: Presencial"),
    ].join("");
    const dicas = dicasDeIdentificacao(detectarSecoes(elementosDoDocumento(lerDocx(montarDocx({ corpo })))));
    expect(Object.fromEntries(dicas)).toEqual({
      nome_curso: "Curso Técnico em Enfermagem",
      campus: "Curitiba",
      modalidade: "Presencial",
    });
  });

  test("chaves numéricas das tabelas mantêm a ordem do documento no JSON", () => {
    const { [`ppc-minimo_dados.json`]: dados } = arquivosConvertidos("ppc-minimo");
    const chaves = [...dados!.matchAll(/^ {4}"([^"]+)": /gm)].map((m) => m[1]);
    // "2026" é rótulo de uma linha da tabela e fica onde está, depois da base legal.
    expect(
      chaves.slice(
        chaves.indexOf("base_legal_especifica_do_curso"),
        chaves.indexOf("base_legal_especifica_do_curso") + 2,
      ),
    ).toEqual(["base_legal_especifica_do_curso", "2026"]);
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
    converterPpc(montarDocx({ corpo: titulo("1 SEÇÃO") + corpo, ...extras }), "x.docx", { agora: AGORA, ...opcoes })
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
        "Sem prejuízo disso, o curso admite o estágio não obrigatório, por iniciativa do estudante:",
        "- cumprir e fazer cumprir as normas e os procedimentos institucionais;",
        "- zelar pelos laboratórios;",
      ].join("\n"),
    );
  });

  test("listas: numeração automática do Word, número digitado e alíneas", () => {
    expect(converter("listas-automaticas").markdownBruto.split("\n").slice(2)).toEqual([
      "São objetivos do curso:",
      "- formar técnicos;",
      "- integrar ensino e pesquisa:",
      "  - na iniciação científica.",
      "",
      "Etapas:",
      "1. diagnóstico;",
      "  1. certificado de conclusão;",
      "1. avaliação.",
      "- redefinido como marcador;",
      "",
      "numeração desligada (numId 0).",
      "numeração que não existe.",
      "- **Item em negrito** e normal",
      "",
      "Parágrafo depois da lista.",
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

  test("resumo da matriz: total_ha e total_hr somam os componentes", () => {
    expect(converter("ppc-minimo").resumos.matriz).toMatchObject({
      total_anos: 2,
      total_componentes: 3,
      total_ha: 440,
      total_hr: 330,
    });
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

  test("documento enorme converte sem estourar a pilha: 80 mil parágrafos, um deles com 100 mil runs inseridos", () => {
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
    const corpo =
      titulo("5.6 MATRIZ CURRICULAR") + matriz + par(runs) + par("Parágrafo de corpo, um entre muitos.").repeat(80_000);
    // O texto repetido comprime mais de 200:1; com o limite padrão, o arquivo é recusado por isso.
    expect(() => converterPpc(montarDocx({ corpo }), "grande.docx", { agora: AGORA })).toThrow(/compressão anormal/);
    const convertido = converterPpc(montarDocx({ corpo }), "grande.docx", {
      agora: AGORA,
      limites: { razaoDeCompressao: 5000 },
      limitesDeTexto: { caracteresPorBloco: 1_000_000 },
    });
    expect(convertido.elementos.length).toBeGreaterThan(80_000);
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
    expect(() => converterPpc(mesclada("palavra ".repeat(131_072), 2000), "x.docx", { agora: AGORA })).toThrow(
      /uma célula de tabela com mais de 50 mil caracteres/,
    );
    // Abaixo do limite, a célula mesclada se repete, limpa uma vez só.
    const { markdownBruto } = converterPpc(mesclada("palavra ".repeat(1024), 500), "x.docx", { agora: AGORA });
    expect(markdownBruto.split("\n").filter((item) => item.startsWith("| palavra palavra"))).toHaveLength(501);
  });

  test(
    "orçamento do documento: tabelas que, cada uma, passam pelo teto por tabela são recusadas depressa",
    { timeout: 15_000 },
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
      const docx = montarDocx({ corpo });
      expect(docx.length).toBeLessThan(64 * 1024);
      expect(() => converterPpc(docx, "x.docx", { agora: AGORA })).toThrow(
        /texto demais para ser convertido \(mais de 8 milhões de caracteres/,
      );
      // Com as células de 160 mil caracteres do caso original, a recusa vem antes, no teto por bloco.
      const maior = montarDocx({ corpo: par("x") + tabelaMesclada("a ".repeat(80_000)) });
      expect(() => converterPpc(maior, "x.docx", { agora: AGORA })).toThrow(
        /uma célula de tabela com mais de 50 mil caracteres/,
      );
      // Uma tabela dessas cabe; três, não. Com o orçamento folgado, passam.
      const uma = montarDocx({ corpo: par("x") + tabelaMesclada("a ".repeat(20_000)) });
      expect(converterPpc(uma, "x.docx", { agora: AGORA }).elementos).toHaveLength(2);
      const tres = montarDocx({
        corpo: par("x") + ["a ", "b ", "c "].map((item) => tabelaMesclada(item.repeat(20_000))).join(""),
      });
      expect(() => converterPpc(tres, "x.docx", { agora: AGORA })).toThrow(/texto demais/);
      const folgado = converterPpc(tres, "x.docx", {
        agora: AGORA,
        limitesDeTexto: { caracteresNoDocumento: 40_000_000 },
      });
      expect(folgado.elementos).toHaveLength(4);
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
          agora: AGORA,
          limitesDeTexto: { caracteresPorBloco: 1_000_000 },
        }),
      ).toThrow(/mais de 1000 espaços, tabulações ou sinais de pontuação seguidos/);
    }
    // Sem o teto de sequência (só para medir): o aparo e o normalizador dão conta das 80 mil tabulações.
    const folgado = { caracteresPorBloco: 1_000_000, sequenciaSemTexto: 1_000_000 };
    const { markdown } = converterPpc(montarDocx({ corpo: casos[0]! }), "x.docx", {
      agora: AGORA,
      limitesDeTexto: folgado,
    });
    expect(markdown).toBe("a b\n");
    // Mil tabulações (37 vezes a maior sequência dos PPCs reais) passam com os tetos padrão.
    const mil = montarDocx({ corpo: par(`<w:r><w:t>a</w:t>${"<w:tab/>".repeat(1000)}<w:t>b</w:t></w:r>`) });
    expect(converterPpc(mil, "x.docx", { agora: AGORA }).markdown).toBe("a b\n");
  });

  test(
    "parágrafo de numeração longa seguido de 80 mil parágrafos curtos converte em poucos segundos",
    { timeout: 15_000 },
    () => {
      // ZIP de 217 KB; antes, 74 s na consolidação de parágrafos do normalizador.
      const corpo =
        par("1)".repeat(1100)) + Array.from({ length: 80_000 }, (_, i) => par(`a${i.toString(36)}`)).join("");
      const convertido = converterPpc(montarDocx({ corpo }), "x.docx", { agora: AGORA });
      expect(convertido.elementos).toHaveLength(80_001);
    },
  );

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
  const grafica = (nome: string) => {
    const arquivos = arquivosConvertidos(nome);
    return {
      arquivos,
      dados: JSON.parse(arquivos[`${nome}_dados.json`]!) as {
        representacao_grafica: Dicionario;
        arquivos_relacionados: Dicionario;
      },
      markdown: arquivos[`${nome}.md`]!,
    };
  };

  test("imagem PNG embutida é copiada e referenciada no Markdown", () => {
    const { arquivos, dados, markdown } = grafica("ppc-minimo");
    expect(dados.representacao_grafica).toEqual({
      encontrada: true,
      secao: "5.11 REPRESENTAÇÃO GRÁFICA DO PROCESSO FORMATIVO",
      tem_bitmap: true,
      tem_desenhos_vetoriais: false,
      extraida: true,
      metodo: "bitmap",
      caminho: "imagens/representacao_grafica.png",
    });
    expect(dados.arquivos_relacionados.representacao_grafica).toBe("imagens/representacao_grafica.png");
    expect(Object.keys(arquivos)).toContain("imagens/representacao_grafica.png");
    expect(markdown).toContain(
      "## 5.11 REPRESENTAÇÃO GRÁFICA DO PROCESSO FORMATIVO\n\n![Representação Gráfica do Processo Formativo](imagens/representacao_grafica.png)\n\nFigura 1: itinerário formativo.",
    );
  });

  test("JPEG sai com a extensão dele, não como .png", () => {
    const { arquivos, dados, markdown } = grafica("figura-jpeg");
    expect(dados.representacao_grafica).toMatchObject({
      extraida: true,
      metodo: "bitmap",
      caminho: "imagens/representacao_grafica.jpeg",
    });
    expect(Object.keys(arquivos)).toContain("imagens/representacao_grafica.jpeg");
    expect(markdown).toContain("![Representação Gráfica do Processo Formativo](imagens/representacao_grafica.jpeg)");
  });

  test.each(["figura-vetorial", "figura-legada"])(
    "%s: desenho com formas não é renderizado, e o PPC.md avisa",
    (nome) => {
      const { arquivos, dados, markdown } = grafica(nome);
      expect(dados.representacao_grafica).toMatchObject({
        tem_bitmap: false,
        tem_desenhos_vetoriais: true,
        extraida: false,
        metodo: "vetorial_nao_renderizada",
        caminho: null,
      });
      expect(dados.arquivos_relacionados.representacao_grafica).toBeUndefined();
      expect(Object.keys(arquivos).some((arquivo) => arquivo.startsWith("imagens"))).toBe(false);
      expect(markdown).toContain(
        "## 5.11 REPRESENTAÇÃO GRÁFICA DO PROCESSO FORMATIVO\n\n**Aviso da conversão:** a figura desta seção foi desenhada com formas do Word (desenho vetorial) e não foi convertida em imagem. Consulte a representação gráfica no documento original.\n\nTexto antes da figura.",
      );
      // O aviso entra uma vez só, também no Markdown bruto.
      expect(arquivos[`${nome}-bruto.md`]!.split("Aviso da conversão").length).toBe(2);
    },
  );

  test.each(["figura-emf", "figura-legada-emf"])(
    "%s: EMF embutido é exportado como está, sem contar como imagem extraída",
    (nome) => {
      const { arquivos, dados, markdown } = grafica(nome);
      expect(dados.representacao_grafica).toMatchObject({
        tem_bitmap: true,
        extraida: false,
        metodo: "vetorial_arquivo_cru",
        caminho: null,
        arquivo_vetorial: "imagens/representacao_grafica.emf",
      });
      expect(dados.arquivos_relacionados.representacao_grafica).toBeUndefined();
      expect(Object.keys(arquivos)).toContain("imagens/representacao_grafica.emf");
      expect(markdown).toContain(
        "**Aviso da conversão:** a figura desta seção está num formato vetorial (EMF) que não é exibido aqui.",
      );
      expect(markdown).not.toContain("![Representação");
    },
  );

  test("seção sem figura reconhecida: aviso próprio", () => {
    const { dados, markdown } = grafica("figura-ausente");
    expect(dados.representacao_grafica).toMatchObject({
      tem_bitmap: false,
      tem_desenhos_vetoriais: true,
      extraida: false,
      metodo: "figura_nao_localizada",
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
    const { dados } = grafica("mesclas");
    expect(dados.representacao_grafica).toBeUndefined();
  });
});

describe("artefatos e rodada", () => {
  test("nomes dos arquivos seguem o nome do DOCX, e `_dados` sai do radical dos JSONs relacionados", () => {
    const conversao = converterPpc(docxDaFixture("ppc-minimo"), "PPC_dados v2.docx", { agora: AGORA });
    const { arquivos, nomes } = artefatosDaConversao(conversao, "PPC_dados v2.docx");
    expect(nomes).toEqual({
      markdown: "PPC_dados v2.md",
      markdown_bruto: "PPC_dados v2-bruto.md",
      dados: "PPC_dados v2_dados.json",
      matriz_curricular: "PPC v2_matriz_curricular.json",
      ementario: "PPC v2_ementario.json",
    });
    expect(arquivos.map((a) => a.caminho)).toEqual(["imagens/representacao_grafica.png", ...Object.values(nomes)]);
    const dados = JSON.parse(arquivos.find((a) => a.caminho === nomes.dados)!.conteudo as string) as Dicionario;
    expect(dados.arquivo_origem).toBe("PPC_dados v2.docx");
    expect(dados.data_conversao).toBe("2026-11-16T12:00:00");
  });

  test("documento sem matriz nem ementário não gera esses arquivos", () => {
    const { arquivos, nomes } = artefatosDaConversao(converter("mesclas"), "mesclas.docx");
    expect(nomes.matriz_curricular).toBeNull();
    expect(nomes.ementario).toBeNull();
    expect(arquivos.map((a) => a.caminho).sort()).toEqual(["mesclas-bruto.md", "mesclas.md", "mesclas_dados.json"]);
  });

  test("entrada que não é .docx, ou grande demais, é recusada antes da leitura", () => {
    expect(() => conferirArquivoDocx("/pasta/ppc.txt", 5)).toThrow(/deve ser \.docx/);
    expect(() => conferirArquivoDocx("/pasta/.docx", 5)).toThrow(/deve ser \.docx/);
    expect(() => conferirArquivoDocx("/pasta/PPC.DOCX", 5)).not.toThrow();
    expect(() => conferirArquivoDocx("/pasta/ppc.docx", 11, 10)).toThrow(ErroDocx);
  });

  test("data_conversao é a hora local do relógio, com microssegundos quando há fração", () => {
    const comFracao = converterPpc(docxDaFixture("mesclas"), "mesclas.docx", {
      agora: new Date(2026, 10, 13, 9, 34, 56, 7),
    });
    expect(comFracao.dados.data_conversao).toBe("2026-11-13T09:34:56.007000");
    const meiaNoite = converterPpc(docxDaFixture("mesclas"), "mesclas.docx", { agora: new Date(2026, 10, 13) });
    expect(meiaNoite.dados.data_conversao).toBe("2026-11-13T00:00:00");
  });

  test("todas as fixtures convertem", () => {
    for (const fixture of FIXTURES) expect(() => converter(fixture.nome), fixture.nome).not.toThrow();
  });
});
