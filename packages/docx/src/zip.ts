/**
 * O ZIP de um pacote de documento (o DOCX do Word e o ODT do OpenDocument): diretório central e
 * partes descompactadas sob demanda, sob limites.
 *
 * O arquivo vem do usuário e pode ser hostil. Por isso o ZIP é lido aqui, e não por uma função que
 * descompacta tudo: o diretório central é percorrido sem descompactar nada, e cada parte só é
 * descompactada quando alguém a pede, em pedaços, sob limites de tamanho que valem para a saída
 * real (o tamanho declarado no ZIP pode mentir). Um PPC traz megabytes de fontes e imagens que a
 * conversão nunca lê.
 */
import type { Element } from "domhandler";
import { Inflate } from "fflate";
import { ErroDocx } from "./erro.ts";
import { LIMITES_PADRAO, type LimitesDoPacote } from "./limites.ts";
import { analisarXml } from "./xml.ts";

type Entrada = {
  /** 0 (armazenado) ou 8 (DEFLATE). */
  metodo: number;
  compactado: number;
  descompactado: number;
  /** Posição do cabeçalho local no arquivo. */
  cabecalhoLocal: number;
};

const ASSINATURA_OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const FIM_DO_DIRETORIO = 0x06054b50;
const ENTRADA_DO_DIRETORIO = 0x02014b50;
const CABECALHO_LOCAL = 0x04034b50;

/**
 * Lê o diretório central do ZIP, sem descompactar nada. Com nomes repetidos vale a última
 * entrada, como nas bibliotecas de ZIP.
 */
function lerDiretorio(bytes: Uint8Array, limites: LimitesDoPacote): Map<string, Entrada> {
  if (ASSINATURA_OLE.every((byte, indice) => bytes[indice] === byte)) {
    throw new ErroDocx({ motivo: "doc-ou-protegido" });
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new ErroDocx({ motivo: "nao-e-zip" });
  }
  const corrompido = () => new ErroDocx({ motivo: "zip-corrompido" });
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // O registro de fim do diretório fica nos últimos 22 bytes, mais um comentário de até 64 KB.
  let fim = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i -= 1) {
    if (vista.getUint32(i, true) === FIM_DO_DIRETORIO) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw corrompido();
  const total = vista.getUint16(fim + 10, true);
  let posicao = vista.getUint32(fim + 16, true);
  // ZIP64 (mais de 65 mil entradas ou de 4 GB) não é DOCX que se abra aqui.
  if (total === 0xffff || posicao === 0xffffffff || total > limites.entradas) {
    throw new ErroDocx({ motivo: "partes-demais", limite: limites.entradas });
  }
  const decodificador = new TextDecoder("utf-8");
  const entradas = new Map<string, Entrada>();
  for (let i = 0; i < total; i += 1) {
    if (posicao + 46 > bytes.length || vista.getUint32(posicao, true) !== ENTRADA_DO_DIRETORIO) throw corrompido();
    const tamanhoDoNome = vista.getUint16(posicao + 28, true);
    const nome = decodificador.decode(bytes.subarray(posicao + 46, posicao + 46 + tamanhoDoNome));
    if (vista.getUint16(posicao + 8, true) & 1) {
      throw new ErroDocx({ motivo: "protegido" });
    }
    entradas.set(nome, {
      metodo: vista.getUint16(posicao + 10, true),
      compactado: vista.getUint32(posicao + 20, true),
      descompactado: vista.getUint32(posicao + 24, true),
      cabecalhoLocal: vista.getUint32(posicao + 42, true),
    });
    posicao += 46 + tamanhoDoNome + vista.getUint16(posicao + 30, true) + vista.getUint16(posicao + 32, true);
  }
  return entradas;
}

/** Pedaço de entrada dado ao descompactador por vez: limita o quanto uma chamada pode produzir. */
const PEDACO = 16 * 1024;

/** O ZIP de um pacote: as partes, lidas sob os limites. */
export class PacoteZip {
  readonly #bytes: Uint8Array;
  readonly #entradas: Map<string, Entrada>;
  readonly #limites: LimitesDoPacote;
  readonly #lidas = new Map<string, Uint8Array>();
  #bytesLidos = 0;

  constructor(bytes: Uint8Array, limites: Partial<LimitesDoPacote> = {}) {
    this.#bytes = bytes;
    this.#limites = { ...LIMITES_PADRAO, ...limites };
    if (bytes.length > this.#limites.bytesDoArquivo)
      throw new ErroDocx({
        motivo: "arquivo-grande-demais",
        tamanho: bytes.length,
        limite: this.#limites.bytesDoArquivo,
      });
    this.#entradas = lerDiretorio(bytes, this.#limites);
  }

  /** Os limites em vigor (os padrões, com o que foi passado na abertura). */
  get limites(): LimitesDoPacote {
    return this.#limites;
  }

  /** Descompacta uma parte, sob os limites; `null` quando ela não existe no pacote. */
  #ler(nome: string): Uint8Array | null {
    const lida = this.#lidas.get(nome);
    if (lida) return lida;
    const entrada = this.#entradas.get(nome);
    if (!entrada) return null;
    const { bytesPorParte, bytesNoTotal, razaoDeCompressao } = this.#limites;
    const grandeDemais = () =>
      new ErroDocx({ motivo: "parte-grande-demais", parte: nome, limite: bytesPorParte, limiteTotal: bytesNoTotal });
    const corrompido = () => new ErroDocx({ motivo: "parte-corrompida", parte: nome });
    const cabe = (tamanho: number) => tamanho <= bytesPorParte && this.#bytesLidos + tamanho <= bytesNoTotal;
    const anormal = (descompactado: number, compactado: number) =>
      descompactado > 10 * 1024 * 1024 && descompactado > compactado * razaoDeCompressao;
    const compressaoAnormal = () => new ErroDocx({ motivo: "compressao-anormal", parte: nome });
    if (!cabe(entrada.descompactado)) throw grandeDemais();
    if (anormal(entrada.descompactado, entrada.compactado)) throw compressaoAnormal();

    const local = entrada.cabecalhoLocal;
    const vista = new DataView(this.#bytes.buffer, this.#bytes.byteOffset, this.#bytes.byteLength);
    if (local + 30 > this.#bytes.length || vista.getUint32(local, true) !== CABECALHO_LOCAL) throw corrompido();
    const inicio = local + 30 + vista.getUint16(local + 26, true) + vista.getUint16(local + 28, true);
    const fim = inicio + entrada.compactado;
    if (fim > this.#bytes.length) throw corrompido();

    let conteudo: Uint8Array;
    if (entrada.metodo === 0) {
      conteudo = this.#bytes.subarray(inicio, fim);
      if (!cabe(conteudo.length)) throw grandeDemais();
    } else if (entrada.metodo === 8) {
      // A entrada vai em pedaços pequenos: o limite é conferido com o que de fato saiu, antes de
      // o próximo pedaço entrar, e não com o tamanho que o ZIP declara.
      const pedacos: Uint8Array[] = [];
      let tamanho = 0;
      const descompactador = new Inflate((pedaco) => {
        pedacos.push(pedaco);
        tamanho += pedaco.length;
      });
      try {
        for (let i = inicio; i < fim || i === inicio; i += PEDACO) {
          const proximo = Math.min(i + PEDACO, fim);
          descompactador.push(this.#bytes.subarray(i, proximo), i + PEDACO >= fim);
          if (!cabe(tamanho)) throw grandeDemais();
          // A razão é conferida de novo com o que saiu e o que entrou até aqui: o tamanho declarado
          // (100 bytes para 96 MB de `<w:p/>`, num ZIP de 142 KB) escaparia da conferência acima.
          if (anormal(tamanho, proximo - inicio)) throw compressaoAnormal();
        }
      } catch (erro) {
        throw erro instanceof ErroDocx ? erro : corrompido();
      }
      conteudo = new Uint8Array(tamanho);
      let posicao = 0;
      for (const pedaco of pedacos) {
        conteudo.set(pedaco, posicao);
        posicao += pedaco.length;
      }
    } else throw corrompido();

    this.#bytesLidos += conteudo.length;
    this.#lidas.set(nome, conteudo);
    return conteudo;
  }

  /** Nomes das partes do ZIP, na ordem do diretório central. */
  nomes(): string[] {
    return [...this.#entradas.keys()];
  }

  /** Raiz do XML de uma parte, ou `null` quando a parte não existe. */
  xml(parte: string): Element | null {
    const bytes = this.#ler(parte);
    return bytes ? analisarXml(bytes, parte, this.#limites) : null;
  }

  /** Bytes de uma parte qualquer (imagem, por exemplo); `null` quando ela não existe no ZIP. */
  binario(parte: string): Uint8Array | null {
    return this.#ler(parte);
  }
}
