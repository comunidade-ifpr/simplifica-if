/**
 * Conversão de um PPC `.docx` em Markdown normalizado (`markdown`), Markdown bruto (`markdownBruto`)
 * e a figura da representação gráfica (`representacaoGrafica`).
 *
 * Camadas, de baixo para cima:
 * - `@simplifica-if/docx`: o DOCX como modelo intermediário (pacote ZIP, XML, parágrafos, tabelas,
 *   figuras), com os limites contra arquivo hostil, e a camada genérica de texto: elementos
 *   (`elementos.ts`), tabelas em grade (`tabelas.ts`), escrita do Markdown (`markdown.ts`) e
 *   orçamento de texto (`orcamento.ts`);
 * - `secoes.ts`: as seções do PPC;
 * - `matriz.ts` e `figura.ts`: a matriz curricular canônica (inserida no Markdown) e a representação gráfica;
 * - `markdown.ts` e este módulo: o Markdown final.
 *
 * Tudo aqui é puro e trabalha em memória: quem chama lê o DOCX (depois de `conferirArquivoDocx`).
 * `converterPpc` é síncrona; quem a chama num servidor deve rodá-la fora do laço de eventos, com
 * limite de memória e de tempo.
 */
import { type Elemento, elementosDoDocumento, type Tabela, temTexto } from "@simplifica-if/docx/elementos";
import { ErroDocx } from "@simplifica-if/docx/erro";
import { lerPacote } from "@simplifica-if/docx/leitor";
import { type LimitesDeTexto, Orcamento } from "@simplifica-if/docx/orcamento";
import { LIMITES_PADRAO, type LimitesDoPacote, PacoteOoxml } from "@simplifica-if/docx/pacote";
import { type FormasDaTabela, formasDaTabela } from "@simplifica-if/docx/tabelas";
import { normalizarMarkdown } from "../normalizador-markdown.ts";
import { inserirBlocoNaSecao, type RepresentacaoGrafica, resolverRepresentacaoGrafica } from "./figura.ts";
import { escreverMarkdown } from "./markdown.ts";
import { extrairMatrizPpc, type MatrizPpc, mesclarMatrizes, substituirMatrizNoMarkdown } from "./matriz.ts";
import { detectarSecoes, type Secao } from "./secoes.ts";

export type OpcoesConversao = {
  /** Limites de leitura do pacote; padrão: `LIMITES_PADRAO` de `@simplifica-if/docx/pacote`. */
  limites?: Partial<LimitesDoPacote>;
  /** Orçamento de texto do documento; padrão: `LIMITES_DE_TEXTO` de `@simplifica-if/docx/orcamento`. */
  limitesDeTexto?: Partial<LimitesDeTexto>;
};

/** Resultado da conversão em memória. */
export type Conversao = {
  elementos: Elemento[];
  secoes: Secao[];
  markdown: string;
  markdownBruto: string;
  matriz: MatrizPpc | null;
  representacaoGrafica: RepresentacaoGrafica | null;
};

/**
 * Converte os bytes de um `.docx` em memória. Lança `ErroDocx` quando o arquivo não é um DOCX
 * legível ou passa dos limites.
 */
export function converterPpc(bytes: Uint8Array, _nomeDoArquivo?: string, opcoes: OpcoesConversao = {}): Conversao {
  const pacote = new PacoteOoxml(bytes, opcoes.limites);
  const documento = lerPacote(pacote);
  const elementos = elementosDoDocumento(documento);
  // Documento sem nenhum texto: vazio, ou digitalizado como imagem. Um `PPC.md` em branco seria
  // revisado como se fosse o PPC.
  if (!elementos.some(temTexto)) {
    throw new ErroDocx({ motivo: "sem-texto" });
  }
  const orcamento = new Orcamento(opcoes.limitesDeTexto);
  orcamento.conferirElementos(elementos);
  // Cada tabela é normalizada uma vez (a extração da matriz e o Markdown usam as mesmas formas), e
  // o texto dela, com as repetições das mesclas, sai do orçamento do documento.
  const normalizadas = new Map<Tabela, FormasDaTabela>();
  const formasUmaVez = (tabela: Tabela) => {
    let formas = normalizadas.get(tabela);
    if (!formas)
      normalizadas.set(tabela, (formas = formasDaTabela(tabela, (caracteres) => orcamento.gastar(caracteres))));
    return formas;
  };
  const secoes = detectarSecoes(elementos);
  let matriz: MatrizPpc | null = null;
  for (const elemento of elementos) {
    if (elemento.tipo !== "tabela") continue;
    const matrizPpc = extrairMatrizPpc(formasUmaVez(elemento).repetida);
    if (matrizPpc) matriz = mesclarMatrizes(matriz, matrizPpc);
  }
  const representacaoGrafica = resolverRepresentacaoGrafica(secoes, pacote);

  const normalizar = (bruto: string) => {
    const resultado = normalizarMarkdown(bruto);
    const markdown = matriz
      ? substituirMatrizNoMarkdown(resultado.markdownNormalizado, matriz)
      : resultado.markdownNormalizado;
    return { markdownBruto: resultado.markdownBruto, markdown };
  };
  const bruto = escreverMarkdown(elementos, secoes, (tabela) => formasUmaVez(tabela).leitura);
  // O Markdown gerado também sai do orçamento, antes de ser normalizado.
  new Orcamento(opcoes.limitesDeTexto).gastar(bruto.length);
  let textos = normalizar(bruto);
  // A imagem (ou o aviso) entra no Markdown bruto já limpo, e a normalização é refeita.
  if (representacaoGrafica) textos = normalizar(inserirBlocoNaSecao(textos.markdownBruto, representacaoGrafica));

  return { elementos, secoes, ...textos, matriz, representacaoGrafica };
}

/**
 * Confere um `.docx` antes de lê-lo: a extensão e o tamanho, que o chamador tira do disco sem ler o
 * arquivo (um arquivo de gigabytes não chega à memória).
 */
export function conferirArquivoDocx(arquivo: string, tamanho: number, limite = LIMITES_PADRAO.bytesDoArquivo): void {
  if (!/[^/\\]\.docx$/i.test(arquivo)) throw new Error(`O arquivo deve ser .docx: ${arquivo}`);
  // A mesma recusa do `PacoteOoxml`, antes de ler o arquivo.
  if (tamanho > limite) throw new ErroDocx({ motivo: "arquivo-grande-demais", tamanho, limite });
}
