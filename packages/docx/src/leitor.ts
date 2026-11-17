/**
 * Leitura de um DOCX no modelo intermediário (`modelo.ts`).
 *
 * Convenções da leitura que mudam a saída:
 * - o texto de um parágrafo é o dos `w:r` e `w:hyperlink` filhos (e dos que estão dentro de
 *   envoltórios, veja abaixo); num run, `w:tab` e
 *   `w:ptab` viram `\t`, `w:br` (de linha) e `w:cr` viram `\n` e `w:noBreakHyphen` vira `-`;
 * - o estilo do parágrafo é o de `w:pStyle` quando ele existe e é de parágrafo, senão o estilo de
 *   parágrafo padrão do documento; o nome é o de exibição (`heading 1` no XML é `Heading 1`);
 * - a formatação do run é só a direta (`w:rPr`), sem herança do estilo;
 * - o texto de uma célula é o dos parágrafos filhos, um por linha.
 *
 * O leitor lê o texto que o Word mostra:
 * - Entram os runs embrulhados em `w:ins` e `w:moveTo` (inserções de alterações controladas ainda
 *   não aceitas), `w:smartTag`, `w:sdt` em linha, `w:fldSimple` e `w:customXml`. O removido
 *   (`w:del`, `w:moveFrom`) fica de fora: o texto, a figura e a linha de tabela.
 * - Entram as linhas, as células e os parágrafos de tabela embrulhados em `w:sdt`.
 * - O texto profundo da célula é lido como os parágrafos do corpo, sem a versão de
 *   compatibilidade (`mc:Fallback`) das caixas de texto.
 * - A numeração automática do parágrafo (`w:numPr`) é lida.
 * - Uma imagem legada (`v:imagedata` em `w:pict` ou `w:object`) é imagem, não forma.
 */
import { aparar } from "@simplifica-if/kb/texto";
import { Element as ElementoDom, type Element } from "domhandler";
import * as DateTime from "effect/DateTime";
import type {
  BlocoOoxml,
  CelulaOoxml,
  DocumentoOoxml,
  FiguraOoxml,
  ItemParagrafo,
  LinhaOoxml,
  ParagrafoOoxml,
  PropriedadesOoxml,
  RunOoxml,
  TabelaOoxml,
} from "./modelo.ts";
import {
  ErroDocx,
  type LimitesDoPacote,
  PacoteOoxml,
  RELACAO_DOCUMENTO,
  RELACAO_ESTILOS,
  RELACAO_NUMERACAO,
  RELACAO_PROPRIEDADES,
  type Relacao,
} from "./pacote.ts";
import { atributo, descendente, descendentes, filho, filhos, filhosElementos, textoInicial } from "./xml.ts";

export type OpcoesLeitura = {
  /** Limites de leitura; padrão: `LIMITES_PADRAO` de `limites.ts`. */
  limites?: Partial<LimitesDoPacote>;
};

/** Elementos que só embrulham conteúdo em linha; o conteúdo de `w:sdt` fica em `w:sdtContent`. */
const ENVOLTORIOS = new Set(["w:ins", "w:moveTo", "w:smartTag", "w:sdt", "w:sdtContent", "w:fldSimple", "w:customXml"]);

/** Nomes de estilo que o Word guarda em minúsculas e exibe com maiúscula. */
const NOMES_DE_EXIBICAO = new Map<string, string>([
  ["caption", "Caption"],
  ["footer", "Footer"],
  ["header", "Header"],
  ...Array.from({ length: 9 }, (_, i): [string, string] => [`heading ${i + 1}`, `Heading ${i + 1}`]),
]);

const EMU_POR_UNIDADE: Record<string, number> = {
  mm: 36000,
  cm: 360000,
  in: 914400,
  pt: 12700,
  pc: 152400,
  pi: 152400,
};

/** Arredonda para o inteiro mais próximo, com o meio indo para o par. */
function arredondar(valor: number): number {
  const piso = Math.floor(valor);
  const resto = valor - piso;
  if (resto !== 0.5) return Math.round(valor);
  return piso % 2 === 0 ? piso : piso + 1;
}

/** Medida com unidade (`0.5in`, `12pt`) em EMU. */
function emuDeMedida(valor: string): number | null {
  const fator = EMU_POR_UNIDADE[valor.slice(-2)];
  const quantidade = Number(valor.slice(0, -2));
  return fator === undefined || Number.isNaN(quantidade) ? null : arredondar(quantidade * fator);
}

/** `w:ind/@w:left`: vigésimos de ponto, ou medida com unidade. */
function emuDeTwips(valor: string): number | null {
  if (/[imp]/.test(valor)) return emuDeMedida(valor);
  const twips = Number(valor);
  return Number.isNaN(twips) ? null : Math.trunc(arredondar(twips) * 635);
}

/** `w:sz/@w:val`: meios pontos, ou medida com unidade; devolve pontos. */
function pontosDeMeiosPontos(valor: string): number | null {
  const emu = /[mnp]/.test(valor) ? emuDeMedida(valor) : Math.trunc((Number.parseInt(valor, 10) / 2) * 12700);
  return emu === null || Number.isNaN(emu) ? null : emu / 12700;
}

function inteiro(valor: string | null, padrao: number): number {
  const numero = valor === null ? Number.NaN : Number.parseInt(valor, 10);
  return Number.isNaN(numero) ? padrao : numero;
}

/** Colunas de uma tabela do Word: o formato não admite mais que 63. */
const COLUNAS_MAXIMAS = 63;

/**
 * Número de colunas lido do arquivo, preso à faixa válida. Um `gridSpan` de dois bilhões num
 * arquivo de menos de 1 KB faria a grade da tabela esgotar a memória.
 */
function colunasValidas(valor: string | null, padrao: number, minimo: number): number {
  return Math.min(Math.max(inteiro(valor, padrao), minimo), COLUNAS_MAXIMAS);
}

/** Propriedade liga/desliga (`w:b`, `w:i`, `w:strike`): presente sem valor é ligada. */
function ligaDesliga(elemento: Element | null): boolean | null {
  if (!elemento) return null;
  const valor = atributo(elemento, "w:val");
  if (valor === null) return true;
  return valor === "1" || valor === "true" || valor === "on";
}

type Contexto = {
  relacoes: Map<string, Relacao>;
  /** Nome de exibição dos estilos de parágrafo, por id. */
  estilos: Map<string, string | null>;
  /** Nome do estilo de parágrafo padrão; `undefined` quando o documento não define um. */
  estiloPadrao: string | null | undefined;
  limites: LimitesDoPacote;
  /** Formato do marcador (`w:numFmt`) de cada nível de cada numeração (`w:num`), por id. */
  numeracoes: Map<string, Map<number, string>>;
};

/** Alterações controladas que removem conteúdo: ficam fora do texto que o Word mostra. */
const REMOVIDOS = new Set(["w:del", "w:moveFrom"]);
/** Envoltórios de blocos (parágrafos, linhas e células). */
const ENVOLTORIOS_DE_BLOCO = new Set(["w:sdt", "w:sdtContent", "w:customXml"]);

/** Descendentes com o nome dado, sem entrar nas subárvores dos elementos de `barrados`. */
function descendentesFora(elemento: Element, nome: string, barrados: ReadonlySet<string>): Element[] {
  const saida: Element[] = [];
  const visitar = (no: Element): void => {
    for (const item of filhosElementos(no)) {
      if (barrados.has(item.name)) continue;
      if (item.name === nome) saida.push(item);
      visitar(item);
    }
  };
  visitar(elemento);
  return saida;
}

/** Filhos com o nome dado, contando os que estão dentro de envoltórios de bloco. */
function filhosComEnvoltorios(elemento: Element, nome: string): Element[] {
  const saida: Element[] = [];
  for (const item of filhosElementos(elemento)) {
    if (item.name === nome) saida.push(item);
    // Sem espalhar o array na chamada: um envoltório com centenas de milhares de filhos estouraria a pilha.
    else if (ENVOLTORIOS_DE_BLOCO.has(item.name))
      for (const interno of filhosComEnvoltorios(item, nome)) saida.push(interno);
  }
  return saida;
}

// ---------------------------------------------------------------- numeração

function lerNumeracoes(raiz: Element | null): Map<string, Map<number, string>> {
  const niveis = (recipiente: Element, base?: Map<number, string>) => {
    const mapa = new Map(base);
    for (const nivel of descendentesFora(recipiente, "w:lvl", new Set())) {
      const formato = filho(nivel, "w:numFmt");
      const valor = formato ? atributo(formato, "w:val") : null;
      if (valor) mapa.set(inteiro(atributo(nivel, "w:ilvl"), 0), valor);
    }
    return mapa;
  };
  const abstratas = new Map<string, Map<number, string>>();
  for (const abstrata of raiz ? filhos(raiz, "w:abstractNum") : []) {
    abstratas.set(atributo(abstrata, "w:abstractNumId") ?? "", niveis(abstrata));
  }
  const numeracoes = new Map<string, Map<number, string>>();
  for (const numeracao of raiz ? filhos(raiz, "w:num") : []) {
    const referencia = filho(numeracao, "w:abstractNumId");
    const base = abstratas.get((referencia && atributo(referencia, "w:val")) ?? "");
    // Os níveis redefinidos na própria numeração (`w:lvlOverride`) prevalecem sobre os da abstrata.
    numeracoes.set(atributo(numeracao, "w:numId") ?? "", niveis(numeracao, base));
  }
  return numeracoes;
}

function lerNumeracao(propriedades: Element | null, contexto: Contexto): ParagrafoOoxml["numeracao"] {
  const numeracao = propriedades ? filho(propriedades, "w:numPr") : null;
  if (!numeracao) return null;
  const id = filho(numeracao, "w:numId");
  const nivel = filho(numeracao, "w:ilvl");
  // `numId` 0 desliga a numeração herdada do estilo.
  const niveis = contexto.numeracoes.get((id && atributo(id, "w:val")) ?? "0");
  if (!niveis) return null;
  const indice = nivel ? inteiro(atributo(nivel, "w:val"), 0) : 0;
  return { nivel: indice, formato: niveis.get(indice) ?? "decimal" };
}

// ---------------------------------------------------------------- estilos

function lerEstilos(raiz: Element | null): Pick<Contexto, "estilos" | "estiloPadrao"> {
  const estilos = new Map<string, string | null>();
  let estiloPadrao: string | null | undefined;
  for (const estilo of raiz ? filhos(raiz, "w:style") : []) {
    if (atributo(estilo, "w:type") !== "paragraph") continue;
    const nome = filho(estilo, "w:name");
    const interno = nome ? atributo(nome, "w:val") : null;
    const exibido = interno === null ? null : (NOMES_DE_EXIBICAO.get(interno) ?? interno);
    const id = atributo(estilo, "w:styleId");
    // Com ids repetidos vale o primeiro; com vários padrões, o último (como manda a especificação).
    if (id !== null && !estilos.has(id)) estilos.set(id, exibido);
    const padrao = atributo(estilo, "w:default");
    if (padrao === "1" || padrao === "true" || padrao === "on") estiloPadrao = exibido;
  }
  return { estilos, estiloPadrao };
}

// ---------------------------------------------------------------- parágrafos

function textoDoRun(run: Element): string {
  let texto = "";
  for (const item of filhosElementos(run)) {
    if (item.name === "w:t") texto += textoInicial(item);
    else if (item.name === "w:tab" || item.name === "w:ptab") texto += "\t";
    else if (item.name === "w:cr") texto += "\n";
    else if (item.name === "w:noBreakHyphen") texto += "-";
    // Quebra de página ou de coluna não é texto.
    else if (item.name === "w:br") texto += (atributo(item, "w:type") ?? "textWrapping") === "textWrapping" ? "\n" : "";
  }
  return texto;
}

function lerRun(run: Element): RunOoxml {
  const propriedades = filho(run, "w:rPr");
  const tamanho = propriedades ? filho(propriedades, "w:sz") : null;
  const valorTamanho = tamanho ? atributo(tamanho, "w:val") : null;
  return {
    texto: textoDoRun(run),
    negrito: ligaDesliga(propriedades && filho(propriedades, "w:b")),
    italico: ligaDesliga(propriedades && filho(propriedades, "w:i")),
    tachado: ligaDesliga(propriedades && filho(propriedades, "w:strike")),
    tamanhoPt: valorTamanho === null ? null : pontosDeMeiosPontos(valorTamanho),
  };
}

/** Filhos de conteúdo em linha: os diretos e os de dentro dos envoltórios. */
function conteudoEmLinha(elemento: Element): Element[] {
  const saida: Element[] = [];
  for (const item of filhosElementos(elemento)) {
    if (ENVOLTORIOS.has(item.name)) for (const interno of conteudoEmLinha(item)) saida.push(interno);
    else saida.push(item);
  }
  return saida;
}

function urlDoHyperlink(hyperlink: Element, contexto: Contexto): string | null {
  const id = atributo(hyperlink, "r:id");
  if (!id) return null;
  // Relação que não existe: o link fica sem endereço, e o texto continua.
  const endereco = contexto.relacoes.get(id)?.alvo;
  if (!endereco) return null;
  const ancora = atributo(hyperlink, "w:anchor");
  return ancora ? `${endereco}#${ancora}` : endereco;
}

function lerItens(paragrafo: Element, contexto: Contexto): ItemParagrafo[] {
  const itens: ItemParagrafo[] = [];
  for (const item of conteudoEmLinha(paragrafo)) {
    if (item.name === "w:r") itens.push({ tipo: "run", ...lerRun(item) });
    else if (item.name === "w:hyperlink") {
      const runs = conteudoEmLinha(item).filter((no) => no.name === "w:r");
      itens.push({ tipo: "hyperlink", url: urlDoHyperlink(item, contexto), runs: runs.map(lerRun) });
    }
  }
  return itens;
}

function textoDosItens(paragrafo: Element, contexto: Contexto): string {
  let texto = "";
  for (const item of lerItens(paragrafo, contexto)) {
    texto += item.tipo === "run" ? item.texto : item.runs.map((run) => run.texto).join("");
  }
  return texto;
}

function parteDaRelacao(id: string, contexto: Contexto): string | null {
  const parte = contexto.relacoes.get(id)?.parte;
  return parte ? `/${parte}` : null;
}

/** Imagem legada: `v:imagedata` com relação para um arquivo do pacote. */
function imagemVml(recipiente: Element, contexto: Contexto): FiguraOoxml | null {
  const dados = descendente(recipiente, "v:imagedata");
  const id = dados ? atributo(dados, "r:id") : null;
  const parte = id ? parteDaRelacao(id, contexto) : null;
  if (!dados || !id || !parte) return null;
  return {
    tipo: "imagem",
    origem: "vml",
    idRelacao: id,
    parte,
    textoAlternativo: atributo(dados, "o:title") ?? "",
    larguraEmu: null,
    alturaEmu: null,
  };
}

function lerFigura(paragrafo: Element, contexto: Contexto): FiguraOoxml | null {
  // A figura apagada com o controle de alterações ligado não conta.
  const achar = (nome: string) => descendentesFora(paragrafo, nome, REMOVIDOS)[0] ?? null;
  const desenho = achar("w:drawing");
  if (desenho) {
    const blip = descendente(desenho, "a:blip");
    if (!blip) return { tipo: "forma", origem: "drawing" };
    const id = atributo(blip, "r:embed");
    // Imagem vinculada (`r:link`), fora do pacote: não há o que extrair.
    if (!id) return null;
    const extensao = descendente(desenho, "wp:extent");
    const descricao = descendente(desenho, "wp:docPr");
    const medida = (nome: string) => {
      const valor = extensao ? atributo(extensao, nome) : null;
      return valor ? inteiro(valor, 0) : null;
    };
    return {
      tipo: "imagem",
      origem: "drawing",
      idRelacao: id,
      parte: parteDaRelacao(id, contexto),
      textoAlternativo: (descricao && (atributo(descricao, "descr") || atributo(descricao, "title"))) || "",
      larguraEmu: medida("cx"),
      alturaEmu: medida("cy"),
    };
  }
  const legado = achar("w:pict");
  if (legado) {
    return imagemVml(legado, contexto) ?? { tipo: "forma", origem: "vml" };
  }
  // Objeto embutido (OLE): a prévia é uma imagem legada, em geral EMF ou WMF.
  const objeto = achar("w:object");
  return objeto ? imagemVml(objeto, contexto) : null;
}

function lerParagrafo(paragrafo: Element, contexto: Contexto, emControle: boolean): ParagrafoOoxml {
  const propriedades = filho(paragrafo, "w:pPr");
  const estilo = propriedades ? filho(propriedades, "w:pStyle") : null;
  const idEstilo = estilo ? atributo(estilo, "w:val") : null;
  const recuo = propriedades ? filho(propriedades, "w:ind") : null;
  const esquerda = recuo ? atributo(recuo, "w:left") : null;
  const conhecido = idEstilo ? contexto.estilos.has(idEstilo) : false;
  return {
    tipo: "paragrafo",
    emControle,
    estilo: (conhecido ? contexto.estilos.get(idEstilo!) : contexto.estiloPadrao) ?? null,
    recuoEsquerdoEmu: esquerda === null ? null : emuDeTwips(esquerda),
    itens: lerItens(paragrafo, contexto),
    numeracao: lerNumeracao(propriedades, contexto),
    figura: emControle ? null : lerFigura(paragrafo, contexto),
  };
}

// ---------------------------------------------------------------- tabelas

/** O que não entra no texto profundo: o removido e a versão de compatibilidade. */
const FORA_DO_TEXTO = new Set([...REMOVIDOS, "mc:Fallback"]);

/** Parágrafos não vazios de toda a célula (com os de tabelas aninhadas e caixas de texto). */
function textoProfundo(celula: Element, contexto: Contexto): string {
  const textos: string[] = [];
  for (const paragrafo of descendentesFora(celula, "w:p", FORA_DO_TEXTO)) {
    const texto = aparar(textoDosItens(paragrafo, contexto));
    if (texto) textos.push(texto);
  }
  return textos.join("\n");
}

/** A célula é da linha, só que embrulhada: entre as duas há apenas envoltórios de bloco. */
function ehEmbrulhada(celula: Element, linha: Element): boolean {
  let pai = celula.parent;
  if (pai === linha) return false;
  while (pai && pai !== linha) {
    if (!(pai instanceof ElementoDom) || !ENVOLTORIOS_DE_BLOCO.has(pai.name)) return false;
    pai = pai.parent;
  }
  return pai === linha;
}

function lerCelula(celula: Element, linha: Element, contexto: Contexto): CelulaOoxml {
  const propriedades = filho(celula, "w:tcPr");
  const vertical = propriedades ? filho(propriedades, "w:vMerge") : null;
  const horizontal = propriedades ? filho(propriedades, "w:gridSpan") : null;
  // Entram também os parágrafos embrulhados em `w:sdt` dentro da célula.
  const paragrafos = filhosComEnvoltorios(celula, "w:p");
  return {
    direta: celula.parent === linha,
    embrulhada: ehEmbrulhada(celula, linha),
    colunas: horizontal ? colunasValidas(atributo(horizontal, "w:val"), 1, 1) : 1,
    // `w:vMerge` sem valor é continuação.
    mesclaVertical: !vertical ? null : atributo(vertical, "w:val") === "restart" ? "inicio" : "continuacao",
    texto: paragrafos.map((paragrafo) => textoDosItens(paragrafo, contexto)).join("\n"),
    textoProfundo: textoProfundo(celula, contexto),
  };
}

/** Linha removida com o controle de alterações ligado (`w:trPr/w:del`). */
function linhaRemovida(linha: Element): boolean {
  const propriedades = filho(linha, "w:trPr");
  return propriedades !== null && filho(propriedades, "w:del") !== null;
}

function lerTabela(tabela: Element, contexto: Contexto, emControle: boolean): TabelaOoxml {
  // Entram as linhas embrulhadas em `w:sdt` (numa matriz, são componentes) e saem as removidas na
  // revisão.
  const elementos = filhosComEnvoltorios(tabela, "w:tr").filter((linha) => !linhaRemovida(linha));
  let grade = 0;
  const linhas = elementos.map((linha): LinhaOoxml => {
    const propriedades = filho(linha, "w:trPr");
    const antes = propriedades ? filho(propriedades, "w:gridBefore") : null;
    const celulas = descendentes(linha, "w:tc");
    if (celulas.length > contexto.limites.celulasPorLinha) {
      throw new ErroDocx(
        `O arquivo DOCX não pôde ser lido: há uma tabela com mais de ${contexto.limites.celulasPorLinha} células numa linha.`,
      );
    }
    const lidas = celulas.map((celula) => lerCelula(celula, linha, contexto));
    for (const celula of lidas) grade += celula.colunas;
    if (grade > contexto.limites.posicoesPorTabela)
      throw new ErroDocx("O arquivo DOCX não pôde ser lido: há uma tabela grande demais.");
    return { colunasAntes: antes ? colunasValidas(atributo(antes, "w:val"), 0, 0) : 0, celulas: lidas };
  });
  return { tipo: "tabela", emControle, linhas };
}

// ---------------------------------------------------------------- corpo

function lerBlocos(recipiente: Element, contexto: Contexto, emControle: boolean, blocos: BlocoOoxml[]): void {
  for (const item of filhosElementos(recipiente)) {
    if (item.name === "w:p") blocos.push(lerParagrafo(item, contexto, emControle));
    else if (item.name === "w:tbl") blocos.push(lerTabela(item, contexto, emControle));
    else if (item.name === "w:sdt") {
      // Controle de conteúdo no nível do corpo (o Google Docs embrulha tabelas e o sumário assim).
      const conteudo = filho(item, "w:sdtContent");
      if (conteudo) lerBlocos(conteudo, contexto, true, blocos);
    }
  }
}

// ---------------------------------------------------------------- propriedades

const RE_DATA_W3C = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2})(?:T(\d{1,2}):(\d{1,2}):(\d{1,2}))?)?)?$/;
const RE_DESLOCAMENTO = /^([+-])(\d\d):(\d\d)/;
const dois = (numero: number) => String(numero).padStart(2, "0");

/**
 * Data W3CDTF (`2003-12-31T10:14:55Z`, `…-08:00`, `2003-12`) em UTC. Só um deslocamento de seis
 * caracteres é aplicado; frações de segundo e `Z` são ignorados.
 */
export function dataW3cEmUtc(texto: string): string | null {
  const m = RE_DATA_W3C.exec(texto.slice(0, 19));
  if (!m) return null;
  let instante = Date.UTC(
    Number(m[1]),
    Number(m[2] ?? 1) - 1,
    Number(m[3] ?? 1),
    Number(m[4] ?? 0),
    Number(m[5] ?? 0),
    Number(m[6] ?? 0),
  );
  const resto = texto.slice(19);
  if (resto.length === 6) {
    const deslocamento = RE_DESLOCAMENTO.exec(resto);
    if (!deslocamento) return null;
    const minutos = Number(deslocamento[2]) * 60 + Number(deslocamento[3]);
    instante += (deslocamento[1] === "+" ? -1 : 1) * minutos * 60_000;
  }
  if (Number.isNaN(instante)) return null;
  const data = DateTime.toPartsUtc(DateTime.makeUnsafe(instante));
  return (
    `${String(data.year).padStart(4, "0")}-${dois(data.month)}-${dois(data.day)}` +
    `T${dois(data.hour)}:${dois(data.minute)}:${dois(data.second)}+00:00`
  );
}

function lerPropriedades(raiz: Element | null): PropriedadesOoxml {
  const texto = (nome: string) => {
    const elemento = raiz ? filho(raiz, nome) : null;
    return elemento ? textoInicial(elemento) : "";
  };
  const data = (nome: string) => {
    const valor = texto(nome);
    return valor ? dataW3cEmUtc(valor) : null;
  };
  return {
    titulo: texto("dc:title"),
    autor: texto("dc:creator"),
    assunto: texto("dc:subject"),
    palavrasChave: texto("cp:keywords"),
    criadoEm: data("dcterms:created"),
    modificadoEm: data("dcterms:modified"),
    modificadoPor: texto("cp:lastModifiedBy"),
  };
}

// ---------------------------------------------------------------- documento

/** Lê o pacote já aberto; exposto para quem também precisa dos binários (a figura). */
export function lerPacote(pacote: PacoteOoxml, opcoes: OpcoesLeitura = {}): DocumentoOoxml {
  const principal = pacote.partePorTipo("", RELACAO_DOCUMENTO);
  const raiz = principal ? pacote.xml(principal) : null;
  const corpo = raiz ? filho(raiz, "w:body") : null;
  if (!principal || !corpo) {
    throw new ErroDocx("O arquivo não é um documento do Word: o pacote não tem documento principal.");
  }
  const parteNumeracao = pacote.partePorTipo(principal, RELACAO_NUMERACAO);
  const parteEstilos = pacote.partePorTipo(principal, RELACAO_ESTILOS);
  const partePropriedades = pacote.partePorTipo("", RELACAO_PROPRIEDADES);
  const contexto: Contexto = {
    relacoes: pacote.relacoes(principal),
    limites: pacote.limites,
    ...lerEstilos(parteEstilos ? pacote.xml(parteEstilos) : null),
    numeracoes: lerNumeracoes(parteNumeracao ? pacote.xml(parteNumeracao) : null),
  };
  const blocos: BlocoOoxml[] = [];
  lerBlocos(corpo, contexto, false, blocos);
  return { blocos, propriedades: lerPropriedades(partePropriedades ? pacote.xml(partePropriedades) : null) };
}

/** Lê os bytes de um `.docx`. */
export function lerDocx(bytes: Uint8Array, opcoes: OpcoesLeitura = {}): DocumentoOoxml {
  return lerPacote(new PacoteOoxml(bytes, opcoes.limites), opcoes);
}
