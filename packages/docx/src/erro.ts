// @effect-diagnostics extendsNativeError:off -- leitura síncrona, fora de Effect: o DOCX inválido é sinalizado por exceção, e quem chama o captura com `instanceof`
/**
 * Arquivo que não é um DOCX legível: não é ZIP, está corrompido, protegido ou passa dos limites.
 *
 * O leitor é síncrono e o lança (`throw`); quem o chama de dentro de Effect o captura com
 * `Effect.try`. O `motivo` é o que se decide e se transporta (o Worker da revisão manda os `dados`,
 * não a frase); a mensagem para a pessoa é montada do motivo e dos atributos, em `mensagemErroDocx`.
 */
import * as Schema from "effect/Schema";

const MOTIVOS = [
  // pacote (ZIP)
  "arquivo-grande-demais",
  "doc-ou-protegido",
  "nao-e-zip",
  "zip-corrompido",
  "partes-demais",
  "protegido",
  "parte-grande-demais",
  "parte-corrompida",
  "compressao-anormal",
  // XML
  "elementos-demais",
  "aninhamento-demais",
  "xml-mal-formado",
  // leitura do documento
  "sem-documento-principal",
  "celulas-por-linha",
  "tabela-grande-demais",
  // comentários
  "comentarios-sem-documento-principal",
  "comentarios-documento-ausente",
  "comentarios-utf16",
  "comentarios-prefixo-w",
  "comentarios-sem-corpo",
  "comentarios-corrompidos",
  "relacoes-corrompidas",
  "sem-tipos-de-conteudo",
  // conversão em Markdown (a do PPC e `docxParaMarkdown`)
  "sem-texto",
  "texto-demais",
  "bloco-longo",
  "sequencia-sem-texto",
  "mescladas-demais",
  "celulas-demais",
] as const;

/** Os motivos como esquema, para quem guarda o motivo num erro tipado (`Schema.TaggedError`). */
export const MotivoErroDocx = Schema.Literals(MOTIVOS);
export type MotivoErroDocx = (typeof MOTIVOS)[number];

/** Os dados do erro, sem a classe: o que atravessa o Worker. */
export type DadosErroDocx = {
  readonly motivo: MotivoErroDocx;
  /** A parte do pacote (`word/document.xml`), nos motivos de parte e de XML. */
  readonly parte?: string;
  /** O limite que o arquivo passou (bytes, entradas, elementos, células, caracteres). */
  readonly limite?: number;
  /** Um segundo limite: o total de bytes, em `parte-grande-demais`. */
  readonly limiteTotal?: number;
  /** O tamanho do arquivo, em `arquivo-grande-demais`. */
  readonly tamanho?: number;
  /** O bloco que passou do limite ("um parágrafo", "uma célula de tabela"), na conversão. */
  readonly bloco?: string;
};

const megabytes = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

/** A frase em português para a pessoa, montada do motivo e dos atributos. */
export function mensagemErroDocx(dados: DadosErroDocx): string {
  const { parte = "", limite = 0, limiteTotal = 0, tamanho = 0, bloco = "" } = dados;
  switch (dados.motivo) {
    case "arquivo-grande-demais":
      return (
        `O arquivo DOCX tem ${megabytes(tamanho)}, e o limite é de ${megabytes(limite)}. Um documento de texto raramente passa disso: ` +
        "em geral são as imagens. No Word, use Arquivo › Compactar imagens e salve de novo."
      );
    case "doc-ou-protegido":
      return "O arquivo é do Word 97-2003 (.doc) ou um DOCX protegido por senha. Salve como .docx, sem senha, e tente de novo.";
    case "nao-e-zip":
      return "O arquivo não é um DOCX: não tem o formato de pacote (ZIP) dos documentos do Word.";
    case "zip-corrompido":
      return "O arquivo DOCX está corrompido ou incompleto: o pacote (ZIP) não pôde ser lido.";
    case "partes-demais":
      return `O arquivo DOCX tem partes demais (o limite é de ${limite}).`;
    case "protegido":
      return "O arquivo DOCX está protegido por senha. Salve sem senha e tente de novo.";
    case "parte-grande-demais":
      return (
        `O arquivo DOCX é grande demais para ser lido: a parte ${parte} passa de ${megabytes(limite)}, ` +
        `ou o documento passa de ${megabytes(limiteTotal)} no total.`
      );
    case "parte-corrompida":
      return `O arquivo DOCX está corrompido: a parte ${parte} não pôde ser lida.`;
    case "compressao-anormal":
      return `O arquivo DOCX não pôde ser lido: a parte ${parte} tem compressão anormal.`;
    case "elementos-demais":
      return `O arquivo DOCX é grande demais para ser lido: ${parte} tem mais de ${limite / 1000} mil elementos.`;
    case "aninhamento-demais":
      return `O arquivo DOCX não pôde ser lido: ${parte} tem elementos aninhados demais.`;
    case "xml-mal-formado":
      return `O arquivo DOCX está corrompido: ${parte} não é um XML bem formado.`;
    case "sem-documento-principal":
      return "O arquivo não é um documento do Word: o pacote não tem documento principal.";
    case "celulas-por-linha":
      return `O arquivo DOCX não pôde ser lido: há uma tabela com mais de ${limite} células numa linha.`;
    case "tabela-grande-demais":
      return "O arquivo DOCX não pôde ser lido: há uma tabela grande demais.";
    case "comentarios-sem-documento-principal":
      return "O arquivo não tem documento principal do Word.";
    case "comentarios-documento-ausente":
      return "O documento principal do Word não está no arquivo.";
    case "comentarios-utf16":
      return "Documento em UTF-16: os comentários ainda não são gravados nesse caso.";
    case "comentarios-prefixo-w":
      return "Documento sem o prefixo w: convencional: os comentários ainda não são gravados nesse caso.";
    case "comentarios-sem-corpo":
      return "O DOCX não tem corpo de documento (w:body).";
    case "comentarios-corrompidos":
      return "A parte de comentários do arquivo está corrompida.";
    case "relacoes-corrompidas":
      return "As relações do documento estão corrompidas.";
    case "sem-tipos-de-conteudo":
      return "O arquivo não declara os tipos de conteúdo.";
    case "sem-texto":
      return (
        "O documento não tem texto: o arquivo está vazio ou traz o conteúdo só como imagem (digitalizado). " +
        "Use o documento de texto original."
      );
    case "texto-demais":
      return (
        `O documento tem texto demais para ser convertido (mais de ${limite / 1_000_000} milhões ` +
        "de caracteres, contadas as repetições das células mescladas das tabelas)."
      );
    case "bloco-longo":
      return `O documento não pôde ser convertido: há ${bloco} com mais de ${limite / 1000} mil caracteres.`;
    case "sequencia-sem-texto":
      return (
        `O documento não pôde ser convertido: há ${bloco} com mais de ${limite} espaços, tabulações ` +
        "ou sinais de pontuação seguidos."
      );
    case "mescladas-demais":
      return "O arquivo DOCX não pôde ser lido: há uma tabela com texto demais nas células mescladas.";
    case "celulas-demais":
      return `O arquivo DOCX não pôde ser lido: há uma tabela com mais de ${limite} células.`;
  }
}

export class ErroDocx extends Error {
  override readonly name = "ErroDocx";
  readonly dados: DadosErroDocx;

  constructor(dados: DadosErroDocx) {
    super(mensagemErroDocx(dados));
    this.dados = dados;
  }

  get motivo(): MotivoErroDocx {
    return this.dados.motivo;
  }
}
