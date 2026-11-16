/**
 * Pacote OPC (o ZIP do DOCX): partes, relações e leitura de XML e de binários.
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
import { analisarXml, atributo, filhos } from "./xml.ts";

/** Bases dos tipos de relação: a do formato de transição (o comum) e a do Strict Open XML. */
const BASES_DE_RELACAO = [
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships",
];
export const RELACAO_DOCUMENTO = BASES_DE_RELACAO.map((base) => `${base}/officeDocument`);
export const RELACAO_ESTILOS = BASES_DE_RELACAO.map((base) => `${base}/styles`);
export const RELACAO_NUMERACAO = BASES_DE_RELACAO.map((base) => `${base}/numbering`);
export const RELACAO_PROPRIEDADES = [
  "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
];

export type Relacao = {
  id: string;
  tipo: string;
  /** `Target` como está no arquivo (uma URL, quando externa). */
  alvo: string;
  externa: boolean;
  /** Nome da parte de destino no ZIP, sem barra inicial; `null` quando a relação é externa. */
  parte: string | null;
};

export { ErroDocx, LIMITES_PADRAO, type LimitesDoPacote };

type Entrada = {
  /** 0 (armazenado) ou 8 (DEFLATE). */
  metodo: number;
  compactado: number;
  descompactado: number;
  /** Posição do cabeçalho local no arquivo. */
  cabecalhoLocal: number;
};

const megabytes = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

/** Erro do arquivo acima do limite; quem lê do disco confere o tamanho antes, com a mesma mensagem. */
export function arquivoGrandeDemais(tamanho: number, limite = LIMITES_PADRAO.bytesDoArquivo): ErroDocx {
  return new ErroDocx(
    `O arquivo DOCX tem ${megabytes(tamanho)}, e o limite é de ${megabytes(limite)}. Um PPC raramente passa disso: ` +
      "em geral são as imagens. No Word, use Arquivo › Compactar imagens e salve de novo.",
  );
}

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
    throw new ErroDocx(
      "O arquivo é do Word 97-2003 (.doc) ou um DOCX protegido por senha. Salve como .docx, sem senha, e tente de novo.",
    );
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new ErroDocx("O arquivo não é um DOCX: não tem o formato de pacote (ZIP) dos documentos do Word.");
  }
  const corrompido = () =>
    new ErroDocx("O arquivo DOCX está corrompido ou incompleto: o pacote (ZIP) não pôde ser lido.");
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
    throw new ErroDocx(`O arquivo DOCX tem partes demais (o limite é de ${limites.entradas}).`);
  }
  const decodificador = new TextDecoder("utf-8");
  const entradas = new Map<string, Entrada>();
  for (let i = 0; i < total; i += 1) {
    if (posicao + 46 > bytes.length || vista.getUint32(posicao, true) !== ENTRADA_DO_DIRETORIO) throw corrompido();
    const tamanhoDoNome = vista.getUint16(posicao + 28, true);
    const nome = decodificador.decode(bytes.subarray(posicao + 46, posicao + 46 + tamanhoDoNome));
    if (vista.getUint16(posicao + 8, true) & 1) {
      throw new ErroDocx("O arquivo DOCX está protegido por senha. Salve sem senha e tente de novo.");
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

/** Resolve `alvo` contra a pasta da parte de origem, como um caminho POSIX normalizado. */
function resolverParte(origem: string, alvo: string): string {
  const base = alvo.startsWith("/") ? [] : origem.split("/").slice(0, -1);
  const segmentos: string[] = [];
  for (const segmento of [...base, ...alvo.split("/")]) {
    if (!segmento || segmento === ".") continue;
    if (segmento === "..") segmentos.pop();
    else segmentos.push(segmento);
  }
  return segmentos.join("/");
}

/** Caminho da parte de relações de uma parte (`word/document.xml` → `word/_rels/document.xml.rels`). */
function parteDeRelacoes(parte: string): string {
  const corte = parte.lastIndexOf("/");
  return `${parte.slice(0, corte + 1)}_rels/${parte.slice(corte + 1)}.rels`;
}

/** Pedaço de entrada dado ao descompactador por vez: limita o quanto uma chamada pode produzir. */
const PEDACO = 16 * 1024;

export class PacoteOoxml {
  readonly #bytes: Uint8Array;
  readonly #entradas: Map<string, Entrada>;
  readonly #limites: LimitesDoPacote;
  readonly #lidas = new Map<string, Uint8Array>();
  readonly #relacoes = new Map<string, Map<string, Relacao>>();
  #bytesLidos = 0;

  constructor(bytes: Uint8Array, limites: Partial<LimitesDoPacote> = {}) {
    this.#bytes = bytes;
    this.#limites = { ...LIMITES_PADRAO, ...limites };
    if (bytes.length > this.#limites.bytesDoArquivo)
      throw arquivoGrandeDemais(bytes.length, this.#limites.bytesDoArquivo);
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
      new ErroDocx(
        `O arquivo DOCX é grande demais para ser lido: a parte ${nome} passa de ${megabytes(bytesPorParte)}, ` +
          `ou o documento passa de ${megabytes(bytesNoTotal)} no total.`,
      );
    const corrompido = () => new ErroDocx(`O arquivo DOCX está corrompido: a parte ${nome} não pôde ser lida.`);
    const cabe = (tamanho: number) => tamanho <= bytesPorParte && this.#bytesLidos + tamanho <= bytesNoTotal;
    const anormal = (descompactado: number, compactado: number) =>
      descompactado > 10 * 1024 * 1024 && descompactado > compactado * razaoDeCompressao;
    const compressaoAnormal = () =>
      new ErroDocx(`O arquivo DOCX não pôde ser lido: a parte ${nome} tem compressão anormal.`);
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

  /** Raiz do XML de uma parte, ou `null` quando a parte não existe. */
  xml(parte: string): Element | null {
    const bytes = this.#ler(parte);
    return bytes ? analisarXml(bytes, parte, this.#limites) : null;
  }

  /** Relações de uma parte, por id; `""` é o próprio pacote (`_rels/.rels`). */
  relacoes(parte: string): Map<string, Relacao> {
    let relacoes = this.#relacoes.get(parte);
    if (relacoes) return relacoes;
    relacoes = new Map();
    const raiz = this.xml(parte ? parteDeRelacoes(parte) : "_rels/.rels");
    for (const item of raiz ? filhos(raiz, "rel:Relationship") : []) {
      const id = atributo(item, "Id");
      const alvo = atributo(item, "Target");
      if (id === null || alvo === null) continue;
      const externa = atributo(item, "TargetMode") === "External";
      relacoes.set(id, {
        id,
        tipo: atributo(item, "Type") ?? "",
        alvo,
        externa,
        parte: externa ? null : resolverParte(parte, alvo),
      });
    }
    this.#relacoes.set(parte, relacoes);
    return relacoes;
  }

  /** Parte de destino da primeira relação de um dos tipos dados. */
  partePorTipo(origem: string, tipos: readonly string[]): string | null {
    for (const relacao of this.relacoes(origem).values()) if (tipos.includes(relacao.tipo)) return relacao.parte;
    return null;
  }

  /** Bytes de uma parte qualquer (imagem, por exemplo); `null` quando ela não existe no ZIP. */
  binario(parte: string): Uint8Array | null {
    return this.#ler(parte);
  }
}
