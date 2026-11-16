/**
 * XML do OOXML como árvore (`htmlparser2` em `xmlMode`), com nomes canônicos.
 *
 * O `htmlparser2` não resolve namespaces: devolve o nome como está no arquivo (`w:p`). Quase todo
 * DOCX usa os prefixos convencionais, mas o prefixo é escolha de quem grava; o que identifica o
 * elemento é a URI. `analisarXml` resolve as declarações `xmlns` e renomeia elementos e atributos
 * para o prefixo convencional da URI (`w:`, `r:`, `a:`…), de modo que o resto do leitor compara
 * nomes simples. Namespace desconhecido vira `{uri}nome`, que não colide com os convencionais.
 */
import { type ChildNode, Element, isCDATA, isTag, isText } from "domhandler";
import { parseDocument } from "htmlparser2";

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
function decodificar(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}

/** Elemento raiz de um XML, com nomes canônicos; `null` quando não há elemento. */
export function analisarXml(fonte: Uint8Array | string): Element | null {
  const texto = typeof fonte === "string" ? fonte : decodificar(fonte);
  const documento = parseDocument(texto, { xmlMode: true, decodeEntities: true });
  const raiz = documento.children.find((no): no is Element => isTag(no));
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
 * Texto de um elemento até o primeiro elemento filho (o `.text` do lxml, que o python-docx usa
 * para `w:t` e para as propriedades do documento).
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
