/**
 * Eventos do `html.parser.HTMLParser(convert_charrefs=False)` do Python 3.14,
 * produzidos pelo `Tokenizer` do `htmlparser2`.
 *
 * O `Parser` do `htmlparser2` fecha tags implicitamente e descarta fechamentos
 * sem par (`<em>a<strong>b</em>c</strong>`), e o `HTMLParser` do Python não:
 * ele só tokeniza. Por isso aqui se usa o `Tokenizer`, sem decodificar
 * entidades, e o texto é repartido como o Python faz com
 * `convert_charrefs=False`:
 * - `&nome;` vira `entidade(nome)` e `&#x27;` vira `referencia("x27")`, e o
 *   texto em volta chega em pedaços separados (`"a "`, `amp`, `" b"`);
 * - `&` ou `<` soltos chegam como pedaços próprios de texto;
 * - dentro de `<title>` e `<textarea>` as referências também são separadas, e
 *   em `<script>` e `<style>` o conteúdo chega cru;
 * - os nomes de tag e de atributo vêm em minúsculas, e os valores dos
 *   atributos com as referências resolvidas como em `_unescape_attrvalue`.
 *
 * A equivalência vale para HTML bem formado (o que o relatório gera); casos
 * patológicos de tokenização (atributos com `/`, tags incompletas no fim,
 * comentários malformados) não foram portados.
 */
import { DecodingMode, EntityDecoder, htmlDecodeTree } from "entities/decode";
import { Tokenizer } from "htmlparser2";
import { caractereDeReferenciaNumerica } from "@simplifica-if/kb/primitivas/html";

export type AtributoHtml = readonly [nome: string, valor: string | null];

export type ManipuladorHtml = {
  inicio(tag: string, atributos: AtributoHtml[]): void;
  inicioFim(tag: string, atributos: AtributoHtml[]): void;
  fim(tag: string): void;
  texto(dados: string): void;
  entidade(nome: string): void;
  referencia(nome: string): void;
  comentario(dados: string): void;
  declaracao(dados: string): void;
  /** `handle_pi` (`<?...>`); o Python ignora por padrão. */
  instrucao?(dados: string): void;
  /** `unknown_decl` (`<![CDATA[...]]>`); o Python ignora por padrão. */
  declaracaoDesconhecida?(dados: string): void;
};

const RE_REFERENCIA_ATRIBUTO = /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*)[;=]?/g;

/** Texto de uma referência nomeada (`&amp;`, `&eacute`) quando ela está, inteira, na tabela HTML5; senão `null`. */
function referenciaNomeada(referencia: string): string | null {
  let consumido = 0;
  let saida = "";
  const decodificador = new EntityDecoder(htmlDecodeTree, (codigo, total) => {
    saida += String.fromCodePoint(codigo);
    consumido = total;
  });
  decodificador.startEntity(DecodingMode.Legacy);
  if (decodificador.write(referencia, 1) < 0) decodificador.end();
  return consumido === referencia.length ? saida : null;
}

/** `_unescape_attrvalue` de `html/parser.py`: resolve referências em valores de atributo. */
export function desescaparAtributo(valor: string): string {
  return valor.replace(RE_REFERENCIA_ATRIBUTO, (referencia: string, corpo: string) => {
    if (corpo.startsWith("#")) {
      const hexadecimal = corpo[1] === "x" || corpo[1] === "X";
      const caractere = caractereDeReferenciaNumerica(corpo.slice(hexadecimal ? 2 : 1), hexadecimal);
      return referencia.endsWith("=") ? `${caractere}=` : caractere;
    }
    if (referencia.endsWith("=")) return referencia;
    return referenciaNomeada(referencia) ?? referencia;
  });
}

const RE_CHARREF = /&#(?:[0-9]+|[xX][0-9a-fA-F]+)[^0-9a-fA-F]/y;
const RE_CHARREF_INCOMPLETA = /&#(?:[0-9]|[xX][0-9a-fA-F])/y;
const RE_ENTITYREF = /&([a-zA-Z][-.a-zA-Z0-9]*)[^a-zA-Z0-9]/y;
const RE_ENTITYREF_INCOMPLETA = /&[a-zA-Z#]/y;

function casar(re: RegExp, html: string, posicao: number): RegExpExecArray | null {
  re.lastIndex = posicao;
  return re.exec(html);
}

/**
 * Reparte o texto `html[inicio:fim]` como o laço `goahead` do Python com
 * `convert_charrefs=False`. As referências são casadas sobre o documento
 * inteiro, porque o Python olha o caractere seguinte ao fim do texto.
 */
function repartirTexto(html: string, inicio: number, fim: number, m: ManipuladorHtml): void {
  let i = inicio;
  while (i < fim) {
    let j = i;
    while (j < fim && html[j] !== "&" && html[j] !== "<") j += 1;
    if (i < j) m.texto(html.slice(i, j));
    i = j;
    if (i >= fim) break;
    if (html[i] === "<") {
      m.texto("<");
      i += 1;
      continue;
    }
    if (html.startsWith("&#", i)) {
      const ref = casar(RE_CHARREF, html, i);
      if (ref) {
        m.referencia(ref[0].slice(2, -1));
        i += ref[0].length;
        if (ref[0].at(-1) !== ";") i -= 1;
        continue;
      }
      if (casar(RE_CHARREF_INCOMPLETA, html, i) && fim === html.length) {
        m.referencia(html.slice(i + 2, fim));
        i = fim;
        continue;
      }
      m.texto("&#");
      i += 2;
      continue;
    }
    const ref = casar(RE_ENTITYREF, html, i);
    if (ref) {
      m.entidade(ref[1]!);
      i += ref[0].length;
      if (ref[0].at(-1) !== ";") i -= 1;
      continue;
    }
    if (casar(RE_ENTITYREF_INCOMPLETA, html, i) && fim === html.length) {
      m.entidade(html.slice(i + 1, fim));
      i = fim;
      continue;
    }
    m.texto("&");
    i += 1;
  }
}

const SEM_REFERENCIAS = new Set(["script", "style", "xmp", "iframe", "noembed", "noframes", "plaintext"]);

/** `HTMLParser(convert_charrefs=False).feed(html); close()`, entregando os eventos a `m`. */
export function percorrerHtml(html: string, m: ManipuladorHtml): void {
  let textoInicio = -1;
  let textoFim = -1;
  let tagAtual = "";
  let atributos: Array<[string, string | null]> = [];
  let nomeAtributo = "";
  let valorAtributo = "";
  let emTagCrua = false;

  const despejarTexto = () => {
    if (textoInicio < 0) return;
    if (emTagCrua) m.texto(html.slice(textoInicio, textoFim));
    else repartirTexto(html, textoInicio, textoFim, m);
    textoInicio = -1;
  };

  const tokenizador = new Tokenizer(
    { decodeEntities: false },
    {
      ontext(inicio, fim) {
        if (textoInicio < 0) textoInicio = inicio;
        textoFim = fim;
      },
      ontextentity() {
        throw new Error("entidade decodificada inesperada");
      },
      onattribentity() {
        throw new Error("entidade de atributo decodificada inesperada");
      },
      onopentagname(inicio, fim) {
        despejarTexto();
        tagAtual = html.slice(inicio, fim).toLowerCase();
        atributos = [];
      },
      onattribname(inicio, fim) {
        nomeAtributo = html.slice(inicio, fim).toLowerCase();
        valorAtributo = "";
      },
      onattribdata(inicio, fim) {
        valorAtributo += html.slice(inicio, fim);
      },
      onattribend(aspas) {
        // QuoteType.NoValue (0): atributo sem `=`, valor `None` no Python.
        const valor = aspas === 0 ? null : valorAtributo ? desescaparAtributo(valorAtributo) : valorAtributo;
        atributos.push([nomeAtributo, valor]);
      },
      onopentagend() {
        m.inicio(tagAtual, atributos);
        emTagCrua = SEM_REFERENCIAS.has(tagAtual);
      },
      onselfclosingtag() {
        m.inicioFim(tagAtual, atributos);
      },
      onclosetag(inicio, fim) {
        despejarTexto();
        m.fim(html.slice(inicio, fim).toLowerCase());
        emTagCrua = false;
      },
      oncomment(inicio, fim) {
        despejarTexto();
        m.comentario(html.slice(inicio, fim));
      },
      oncdata(inicio, fim) {
        despejarTexto();
        m.declaracaoDesconhecida?.(`CDATA[${html.slice(inicio, fim)}`);
      },
      ondeclaration(inicio, fim) {
        despejarTexto();
        m.declaracao(html.slice(inicio, fim));
      },
      onprocessinginstruction(inicio, fim) {
        despejarTexto();
        m.instrucao?.(html.slice(inicio, fim));
      },
      onend() {
        despejarTexto();
      },
    },
  );
  tokenizador.write(html);
  tokenizador.end();
}
