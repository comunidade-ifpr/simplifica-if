/**
 * XML do OOXML como árvore (`htmlparser2` em `xmlMode`), com nomes canônicos.
 *
 * O `htmlparser2` não resolve namespaces: devolve o nome como está no arquivo (`w:p`). Quase todo
 * DOCX usa os prefixos convencionais, mas o prefixo é escolha de quem grava; o que identifica o
 * elemento é a URI. `analisarXml` resolve as declarações `xmlns` e renomeia elementos e atributos
 * para o prefixo convencional da URI (`w:`, `r:`, `a:`…), de modo que o resto do leitor compara
 * nomes simples. Namespace desconhecido vira `{uri}nome`, que não colide com os convencionais.
 *
 * As URIs do formato "Strict Open XML" (a outra opção de DOCX do "Salvar como" do Word) levam aos
 * mesmos prefixos: o conteúdo é o mesmo, só o namespace muda.
 */
import { type ChildNode, DomHandler, Element, isCDATA, isTag, isText } from "domhandler";
import { Parser } from "htmlparser2";
import { ErroDocx } from "./erro.ts";
import { LIMITES_PADRAO, type LimitesDoPacote } from "./limites.ts";

const PREFIXO_DA_URI: Record<string, string> = {
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main": "w",
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships": "r",
  "http://schemas.openxmlformats.org/drawingml/2006/main": "a",
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing": "wp",
  "http://schemas.openxmlformats.org/drawingml/2006/picture": "pic",
  "http://schemas.openxmlformats.org/markup-compatibility/2006": "mc",
  "urn:schemas-microsoft-com:vml": "v",
  "urn:schemas-microsoft-com:office:office": "o",
  "http://schemas.openxmlformats.org/package/2006/relationships": "rel",
  "http://schemas.openxmlformats.org/package/2006/metadata/core-properties": "cp",
  "http://purl.org/dc/elements/1.1/": "dc",
  "http://purl.org/dc/terms/": "dcterms",
  "http://www.w3.org/XML/1998/namespace": "xml",
  // Strict Open XML.
  "http://purl.oclc.org/ooxml/wordprocessingml/main": "w",
  "http://purl.oclc.org/ooxml/officeDocument/relationships": "r",
  "http://purl.oclc.org/ooxml/drawingml/main": "a",
  "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing": "wp",
  "http://purl.oclc.org/ooxml/drawingml/picture": "pic",
};

type Escopo = ReadonlyMap<string, string>;
const ESCOPO_INICIAL: Escopo = new Map([["xml", "http://www.w3.org/XML/1998/namespace"]]);

function nomeCanonico(nome: string, escopo: Escopo, elemento: boolean): string {
  const separador = nome.indexOf(":");
  const prefixo = separador < 0 ? "" : nome.slice(0, separador);
  // Atributo sem prefixo não tem namespace (o namespace padrão só vale para elementos).
  if (!prefixo && !elemento) return nome;
  const uri = escopo.get(prefixo);
  if (!uri) return nome;
  const local = separador < 0 ? nome : nome.slice(separador + 1);
  const canonico = PREFIXO_DA_URI[uri];
  return canonico ? `${canonico}:${local}` : `{${uri}}${local}`;
}

function canonizar(elemento: Element, herdado: Escopo): void {
  let escopo = herdado;
  for (const [nome, valor] of Object.entries(elemento.attribs)) {
    if (nome !== "xmlns" && !nome.startsWith("xmlns:")) continue;
    if (escopo === herdado) escopo = new Map(herdado);
    (escopo as Map<string, string>).set(nome === "xmlns" ? "" : nome.slice(6), valor);
  }
  elemento.name = nomeCanonico(elemento.name, escopo, true);
  let atributos: Record<string, string> | null = null;
  for (const nome of Object.keys(elemento.attribs)) {
    if (!nome.includes(":") || nome.startsWith("xmlns:")) continue;
    const canonico = nomeCanonico(nome, escopo, false);
    if (canonico === nome) continue;
    atributos ??= { ...elemento.attribs };
    delete atributos[nome];
    atributos[canonico] = elemento.attribs[nome]!;
  }
  if (atributos) elemento.attribs = atributos;
  for (const filho of elemento.children) if (isTag(filho)) canonizar(filho, escopo);
}

/** Decodifica o XML de uma parte: UTF-16 quando há BOM, senão UTF-8. */
export function decodificarXml(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Elemento raiz de um XML, com nomes canônicos; `null` quando não há elemento. `parte` é o nome
 * usado nas mensagens de erro.
 *
 * O `htmlparser2` é tolerante: fecha sozinho o que ficou aberto e segue em frente. Aqui isso é
 * erro (`ErroDocx`): um XML truncado viraria um documento pela metade, convertido sem aviso.
 * Entidades declaradas no próprio arquivo (`<!ENTITY …>`) não são expandidas nem buscadas.
 */
export function analisarXml(
  fonte: Uint8Array | string,
  parte = "XML",
  limites: Pick<LimitesDoPacote, "elementosPorParte" | "profundidadeDoXml"> = LIMITES_PADRAO,
  opcoes: { indices?: boolean } = {},
): Element | null {
  const texto = typeof fonte === "string" ? fonte : decodificarXml(fonte);
  // Com `indices`, cada elemento guarda `startIndex` e `endIndex` no texto de entrada: quem edita o
  // XML (os comentários) insere marcas nessas posições sem regravar o resto da parte.
  const arvore = opcoes.indices
    ? new DomHandler(undefined, { withStartIndices: true, withEndIndices: true })
    : new DomHandler();
  let profundidade = 0;
  let elementos = 0;
  const analisador: Parser = new Parser(
    {
      onparserinit: (parser) => arvore.onparserinit(parser),
      onopentag: (nome, atributos) => {
        profundidade += 1;
        elementos += 1;
        if (elementos > limites.elementosPorParte) {
          throw new ErroDocx(
            `O arquivo DOCX é grande demais para ser lido: ${parte} tem mais de ${limites.elementosPorParte / 1000} mil elementos.`,
          );
        }
        if (profundidade > limites.profundidadeDoXml) {
          throw new ErroDocx(`O arquivo DOCX não pôde ser lido: ${parte} tem elementos aninhados demais.`);
        }
        arvore.onopentag(nome, atributos);
      },
      onclosetag: (_nome, implicito) => {
        // O analisador marca como implícito o fechamento da tag autofechada (`<w:b/>`), o do
        // elemento que ficou aberto até o fim e o do que foi fechado pela tag de um ancestral. Só
        // o primeiro é XML bem formado, e é o único que termina em `/>`.
        const autofechada = texto[analisador.endIndex] === ">" && texto[analisador.endIndex - 1] === "/";
        if (implicito && !autofechada) {
          throw new ErroDocx(`O arquivo DOCX está corrompido: ${parte} não é um XML bem formado.`);
        }
        profundidade -= 1;
        arvore.onclosetag();
      },
      ontext: (dados) => arvore.ontext(dados),
      oncdatastart: () => arvore.oncdatastart(),
      oncdataend: () => arvore.oncdataend(),
      onend: () => arvore.onend(),
    },
    { xmlMode: true, decodeEntities: true },
  );
  analisador.end(texto);
  const raiz = arvore.root.children.find((no): no is Element => isTag(no));
  if (!raiz) return null;
  canonizar(raiz, ESCOPO_INICIAL);
  return raiz;
}

/** Filhos diretos com o nome dado, na ordem do documento. */
export function filhos(elemento: Element, nome: string): Element[] {
  const saida: Element[] = [];
  for (const no of elemento.children) if (isTag(no) && no.name === nome) saida.push(no);
  return saida;
}

/** Filhos diretos que são elementos. */
export function filhosElementos(elemento: Element): Element[] {
  return elemento.children.filter((no): no is Element => isTag(no));
}

/** Primeiro filho direto com o nome dado. */
export function filho(elemento: Element, nome: string): Element | null {
  for (const no of elemento.children) if (isTag(no) && no.name === nome) return no;
  return null;
}

/** Descendentes (sem o próprio elemento) com o nome dado, na ordem do documento. */
export function descendentes(elemento: Element, nome: string): Element[] {
  const saida: Element[] = [];
  const visitar = (no: Element): void => {
    for (const item of no.children) {
      if (!isTag(item)) continue;
      if (item.name === nome) saida.push(item);
      visitar(item);
    }
  };
  visitar(elemento);
  return saida;
}

/** Primeiro descendente com o nome dado, na ordem do documento. */
export function descendente(elemento: Element, nome: string): Element | null {
  for (const item of elemento.children) {
    if (!isTag(item)) continue;
    if (item.name === nome) return item;
    const achado = descendente(item, nome);
    if (achado) return achado;
  }
  return null;
}

/** Valor do atributo, ou `null` quando ausente. */
export function atributo(elemento: Element, nome: string): string | null {
  return Object.hasOwn(elemento.attribs, nome) ? elemento.attribs[nome]! : null;
}

function textoDoNo(no: ChildNode): string | null {
  if (isText(no)) return no.data;
  if (isCDATA(no)) return no.children.map((item) => (isText(item) ? item.data : "")).join("");
  return null;
}

/**
 * Texto de um elemento até o primeiro elemento filho (o de `w:t` e o das propriedades do
 * documento).
 */
export function textoInicial(elemento: Element): string {
  let saida = "";
  for (const no of elemento.children) {
    const texto = textoDoNo(no);
    if (texto === null) {
      if (isTag(no)) break;
      continue;
    }
    saida += texto;
  }
  return saida;
}
