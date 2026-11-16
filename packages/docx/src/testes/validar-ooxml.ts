/**
 * Validador estrutural de DOCX para os testes: confere as regras do OOXML que, violadas, fazem o Word
 * recusar o arquivo ("O Word encontrou conteúdo ilegível…") ou nem abri-lo, e que o LibreOffice e os
 * leitores tolerantes (inclusive o nosso) deixam passar. Não é um validador de esquema completo: cobre
 * o que já quebrou ou costuma quebrar a abertura de arquivo gerado por programa.
 *
 * Regras (ECMA-376, Parte 1, §17 e Parte 2, e o comportamento do Word):
 *   - pacote: `[Content_Types].xml` dá tipo a toda parte e não aponta parte inexistente; toda relação
 *     interna aponta parte existente; ids de relação únicos; o pacote tem o documento principal;
 *   - toda referência a relação (`r:id`, `r:embed`, `r:link`…) existe nas relações da parte: um
 *     hiperlink com `r:id` sem relação impede o Word de abrir o documento;
 *   - XML bem formado, todo prefixo usado declarado, `mc:Ignorable` e `mc:Choice/@Requires` só com
 *     prefixos declarados, `mc:AlternateContent` com `mc:Choice` antes do `mc:Fallback`;
 *   - o corpo, cada célula (`w:tc`), cada caixa de texto, comentário, cabeçalho e rodapé terminam num
 *     parágrafo (nunca numa tabela), e o `w:sectPr` do corpo é o último filho;
 *   - toda tabela tem `w:tblPr` e `w:tblGrid` com colunas que bastam para as linhas, e toda linha tem
 *     célula; caixa de texto não contém caixa de texto. A falta de `w:tblGrid` o Word tolera (as
 *     amostras 1 a 3 da revisão prévia abriram sem ela), mas o esquema a exige e o Word sempre a grava:
 *     fica como regra para que os sintéticos se pareçam com o que circula;
 *   - comentários: ids únicos, cada comentário com uma referência (`w:commentReference`) e, se tiver
 *     intervalo, início antes do fim; nenhuma marca sem comentário;
 *   - `wp:docPr/@id` único no documento (fora do conteúdo de reserva, `mc:Fallback`).
 *
 * Fica em `src/testes/` para que os testes de outros pacotes o importem; não é usado em produção.
 */
import type { Element } from "domhandler";
import { strFromU8, unzipSync } from "fflate";
import { Parser } from "htmlparser2";
import { analisarXml, atributo, descendentes, filho, filhos, filhosElementos } from "../xml.ts";

const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const TIPO_DOCUMENTO = `${NS_R}/officeDocument`;
const TIPO_COMENTARIOS = `${NS_R}/comments`;

type Relacao = { id: string; tipo: string; alvo: string; externa: boolean };

const atributosDe = (tag: string): Record<string, string> =>
  Object.fromEntries([...tag.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)].map(([, nome, valor]) => [nome!, valor!]));

/** `word/_rels/document.xml.rels` → `word/document.xml`; `_rels/.rels` → `` (o pacote). */
function origemDasRelacoes(nome: string): string {
  const pasta = nome.slice(0, nome.lastIndexOf("_rels/"));
  return pasta + nome.slice(nome.lastIndexOf("/") + 1).replace(/\.rels$/, "");
}

const relacoesDe = (origem: string) => {
  const corte = origem.lastIndexOf("/");
  return `${origem.slice(0, corte + 1)}_rels/${origem.slice(corte + 1)}.rels`;
};

/** Resolve o alvo de uma relação interna a partir da pasta da parte de origem. */
function resolverAlvo(origem: string, alvo: string): string {
  const base = alvo.startsWith("/") ? [] : origem.split("/").slice(0, -1);
  for (const segmento of decodeURIComponent(alvo).split("/")) {
    if (segmento === "" || segmento === ".") continue;
    if (segmento === "..") base.pop();
    else base.push(segmento);
  }
  return base.join("/");
}

/** Prefixos e namespaces: o que o Word confere antes de interpretar qualquer elemento. */
function problemasDeNamespace(parte: string, texto: string): string[] {
  const problemas = new Set<string>();
  const escopos: Map<string, string>[] = [new Map([["xml", "http://www.w3.org/XML/1998/namespace"]])];
  // Por elemento aberto: se é um mc:AlternateContent, e os nomes dos filhos dele.
  const pilha: { alternativa: boolean; filhos: string[] }[] = [];
  const declarado = (prefixo: string) => escopos.at(-1)!.has(prefixo);
  const prefixo = (nome: string) => (nome.includes(":") ? nome.slice(0, nome.indexOf(":")) : "");
  const analisador = new Parser(
    {
      onopentag: (nome, atributos) => {
        const escopo = new Map(escopos.at(-1)!);
        for (const [chave, valor] of Object.entries(atributos)) {
          if (chave === "xmlns") escopo.set("", valor);
          else if (chave.startsWith("xmlns:")) escopo.set(chave.slice(6), valor);
        }
        escopos.push(escopo);
        const doElemento = prefixo(nome);
        if (doElemento && !declarado(doElemento))
          problemas.add(`${parte}: prefixo "${doElemento}:" sem declaração (${nome})`);
        for (const [chave, valor] of Object.entries(atributos)) {
          const doAtributo = prefixo(chave);
          if (!doAtributo || doAtributo === "xmlns") continue;
          if (!declarado(doAtributo))
            problemas.add(`${parte}: prefixo "${doAtributo}:" sem declaração (${nome}/@${chave})`);
          if (escopo.get(doAtributo) !== NS_MC) continue;
          const local = chave.slice(doAtributo.length + 1);
          if (local !== "Ignorable" && local !== "ProcessContent" && local !== "MustUnderstand") continue;
          for (const item of valor.split(/\s+/).filter(Boolean)) {
            const citado = prefixo(item) || item;
            if (!declarado(citado)) problemas.add(`${parte}: mc:${local} cita o prefixo "${citado}", sem declaração`);
          }
        }
        const doMc = escopo.get(doElemento) === NS_MC;
        const local = nome.slice(nome.indexOf(":") + 1);
        const pai = pilha.at(-1);
        if (pai?.alternativa) pai.filhos.push(doMc ? local : nome);
        if (doMc && local === "Choice")
          for (const requerido of (atributos.Requires ?? "").split(/\s+/).filter(Boolean))
            if (!declarado(requerido))
              problemas.add(`${parte}: mc:Choice Requires="${requerido}" sem declaração do prefixo`);
        pilha.push({ alternativa: doMc && local === "AlternateContent", filhos: [] });
      },
      onclosetag: () => {
        escopos.pop();
        const { alternativa, filhos: nomes } = pilha.pop()!;
        if (!alternativa) return;
        if (!nomes.includes("Choice")) problemas.add(`${parte}: mc:AlternateContent sem mc:Choice`);
        if (nomes.some((item) => item !== "Choice" && item !== "Fallback"))
          problemas.add(`${parte}: mc:AlternateContent com filho que não é mc:Choice nem mc:Fallback`);
        const fallback = nomes.indexOf("Fallback");
        if (fallback >= 0 && fallback !== nomes.length - 1)
          problemas.add(`${parte}: mc:Fallback fora do fim do mc:AlternateContent`);
      },
    },
    { xmlMode: true },
  );
  analisador.end(texto);
  return [...problemas];
}

/** Marcas de intervalo que podem aparecer no nível de bloco sem contar como conteúdo. */
const MARCAS = new Set([
  "w:bookmarkStart",
  "w:bookmarkEnd",
  "w:commentRangeStart",
  "w:commentRangeEnd",
  "w:moveFromRangeStart",
  "w:moveFromRangeEnd",
  "w:moveToRangeStart",
  "w:moveToRangeEnd",
  "w:permStart",
  "w:permEnd",
  "w:proofErr",
  "w:sectPr",
  "w:tcPr",
  "w:tblPrEx",
]);

/** O último bloco de um conteiner, atravessando controles de conteúdo (`w:sdt`) e `w:customXml`. */
function ultimoBloco(conteiner: Element): Element | null {
  const blocos = filhosElementos(conteiner).filter((item) => !MARCAS.has(item.name));
  const ultimo = blocos.at(-1) ?? null;
  if (ultimo?.name === "w:sdt") {
    const conteudo = filho(ultimo, "w:sdtContent");
    return conteudo ? ultimoBloco(conteudo) : ultimo;
  }
  if (ultimo?.name === "w:customXml") return ultimoBloco(ultimo);
  return ultimo;
}

/** Filhos de um conteiner de linhas ou células, atravessando `w:sdt`/`w:sdtContent` e `w:customXml`. */
function filhosAtravessando(no: Element, nome: string): Element[] {
  const saida: Element[] = [];
  for (const item of filhosElementos(no)) {
    if (item.name === nome) saida.push(item);
    else if (item.name === "w:sdt") {
      const conteudo = filho(item, "w:sdtContent");
      if (conteudo) saida.push(...filhosAtravessando(conteudo, nome));
    } else if (item.name === "w:customXml") saida.push(...filhosAtravessando(item, nome));
  }
  return saida;
}

const valorInteiro = (elemento: Element | null) => (elemento ? Number(atributo(elemento, "w:val") ?? 1) : 0);

function problemasDeConteudo(parte: string, raiz: Element): string[] {
  const problemas: string[] = [];
  const terminaEmParagrafo = (conteiner: Element, onde: string) => {
    const ultimo = ultimoBloco(conteiner);
    if (ultimo?.name !== "w:p")
      problemas.push(`${parte}: ${onde} termina em ${ultimo ? ultimo.name : "nada"}, não num parágrafo (w:p)`);
  };
  const corpo = filho(raiz, "w:body");
  if (corpo) {
    terminaEmParagrafo(corpo, "o corpo");
    const filhos = filhosElementos(corpo);
    const secao = filhos.findIndex((item) => item.name === "w:sectPr");
    if (secao >= 0 && secao !== filhos.length - 1) problemas.push(`${parte}: w:sectPr do corpo não é o último filho`);
  }
  if (raiz.name === "w:hdr" || raiz.name === "w:ftr") terminaEmParagrafo(raiz, raiz.name);
  // Só nas partes de comentários e notas: em `settings.xml`, `w:footnote` é uma referência vazia.
  const notas = { "w:comments": "w:comment", "w:footnotes": "w:footnote", "w:endnotes": "w:endnote" }[raiz.name];
  if (notas) for (const item of filhos(raiz, notas)) terminaEmParagrafo(item, `${notas} ${atributo(item, "w:id")}`);
  descendentes(raiz, "w:tbl").forEach((tabela, indice) => {
    const onde = `a tabela ${indice + 1}`;
    const elementos = filhosElementos(tabela);
    if (elementos[0]?.name !== "w:tblPr") problemas.push(`${parte}: ${onde} não começa com w:tblPr`);
    const grade = filho(tabela, "w:tblGrid");
    if (!grade || elementos[1] !== grade) problemas.push(`${parte}: ${onde} sem w:tblGrid logo depois de w:tblPr`);
    const linhas = filhosAtravessando(tabela, "w:tr");
    if (!linhas.length) problemas.push(`${parte}: ${onde} sem linhas (w:tr)`);
    let colunas = 0;
    linhas.forEach((linha, numero) => {
      const celulas = filhosAtravessando(linha, "w:tc");
      if (!celulas.length) problemas.push(`${parte}: ${onde}, linha ${numero + 1}, sem células (w:tc)`);
      const propriedades = filho(linha, "w:trPr");
      let ocupadas = valorInteiro(propriedades && filho(propriedades, "w:gridBefore"));
      ocupadas += valorInteiro(propriedades && filho(propriedades, "w:gridAfter"));
      for (const celula of celulas) {
        const tcPr = filho(celula, "w:tcPr");
        ocupadas += Math.max(1, valorInteiro(tcPr && filho(tcPr, "w:gridSpan")));
      }
      colunas = Math.max(colunas, ocupadas);
    });
    const declaradas = grade ? filhos(grade, "w:gridCol").length : 0;
    if (grade && declaradas < colunas)
      problemas.push(`${parte}: ${onde} ocupa ${colunas} colunas, mas w:tblGrid declara ${declaradas}`);
  });
  descendentes(raiz, "w:tc").forEach((celula, indice) => terminaEmParagrafo(celula, `a célula ${indice + 1}`));
  descendentes(raiz, "w:txbxContent").forEach((caixa, indice) => {
    terminaEmParagrafo(caixa, `a caixa de texto ${indice + 1}`);
    if (descendentes(caixa, "w:txbxContent").length)
      problemas.push(`${parte}: a caixa de texto ${indice + 1} contém outra caixa de texto`);
  });
  return problemas;
}

/** Problemas estruturais do DOCX, em português; lista vazia quando o Word deve abri-lo sem reparo. */
export function problemasOoxml(bytes: Uint8Array): string[] {
  const problemas: string[] = [];
  const partes = unzipSync(bytes);
  const nomes = Object.keys(partes).filter((nome) => !nome.endsWith("/"));
  const texto = (nome: string) => strFromU8(partes[nome]!);

  // Tipos de conteúdo.
  if (!partes["[Content_Types].xml"]) return ["pacote sem [Content_Types].xml"];
  const tipos = texto("[Content_Types].xml");
  const padroes = new Set(
    [...tipos.matchAll(/<Default\b[^>]*>/g)].map((tag) => (atributosDe(tag[0]).Extension ?? "").toLowerCase()),
  );
  const sobrescritas = new Set(
    [...tipos.matchAll(/<Override\b[^>]*>/g)].map((tag) => (atributosDe(tag[0]).PartName ?? "").toLowerCase()),
  );
  for (const nome of nomes) {
    if (nome === "[Content_Types].xml") continue;
    const extensao = nome.slice(nome.lastIndexOf(".") + 1).toLowerCase();
    if (!sobrescritas.has(`/${nome}`.toLowerCase()) && !padroes.has(extensao))
      problemas.push(`[Content_Types].xml não dá tipo a ${nome}`);
  }
  const existentes = new Set(nomes.map((nome) => nome.toLowerCase()));
  for (const nome of sobrescritas)
    if (!existentes.has(nome.slice(1))) problemas.push(`[Content_Types].xml declara ${nome}, que não está no pacote`);

  // Relações.
  const relacoes = new Map<string, Map<string, Relacao>>();
  for (const nome of nomes.filter((item) => item.endsWith(".rels"))) {
    const origem = origemDasRelacoes(nome);
    const mapa = new Map<string, Relacao>();
    for (const [tag] of texto(nome).matchAll(/<Relationship\b[^>]*>/g)) {
      const { Id: id = "", Type: tipo = "", Target: alvo = "", TargetMode: modo } = atributosDe(tag);
      if (mapa.has(id)) problemas.push(`${nome}: id de relação repetido (${id})`);
      const relacao = { id, tipo, alvo, externa: modo === "External" };
      mapa.set(id, relacao);
      if (!relacao.externa && !existentes.has(resolverAlvo(origem, alvo).toLowerCase()))
        problemas.push(`${nome}: a relação ${id} aponta ${alvo}, que não está no pacote`);
    }
    relacoes.set(origem, mapa);
  }
  const principal = [...(relacoes.get("")?.values() ?? [])].find((relacao) => relacao.tipo === TIPO_DOCUMENTO);
  if (!principal) problemas.push("_rels/.rels sem a relação do documento principal");
  const partePrincipal = principal ? resolverAlvo("", principal.alvo) : null;

  // Cada parte XML: bem formada, namespaces, referências a relações e regras de conteúdo.
  for (const nome of nomes.filter((item) => /\.(xml|rels)$/i.test(item))) {
    const xml = texto(nome);
    let raiz: Element | null;
    try {
      raiz = analisarXml(xml, nome);
    } catch (erro) {
      problemas.push(`${nome}: ${(erro as Error).message}`);
      continue;
    }
    problemas.push(...problemasDeNamespace(nome, xml));
    if (!raiz || nome.endsWith(".rels") || nome === "[Content_Types].xml") continue;
    const daParte = relacoes.get(nome) ?? new Map<string, Relacao>();
    const visitar = (elemento: Element) => {
      for (const [chave, valor] of Object.entries(elemento.attribs))
        if (chave.startsWith("r:") && valor && !daParte.has(valor))
          problemas.push(`${nome}: ${elemento.name}/@${chave}="${valor}" sem relação em ${relacoesDe(nome)}`);
      for (const item of filhosElementos(elemento)) visitar(item);
    };
    visitar(raiz);
    problemas.push(...problemasDeConteudo(nome, raiz));
  }

  if (partePrincipal && partes[partePrincipal]) {
    const documento = analisarXml(texto(partePrincipal), partePrincipal)!;
    // Ids de desenho.
    const vistos = new Set<string>();
    // O conteúdo de reserva (`mc:Fallback`) repete o do `mc:Choice`, inclusive os desenhos de dentro
    // de uma caixa de texto: só os de fora dele contam.
    const desenhos: Element[] = [];
    const coletar = (elemento: Element) => {
      for (const item of filhosElementos(elemento)) {
        if (item.name === "mc:Fallback") continue;
        if (item.name === "wp:docPr") desenhos.push(item);
        coletar(item);
      }
    };
    coletar(documento);
    for (const desenho of desenhos) {
      const id = atributo(desenho, "id") ?? "";
      if (vistos.has(id)) problemas.push(`${partePrincipal}: wp:docPr id="${id}" repetido`);
      vistos.add(id);
    }
    problemas.push(
      ...problemasDeComentarios(partePrincipal, documento, relacoes, (alvo) => (partes[alvo] ? texto(alvo) : null)),
    );
  }
  return problemas;
}

function problemasDeComentarios(
  partePrincipal: string,
  documento: Element,
  relacoes: Map<string, Map<string, Relacao>>,
  ler: (parte: string) => string | null,
): string[] {
  const problemas: string[] = [];
  // Marcas na ordem do documento: início, fim e referência de cada id.
  const marcas = new Map<string, { inicio: number[]; fim: number[]; referencia: number[] }>();
  let posicao = 0;
  const visitar = (elemento: Element) => {
    posicao += 1;
    const tipo =
      elemento.name === "w:commentRangeStart"
        ? "inicio"
        : elemento.name === "w:commentRangeEnd"
          ? "fim"
          : elemento.name === "w:commentReference"
            ? "referencia"
            : null;
    if (tipo) {
      const id = atributo(elemento, "w:id") ?? "";
      if (!marcas.has(id)) marcas.set(id, { inicio: [], fim: [], referencia: [] });
      marcas.get(id)![tipo].push(posicao);
    }
    for (const item of filhosElementos(elemento)) visitar(item);
  };
  visitar(documento);
  const relacao = [...(relacoes.get(partePrincipal)?.values() ?? [])].find((item) => item.tipo === TIPO_COMENTARIOS);
  const parte = relacao ? resolverAlvo(partePrincipal, relacao.alvo) : null;
  const xml = parte ? ler(parte) : null;
  const ids: string[] = [];
  if (xml) {
    const raiz = analisarXml(xml, parte!);
    for (const comentario of raiz ? filhos(raiz, "w:comment") : []) ids.push(atributo(comentario, "w:id") ?? "");
  }
  const unicos = new Set(ids);
  if (unicos.size !== ids.length) problemas.push(`${parte}: ids de comentário repetidos`);
  for (const [id, marca] of marcas) {
    if (!unicos.has(id)) problemas.push(`${partePrincipal}: marca do comentário ${id}, que não existe`);
    if (marca.referencia.length !== 1)
      problemas.push(
        `${partePrincipal}: comentário ${id} com ${marca.referencia.length} referências (w:commentReference)`,
      );
    if (marca.inicio.length > 1 || marca.fim.length > 1 || marca.inicio.length !== marca.fim.length)
      problemas.push(`${partePrincipal}: comentário ${id} com intervalo incompleto ou repetido`);
    else if (marca.inicio.length && marca.inicio[0]! > marca.fim[0]!)
      problemas.push(`${partePrincipal}: comentário ${id} com o fim do intervalo antes do início`);
  }
  for (const id of unicos)
    if (!marcas.has(id)) problemas.push(`${parte}: comentário ${id} sem referência no documento`);
  return problemas;
}
