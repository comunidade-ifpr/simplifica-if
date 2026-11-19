// @effect-diagnostics globalConsole:off -- não é log: o console.warn é trocado só para calar os avisos do pdfjs ao carregar
// oxlint-disable-next-line typescript/triple-slash-reference -- o worker do pdfjs não tem tipos; a declaração vai junto para quem importa este módulo
/// <reference path="./pdfjs-trabalhador.d.ts" />
/**
 * O texto de um PDF em Markdown, para a IA ler (`pdfParaMarkdown`).
 *
 * O texto vem do `getTextContent` do pdfjs, na ordem em que ele o dá. Cada página começa com o
 * marcador `<!-- página N -->` (N é a posição da página no arquivo, a partir de 1, não o número
 * impresso nela), e a página sem texto sai como `<!-- página N: sem texto -->`. Os itens viram
 * linhas (pelo `hasEOL` e pela mudança de altura), e as linhas viram parágrafos: a linha que chega
 * perto da margem direita continua na seguinte, salvo quando o espaço entre as duas é maior que o
 * entrelinha da página ou a seguinte começa com marcador de lista. A palavra partida no fim da linha
 * ("estu-" e "dante", as duas em minúsculas) é juntada sem o hífen. O texto não é escapado: um `#`
 * ou `*` do PDF fica como está.
 */
import { ErroPdf } from "./erro.ts";

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
};

type Linha = { texto: string; x0: number; x1: number; y: number; altura: number };

const ESPACO_NA_PONTA = /^\s|\s$/u;

/** Os itens de uma página em linhas, na ordem do `getTextContent`. */
export function linhasDosItens(itens: ReadonlyArray<Item>): Linha[] {
  const linhas: Linha[] = [];
  let atual: Linha | undefined;
  const fechar = () => {
    if (atual && atual.texto.trim()) linhas.push({ ...atual, texto: atual.texto.replace(/\s+/gu, " ").trim() });
    atual = undefined;
  };
  for (const item of itens) {
    const x = item.transform[4] ?? 0;
    const y = item.transform[5] ?? 0;
    if (item.str) {
      const altura = Math.max(item.height, 1);
      if (atual && Math.abs(atual.y - y) > Math.max(atual.altura, altura) / 2) fechar();
      if (!atual) atual = { texto: "", x0: x, x1: x, y, altura };
      else {
        const lacuna = x - atual.x1;
        const fimOuInicio = (atual.texto.at(-1) ?? " ") + (item.str[0] ?? " ");
        if (lacuna > altura * 0.15 && !ESPACO_NA_PONTA.test(fimOuInicio)) atual.texto += " ";
      }
      atual.texto += item.str;
      atual.x0 = Math.min(atual.x0, x);
      atual.x1 = Math.max(atual.x1, x + item.width);
      atual.altura = Math.max(atual.altura, altura);
    }
    if (item.hasEOL) fechar();
  }
  fechar();
  return linhas;
}

const MARCADOR_DE_LISTA = /^(?:[•▪◦●■□–—-]|\(?(?:\d{1,3}|[ivxlc]{1,6}|[a-z])[).])\s/iu;
const HIFEN_PARTIDO = /\p{Ll}-$/u;
const COMECA_MINUSCULA = /^\p{Ll}/u;

function mediana(valores: number[]): number {
  const ordenados = valores.toSorted((a, b) => a - b);
  return ordenados[Math.floor(ordenados.length / 2)] ?? 0;
}

/** As linhas de uma página em parágrafos (ver o comentário do módulo). */
export function paragrafosDasLinhas(linhas: ReadonlyArray<Linha>): string[] {
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

  const paragrafos: string[] = [];
  let paragrafo = linhas[0]!.texto;
  for (let i = 1; i < linhas.length; i++) {
    const anterior = linhas[i - 1]!;
    const linha = linhas[i]!;
    const descida = descidas[i - 1]!;
    const continua =
      anterior.x1 >= direita - margem &&
      descida > 0 &&
      descida <= Math.max(entrelinha, anterior.altura) * 1.4 &&
      !MARCADOR_DE_LISTA.test(linha.texto);
    if (!continua) {
      paragrafos.push(paragrafo);
      paragrafo = linha.texto;
    } else if (HIFEN_PARTIDO.test(paragrafo) && COMECA_MINUSCULA.test(linha.texto)) {
      paragrafo = paragrafo.slice(0, -1) + linha.texto;
    } else {
      paragrafo += ` ${linha.texto}`;
    }
  }
  paragrafos.push(paragrafo);
  return paragrafos;
}

/** O erro do pdfjs que diz que o arquivo não é um PDF legível, traduzido; o resto passa como está. */
function traduzir(erro: unknown): unknown {
  const nome = erro instanceof Error ? erro.name : undefined;
  if (nome === "PasswordException") return new ErroPdf({ motivo: "protegido" });
  if (nome === "InvalidPDFException" || nome === "FormatError") return new ErroPdf({ motivo: "corrompido" });
  return erro;
}

/** O texto de um PDF em Markdown, para a IA ler. Rejeita com `ErroPdf`. */
export async function pdfParaMarkdown(bytes: Uint8Array, opcoes: OpcoesPdfParaMarkdown = {}): Promise<string> {
  const limitePaginas = opcoes.paginas ?? PAGINAS_PADRAO;
  const limiteCaracteres = opcoes.caracteres ?? CARACTERES_PADRAO;
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
  });
  try {
    const documento = await tarefa.promise.catch((erro: unknown) => Promise.reject(traduzir(erro)));
    if (documento.numPages > limitePaginas)
      throw new ErroPdf({ motivo: "paginas-demais", paginas: documento.numPages, limite: limitePaginas });

    const partes: string[] = [];
    let caracteres = 0;
    let comTexto = false;
    for (let numero = 1; numero <= documento.numPages; numero++) {
      const pagina = await documento.getPage(numero).catch((erro: unknown) => Promise.reject(traduzir(erro)));
      try {
        const conteudo = await pagina.getTextContent();
        const paragrafos = paragrafosDasLinhas(
          linhasDosItens(conteudo.items.flatMap((item) => ("str" in item ? [item] : []))),
        );
        comTexto ||= paragrafos.length > 0;
        const parte = paragrafos.length
          ? [`<!-- página ${numero} -->`, ...paragrafos].join("\n\n")
          : `<!-- página ${numero}: sem texto -->`;
        caracteres += parte.length + 2;
        if (caracteres > limiteCaracteres) throw new ErroPdf({ motivo: "texto-demais", limite: limiteCaracteres });
        partes.push(parte);
      } finally {
        pagina.cleanup();
      }
    }
    if (!comTexto) throw new ErroPdf({ motivo: "sem-texto" });
    return `${partes.join("\n\n")}\n`;
  } finally {
    await tarefa.destroy();
  }
}
