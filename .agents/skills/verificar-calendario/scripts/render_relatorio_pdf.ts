// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalConsole:off -- script de execução única: lê o Markdown, grava o PDF e relata no console; a data do relatório é a do sistema
/**
 * Relatório de verificação de calendário: Markdown → PDF (porte de
 * `render_relatorio_pdf.py`, que usava `reportlab`, para `pdfmake`).
 *
 * Uso: `node .agents/skills/verificar-calendario/scripts/render_relatorio_pdf.ts entrada.md saida.pdf`
 *
 * O Markdown aceito é o subconjunto que o relatório usa (`instrucoes.md`):
 * - 1ª linha: título; 2ª linha: subtítulo (sem os `#` e espaços iniciais);
 * - linhas `**Chave:** valor`: metadados, na ordem em que aparecem;
 * - tabelas que começam por `| Item |`: as linhas de 3 colunas depois do
 *   cabeçalho e do separador viram a tabela única do relatório;
 * - linhas `N. **Pergunta** resposta`: a seção "Conclusão", renumerada;
 * - inline: `` `código` `` (Courier) e `**negrito**`, nessa ordem, como as
 *   expressões regulares do script Python. O resto do arquivo é ignorado.
 *
 * Fontes: Helvetica e Courier das 14 fontes padrão do PDF, as mesmas do
 * `reportlab`, sem arquivo de fonte embutido. Elas usam a codificação
 * WinAnsi (cp1252), que cobre os acentos do português, `º`, `ª`, `§`, aspas
 * curvas e travessões. O `reportlab` desenhava o que fica fora dela com as
 * fontes Symbol e ZapfDingbats, e o que nenhuma delas tem como `■`; o
 * `pdfkit` não sabe usar essas duas fontes simbólicas (declara toda fonte
 * padrão como WinAnsi e emitiria bytes sem sentido). Aqui, o que fica fora da
 * cp1252 sai na Roboto que acompanha o próprio `pdfmake` (`≥`, `≤`, `≠`, `√`,
 * `∞`, letras gregas) e, se ela também não tiver o glifo (setas, `✓`, emoji),
 * como `■`. A Roboto só é embutida quando algum caractere a usa.
 *
 * O `pdfkit` aplica o kerning das métricas AFM nas fontes padrão, e o
 * `reportlab` não: o kerning é desligado para que as larguras coincidam. As
 * linhas são quebradas aqui com as regras do `reportlab` (`quebra-linhas.ts`)
 * e entregues já separadas ao `pdfmake`, cuja caixa de texto ganha uma folga
 * para não quebrá-las de novo.
 *
 * O leiaute reproduz o do `SimpleDocTemplate`: A4, margens de 14 mm mais os
 * 6 pt de recuo do quadro (a tabela ocupa a largura entre as margens),
 * entrelinha fixa por estilo, espaçamento entre blocos igual a
 * `max(espaço antes, espaço depois do anterior)`, linha de base a um corpo do
 * topo da linha, parágrafos que passam de página sem deixar a primeira linha
 * sozinha no pé e tabela com cabeçalho repetido, sem quebrar linhas da tabela
 * entre páginas.
 *
 * `VERIFICAR_CALENDARIO_AGORA` (data ISO) fixa a data de criação do PDF, para
 * que a saída seja reproduzível.
 */
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import type { Content, ContextPageSize, TableCell, TDocumentDefinitions } from "pdfmake/interfaces.js";
import { aparar, apararCaracteres, dividirLinhas, lerTexto } from "@simplifica-if/kb/texto";
import { match } from "@simplifica-if/kb/python/re";
import { type Linha, quebrarCjk, quebrarNormal } from "./quebra-linhas.ts";

type PdfMake = typeof import("pdfmake");
type FonteFontkit = { ascent: number; descent: number; unitsPerEm: number; hasGlyphForCodePoint(c: number): boolean };
type PdfKitDocumento = {
  font(fonte: string): PdfKitDocumento;
  fontSize(corpo: number): PdfKitDocumento;
  widthOfString(texto: string): number;
  _font: { font: object; ascender: number; lineHeight(corpo: number): number };
};

const requerer = NodeModule.createRequire(import.meta.url);
const pdfmake = requerer("pdfmake") as PdfMake;
// `pdfkit` e `fontkit` são dependências do `pdfmake`, resolvidas a partir dele.
const caminhoPdfmake = NodeFS.realpathSync(requerer.resolve("pdfmake"));
const doPdfmake = NodeModule.createRequire(caminhoPdfmake);
const { PDFDocument: PdfKit } = doPdfmake("pdfkit") as {
  PDFDocument: new (opcoes: object) => PdfKitDocumento;
};
const fontkit = NodeModule.createRequire(doPdfmake.resolve("pdfkit"))("fontkit") as {
  openSync(caminho: string): FonteFontkit;
};

const MM = 72 / 25.4;
const A4 = { width: 210 * MM, height: 297 * MM };
const MARGEM = 14 * MM;
/** Recuo interno do `Frame` do `reportlab` (6 pt em cada lado). */
const RECUO_QUADRO = 6;
const LARGURA_UTIL = A4.width - 2 * MARGEM;
const LARGURA_QUADRO = LARGURA_UTIL - 2 * RECUO_QUADRO;
/**
 * Folga somada à caixa de texto do `pdfmake` (que não usa espaços encolhidos)
 * para que ele não quebre de novo linhas já quebradas: nos parágrafos, uma
 * linha pode passar da largura útil em até 5% dos seus espaços.
 */
const FOLGA_PARAGRAFO = 12;
const FOLGA_CELULA = 1;

const FONTES_PADRAO = {
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
  Courier: {
    normal: "Courier",
    bold: "Courier-Bold",
    italics: "Courier-Oblique",
    bolditalics: "Courier-BoldOblique",
  },
};
const PASTA_ROBOTO = NodePath.join(NodePath.dirname(caminhoPdfmake), "..", "fonts", "Roboto");
const FONTE_RESERVA = {
  Roboto: {
    normal: NodePath.join(PASTA_ROBOTO, "Roboto-Regular.ttf"),
    bold: NodePath.join(PASTA_ROBOTO, "Roboto-Medium.ttf"),
    italics: NodePath.join(PASTA_ROBOTO, "Roboto-Italic.ttf"),
    bolditalics: NodePath.join(PASTA_ROBOTO, "Roboto-MediumItalic.ttf"),
  },
};
const ARQUIVOS_FONTES = new Set(
  Object.values({ ...FONTES_PADRAO, ...FONTE_RESERVA }).flatMap((familia) => Object.values(familia)),
);

let roboto: FonteFontkit | undefined;
function fonteReserva(): FonteFontkit {
  roboto ??= fontkit.openSync(FONTE_RESERVA.Roboto.normal);
  return roboto;
}

/** Caracteres que o codec `cp1252` do Python codifica (os 5 bytes indefinidos ficam de fora). */
const CP1252 = new Set<number>([
  ...Array.from({ length: 0x80 }, (_, i) => i),
  ...Array.from({ length: 0x60 }, (_, i) => 0xa0 + i),
  0x20ac,
  0x201a,
  0x0192,
  0x201e,
  0x2026,
  0x2020,
  0x2021,
  0x02c6,
  0x2030,
  0x0160,
  0x2039,
  0x0152,
  0x017d,
  0x2018,
  0x2019,
  0x201c,
  0x201d,
  0x2022,
  0x2013,
  0x2014,
  0x02dc,
  0x2122,
  0x0161,
  0x203a,
  0x0153,
  0x017e,
  0x0178,
]);
const SEM_GLIFO = "\u25a0";
/** Seletores de variação, BOM, ZWJ etc.: a Roboto tem glifo vazio, mas o `reportlab` desenha `■`. */
const RE_IGNORAVEL = /^\p{Default_Ignorable_Code_Point}$/u;

function semGlifo(caractere: string): boolean {
  return RE_IGNORAVEL.test(caractere) || !fonteReserva().hasGlyphForCodePoint(caractere.codePointAt(0)!);
}

type Estilo = {
  corpo: number;
  entrelinha: number;
  negrito?: boolean;
  cor?: string;
  alinhamento?: "left" | "center";
  espacoAntes: number;
  espacoDepois: number;
};

// Estilos do script Python; `espacoAntes` vem do estilo-pai do `getSampleStyleSheet`
// quando não é redefinido (Title: 0; Heading2: 12; BodyText: 6).
const ESTILO_TITULO: Estilo = {
  corpo: 14,
  entrelinha: 17,
  negrito: true,
  alinhamento: "center",
  espacoAntes: 0,
  espacoDepois: 4,
};
const ESTILO_SUBTITULO: Estilo = {
  corpo: 10.5,
  entrelinha: 13,
  negrito: true,
  cor: "#1f4fa5",
  alinhamento: "center",
  espacoAntes: 12,
  espacoDepois: 10,
};
const ESTILO_META: Estilo = { corpo: 8.3, entrelinha: 10, espacoAntes: 6, espacoDepois: 3 };
const ESTILO_SECAO: Estilo = {
  corpo: 10,
  entrelinha: 12,
  negrito: true,
  cor: "#163a70",
  espacoAntes: 10,
  espacoDepois: 5,
};
const ESTILO_CONCLUSAO: Estilo = { corpo: 8, entrelinha: 10, espacoAntes: 6, espacoDepois: 4 };
const ESTILO_CELULA: Estilo = { corpo: 6.8, entrelinha: 8.2, espacoAntes: 0, espacoDepois: 0 };
const ESTILO_CABECALHO: Estilo = {
  corpo: 7.4,
  entrelinha: 8.8,
  negrito: true,
  cor: "#ffffff",
  alinhamento: "center",
  espacoAntes: 0,
  espacoDepois: 0,
};
const SEM_ESPACO = { espacoDepois: 0 };
/** Recuo da conclusão: `leftIndent=10`, `firstLineIndent=-10` (número pendente). */
const RECUO_CONCLUSAO = 10;

const AZUL_ESCURO = "#163a70";
const COR_GRADE = "#8092b3";
const ESPESSURA_GRADE = 0.35;
const PREENCHIMENTO_CELULA = 4;
/** `colors.whitesmoke` e `#eef3fa`, alternados a partir da primeira linha de dados. */
const FUNDOS_LINHAS = ["#f5f5f5", "#eef3fa"] as const;
const PROPORCOES_COLUNAS = [0.34, 0.14, 0.52] as const;

export type Relatorio = {
  titulo: string;
  subtitulo: string;
  metadados: Array<[string, string]>;
  tabela: Array<[string, string, string]>;
  conclusoes: Array<[string, string]>;
};

/** `linha.lstrip("# ").strip()`. */
function semMarcaTitulo(linha: string): string {
  return aparar(apararInicioCaracteres(linha, "# "));
}

function apararInicioCaracteres(texto: string, caracteres: string): string {
  let inicio = 0;
  while (inicio < texto.length && caracteres.includes(texto[inicio]!)) inicio += 1;
  return texto.slice(inicio);
}

/** Lê o relatório como `carregar_relatorio` do script Python. */
export function carregarRelatorio(markdown: string): Relatorio {
  const linhas = dividirLinhas(markdown);
  if (linhas.length < 2) throw new Error("o relatório precisa de título e subtítulo nas duas primeiras linhas");
  const relatorio: Relatorio = {
    titulo: semMarcaTitulo(linhas[0]!),
    subtitulo: semMarcaTitulo(linhas[1]!),
    metadados: [],
    tabela: [],
    conclusoes: [],
  };

  let i = 2;
  while (i < linhas.length) {
    const linha = aparar(linhas[i]!);
    if (linha.startsWith("**") && linha.includes(":**")) {
      const corte = linha.indexOf(":**");
      relatorio.metadados.push([apararCaracteres(linha.slice(0, corte), "*"), aparar(linha.slice(corte + 3))]);
    } else if (linha.startsWith("| Item |")) {
      i += 2;
      while (i < linhas.length && aparar(linhas[i]!).startsWith("|")) {
        const partes = apararCaracteres(aparar(linhas[i]!), "|")
          .split("|")
          .map((parte) => aparar(parte));
        if (partes.length === 3) relatorio.tabela.push(partes as [string, string, string]);
        i += 1;
      }
      continue;
    } else if (match(String.raw`^\d+\.\s+\*\*`, linha)) {
      const partes = match(String.raw`^(\d+)\.\s+\*\*(.+?)\*\*\s*(.*)$`, linha);
      if (partes) relatorio.conclusoes.push([aparar(partes[2]!), aparar(partes[3]!)]);
    }
    i += 1;
  }
  return relatorio;
}

type Trecho = {
  text: string;
  bold?: boolean;
  font?: string;
  lineHeight?: number;
  characterSpacing?: number;
  semGlifo?: boolean;
};

const INICIO_CODIGO = "\u0001";
const FIM_CODIGO = "\u0002";
const INICIO_NEGRITO = "\u0003";
const FIM_NEGRITO = "\u0004";

/**
 * `markdown_inline_para_html`: apara, troca `` `x` `` por Courier e depois
 * `**x**` por negrito (na mesma ordem das substituições do Python, de modo que
 * negrito dentro de código também vale). Os espaços são colapsados como no
 * `Paragraph` do `reportlab`.
 */
function trechosInline(texto: string, negritoBase = false): Trecho[] {
  const marcado = aparar(texto)
    .replace(/`([^`]+)`/g, `${INICIO_CODIGO}$1${FIM_CODIGO}`)
    .replace(/\*\*([^*]+)\*\*/g, `${INICIO_NEGRITO}$1${FIM_NEGRITO}`);
  const trechos: Trecho[] = [];
  let codigo = false;
  let negrito = false;
  let atual = "";
  const fechar = () => {
    if (!atual) return;
    const trecho: Trecho = { text: atual };
    if (negritoBase || negrito) trecho.bold = true;
    if (codigo) trecho.font = "Courier";
    trechos.push(trecho);
    atual = "";
  };
  for (const caractere of marcado) {
    if (caractere === INICIO_CODIGO || caractere === FIM_CODIGO) {
      fechar();
      codigo = caractere === INICIO_CODIGO;
    } else if (caractere === INICIO_NEGRITO || caractere === FIM_NEGRITO) {
      fechar();
      negrito = caractere === INICIO_NEGRITO;
    } else atual += caractere;
  }
  fechar();
  return trechos;
}

/** Espaços que o `Paragraph` do `reportlab` colapsa (`_wsc`, sem o espaço não separável). */
const RE_ESPACOS_PARAGRAFO = /[\t\n\v\f\r\x1c-\x1f \x85\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000]+/g;

/**
 * Colapsa os espaços dentro de cada trecho e apara as pontas do parágrafo,
 * como o `reportlab`: espaços de trechos vizinhos não se juntam (`"e "` +
 * `" e"` em negrito mantém dois espaços).
 */
function colapsar(trechos: Trecho[]): Trecho[] {
  const saida: Trecho[] = [];
  for (const trecho of trechos) {
    let texto = trecho.text.replace(RE_ESPACOS_PARAGRAFO, " ");
    if (!saida.length) texto = texto.replace(/^ +/, "");
    if (!texto) continue;
    saida.push({ ...trecho, text: texto });
  }
  const ultimo = saida.at(-1);
  if (ultimo && ultimo.text.endsWith(" ")) {
    ultimo.text = ultimo.text.replace(/ +$/, "");
    if (!ultimo.text) saida.pop();
  }
  return saida;
}

/**
 * Separa o que a cp1252 não codifica num trecho na fonte de reserva; o que
 * nem ela tem vira `■` (`semGlifo`).
 */
function comReserva(trechos: Trecho[]): Trecho[] {
  const saida: Trecho[] = [];
  for (const trecho of trechos) {
    let atual = "";
    let tipo: "padrao" | "reserva" | "semGlifo" = "padrao";
    const fechar = () => {
      if (!atual) return;
      if (tipo === "padrao") saida.push({ ...trecho, text: atual });
      else saida.push({ ...trecho, text: atual, font: "Roboto", ...(tipo === "semGlifo" && { semGlifo: true }) });
      atual = "";
    };
    for (const caractere of trecho.text) {
      const novo = CP1252.has(caractere.codePointAt(0)!) ? "padrao" : semGlifo(caractere) ? "semGlifo" : "reserva";
      if (novo !== tipo) {
        fechar();
        tipo = novo;
      }
      atual += tipo === "semGlifo" ? SEM_GLIFO : caractere;
    }
    fechar();
  }
  return saida;
}

/** Avanço do `■` (glifo `a73` da ZapfDingbats) que o `reportlab` desenha no lugar do que falta. */
const AVANCO_SEM_GLIFO = 761 / 1000;
/** Avanço do `■` na Roboto. */
function avancoQuadradoRoboto(): number {
  const f = fonteReserva() as FonteFontkit & { glyphForCodePoint(c: number): { advanceWidth: number } };
  return f.glyphForCodePoint(0x25a0).advanceWidth / f.unitsPerEm;
}

/**
 * Trecho de `■` com o avanço da ZapfDingbats: espaçamento entre caracteres
 * mais um espaço de largura zero no fim, porque o `pdfmake` mede
 * `largura + espaçamento × (caracteres − 1)`.
 */
function paraPdfmake(trecho: Trecho, corpo: number): Trecho {
  const { semGlifo: quadrados, ...resto } = trecho;
  if (!quadrados) return resto;
  const espacamento = (AVANCO_SEM_GLIFO - avancoQuadradoRoboto()) * corpo;
  return { ...resto, text: resto.text.replace(/\u25a0+/, (q) => `${q}\u200b`), characterSpacing: espacamento };
}

let medidor: PdfKitDocumento | undefined;
const cacheLarguras = new Map<string, number>();

function fonteDe(trecho: Trecho): string {
  return trecho.font === "Roboto"
    ? FONTE_RESERVA.Roboto[trecho.bold ? "bold" : "normal"]
    : `${trecho.font ?? "Helvetica"}${trecho.bold ? "-Bold" : ""}`;
}

function medidorPdfKit(fonte: string, corpo: number): PdfKitDocumento {
  desligarKerning();
  medidor ??= new PdfKit({ autoFirstPage: false });
  return medidor.font(fonte).fontSize(corpo);
}

/** Largura no `pdfkit` (com o kerning desligado, igual à `stringWidth` do `reportlab`). */
function medir(texto: string, trecho: Trecho, corpo: number): number {
  if (trecho.semGlifo) return [...texto].length * AVANCO_SEM_GLIFO * corpo;
  const fonte = fonteDe(trecho);
  const chave = `${fonte}\u0000${corpo}\u0000${texto}`;
  let largura = cacheLarguras.get(chave);
  if (largura === undefined) {
    largura = medidorPdfKit(fonte, corpo).widthOfString(texto);
    cacheLarguras.set(chave, largura);
  }
  return largura;
}

/** Ascendente e altura de linha (`(ascendente - descendente) × corpo`) que o `pdfmake` usa para a fonte do trecho. */
function metricas(trecho: Trecho, corpo: number): { ascendente: number; altura: number } {
  const fonte = medidorPdfKit(fonteDe(trecho), corpo)._font;
  return { ascendente: (fonte.ascender / 1000) * corpo, altura: fonte.lineHeight(corpo) };
}

type Quebra = (
  pecas: Trecho[],
  larguras: readonly number[],
  medir: (texto: string, peca: Trecho) => number,
) => Linha<Trecho>[];

/**
 * Um bloco de texto como pilha de linhas, uma por nó do `pdfmake`, com a
 * geometria do `reportlab`: cada linha ocupa `entrelinha` e tem a linha de
 * base a um corpo do topo. O `pdfmake` põe a linha de base a um ascendente do
 * topo e a altura da linha vem de `lineHeight`; por isso cada linha leva uma
 * margem de cima `corpo - ascendente` e altura `entrelinha - margem`, e o
 * teste de quebra de página continua sendo o da entrelinha.
 */
function linhasDoBloco(
  trechos: Trecho[],
  estilo: Estilo,
  larguras: readonly number[],
  quebrar: Quebra,
  margens: (linha: number) => [esquerda: number, direita: number],
): Content[] {
  const negrito = estilo.negrito ?? false;
  const comNegrito = (peca: Trecho) => ({ ...peca, bold: peca.bold ?? negrito });
  const linhas = quebrar(comReserva(colapsar(trechos)), larguras, (texto, peca) =>
    medir(texto, comNegrito(peca), estilo.corpo),
  );
  return linhas.map((linha, i) => {
    const medidas = linha.map((trecho) => metricas(comNegrito(trecho), estilo.corpo));
    const margemCima = estilo.corpo - Math.max(...medidas.map((m) => m.ascendente));
    const altura = estilo.entrelinha - margemCima;
    const [esquerda, direita] = margens(i);
    return {
      text: linha.map((trecho, k) => ({
        ...paraPdfmake(trecho, estilo.corpo),
        lineHeight: altura / medidas[k]!.altura,
      })),
      fontSize: estilo.corpo,
      bold: negrito,
      color: estilo.cor ?? "#000000",
      alignment: estilo.alinhamento ?? "left",
      margin: [esquerda, margemCima, direita, 0],
    };
  });
}

/**
 * Parágrafo com o espaçamento do `Frame` (`overlapAttachedSpace`: o espaço
 * antes é `max(espaço antes, espaço depois do anterior)`). Como no
 * `reportlab` (`allowOrphans=0`), a primeira linha não fica sozinha no pé da
 * página.
 */
function paragrafo(
  trechos: Trecho[],
  estilo: Estilo,
  anterior: Pick<Estilo, "espacoDepois"> | null,
  recuoPendente = 0,
): Content {
  const espacoAntes = anterior === null ? 0 : Math.max(estilo.espacoAntes - anterior.espacoDepois, 0);
  // Folga dos dois lados no texto centrado (o centro não muda) e só à direita no alinhado à esquerda.
  const folgaEsquerda = estilo.alinhamento === "center" ? FOLGA_PARAGRAFO / 2 : 0;
  const folgaDireita = FOLGA_PARAGRAFO - folgaEsquerda;
  // `leftIndent=10`, `firstLineIndent=-10`: a primeira linha usa a largura toda; as outras, 10 pt a menos.
  const larguras = recuoPendente ? [LARGURA_QUADRO, LARGURA_QUADRO - recuoPendente] : [LARGURA_QUADRO];
  const linhas = linhasDoBloco(trechos, estilo, larguras, quebrarNormal, (i) => [
    RECUO_QUADRO + (i > 0 ? recuoPendente : 0) - folgaEsquerda,
    RECUO_QUADRO - folgaDireita,
  ]);
  // Cada linha vai num bloco inquebrável para que a margem de cima (linha de base) a acompanhe para a
  // página seguinte: o `pdfmake` descarta a margem de um nó que passa para outra página.
  const grupos = linhas.length > 1 ? [linhas.slice(0, 2), ...linhas.slice(2).map((linha) => [linha])] : [linhas];
  return {
    stack: grupos.map((grupo): Content => ({ stack: grupo, unbreakable: true })),
    margin: [0, espacoAntes, 0, estilo.espacoDepois],
  };
}

function celula(trechos: Trecho[], estilo: Estilo, largura: number): TableCell {
  const folgaEsquerda = estilo.alinhamento === "center" ? FOLGA_CELULA / 2 : 0;
  return {
    stack: linhasDoBloco(trechos, estilo, [largura], quebrarCjk, () => [
      -folgaEsquerda,
      -(FOLGA_CELULA - folgaEsquerda),
    ]),
  };
}

/** Monta a definição do documento do `pdfmake` para um relatório. */
export function definicaoDocumento(relatorio: Relatorio, criadoEm?: Date): TDocumentDefinitions {
  const conteudo: Content[] = [];
  conteudo.push(paragrafo(trechosInline(relatorio.titulo), ESTILO_TITULO, null));
  conteudo.push(paragrafo(trechosInline(relatorio.subtitulo), ESTILO_SUBTITULO, ESTILO_TITULO));
  let anterior = ESTILO_SUBTITULO;
  for (const [chave, valor] of relatorio.metadados) {
    const trechos = [...trechosInline(chave, true), { text: ":", bold: true }, { text: " " }, ...trechosInline(valor)];
    conteudo.push(paragrafo(trechos, ESTILO_META, anterior));
    anterior = ESTILO_META;
  }

  // `Spacer(1, 6)`: o espaço depois do bloco anterior já foi aplicado, e o espaçador não tem espaço próprio.
  const larguras = PROPORCOES_COLUNAS.map((proporcao) => LARGURA_UTIL * proporcao - 2 * PREENCHIMENTO_CELULA);
  const corpo: TableCell[][] = [
    ["Item", "Status", "Observação/Evidência"].map((texto, i) =>
      celula([{ text: texto }], ESTILO_CABECALHO, larguras[i]!),
    ),
    ...relatorio.tabela.map((linha) =>
      linha.map((texto, i) => celula(trechosInline(texto), ESTILO_CELULA, larguras[i]!)),
    ),
  ];
  conteudo.push({
    margin: [0, 6, 0, 0],
    table: { headerRows: 1, dontBreakRows: true, widths: larguras, body: corpo },
    layout: {
      hLineWidth: () => ESPESSURA_GRADE,
      vLineWidth: () => ESPESSURA_GRADE,
      hLineColor: () => COR_GRADE,
      vLineColor: () => COR_GRADE,
      // A grade do `reportlab` não ocupa espaço: o fio sai do preenchimento.
      paddingLeft: () => PREENCHIMENTO_CELULA - ESPESSURA_GRADE,
      paddingRight: () => PREENCHIMENTO_CELULA,
      paddingTop: () => PREENCHIMENTO_CELULA - ESPESSURA_GRADE,
      paddingBottom: () => PREENCHIMENTO_CELULA,
      fillColor: (linha) => (linha === 0 ? AZUL_ESCURO : FUNDOS_LINHAS[(linha - 1) % 2]!),
    },
  });

  if (relatorio.conclusoes.length) {
    // A tabela não tem espaço depois: vale o `spaceBefore` inteiro da seção.
    conteudo.push(paragrafo([{ text: "Conclusão" }], ESTILO_SECAO, SEM_ESPACO));
    let anteriorConclusao: Estilo = ESTILO_SECAO;
    relatorio.conclusoes.forEach(([pergunta, resposta], indice) => {
      const trechos = [{ text: `${indice + 1}. ` }, ...trechosInline(pergunta, true), { text: " " }];
      trechos.push(...trechosInline(resposta));
      conteudo.push(paragrafo(trechos, ESTILO_CONCLUSAO, anteriorConclusao, RECUO_CONCLUSAO));
      anteriorConclusao = ESTILO_CONCLUSAO;
    });
  }

  const info: TDocumentDefinitions["info"] = { title: relatorio.titulo, author: "Codex" };
  if (criadoEm) {
    info.creationDate = criadoEm;
    info.modDate = criadoEm;
  }
  return {
    pageSize: A4 as ContextPageSize,
    pageOrientation: "portrait",
    pageMargins: [MARGEM, MARGEM + RECUO_QUADRO, MARGEM, MARGEM + RECUO_QUADRO],
    info,
    defaultStyle: { font: "Helvetica" },
    content: conteudo,
  };
}

let kerningDesligado = false;

/** Zera os pares de kerning da classe de métricas AFM do `pdfkit`, que o `reportlab` não aplica. */
function desligarKerning(): void {
  if (kerningDesligado) return;
  const documento = new PdfKit({ autoFirstPage: false });
  documento.font("Helvetica");
  const metricasAfm = Object.getPrototypeOf(documento._font.font) as { getKernPair?: unknown };
  if (typeof metricasAfm.getKernPair !== "function") throw new Error("pdfkit sem getKernPair: revisar o kerning");
  metricasAfm.getKernPair = () => 0;
  kerningDesligado = true;
}

function configurarPdfmake(): void {
  desligarKerning();
  pdfmake.setFonts({ ...FONTES_PADRAO, ...FONTE_RESERVA });
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy((caminho) => ARQUIVOS_FONTES.has(caminho));
}

/** Gera o PDF do relatório em memória. */
export async function gerarPdf(markdown: string, criadoEm?: Date): Promise<Buffer> {
  configurarPdfmake();
  return pdfmake.createPdf(definicaoDocumento(carregarRelatorio(markdown), criadoEm)).getBuffer();
}

/** `construir_pdf`: lê o Markdown e grava o PDF, criando a pasta de saída. */
export async function construirPdf(entrada: string, saida: string, criadoEm?: Date): Promise<void> {
  const pdf = await gerarPdf(lerTexto(entrada), criadoEm);
  NodeFS.mkdirSync(NodePath.dirname(saida), { recursive: true });
  await NodeFSP.writeFile(saida, pdf);
}

function dataFixa(): Date | undefined {
  const valor = process.env.VERIFICAR_CALENDARIO_AGORA;
  if (!valor) return undefined;
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) throw new Error(`VERIFICAR_CALENDARIO_AGORA inválida: ${valor}`);
  return data;
}

async function main(argumentos: string[]): Promise<number> {
  if (argumentos.length !== 2) {
    console.log("Uso: render_relatorio_pdf.ts entrada.md saida.pdf");
    return 1;
  }
  await construirPdf(NodePath.resolve(argumentos[0]!), NodePath.resolve(argumentos[1]!), dataFixa());
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (erro) {
    const e = erro as Error;
    console.error(`${e.name}: ${e.message}`);
    process.exitCode = 1;
  }
}
