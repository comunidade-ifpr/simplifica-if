/**
 * Representação gráfica do processo formativo: a seção do PPC que traz o fluxograma do curso.
 *
 * A imagem embutida é copiada do pacote como está. O fluxograma desenhado com formas do Word
 * (o caso comum nos PPCs) não é renderizado: a conversão antiga tentava, com MS Word e poppler, e
 * o app não pode depender deles. Em vez da figura, o `PPC.md` recebe um aviso para a revisão.
 */
import { escape, search } from "@simplifica-if/kb/python/re";
import { aparar } from "@simplifica-if/kb/texto";
import type { Figura } from "./elementos.ts";
import type { PacoteOoxml } from "@simplifica-if/docx/pacote";
import { type Secao, tituloCompleto } from "./secoes.ts";

const r = String.raw;

const PADROES_DA_SECAO = [
  r`representa[çc][ãa]o\s+gr[áa]fica`,
  r`fluxograma`,
  r`diagrama\s+do\s+(curso|processo)`,
  r`organiza[çc][ãa]o\s+visual`,
];

/** Formatos que um navegador e um modelo de linguagem abrem como imagem. */
const EXTENSOES_DE_IMAGEM = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp"]);

export type MetodoDeExtracao =
  /** Imagem embutida, copiada do pacote. */
  | "bitmap"
  /** Arquivo vetorial embutido (EMF ou WMF), copiado como está; não é exibível. */
  | "vetorial_arquivo_cru"
  /** Desenho feito com formas do Word: nada a copiar. */
  | "vetorial_nao_renderizada"
  /** A seção não tem figura que a conversão reconheça. */
  | "figura_nao_localizada"
  /** A seção aponta para uma imagem que não está no pacote. */
  | "falha_imagem_ausente";

export type RepresentacaoGrafica = {
  /** Título completo da seção. */
  secao: string;
  temBitmap: boolean;
  temDesenhosVetoriais: boolean;
  metodo: MetodoDeExtracao;
  /** Arquivo a gravar, com o caminho relativo à pasta de saída. */
  arquivo: { caminho: string; bytes: Uint8Array } | null;
  /** Bloco de Markdown a inserir depois do título da seção: a imagem ou o aviso. */
  bloco: string;
};

function procurarSecao(secoes: Secao[]): Secao | null {
  for (const secao of secoes) {
    const titulos = [secao.titulo, tituloCompleto(secao)];
    if (PADROES_DA_SECAO.some((padrao) => titulos.some((titulo) => search(padrao, titulo, { ignoreCase: true }))))
      return secao;
    const achada = procurarSecao(secao.subsecoes);
    if (achada) return achada;
  }
  return null;
}

const aviso = (texto: string) => `**Aviso da conversão:** ${texto}`;

/** Localiza a seção da representação gráfica e resolve o que fazer com a figura dela. */
export function resolverRepresentacaoGrafica(secoes: Secao[], pacote: PacoteOoxml): RepresentacaoGrafica | null {
  const secao = procurarSecao(secoes);
  if (!secao) return null;
  // Só as figuras da própria seção, não as das subseções.
  const figuras = secao.elementos
    .filter((elemento): elemento is Figura => elemento.tipo === "figura")
    .map((item) => item.figura);
  const imagens = figuras.filter((figura) => figura.tipo === "imagem");
  const formas = figuras.filter((figura) => figura.tipo === "forma");
  const base = {
    secao: tituloCompleto(secao),
    temBitmap: imagens.length > 0,
    // Sem figura nenhuma, presume-se um desenho que a leitura não alcançou.
    temDesenhosVetoriais: formas.length > 0 || figuras.length === 0,
  };

  const parte = imagens.find((imagem) => imagem.parte)?.parte ?? null;
  if (parte) {
    const bytes = pacote.binario(parte.replace(/^\/+/, ""));
    const extensao = /\.([A-Za-z0-9]+)$/.exec(parte)?.[1]?.toLowerCase() ?? "";
    if (!bytes) {
      return {
        ...base,
        metodo: "falha_imagem_ausente",
        arquivo: null,
        bloco: aviso(
          "a imagem desta seção não está no arquivo do PPC. Consulte a representação gráfica no documento original.",
        ),
      };
    }
    if (EXTENSOES_DE_IMAGEM.has(extensao)) {
      const caminho = `imagens/representacao_grafica.${extensao}`;
      return {
        ...base,
        metodo: "bitmap",
        arquivo: { caminho, bytes },
        bloco: `![Representação Gráfica do Processo Formativo](${caminho})`,
      };
    }
    const caminho = `imagens/representacao_grafica.${extensao || "bin"}`;
    return {
      ...base,
      metodo: "vetorial_arquivo_cru",
      arquivo: { caminho, bytes },
      bloco: aviso(
        `a figura desta seção está num formato vetorial (${extensao.toUpperCase() || "desconhecido"}) que não é exibido aqui. ` +
          `O arquivo foi salvo em ${caminho}; consulte a representação gráfica no documento original.`,
      ),
    };
  }
  if (imagens.length) {
    return {
      ...base,
      metodo: "falha_imagem_ausente",
      arquivo: null,
      bloco: aviso(
        "a imagem desta seção não está no arquivo do PPC. Consulte a representação gráfica no documento original.",
      ),
    };
  }
  if (formas.length) {
    return {
      ...base,
      metodo: "vetorial_nao_renderizada",
      arquivo: null,
      bloco: aviso(
        "a figura desta seção foi desenhada com formas do Word (desenho vetorial) e não foi convertida em imagem. " +
          "Consulte a representação gráfica no documento original.",
      ),
    };
  }
  return {
    ...base,
    metodo: "figura_nao_localizada",
    arquivo: null,
    bloco: aviso(
      "a conversão não encontrou figura nesta seção. Se o PPC traz a representação gráfica em outro formato " +
        "(caixa de texto, objeto incorporado ou tabela), consulte o documento original.",
    ),
  };
}

/**
 * Insere o bloco (imagem ou aviso) depois do título da seção no Markdown, entre linhas em branco.
 * O título é o primeiro que casa com os padrões da representação gráfica ou com o título da seção.
 */
export function inserirBlocoNaSecao(markdown: string, grafica: RepresentacaoGrafica): string {
  if (markdown.includes(grafica.bloco)) return markdown;
  const padroes = [...PADROES_DA_SECAO, escape(grafica.secao)];
  const linhas = markdown.split("\n");
  for (const [indice, linha] of linhas.entries()) {
    if (!linha.startsWith("#") || !padroes.some((padrao) => search(padrao, linha, { ignoreCase: true }))) continue;
    let posicao = indice + 1;
    while (posicao < linhas.length && !aparar(linhas[posicao]!)) posicao += 1;
    linhas.splice(posicao, 0, `\n${grafica.bloco}\n`);
    return linhas.join("\n");
  }
  return markdown;
}
