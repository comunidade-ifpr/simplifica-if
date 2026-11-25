// @effect-diagnostics globalConsole:off -- não é log: o console.warn é trocado só para calar os avisos do pdfjs ao carregar
// oxlint-disable-next-line typescript/triple-slash-reference -- o worker do pdfjs não tem tipos; a declaração vai junto para quem importa este módulo
/// <reference path="./pdfjs-trabalhador.d.ts" />
/**
 * O texto de um PDF em Markdown (`pdfParaMarkdown`), para a IA ler um anexo e para a entrada de um
 * PPC na base.
 *
 * Por página, na ordem do `getTextContent` do pdfjs:
 *
 * - **Tabelas** com borda viram tabela Markdown (`./tabelas.ts`), no lugar em que estão na página;
 *   a tabela que continua no alto da página seguinte, com o mesmo número de colunas, é a mesma.
 * - **Cabeçalho e rodapé**: a linha na faixa de cima ou de baixo da página (8% da altura) que se
 *   repete, com os números trocados, em 3 páginas ou mais (e em ao menos um quarto delas) sai, e
 *   o número sozinho nessas faixas (o da página) também.
 * - **Linhas e parágrafos**: os itens viram linhas pelo `hasEOL` e pela mudança de altura, e as
 *   linhas viram parágrafos: a linha que chega perto da margem direita continua na seguinte, salvo
 *   quando o espaço entre as duas é maior que o entrelinha da página ou a seguinte começa com
 *   marcador de lista. A palavra partida no fim da linha ("estu-" e "dante", as duas em
 *   minúsculas) é juntada sem o hífen.
 * - **Negrito e títulos**: o trecho em fonte negrita (nome da fonte com Bold, Black, Heavy ou
 *   Semibold) vai entre `**`. O parágrafo curto (até 150 caracteres), todo em negrito ou em letra
 *   maior que a do corpo do texto, que não acaba em pontuação, é título: `##` e mais um `#` por
 *   nível da numeração (`2.4.1` → `####`).
 *
 * Cada página começa com o marcador `<!-- página N -->` (N é a posição da página no arquivo, a
 * partir de 1, não o número impresso nela), e a página sem texto sai como
 * `<!-- página N: sem texto -->`; com `marcadoresDePagina: false`, os marcadores saem e o parágrafo
 * partido pela página fica para a limpeza (`./limpeza.ts`). O texto não é escapado: um `#` ou `*`
 * do PDF fica como está.
 */
import { ErroPdf } from "./erro.ts";
import { segmentosDoDesenho } from "./geometria.ts";
import { nivelDaNumeracao } from "./limpeza.ts";
import { type ItemPosicionado, type Tabela, tabelaEmMarkdown, tabelasDaPagina } from "./tabelas.ts";

type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjs: Promise<Pdfjs> | undefined;

/**
 * O pdfjs, carregado no primeiro uso (são 3,4 MB de código).
 *
 * Com o `WorkerMessageHandler` em `globalThis.pdfjsWorker`, o pdfjs roda o "worker" na mesma thread,
 * sem `new Worker` nem o `import()` de `workerSrc`, que num bundle não acharia o arquivo; quem chama
 * já roda a conversão num Worker do servidor, com limite de memória e de tempo. Ao ser carregado, o
 * pdfjs avisa que não achou o `@napi-rs/canvas` (fica fora: só desenha páginas) e que não pôde
 * imitar `DOMMatrix` e `Path2D` (idem); esses avisos, e só eles, são calados.
 */
function carregarPdfjs(): Promise<Pdfjs> {
  pdfjs ??= (async () => {
    const avisar = console.warn;
    console.warn = (...argumentos: unknown[]) => {
      const aviso = argumentos[0];
      if (typeof aviso === "string" && /^Warning: Cannot (load "@napi-rs\/canvas"|polyfill)/.test(aviso)) return;
      avisar(...argumentos);
    };
    try {
      const [modulo, trabalhador] = await Promise.all([
        import("pdfjs-dist/legacy/build/pdf.mjs"),
        import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
      ]);
      (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = trabalhador;
      return modulo;
    } finally {
      console.warn = avisar;
    }
  })();
  return pdfjs;
}

export interface OpcoesPdfParaMarkdown {
  /** Máximo de páginas lidas (padrão 500); acima disso, ErroPdf "paginas-demais". */
  readonly paginas?: number;
  /** Máximo de caracteres do Markdown (padrão 8 milhões, o mesmo orçamento do docx). */
  readonly caracteres?: number;
  /** O marcador `<!-- página N -->` antes de cada página (padrão: sim). */
  readonly marcadoresDePagina?: boolean;
}

export const PAGINAS_PADRAO = 500;
export const CARACTERES_PADRAO = 8_000_000;

/** A assinatura `%PDF-` vale no primeiro 1 KB, como os leitores toleram lixo antes dela. */
function ehPdf(bytes: Uint8Array): boolean {
  const assinatura = [0x25, 0x50, 0x44, 0x46, 0x2d];
  const fim = Math.min(bytes.length - assinatura.length, 1024);
  for (let i = 0; i <= fim; i++) {
    if (assinatura.every((byte, j) => bytes[i + j] === byte)) return true;
  }
  return false;
}

type Item = {
  readonly str: string;
  readonly transform: ReadonlyArray<number>;
  readonly width: number;
  readonly height: number;
  readonly hasEOL: boolean;
  readonly negrito?: boolean;
};

export type Linha = {
  texto: string;
  x0: number;
  x1: number;
  y: number;
  altura: number;
  /** Caracteres em negrito e no total, para dizer se a linha toda é negrito. */
  negritos?: number;
  caracteres?: number;
};

const ESPACO_NA_PONTA = /^\s|\s$/u;

/** Os itens de uma página em linhas, na ordem do `getTextContent`; o negrito vai entre `**`. */
export function linhasDosItens(itens: ReadonlyArray<Item>): Linha[] {
  const linhas: Linha[] = [];
  let atual: (Linha & { negritoAberto: boolean }) | undefined;
  const fechar = () => {
    if (atual && atual.negritoAberto) atual.texto += "**";
    if (atual && atual.texto.replaceAll("**", "").trim()) {
      const { negritoAberto: _, ...linha } = atual;
      linhas.push({
        ...linha,
        texto: linha.texto
          .replace(/\*\*(\s*)\*\*/gu, "$1")
          .replace(/\*\*(\s+)/gu, (_m, espaco: string, posicao: number, todo: string) =>
            // `**` que abre seguido de espaço: o espaço vai para antes dele.
            abreNegrito(todo, posicao) ? `${espaco}**` : `**${espaco}`,
          )
          .replace(/\s+/gu, " ")
          .trim(),
      });
    }
    atual = undefined;
  };
  for (const item of itens) {
    const x = item.transform[4] ?? 0;
    const y = item.transform[5] ?? 0;
    if (item.str) {
      const altura = Math.max(item.height, 1);
      if (atual && Math.abs(atual.y - y) > Math.max(atual.altura, altura) / 2) fechar();
      if (!atual) atual = { texto: "", x0: x, x1: x, y, altura, negritos: 0, caracteres: 0, negritoAberto: false };
      else {
        const lacuna = x - atual.x1;
        const fimOuInicio = (atual.texto.replace(/\*+$/u, "").at(-1) ?? " ") + (item.str[0] ?? " ");
        if (lacuna > altura * 0.15 && !ESPACO_NA_PONTA.test(fimOuInicio)) atual.texto += " ";
      }
      const negrito = item.negrito === true && item.str.trim() !== "";
      if (negrito !== atual.negritoAberto && item.str.trim() !== "") {
        atual.texto += "**";
        atual.negritoAberto = negrito;
      }
      atual.texto += item.str;
      const visiveis = item.str.replace(/\s/gu, "").length;
      atual.caracteres! += visiveis;
      if (negrito) atual.negritos! += visiveis;
      atual.x0 = Math.min(atual.x0, x);
      atual.x1 = Math.max(atual.x1, x + item.width);
      atual.altura = Math.max(atual.altura, altura);
    }
    if (item.hasEOL) fechar();
  }
  fechar();
  return linhas;
}

/** O `**` em `posicao` abre um trecho em negrito (é o 1º, 3º, 5º… do texto)? */
function abreNegrito(texto: string, posicao: number): boolean {
  return (texto.slice(0, posicao).match(/\*\*/gu)?.length ?? 0) % 2 === 0;
}

const MARCADOR_DE_LISTA = /^(?:[•▪◦●■□–—-]|\(?(?:\d{1,3}|[ivxlc]{1,6}|[a-z])[).])\s/iu;
const HIFEN_PARTIDO = /\p{Ll}-$/u;
/**
 * Linha de sumário: vai até a margem pelo pontilhado ou pelo número da página alinhado à direita,
 * mas acaba nele, e não continua na linha seguinte.
 */
const ENTRADA_DE_SUMARIO = /(?:\.{4,}|…{2,}|_{4,})\s*\d{1,4}\**$|^\**\d{1,2}(?:\.\d{1,3})*\.?\s+\S.*\s\d{1,3}\**$/u;
const COMECA_MINUSCULA = /^\p{Ll}/u;

function mediana(valores: number[]): number {
  const ordenados = valores.toSorted((a, b) => a - b);
  return ordenados[Math.floor(ordenados.length / 2)] ?? 0;
}

/** A linha toda (95% dos caracteres) em negrito: o título não continua no texto que vem depois dele. */
const todaEmNegrito = (linha: Linha) =>
  (linha.caracteres ?? 0) > 0 && (linha.negritos ?? 0) / linha.caracteres! >= 0.95;

/** Um parágrafo, com as linhas de que veio (para decidir se é título). */
export interface Paragrafo {
  texto: string;
  linhas: Linha[];
  /** A última linha chega à margem direita sem pontuação final: o parágrafo pode seguir na página seguinte. */
  aberto?: boolean;
}

/** As linhas de uma página em parágrafos (ver o comentário do módulo). */
export function paragrafosComLinhas(linhas: ReadonlyArray<Linha>): Paragrafo[] {
  if (!linhas.length) return [];
  // Num laço, não com `Math.min(...)`: espalhar centenas de milhares de linhas estoura a pilha.
  let esquerda = Infinity;
  let direita = -Infinity;
  for (const linha of linhas) {
    esquerda = Math.min(esquerda, linha.x0);
    direita = Math.max(direita, linha.x1);
  }
  const margem = (direita - esquerda) * 0.12;
  const descidas = linhas.slice(1).map((linha, i) => linhas[i]!.y - linha.y);
  const entrelinha = mediana(descidas.filter((descida) => descida > 0));

  const paragrafos: Paragrafo[] = [];
  let paragrafo: Paragrafo = { texto: linhas[0]!.texto, linhas: [linhas[0]!] };
  for (let i = 1; i < linhas.length; i++) {
    const anterior = linhas[i - 1]!;
    const linha = linhas[i]!;
    const descida = descidas[i - 1]!;
    const continua =
      anterior.x1 >= direita - margem &&
      !ENTRADA_DE_SUMARIO.test(anterior.texto) &&
      todaEmNegrito(anterior) === todaEmNegrito(linha) &&
      descida > 0 &&
      descida <= Math.max(entrelinha, anterior.altura) * 1.4 &&
      !MARCADOR_DE_LISTA.test(linha.texto.replace(/^\*\*/u, ""));
    if (!continua) {
      paragrafos.push(paragrafo);
      paragrafo = { texto: linha.texto, linhas: [linha] };
    } else {
      paragrafo.linhas.push(linha);
      if (HIFEN_PARTIDO.test(paragrafo.texto) && COMECA_MINUSCULA.test(linha.texto))
        paragrafo.texto = paragrafo.texto.slice(0, -1) + linha.texto;
      else paragrafo.texto += ` ${linha.texto}`;
    }
  }
  paragrafos.push(paragrafo);
  for (const p of paragrafos) {
    p.texto = p.texto.replace(/\*\* \*\*/gu, " ");
    p.aberto = p.linhas.at(-1)!.x1 >= direita - margem && !/[.!?:;]\**$/u.test(p.texto);
  }
  return paragrafos;
}

/** As linhas de uma página em parágrafos, só o texto. */
export function paragrafosDasLinhas(linhas: ReadonlyArray<Linha>): string[] {
  return paragrafosComLinhas(linhas).map((p) => p.texto);
}

const MAXIMO_TITULO = 150;

/**
 * O parágrafo como título (`## …`), se for curto, todo em negrito ou em letra maior que `corpo`, e
 * não acabar em pontuação; senão, `null`.
 */
export function comoTitulo(paragrafo: Paragrafo, corpo: number): string | null {
  const texto = paragrafo.texto.replaceAll("**", "").trim();
  if (!texto || texto.length > MAXIMO_TITULO || /[.;,:]$/u.test(texto) || /^\p{Ll}/u.test(texto)) return null;
  if (paragrafo.linhas.length > 2 || MARCADOR_DE_LISTA.test(texto)) return null;
  const caracteres = paragrafo.linhas.reduce((s, l) => s + (l.caracteres ?? 0), 0);
  const negritos = paragrafo.linhas.reduce((s, l) => s + (l.negritos ?? 0), 0);
  const todoNegrito = caracteres > 0 && negritos / caracteres >= 0.95;
  const maior = corpo > 0 && Math.min(...paragrafo.linhas.map((l) => l.altura)) >= corpo * 1.15;
  if (!todoNegrito && !maior) return null;
  if (/^\d+$/u.test(texto)) return null;
  return `${"#".repeat(nivelDaNumeracao(texto) ?? 2)} ${texto}`;
}

/** O erro do pdfjs que diz que o arquivo não é um PDF legível, traduzido; o resto passa como está. */
function traduzir(erro: unknown): unknown {
  const nome = erro instanceof Error ? erro.name : undefined;
  if (nome === "PasswordException") return new ErroPdf({ motivo: "protegido" });
  if (nome === "InvalidPDFException" || nome === "FormatError") return new ErroPdf({ motivo: "corrompido" });
  return erro;
}

const RE_NEGRITO = /bold|black|heavy|semibold|demibold|demi\b/iu;

/** A chave que reconhece o mesmo cabeçalho em páginas diferentes: sem números, espaços e acentos. */
const chaveDeFaixa = (texto: string) =>
  texto
    .replaceAll("**", "")
    .normalize("NFKD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/\d+/gu, "#")
    .replace(/\s+/gu, "");

/** A página lida: as linhas fora das tabelas, as tabelas e as faixas de cima e de baixo. */
interface PaginaLida {
  readonly numero: number;
  readonly linhas: Linha[];
  readonly tabelas: Tabela[];
  readonly topoFaixa: number;
  readonly baseFaixa: number;
}

const FAIXA = 0.08;

/** As linhas da faixa de cima ou de baixo. */
function naFaixa(pagina: PaginaLida, linha: Linha): boolean {
  return linha.y >= pagina.topoFaixa || linha.y <= pagina.baseFaixa;
}

/** As chaves das linhas de faixa que se repetem: cabeçalho e rodapé. */
function chavesDeCabecalho(paginas: ReadonlyArray<PaginaLida>): Set<string> {
  const contagem = new Map<string, number>();
  for (const pagina of paginas) {
    const vistas = new Set<string>();
    for (const linha of pagina.linhas) if (naFaixa(pagina, linha)) vistas.add(chaveDeFaixa(linha.texto));
    for (const chave of vistas) contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
  }
  const minimo = Math.max(3, Math.ceil(paginas.length / 4));
  return new Set([...contagem].filter(([chave, n]) => n >= minimo && chave !== "").map(([chave]) => chave));
}

const RE_SO_NUMERO = /^(?:p[áa]g(?:ina)?\.?\s*)?[-–]?\s*\d{1,4}\s*[-–]?(?:\s*(?:de|\/)\s*\d{1,4})?$/iu;

/**
 * O Markdown de uma página: parágrafos, títulos e tabelas na ordem da página, e se o último bloco é
 * um parágrafo que segue na página seguinte.
 */
function markdownDaPagina(
  pagina: PaginaLida,
  cabecalhos: Set<string>,
  corpo: number,
): { blocos: string[]; abertoNoFim: boolean } {
  const linhas = pagina.linhas.filter(
    (linha) =>
      !(naFaixa(pagina, linha) && (cabecalhos.has(chaveDeFaixa(linha.texto)) || RE_SO_NUMERO.test(linha.texto))),
  );
  const blocos: string[] = [];
  let abertoNoFim = false;
  const emParagrafos = (trecho: Linha[]) => {
    for (const paragrafo of paragrafosComLinhas(trecho)) {
      const titulo = comoTitulo(paragrafo, corpo);
      blocos.push(titulo ?? paragrafo.texto);
      abertoNoFim = titulo === null && paragrafo.aberto === true;
    }
  };
  let trecho: Linha[] = [];
  const pendentes = [...pagina.tabelas];
  for (const linha of linhas) {
    // A tabela entra antes da primeira linha que fica abaixo do topo dela.
    while (pendentes.length && linha.y < pendentes[0]!.topo) {
      emParagrafos(trecho);
      trecho = [];
      blocos.push(tabelaEmMarkdown(pendentes.shift()!.linhas));
      abertoNoFim = false;
    }
    trecho.push(linha);
  }
  emParagrafos(trecho);
  for (const tabela of pendentes) {
    blocos.push(tabelaEmMarkdown(tabela.linhas));
    abertoNoFim = false;
  }
  return { blocos, abertoNoFim };
}

/** Bloco de parágrafo comum (nem título, nem tabela, nem item de lista). */
const ehParagrafoComum = (bloco: string) => !/^(?:#|\||[-•▪◦●■□–—]\s|\(?(?:\d{1,3}|[a-z])[).]\s)/iu.test(bloco);

/** O texto de um PDF em Markdown. Rejeita com `ErroPdf`. */
export async function pdfParaMarkdown(bytes: Uint8Array, opcoes: OpcoesPdfParaMarkdown = {}): Promise<string> {
  const limitePaginas = opcoes.paginas ?? PAGINAS_PADRAO;
  const limiteCaracteres = opcoes.caracteres ?? CARACTERES_PADRAO;
  const marcadores = opcoes.marcadoresDePagina ?? true;
  if (!ehPdf(bytes)) throw new ErroPdf({ motivo: "nao-e-pdf" });

  const Pdfjs = await carregarPdfjs();
  const tarefa = Pdfjs.getDocument({
    // O pdfjs transfere o buffer ao worker (o do chamador ficaria vazio): vai uma cópia.
    data: bytes.slice(),
    verbosity: Pdfjs.VerbosityLevel.ERRORS,
    disableFontFace: true,
    useSystemFonts: false,
    useWasm: false,
    stopAtErrors: false,
    // Guarda o nome da fonte (o negrito vem dele).
    fontExtraProperties: true,
  });
  const codigos = {
    save: Pdfjs.OPS.save,
    restore: Pdfjs.OPS.restore,
    transform: Pdfjs.OPS.transform,
    constructPath: Pdfjs.OPS.constructPath,
    endPath: Pdfjs.OPS.endPath,
    fill: Pdfjs.OPS.fill,
    eoFill: Pdfjs.OPS.eoFill,
    setFillRGBColor: Pdfjs.OPS.setFillRGBColor,
    setFillGray: Pdfjs.OPS.setFillGray,
  };
  try {
    const documento = await tarefa.promise.catch((erro: unknown) => Promise.reject(traduzir(erro)));
    if (documento.numPages > limitePaginas)
      throw new ErroPdf({ motivo: "paginas-demais", paginas: documento.numPages, limite: limitePaginas });

    const paginas: PaginaLida[] = [];
    const alturas: number[] = [];
    let caracteres = 0;
    for (let numero = 1; numero <= documento.numPages; numero++) {
      const pagina = await documento.getPage(numero).catch((erro: unknown) => Promise.reject(traduzir(erro)));
      try {
        const conteudo = await pagina.getTextContent();
        // A lista de operações dá as bordas das tabelas e carrega as fontes (o nome diz o negrito); a
        // página sem texto (digitalizada) não precisa dela, e ela processaria as imagens à toa.
        const temTexto = conteudo.items.some((item) => "str" in item && item.str.trim() !== "");
        const operacoes = temTexto ? await pagina.getOperatorList() : { fnArray: [], argsArray: [] };
        const negrito = new Map<string, boolean>();
        const ehNegrito = (fonte: string) => {
          if (!negrito.has(fonte)) {
            let nome = "";
            try {
              nome = (pagina.commonObjs.get(fonte) as { name?: string } | undefined)?.name ?? "";
            } catch {
              nome = "";
            }
            negrito.set(fonte, RE_NEGRITO.test(nome));
          }
          return negrito.get(fonte)!;
        };
        const itens = conteudo.items.flatMap((item) =>
          "str" in item ? [{ ...item, negrito: item.fontName ? ehNegrito(item.fontName) : false }] : [],
        );
        const posicionados: ItemPosicionado[] = itens.map((item, indice) => ({
          indice,
          texto: item.str,
          x: item.transform[4] ?? 0,
          y: item.transform[5] ?? 0,
          largura: item.width,
          altura: Math.max(item.height, 1),
          negrito: item.negrito,
        }));
        const tabelas = tabelasDaPagina(
          segmentosDoDesenho(operacoes.fnArray, operacoes.argsArray, codigos),
          posicionados,
        );
        const naTabela = new Set(tabelas.flatMap((t) => [...t.itens]));
        const linhas = linhasDosItens(itens.filter((_, i) => !naTabela.has(i)));
        for (const linha of linhas) alturas.push(linha.altura);
        const [, y0 = 0, , y1 = 792] = pagina.view;
        const altura = y1 - y0;
        paginas.push({ numero, linhas, tabelas, topoFaixa: y1 - altura * FAIXA, baseFaixa: y0 + altura * FAIXA });
        caracteres += linhas.reduce((s, l) => s + l.texto.length + 2, 0);
        if (caracteres > limiteCaracteres) throw new ErroPdf({ motivo: "texto-demais", limite: limiteCaracteres });
      } finally {
        pagina.cleanup();
      }
    }

    const cabecalhos = chavesDeCabecalho(paginas);
    const corpo = mediana(alturas);
    const partes: string[] = [];
    let total = 0;
    let comTexto = false;
    let anteriorAberto = false;
    for (const pagina of paginas) {
      const { blocos, abertoNoFim } = markdownDaPagina(pagina, cabecalhos, corpo);
      // O parágrafo que chegou à margem no fim da página continua no primeiro da página seguinte.
      const ultimo = partes.at(-1);
      if (!marcadores && anteriorAberto && ultimo !== undefined && blocos[0] && ehParagrafoComum(blocos[0])) {
        const seguinte = blocos.shift()!;
        partes[partes.length - 1] =
          HIFEN_PARTIDO.test(ultimo) && COMECA_MINUSCULA.test(seguinte)
            ? ultimo.slice(0, -1) + seguinte
            : `${ultimo} ${seguinte}`;
      }
      anteriorAberto = blocos.length ? abertoNoFim : anteriorAberto;
      // A tabela que abre a página e continua a que fechou a anterior, com as mesmas colunas, é a mesma.
      const anterior = partes.at(-1);
      if (!marcadores && blocos[0]?.startsWith("|") && anterior?.startsWith("|")) {
        const colunas = (t: string) => t.split("\n")[1]!.split("|").length;
        if (colunas(anterior) === colunas(blocos[0])) {
          // Sem o separador; e sem o cabeçalho também, quando ele se repete no alto da página.
          const [primeira, , ...resto] = blocos.shift()!.split("\n");
          const linhas = primeira === anterior.split("\n")[0] ? resto : [primeira!, ...resto];
          partes[partes.length - 1] = [anterior, ...linhas].join("\n");
        }
      }
      comTexto ||= blocos.length > 0 || pagina.tabelas.length > 0;
      if (marcadores)
        partes.push(
          blocos.length
            ? [`<!-- página ${pagina.numero} -->`, ...blocos].join("\n\n")
            : `<!-- página ${pagina.numero}: sem texto -->`,
        );
      else partes.push(...blocos);
      total += (partes.at(-1)?.length ?? 0) + 2;
      if (total > limiteCaracteres) throw new ErroPdf({ motivo: "texto-demais", limite: limiteCaracteres });
    }
    if (!comTexto) throw new ErroPdf({ motivo: "sem-texto" });
    return `${partes.join("\n\n")}\n`;
  } finally {
    await tarefa.destroy();
  }
}
