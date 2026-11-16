/**
 * Leitor OOXML diante de arquivos hostis ou quebrados, e nas leituras que só o modo `documento`
 * faz. Os casos hostis vêm das revisões da trilha T3: o app abre arquivos do usuário, e um DOCX
 * de poucos kilobytes não pode esgotar a memória nem a pilha, nem ser convertido pela metade sem
 * aviso. Todo arquivo recusado tem de sair com `ErroDocx` e mensagem em português.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, test } from "vite-plus/test";
import { dataW3cEmUtc, lerDocx } from "../src/leitor.ts";
import type { BlocoOoxml, ParagrafoOoxml, TabelaOoxml } from "../src/modelo.ts";
import { textoDoParagrafo } from "../src/modelo.ts";
import { ErroDocx, PacoteOoxml } from "../src/pacote.ts";
import {
  celula,
  controle,
  formas,
  imagem,
  linha,
  montarDocx,
  NUMERACAO_PADRAO,
  PNG_MINIMO,
  par,
  run,
  tabela,
} from "../src/testes/sintetico.ts";
import { analisarXml, descendentes } from "../src/xml.ts";
import { LIMITES_PADRAO } from "../src/limites.ts";

const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const RELACOES_DO_PACOTE =
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" ' +
  'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';

const documento = (corpo: string) => `<?xml version="1.0"?><w:document ${W}><w:body>${corpo}</w:body></w:document>`;
const p = (texto: string) => `<w:p><w:r><w:t>${texto}</w:t></w:r></w:p>`;

/** Pacote mínimo, sem estilos nem tipos de conteúdo: só o que o leitor precisa. */
function pacoteCru(partes: Record<string, string | Uint8Array>, nivel: 0 | 9 = 9): Uint8Array {
  const todas = { "_rels/.rels": RELACOES_DO_PACOTE, ...partes };
  return zipSync(
    Object.fromEntries(
      Object.entries(todas).map(([nome, valor]) => [nome, typeof valor === "string" ? strToU8(valor) : valor]),
    ),
    { level: nivel },
  );
}

const lerCorpo = (corpo: string) => lerDocx(pacoteCru({ "word/document.xml": documento(corpo) }));
const paragrafos = (blocos: BlocoOoxml[]) =>
  blocos.filter((bloco): bloco is ParagrafoOoxml => bloco.tipo === "paragrafo");
const tabelas = (blocos: BlocoOoxml[]) => blocos.filter((bloco): bloco is TabelaOoxml => bloco.tipo === "tabela");
const textos = (blocos: BlocoOoxml[]) => paragrafos(blocos).map(textoDoParagrafo);

/** Espera um `ErroDocx` (nunca `RangeError` ou outro) com a mensagem dada. */
function esperarErroDocx(acao: () => unknown, mensagem: RegExp): void {
  let erro: unknown;
  try {
    acao();
  } catch (capturado) {
    erro = capturado;
  }
  expect(erro).toBeInstanceOf(ErroDocx);
  expect((erro as Error).message).toMatch(mensagem);
}

/** Posição do registro de uma entrada no diretório central do ZIP. */
function entradaNoDiretorio(zip: Uint8Array, nome: string): number {
  const vista = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let i = 0; i + 46 <= zip.length; i += 1) {
    if (vista.getUint32(i, true) !== 0x02014b50) continue;
    const tamanho = vista.getUint16(i + 28, true);
    if (strFromU8(zip.subarray(i + 46, i + 46 + tamanho)) === nome) return i;
  }
  throw new Error(`entrada não encontrada: ${nome}`);
}

describe("arquivo que não é um DOCX legível", () => {
  test("texto qualquer e ZIP vazio de documento", () => {
    esperarErroDocx(() => lerDocx(strToU8("isto não é zip")), /não é um DOCX: não tem o formato de pacote/);
    esperarErroDocx(() => lerDocx(new Uint8Array(0)), /não é um DOCX/);
    esperarErroDocx(() => lerDocx(zipSync({ "a.txt": strToU8("x") })), /não tem documento principal/);
  });

  test("Word 97-2003 e DOCX protegido por senha (contêiner OLE)", () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...Array<number>(500).fill(0)]);
    esperarErroDocx(
      () => lerDocx(ole),
      /Word 97-2003 \(\.doc\) ou um DOCX protegido por senha\. Salve como \.docx, sem senha/,
    );
  });

  test("entrada cifrada no ZIP", () => {
    const zip = pacoteCru({ "word/document.xml": documento(p("oi")) });
    const posicao = entradaNoDiretorio(zip, "word/document.xml");
    zip[posicao + 8] = zip[posicao + 8]! | 1;
    esperarErroDocx(() => lerDocx(zip), /protegido por senha/);
  });

  test("ZIP truncado", () => {
    const zip = pacoteCru({ "word/document.xml": documento(p("oi")) });
    esperarErroDocx(() => lerDocx(zip.slice(0, 200)), /corrompido ou incompleto/);
    // Cortado no meio dos dados, com o diretório central inteiro.
    const partido = new Uint8Array(zip);
    partido.fill(0, 40, 90);
    esperarErroDocx(() => lerDocx(partido), /corrompido/);
  });

  test("XML truncado ou malformado não vira documento pela metade", () => {
    for (const xml of [
      "<w:document><w:body><w:p>",
      `${documento(p("um") + p("dois")).slice(0, -30)}`,
      "<w:document><w:body></w:document>",
    ]) {
      esperarErroDocx(
        () => lerDocx(pacoteCru({ "word/document.xml": xml })),
        /word\/document\.xml não é um XML bem formado/,
      );
    }
    // A tag autofechada e o `/>` dentro de um atributo são XML válido.
    expect(analisarXml('<a><b/><c x="/>"></c><d /></a>')!.children).toHaveLength(3);
    esperarErroDocx(() => analisarXml("<a><b/>", "x.xml"), /x\.xml não é um XML bem formado/);
  });

  test("entidades declaradas no arquivo não são expandidas nem buscadas", () => {
    const xml =
      `<?xml version="1.0"?><!DOCTYPE d [<!ENTITY a "AAAAAAAAAA"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">` +
      `<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${documento(p("x&b;y&xxe;z &amp; &#65; &lt;")).replace(/^<\?xml[^>]*>/, "")}`;
    expect(textos(lerDocx(pacoteCru({ "word/document.xml": xml })).blocos)).toEqual(["x&b;y&xxe;z & A <"]);
  });
});

describe("limites contra arquivos montados para esgotar recursos", () => {
  test("aninhamento profundo é recusado com ErroDocx, não estoura a pilha", () => {
    const fundo = (abre: string, fecha: string, vezes: number, miolo: string) =>
      abre.repeat(vezes) + miolo + fecha.repeat(vezes);
    const casos = [
      fundo("<w:sdt><w:sdtContent>", "</w:sdtContent></w:sdt>", 20_000, p("fundo")),
      p("a") + fundo("<x>", "</x>", 100_000, ""),
      `<w:p>${fundo("<w:ins>", "</w:ins>", 50_000, "<w:r><w:t>i</w:t></w:r>")}</w:p>`,
    ];
    for (const corpo of casos) esperarErroDocx(() => lerCorpo(corpo), /elementos aninhados demais/);
    // No limite, o documento é lido.
    const niveis = (LIMITES_PADRAO.profundidadeDoXml - 6) / 2;
    expect(
      textos(lerCorpo(fundo("<w:sdt><w:sdtContent>", "</w:sdtContent></w:sdt>", niveis, p("fundo"))).blocos),
    ).toEqual(["fundo"]);
  });

  test("gridSpan e gridBefore ficam na faixa do Word (um gridSpan de 2 bilhões cabia em 879 bytes)", () => {
    const zip = pacoteCru({
      "word/document.xml": documento(
        `<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2000000000"/></w:tcPr>${p("a")}</w:tc></w:tr>` +
          `<w:tr><w:trPr><w:gridBefore w:val="-5"/></w:trPr><w:tc><w:tcPr><w:gridSpan w:val="-3"/></w:tcPr>${p("b")}</w:tc></w:tr>` +
          `<w:tr><w:trPr><w:gridBefore w:val="999999"/></w:trPr><w:tc><w:tcPr><w:gridSpan w:val="x"/></w:tcPr>${p("c")}</w:tc></w:tr></w:tbl>`,
      ),
    });
    expect(zip.length).toBeLessThan(1500);
    const [lida] = tabelas(lerDocx(zip).blocos);
    expect(lida!.linhas.map((item) => [item.colunasAntes, item.celulas[0]!.colunas])).toEqual([
      [0, 63],
      [0, 1],
      [63, 1],
    ]);
  });

  test("linha com células demais e tabela com grade grande demais", () => {
    esperarErroDocx(
      () => lerCorpo(`<w:tbl><w:tr>${"<w:tc><w:p/></w:tc>".repeat(1025)}</w:tr></w:tbl>`),
      /mais de 1024 células numa linha/,
    );
    const larga = `<w:tr>${`<w:tc><w:tcPr><w:gridSpan w:val="63"/></w:tcPr><w:p/></w:tc>`.repeat(1000)}</w:tr>`;
    esperarErroDocx(() => lerCorpo(`<w:tbl>${larga.repeat(40)}</w:tbl>`), /tabela grande demais/);
  });

  test("parte maior que o limite e total maior que o limite", () => {
    const grande = documento(p("a".repeat(1000)).repeat(3000));
    const zip = pacoteCru({ "word/document.xml": grande }, 0);
    esperarErroDocx(
      () => lerDocx(zip, { limites: { bytesPorParte: 1024 * 1024 } }),
      /grande demais.*word\/document\.xml/,
    );
    esperarErroDocx(() => lerDocx(zip, { limites: { bytesNoTotal: 1024 * 1024 } }), /grande demais/);
    expect(lerDocx(zip).blocos).toHaveLength(3000);
  });

  test("o limite vale para a saída real: o tamanho declarado no ZIP pode mentir", () => {
    const zip = pacoteCru({ "word/document.xml": documento(p("abcdefgh ".repeat(100)).repeat(3000)) });
    const posicao = entradaNoDiretorio(zip, "word/document.xml");
    // Declara 100 bytes para uma parte que descompacta em quase 3 MB.
    new DataView(zip.buffer).setUint32(posicao + 24, 100, true);
    esperarErroDocx(() => lerDocx(zip, { limites: { bytesPorParte: 256 * 1024 } }), /grande demais/);
  });

  test(
    "compressão anormal numa parte lida; bomba numa parte que ninguém lê não é descompactada",
    { timeout: 10_000 },
    () => {
      const bomba = `<a>${" ".repeat(20_000_000)}</a>`;
      esperarErroDocx(
        () =>
          lerDocx(
            pacoteCru({ "word/document.xml": documento(`<w:p><w:r><w:t>${" ".repeat(20_000_000)}</w:t></w:r></w:p>`) }),
          ),
        /compressão anormal/,
      );
      const zip = pacoteCru({ "word/document.xml": documento(p("texto")), "customXml/item1.xml": bomba });
      expect(textos(lerDocx(zip).blocos)).toEqual(["texto"]);
      // E a parte, se pedida, é recusada.
      esperarErroDocx(() => new PacoteOoxml(zip).binario("customXml/item1.xml"), /compressão anormal/);
    },
  );

  test("bomba com tamanho declarado mentiroso: a razão vale para o que de fato saiu", { timeout: 5_000 }, () => {
    // 15 MB de `<w:p/>` num ZIP de poucos kilobytes, declarados como 100 bytes: a conferência pelo
    // tamanho declarado não vê nada, e a árvore de milhões de nós esgotaria a memória.
    const zip = pacoteCru({ "word/document.xml": documento(p("x") + "<w:p/>".repeat(2_500_000)) });
    expect(zip.length).toBeLessThan(64 * 1024);
    new DataView(zip.buffer).setUint32(entradaNoDiretorio(zip, "word/document.xml") + 24, 100, true);
    esperarErroDocx(() => lerDocx(zip), /word\/document\.xml tem compressão anormal/);
  });

  test("teto de elementos por parte XML", () => {
    const zip = pacoteCru({
      "word/document.xml": documento(p("x") + "<w:p/>".repeat(LIMITES_PADRAO.elementosPorParte)),
    });
    esperarErroDocx(
      () => lerDocx(zip, { limites: { razaoDeCompressao: 1_000_000 } }),
      /word\/document\.xml tem mais de 500 mil elementos/,
    );
    // Quatro vezes o maior PPC real conferido passa.
    const grande = pacoteCru({ "word/document.xml": documento(p("x").repeat(140_000)) });
    expect(lerDocx(grande, { limites: { razaoDeCompressao: 1_000_000 } }).blocos).toHaveLength(140_000);
  });

  test("arquivo acima do limite de tamanho, com a orientação de compactar as imagens", () => {
    esperarErroDocx(
      () => lerDocx(new Uint8Array(LIMITES_PADRAO.bytesDoArquivo + 1)),
      /tem 20 MB, e o limite é de 20 MB\. Um PPC raramente passa disso: em geral são as imagens\. No Word, use Arquivo › Compactar imagens/,
    );
    const zip = pacoteCru({ "word/document.xml": documento(p("a")) });
    esperarErroDocx(() => lerDocx(zip, { limites: { bytesDoArquivo: 100 } }), /o limite é de 0 MB/);
    expect(LIMITES_PADRAO).toMatchObject({
      bytesDoArquivo: 20 * 1024 * 1024,
      bytesPorParte: 25 * 1024 * 1024,
      bytesNoTotal: 60 * 1024 * 1024,
    });
  });

  test("entradas demais no ZIP", () => {
    const partes: Record<string, string> = { "word/document.xml": documento(p("a")) };
    for (let i = 0; i < 300; i += 1) partes[`x/${i}.xml`] = "";
    const zip = pacoteCru(partes);
    esperarErroDocx(() => lerDocx(zip, { limites: { entradas: 100 } }), /partes demais/);
    expect(textos(lerDocx(zip).blocos)).toEqual(["a"]);
  });

  test("relação que aponta para fora do pacote resolve dentro dele, e a externa não é lida", () => {
    const zip = pacoteCru({
      "word/document.xml": documento(
        `<w:p><w:r><w:drawing><a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" r:embed="rId9"/></w:drawing></w:r></w:p>` +
          `<w:p><w:r><w:drawing><a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" r:embed="rId6"/></w:drawing></w:r></w:p>`,
      ),
      "word/_rels/document.xml.rels":
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId9" Type="x" Target="../../../../etc/passwd.png"/>` +
        `<Relationship Id="rId6" Type="i" Target="file:///etc/passwd" TargetMode="External"/></Relationships>`,
      "etc/passwd.png": "dentro do pacote",
    });
    const pacote = new PacoteOoxml(zip);
    const [primeiro, segundo] = paragrafos(lerDocx(zip).blocos);
    expect(primeiro!.figura).toMatchObject({ tipo: "imagem", parte: "/etc/passwd.png" });
    expect(strFromU8(pacote.binario("etc/passwd.png")!)).toBe("dentro do pacote");
    expect(segundo!.figura).toMatchObject({ tipo: "imagem", parte: null });
  });

  test("mescla vertical de 20 mil linhas num ZIP de poucos kilobytes: uma passada, sem recursão", () => {
    const linhas =
      `<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>${p("topo")}</w:tc></w:tr>` +
      `<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr>`.repeat(20_000);
    const zip = pacoteCru({ "word/document.xml": documento(`<w:tbl>${linhas}</w:tbl>`) });
    expect(zip.length).toBeLessThan(8192);
    expect(tabelas(lerDocx(zip).blocos)[0]!.linhas).toHaveLength(20_001);
  });
});

describe("leituras do modo documento", () => {
  const ler = (corpo: string, fidelidade: "documento" | "python-docx" = "documento", extras = {}) =>
    lerDocx(montarDocx({ corpo, ...extras }), { fidelidade });
  const celulas = (bloco: TabelaOoxml) => bloco.linhas.map((item) => item.celulas.map((lida) => lida.texto));

  test("linha de tabela embrulhada em w:sdt é lida; a removida na revisão sai", () => {
    const removida = `<w:tr><w:trPr><w:del w:id="9" w:author="a"/></w:trPr>${celula("apagada")}</w:tr>`;
    const corpo = tabela([
      linha([celula("Cab")]),
      controle(linha([celula("em controle")])),
      removida,
      linha([celula("última")]),
    ]);
    expect(celulas(tabelas(ler(corpo).blocos)[0]!)).toEqual([["Cab"], ["em controle"], ["última"]]);
    // O python-docx não vê a linha embrulhada e mantém a removida.
    expect(celulas(tabelas(ler(corpo, "python-docx").blocos)[0]!)).toEqual([["Cab"], ["apagada"], ["última"]]);
  });

  test("célula e parágrafo embrulhados em w:sdt dentro da linha", () => {
    const corpo = tabela([
      linha([celula("direta"), controle(celula("embrulhada")), celula(controle(par("parágrafo em controle")))]),
    ]);
    const [lida] = tabelas(ler(corpo).blocos);
    expect(lida!.linhas[0]!.celulas.map((item) => [item.texto, item.direta, item.embrulhada])).toEqual([
      ["direta", true, false],
      ["embrulhada", false, true],
      ["parágrafo em controle", true, false],
    ]);
    const [compativel] = tabelas(ler(corpo, "python-docx").blocos);
    expect(compativel!.linhas[0]!.celulas.map((item) => [item.texto, item.direta, item.embrulhada])).toEqual([
      ["direta", true, false],
      ["embrulhada", false, false],
      ["", true, false],
    ]);
    // Célula de tabela aninhada não é da linha.
    const [aninhada] = tabelas(
      ler(tabela([linha([celula(par("fora") + tabela([linha([celula("dentro")])]))])])).blocos,
    );
    expect(aninhada!.linhas[0]!.celulas.map((item) => [item.direta, item.embrulhada])).toEqual([
      [true, false],
      [false, false],
    ]);
  });

  test("texto profundo: como os parágrafos do corpo, sem o removido, o movido nem a versão de compatibilidade", () => {
    const caixa =
      `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><w:txbxContent>${par("caixa")}</w:txbxContent></w:drawing></mc:Choice>` +
      `<mc:Fallback><w:pict><w:txbxContent>${par("caixa")}</w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r>`;
    const corpo = tabela([
      linha([
        celula(
          par(
            run("A\tB") +
              `<w:moveFrom w:id="3" w:author="a">${run(" movido")}</w:moveFrom>` +
              `<w:ins w:id="4" w:author="a">${run(" inserido")}</w:ins>`,
          ) + par(caixa),
        ),
      ]),
    ]);
    expect(tabelas(ler(corpo).blocos)[0]!.linhas[0]!.celulas[0]!.textoProfundo).toBe("A\tB inserido\ncaixa");
    expect(tabelas(ler(corpo, "python-docx").blocos)[0]!.linhas[0]!.celulas[0]!.textoProfundo).toBe(
      "AB movido inserido\ncaixacaixa\ncaixa\ncaixa",
    );
  });

  test("figura apagada com o controle de alterações não é a figura do parágrafo", () => {
    const apagada = `<w:del w:id="2" w:author="a">${imagem("rId10")}</w:del>`;
    const extras = {
      relacoes: [{ id: "rId10", tipo: "image" as const, alvo: "media/image1.png" }],
      midia: { "image1.png": PNG_MINIMO },
    };
    expect(paragrafos(ler(par(apagada + run("texto")), "documento", extras).blocos)[0]!.figura).toBeNull();
    expect(paragrafos(ler(par(apagada + formas()), "documento", extras).blocos)[0]!.figura).toEqual({
      tipo: "forma",
      origem: "drawing",
    });
    expect(paragrafos(ler(par(apagada + run("texto")), "python-docx", extras).blocos)[0]!.figura).toMatchObject({
      tipo: "imagem",
    });
  });

  test("numeração automática: nível e formato do marcador, com redefinição de nível", () => {
    const corpo = [
      par("marcador", { numeracao: { id: 1 } }),
      par("alínea", { numeracao: { id: 2, nivel: 1 } }),
      par("romano", { numeracao: { id: 3 } }),
      par("redefinido", { numeracao: { id: 4 } }),
      par("desligada", { numeracao: { id: 0 } }),
      par("inexistente", { numeracao: { id: 99 } }),
      par("sem numeração"),
    ].join("");
    const lidos = paragrafos(ler(corpo, "documento", { numeracao: NUMERACAO_PADRAO }).blocos);
    expect(lidos.map((item) => item.numeracao)).toEqual([
      { nivel: 0, formato: "bullet" },
      { nivel: 1, formato: "lowerLetter" },
      { nivel: 0, formato: "upperRoman" },
      { nivel: 0, formato: "bullet" },
      null,
      null,
      null,
    ]);
    const compativeis = paragrafos(ler(corpo, "python-docx", { numeracao: NUMERACAO_PADRAO }).blocos);
    expect(compativeis.every((item) => item.numeracao === null)).toBe(true);
  });

  test("recuo com meio twip ou com unidade arredonda para o par, como no python-docx", () => {
    const recuo = (valor: string) =>
      paragrafos(lerCorpo(`<w:p><w:pPr><w:ind w:left="${valor}"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`).blocos)[0]!
        .recuoEsquerdoEmu;
    expect(recuo("720")).toBe(457200);
    expect(recuo("720.5")).toBe(457200);
    expect(recuo("721.5")).toBe(458470);
    expect(recuo("1in")).toBe(914400);
    expect(recuo("ruim")).toBeNull();
  });
});

describe("XML e propriedades", () => {
  test("namespaces: o que vale é a URI, não o prefixo", () => {
    const raiz = analisarXml(
      '<a:x xmlns:a="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns="urn:outro"><a:p a:val="1"/><p/></a:x>',
    );
    expect(raiz!.name).toBe("w:x");
    expect(descendentes(raiz!, "w:p").map((item) => item.attribs)).toEqual([{ "w:val": "1" }]);
    expect(descendentes(raiz!, "{urn:outro}p")).toHaveLength(1);
    // O mesmo documento com outros prefixos dá o mesmo modelo.
    const original = montarDocx({
      corpo: par("Título", { estilo: "Ttulo1" }) + tabela([linha([celula("a", { colunas: 2 })])]),
    });
    const partes = unzipSync(original);
    const trocado = strFromU8(partes["word/document.xml"]!)
      .replaceAll("xmlns:w=", "xmlns:word=")
      .replaceAll(/(<\/?|\s)w:/g, "$1word:");
    expect(lerDocx(zipSync({ ...partes, "word/document.xml": strToU8(trocado) }))).toEqual(lerDocx(original));
  });

  test("datas das propriedades do documento em UTC", () => {
    expect(dataW3cEmUtc("2026-03-05T10:38:00Z")).toBe("2026-03-05T10:38:00+00:00");
    expect(dataW3cEmUtc("2026-04-22T00:06:00-03:00")).toBe("2026-04-22T03:06:00+00:00");
    expect(dataW3cEmUtc("2026-04-22T00:06:00+05:30")).toBe("2026-04-21T18:36:00+00:00");
    expect(dataW3cEmUtc("2026-03")).toBe("2026-03-01T00:00:00+00:00");
    expect(dataW3cEmUtc("ontem")).toBeNull();
    expect(lerDocx(montarDocx({ corpo: par("x") })).propriedades).toMatchObject({
      titulo: "PPC fictício",
      autor: "Autora de Teste",
      criadoEm: "2026-03-05T10:38:00+00:00",
      modificadoEm: "2026-04-22T03:06:00+00:00",
    });
    expect(lerDocx(montarDocx({ corpo: par("x"), propriedades: false })).propriedades).toMatchObject({
      titulo: "",
      criadoEm: null,
    });
  });
});
