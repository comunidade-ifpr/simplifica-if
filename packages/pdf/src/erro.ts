// @effect-diagnostics extendsNativeError:off -- conversão fora de Effect, como a do docx: o PDF recusado é sinalizado por rejeição, e quem chama o captura com `instanceof`
/**
 * Arquivo que não é um PDF com texto legível.
 *
 * O `motivo` é o que se decide e se transporta (um Worker manda os `dados`, não a frase); a
 * mensagem para a pessoa é montada do motivo e dos atributos, em `mensagemErroPdf`.
 */

export type MotivoErroPdf = "nao-e-pdf" | "corrompido" | "protegido" | "sem-texto" | "paginas-demais" | "texto-demais";

/** Os dados do erro, sem a classe: o que atravessa o Worker (`postMessage`). */
export type DadosErroPdf = {
  readonly motivo: MotivoErroPdf;
  /** As páginas do documento, em `paginas-demais`. */
  readonly paginas?: number;
  /** O limite que o documento passou (páginas ou caracteres). */
  readonly limite?: number;
};

const milhoes = (n: number) => `${(n / 1_000_000).toLocaleString("pt-BR")} milhões`;

/** A frase em português para a pessoa, montada do motivo e dos atributos. */
export function mensagemErroPdf(dados: DadosErroPdf): string {
  const { paginas = 0, limite = 0 } = dados;
  switch (dados.motivo) {
    case "nao-e-pdf":
      return "O arquivo não é um PDF: não começa com a assinatura dos arquivos PDF.";
    case "corrompido":
      return "O PDF está corrompido ou incompleto e não pôde ser lido. Gere o PDF de novo a partir do documento original.";
    case "protegido":
      return "O PDF está protegido por senha. Salve uma cópia sem senha e tente de novo.";
    case "sem-texto":
      return (
        "O PDF não tem texto: é digitalizado (só imagem) ou está vazio. " +
        "Use o documento de texto original, ou um PDF gerado pelo editor de texto."
      );
    case "paginas-demais":
      return `O PDF tem ${paginas} páginas, e o limite é de ${limite}. Separe as páginas que interessam num PDF menor.`;
    case "texto-demais":
      return `O PDF tem texto demais para ser convertido (mais de ${milhoes(limite)} de caracteres).`;
  }
}

export class ErroPdf extends Error {
  override readonly name = "ErroPdf";
  readonly dados: DadosErroPdf;

  constructor(dados: DadosErroPdf) {
    super(mensagemErroPdf(dados));
    this.dados = dados;
  }

  get motivo(): MotivoErroPdf {
    return this.dados.motivo;
  }
}
