// @effect-diagnostics nodeBuiltinImport:off -- gerador síncrono do relatório HTML a partir dos arquivos da rodada
/**
 * Relatório HTML da rodada: o PPC anotado com os achados dos sub-agentes
 * (porte de `gerar_relatorio_html.py`, trilha T2).
 *
 * O HTML sai idêntico ao do Python, byte a byte:
 * - escape de `html.escape` (`&#x27;` para apóstrofo);
 * - Markdown do PPC em blocos com as regex do Python (`\s`, `\d` e `.`
 *   Unicode, por `@simplifica-if/kb/python/re`) e `splitlines` Unicode;
 * - indentação pelo `_HTMLPrettyPrinter`, que recebe os eventos do
 *   `HTMLParser` do Python (`html-py.ts`) e quebra o texto com o
 *   `textwrap.wrap` portado. Ele herda do Python uma peculiaridade: fora de
 *   tags inline, o texto em volta de uma referência (`a &amp; b`) é aparado
 *   pedaço a pedaço e sai sem os espaços (`a&amp;b`);
 * - confiança com `:.2f` do Python (empate para o par);
 * - posições e larguras contadas em code points.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { escapeHtml } from "@simplifica-if/kb/python/html";
import { match, sub } from "@simplifica-if/kb/python/re";
import { wrap } from "@simplifica-if/kb/python/textwrap";
import { casefold, colapsarEspacos, semMarcas } from "@simplifica-if/kb/python/texto";
import {
  ehObjetoPy,
  formatoFixoPy,
  numeroPy,
  obter,
  type ObjetoPy,
  ou,
  strPy,
  textoOuVazioPy,
  verdadeiro,
} from "@simplifica-if/kb/python/valores";
import {
  aparar,
  apararCaracteres,
  apararFim,
  compararTexto,
  contarCaracteres,
  dividirLinhas,
} from "@simplifica-if/kb/texto";
import { type CaminhosAnalise, caminhosPadrao } from "./caminhos.ts";
import { type AtributoPy, percorrerHtmlPy } from "./html-py.ts";
import {
  catalogoFichas,
  catalogoValidacoes,
  type ResultadoNormalizado,
  resolverResultadosPath,
  SITUACOES_REVISAO,
  situacao,
  validarAlertasTransversais,
  validarResultadosSubagents,
} from "./resultados.ts";
import { caminhosRodada, escreverTextoPy, lerJsonPy, lerTexto } from "./rodada.ts";

type Objeto = Record<string, unknown>;

const STATUS_NORMATIVOS_ACIONAVEIS = new Set([
  "CONFIRMADA_COM_RESSALVA",
  "IMPRECISA",
  "SEM_SUPORTE_NA_FONTE",
  "CONTRADITORIA",
  "FONTE_AUSENTE_OU_NAO_CONSULTADA",
]);

const escape = (texto: string) => escapeHtml(texto);
const texto = (valor: unknown) => textoOuVazioPy(valor);
const comprimento = (valor: string) => contarCaracteres(valor);

// ---------------------------------------------------------------- impressão do HTML

const INLINE = new Set(["abbr", "b", "br", "code", "em", "small", "span", "strong"]);
const VAZIAS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
const PRESERVADAS = new Set(["script", "style", "textarea", "pre"]);

/** `_HTMLPrettyPrinter`: indenta o HTML em blocos e quebra o texto em 110 colunas. */
class ImpressoraHtml {
  private readonly partes: string[] = [];
  private nivel = 0;
  private profundidadeInline = 0;
  private profundidadePreservada = 0;

  private atributos(atributos: AtributoPy[]): string {
    if (!atributos.length) return "";
    const partes = atributos.map(([nome, valor]) => (valor === null ? nome : `${nome}="${escapeHtml(valor)}"`));
    return ` ${partes.join(" ")}`;
  }

  private novaLinha(): void {
    if (this.profundidadeInline || this.profundidadePreservada) return;
    if (this.partes.length && !this.partes.at(-1)!.endsWith("\n")) this.partes.push("\n");
    this.partes.push("  ".repeat(this.nivel));
  }

  private inicio(tag: string, atributos: AtributoPy[]): void {
    if (!INLINE.has(tag)) this.novaLinha();
    this.partes.push(`<${tag}${this.atributos(atributos)}>`);
    if (PRESERVADAS.has(tag)) this.profundidadePreservada += 1;
    if (VAZIAS.has(tag)) return;
    if (INLINE.has(tag) || PRESERVADAS.has(tag)) this.profundidadeInline += 1;
    else this.nivel += 1;
  }

  private fim(tag: string): void {
    if (INLINE.has(tag) || PRESERVADAS.has(tag)) {
      this.partes.push(`</${tag}>`);
      this.profundidadeInline = Math.max(0, this.profundidadeInline - 1);
      if (PRESERVADAS.has(tag)) this.profundidadePreservada = Math.max(0, this.profundidadePreservada - 1);
      return;
    }
    this.nivel = Math.max(0, this.nivel - 1);
    this.novaLinha();
    this.partes.push(`</${tag}>`);
  }

  private dados(dados: string): void {
    if (this.profundidadePreservada || this.profundidadeInline) {
      this.partes.push(dados);
      return;
    }
    const aparado = aparar(dados);
    if (!aparado) return;
    const linhas = wrap(aparado, 110, { quebrarPalavrasLongas: false });
    if (!linhas.length) return;
    this.partes.push(linhas[0]!);
    for (const linha of linhas.slice(1)) this.partes.push("\n", "  ".repeat(this.nivel), linha);
  }

  formatar(html: string): string {
    percorrerHtmlPy(html, {
      declaracao: (dados) => this.partes.push(`<!${dados}>\n`),
      inicio: (tag, atributos) => this.inicio(tag, atributos),
      inicioFim: (tag, atributos) => {
        this.novaLinha();
        this.partes.push(`<${tag}${this.atributos(atributos)}>`);
      },
      fim: (tag) => this.fim(tag),
      texto: (dados) => this.dados(dados),
      entidade: (nome) => this.partes.push(`&${nome};`),
      referencia: (nome) => this.partes.push(`&#${nome};`),
      comentario: (dados) => {
        this.novaLinha();
        this.partes.push(`<!--${dados}-->`);
      },
    });
    return `${quebrarLinhasLongasFonte(aparar(this.partes.join("")))}\n`;
  }
}

/** `_quebrar_linhas_longas_fonte`: reparte em `largura` colunas as linhas do HTML que passam dela. */
export function quebrarLinhasLongasFonte(html: string, largura = 180): string {
  const formatadas: string[] = [];
  for (const linha of dividirLinhas(html)) {
    if (comprimento(linha) <= largura) {
      formatadas.push(linha);
      continue;
    }
    const recuo = match("^\\s*", linha)![0];
    const larguraTexto = Math.max(40, largura - comprimento(recuo));
    let atual = recuo;
    for (const parte of aparar(linha).split(/(<[^>]+>)/)) {
      if (!parte) continue;
      if (parte.startsWith("<") && parte.endsWith(">")) {
        if (aparar(atual) && comprimento(atual) + comprimento(parte) > largura) {
          formatadas.push(apararFim(atual));
          atual = recuo + parte;
        } else atual += parte;
        continue;
      }
      for (const trecho of wrap(aparar(parte), larguraTexto, { quebrarPalavrasLongas: false })) {
        if (!trecho) continue;
        if (aparar(atual) && comprimento(atual) + comprimento(trecho) + 1 > largura) {
          formatadas.push(apararFim(atual));
          atual = recuo + trecho;
        } else {
          if (aparar(atual) && !atual.endsWith(">") && !atual.endsWith(" ")) atual += " ";
          atual += trecho;
        }
      }
    }
    if (aparar(atual)) formatadas.push(apararFim(atual));
  }
  return formatadas.join("\n");
}

/** HTML indentado como o `_HTMLPrettyPrinter().pretty(html)` do Python. */
export function formatarHtml(html: string): string {
  return new ImpressoraHtml().formatar(html);
}

// ---------------------------------------------------------------- blocos do PPC

export type BlocoPpc = { id: string; kind: string; text: string; html: string; level: number };

/** `_normalizar_texto`: sem acentos, minúsculas, só `a-z0-9` separados por um espaço. */
function normalizarTexto(valor: string): string {
  return colapsarEspacos(casefold(semMarcas(valor)).replace(/[^a-z0-9]+/gu, " "));
}

const cssSlug = (valor: string) => valor.toLowerCase().replaceAll("_", "-");
const classeEstado = (valor: string) => (valor === "TRANSVERSAL" ? "transversal" : cssSlug(valor));

const MARCADOR_BR = "\u0000BR\u0000";

/** `_inline_markdown`: escape, `<br>` preservado, `**negrito**` e `*itálico*`. */
function markdownInline(valor: string): string {
  const comMarcador = sub("<br\\s*/?>", MARCADOR_BR, valor, { ignoreCase: true });
  let html = escape(comMarcador).replaceAll(MARCADOR_BR, "<br>");
  html = sub("\\*\\*(.+?)\\*\\*", "<strong>\\1</strong>", html);
  return sub("\\*(.+?)\\*", "<em>\\1</em>", html);
}

function tabelaMarkdown(linhas: string[]): string {
  const linhasTabela: string[][] = [];
  for (const linha of linhas) {
    const celulas = apararCaracteres(aparar(linha), "|")
      .split("|")
      .map((celula) => aparar(celula));
    if (celulas.length && celulas.every((celula) => /^:?-{3,}:?$/.test(celula))) continue;
    linhasTabela.push(celulas);
  }
  if (!linhasTabela.length) return "";
  const largura = Math.max(...linhasTabela.map((linha) => linha.length));
  const completas = linhasTabela.map((linha) => [...linha, ...Array<string>(largura - linha.length).fill("")]);
  const [cabecalho, ...corpo] = completas as [string[], ...string[][]];
  const thead = cabecalho.map((celula) => `<th scope="col">${markdownInline(celula)}</th>`).join("");
  const tbody = corpo
    .map((linha) => `<tr>${linha.map((celula) => `<td>${markdownInline(celula)}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
}

const RE_ITEM_LISTA = "^\\s*(?:[-*+]|\\d+[.)])\\s+";

function htmlDoBloco(tipo: string, valor: string, nivel = 0): string {
  if (tipo === "heading") {
    const n = Math.min(Math.max(nivel, 1), 6);
    return `<h${n}>${markdownInline(valor)}</h${n}>`;
  }
  if (tipo === "table") return tabelaMarkdown(dividirLinhas(valor));
  if (tipo === "list") {
    const itens = dividirLinhas(valor)
      .map((linha) => aparar(sub(RE_ITEM_LISTA, "", linha)))
      .filter(Boolean)
      .map((item) => `<li>${markdownInline(item)}</li>`);
    return `<ul>${itens.join("")}</ul>`;
  }
  return valor
    .split("\n")
    .map((parte) => aparar(parte))
    .filter(Boolean)
    .map((paragrafo) => `<p>${markdownInline(paragrafo)}</p>`)
    .join("");
}

function tipoLinha(linha: string): [string, number] {
  const limpa = aparar(linha);
  if (!limpa) return ["blank", 0];
  const titulo = match("^(#{1,6})\\s+(.+)$", limpa);
  if (titulo) return ["heading", titulo[1]!.length];
  if (limpa.includes("|") && limpa.startsWith("|")) return ["table", 0];
  if (match(RE_ITEM_LISTA, linha)) return ["list", 0];
  return ["paragraph", 0];
}

/** `gerar_blocos_ppc`: o Markdown do PPC em blocos com IDs estáveis (`ppc-b00001`). */
export function gerarBlocosPpc(markdown: string): BlocoPpc[] {
  const linhas = markdown.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const blocos: BlocoPpc[] = [];
  let indice = 0;
  let atual: string[] = [];
  let tipoAtual = "paragraph";

  const despejar = (nivel = 0) => {
    let valor = aparar(atual.map((linha) => apararFim(linha)).join("\n"));
    if (!valor) {
      atual = [];
      return;
    }
    indice += 1;
    if (tipoAtual === "heading") valor = aparar(sub("^#{1,6}\\s+", "", valor));
    const id = `ppc-b${String(indice).padStart(5, "0")}`;
    blocos.push({ id, kind: tipoAtual, text: valor, html: htmlDoBloco(tipoAtual, valor, nivel), level: nivel });
    atual = [];
  };

  let nivelAtual = 0;
  for (const linha of linhas) {
    const [tipo, nivel] = tipoLinha(linha);
    if (tipo === "blank") {
      despejar(nivelAtual);
      nivelAtual = 0;
      tipoAtual = "paragraph";
      continue;
    }
    if (!atual.length) {
      atual = [linha];
      tipoAtual = tipo;
      nivelAtual = nivel;
      continue;
    }
    if (tipo !== tipoAtual || tipo === "heading") {
      despejar(nivelAtual);
      atual = [linha];
      tipoAtual = tipo;
      nivelAtual = nivel;
    } else atual.push(linha);
  }
  despejar(nivelAtual);
  return blocos;
}

// ---------------------------------------------------------------- âncoras

function tituloSemNumero(valor: string): string {
  return aparar(sub("^\\s*\\d+(?:\\.\\d+)*\\s+", "", valor));
}

function blocoSecaoPorTitulo(secao: string, blocos: BlocoPpc[]): BlocoPpc | null {
  const secaoNormalizada = normalizarTexto(tituloSemNumero(secao));
  if (!secaoNormalizada) return null;
  for (const bloco of blocos) {
    if (bloco.kind !== "heading") continue;
    const tituloNormalizado = normalizarTexto(tituloSemNumero(bloco.text));
    if (secaoNormalizada === tituloNormalizado || tituloNormalizado.includes(secaoNormalizada)) return bloco;
  }
  return null;
}

function blocosDaSecao(titulo: BlocoPpc, blocos: BlocoPpc[]): BlocoPpc[] {
  const indice = blocos.indexOf(titulo);
  if (indice < 0) return [];
  const relacionados = [titulo];
  for (const bloco of blocos.slice(indice + 1)) {
    if (bloco.kind === "heading" && bloco.level <= titulo.level) break;
    relacionados.push(bloco);
  }
  return relacionados;
}

/** `_resolver_anchor_evidencia`: o bloco do PPC e o trecho a destacar para uma evidência. */
export function resolverAncoraEvidencia(evidencia: Objeto, blocos: BlocoPpc[]): [string, string] {
  const porId = new Set(blocos.map((bloco) => bloco.id));
  const ancora = ehObjetoPy(evidencia.anchor) ? evidencia.anchor : {};
  const blockId = aparar(texto(obter(ancora, "block_id")));
  const quote = aparar(texto(obter(ancora, "quote")));
  const trecho = texto(evidencia.trecho);
  if (porId.has(blockId)) return [blockId, quote || trecho];

  const secao = texto(evidencia.secao);
  const blocoSecao = blocoSecaoPorTitulo(secao, blocos);
  if (blocoSecao) {
    const trechoNormalizado = normalizarTexto(trecho || quote);
    if (trechoNormalizado) {
      for (const bloco of blocosDaSecao(blocoSecao, blocos)) {
        if (normalizarTexto(bloco.text).includes(trechoNormalizado)) return [bloco.id, quote || trecho];
      }
    }
    return [blocoSecao.id, quote || trecho || blocoSecao.text];
  }

  for (const candidato of [quote, trecho, texto(evidencia.localizador), secao]) {
    const normalizado = normalizarTexto(candidato);
    if (!normalizado) continue;
    for (const bloco of blocos) {
      if (normalizarTexto(bloco.text).includes(normalizado)) return [bloco.id, quote || trecho || candidato];
    }
  }
  return ["", quote || trecho];
}

function itemAcionavel(item: Objeto): boolean {
  if (item.estado === "NAO_ATENDE" || item.estado === "INCONCLUSIVO") return true;
  if (item.revisao_humana_obrigatoria || verdadeiro(item.lacunas) || verdadeiro(item.feedback_autores)) return true;
  return ((item.fundamentacao_normativa as Objeto[] | undefined) ?? []).some((achado) =>
    STATUS_NORMATIVOS_ACIONAVEIS.has(achado.status as string),
  );
}

/** Posição em code points de `trecho` em `texto` (`str.find`), ou -1. */
function encontrar(textoBase: string, trecho: string): number {
  const posicao = textoBase.indexOf(trecho);
  return posicao < 0 ? -1 : comprimento(textoBase.slice(0, posicao));
}

function posicaoQuoteNoBloco(quote: string, bloco: BlocoPpc | undefined): number {
  if (!quote || !bloco) return 0;
  const posicao = encontrar(bloco.text, quote);
  if (posicao >= 0) return posicao;
  const quoteNormalizado = normalizarTexto(quote);
  if (!quoteNormalizado) return 0;
  const posicaoNormalizada = encontrar(normalizarTexto(bloco.text), quoteNormalizado);
  return posicaoNormalizada >= 0 ? posicaoNormalizada : 0;
}

type Anotacao = Objeto & { annotation_id: string; anchor_id: string; quote: string };

function prepararAnotacoes(resultados: ResultadoNormalizado[], blocos: BlocoPpc[]) {
  const porBloco = new Map<string, Anotacao[]>();
  const soltas: Anotacao[] = [];
  const blocosPorId = new Map(blocos.map((bloco) => [bloco.id, bloco]));
  const ordemBlocos = new Map(blocos.map((bloco, indice) => [bloco.id, indice]));
  type Preparada = { item: Objeto; ordem: [number, number, number, string, number] };
  const preparadas: Preparada[] = resultados.map((item, posicao) => {
    const indiceOriginal = posicao + 1;
    let anchorId = "";
    let quote = "";
    const evidencias = (item.evidencias as Objeto[]).map((evidencia) => {
      const [evidenciaAnchorId, evidenciaQuote] = resolverAncoraEvidencia(evidencia, blocos);
      if (evidenciaAnchorId && !anchorId) {
        anchorId = evidenciaAnchorId;
        quote = evidenciaQuote;
      }
      return { ...evidencia, anchor_id: evidenciaAnchorId, quote: evidenciaQuote };
    });
    const preparada = { ...item, evidencias, anchor_id: anchorId, quote, acionavel: itemAcionavel(item) };
    return {
      item: preparada,
      ordem: [
        anchorId ? 0 : 1,
        ordemBlocos.get(anchorId) ?? blocos.length + indiceOriginal,
        posicaoQuoteNoBloco(quote, blocosPorId.get(anchorId)),
        item.ficha_id,
        indiceOriginal,
      ],
    };
  });
  preparadas.sort((a, b) => {
    for (let i = 0; i < 5; i += 1) {
      const x = a.ordem[i]!;
      const y = b.ordem[i]!;
      const comparacao = typeof x === "string" ? compararTexto(x, y as string) : x - (y as number);
      if (comparacao !== 0) return comparacao;
    }
    return 0;
  });
  const anotacoes: Anotacao[] = preparadas.map(({ item }, posicao) => {
    const anotacao = { ...item, annotation_id: `ann-${String(posicao + 1).padStart(3, "0")}` } as Anotacao;
    if (anotacao.anchor_id) {
      const lista = porBloco.get(anotacao.anchor_id) ?? [];
      lista.push(anotacao);
      porBloco.set(anotacao.anchor_id, lista);
    } else soltas.push(anotacao);
    return anotacao;
  });
  return { anotacoes, porBloco, soltas };
}

function prepararAlertasTransversais(alertas: ObjetoPy[], blocos: BlocoPpc[]) {
  const porBloco = new Map<string, Anotacao[]>();
  const preparados = alertas.map((alerta, posicaoAlerta) => {
    const ocorrencias = (alerta.evidencias as Objeto[]).map((evidencia, posicaoEvidencia) => {
      const [anchorId, quote] = resolverAncoraEvidencia(evidencia, blocos);
      const ocorrencia = {
        ...evidencia,
        occurrence_id: `trans-${String(posicaoAlerta + 1).padStart(3, "0")}-${String(posicaoEvidencia + 1).padStart(2, "0")}`,
        anchor_id: anchorId,
        quote,
      };
      if (anchorId) {
        const lista = porBloco.get(anchorId) ?? [];
        lista.push({
          ...alerta,
          annotation_id: alerta.id as string,
          ficha_id: alerta.id,
          estado: "TRANSVERSAL",
          occurrence_id: ocorrencia.occurrence_id,
          anchor_id: anchorId,
          quote,
        });
        porBloco.set(anchorId, lista);
      }
      return ocorrencia;
    });
    return { ...alerta, annotation_id: alerta.id, ocorrencias };
  });
  return { alertas: preparados, porBloco };
}

// ---------------------------------------------------------------- renderização

function renderizarLista(valores: string[]): string {
  if (!valores.length) return '<span class="muted">Não informado</span>';
  return `<ul>${valores.map((valor) => `<li>${escape(valor)}</li>`).join("")}</ul>`;
}

function rotuloLinkEvidencia(evidencia: Objeto): string {
  if (aparar(texto(evidencia.secao))) return "Ir para seção";
  if (aparar(texto(ou(evidencia.quote, evidencia.trecho)))) return "Ir para trecho";
  return "Ir para ponto no PPC";
}

function renderizarLinkEvidencia(evidencia: Objeto): string {
  const anchorId = aparar(texto(evidencia.anchor_id));
  if (!anchorId) return "";
  return `<a class="backlink evidence-jump" href="#${escape(anchorId)}">${escape(rotuloLinkEvidencia(evidencia))}</a>`;
}

function renderizarEvidencias(evidencias: Objeto[]): string {
  if (!evidencias.length) return '<span class="muted">Não informado</span>';
  const itens = evidencias.map((evidencia) => {
    const detalhes: string[] = [];
    if (verdadeiro(evidencia.secao)) {
      detalhes.push(`<span><strong>Seção:</strong> ${escape(strPy(evidencia.secao))}</span>`);
    }
    const detalhesHtml = detalhes.length ? `<div class="evidence-meta">${detalhes.join(" · ")}</div>` : "";
    return `<li><p>${escape(texto(evidencia.trecho))}</p>${detalhesHtml}${renderizarLinkEvidencia(evidencia)}</li>`;
  });
  return `<ul class="evidence-list">${itens.join("")}</ul>`;
}

function renderizarFeedbackAutores(valor: string): string {
  if (!valor) return "";
  const paragrafos = valor
    .split("\n\n")
    .filter((paragrafo) => aparar(paragrafo))
    .map((paragrafo) => `<p>${escape(paragrafo)}</p>`);
  return `<section class="author-feedback"><h4>Feedback sugerido aos autores</h4>${paragrafos.join("")}</section>`;
}

function renderizarFundamentacaoNormativa(achados: Array<Record<string, string>>): string {
  if (!achados.length) return "";
  const classes = [
    "normative-section",
    ...achados.filter((achado) => achado.status).map((achado) => `normative-${cssSlug(achado.status!)}`),
  ];
  const cards = achados.map((achado) => {
    const detalhes: Array<[string, string]> = [
      ["Trecho do PPC", achado.trecho_ppc!],
      ["Norma", achado.norma!],
      ["Fonte consultada", achado.fonte!],
      ["Dispositivo", achado.dispositivo!],
      ["Evidência", achado.evidencia!],
      ["Análise", achado.analise!],
      ["Recomendação", achado.recomendacao!],
    ];
    const itens = detalhes
      .filter(([, valor]) => valor)
      .map(([rotulo, valor]) => `<p><strong>${escape(rotulo)}:</strong> ${escape(valor)}</p>`)
      .join("");
    return (
      '<article class="normative-finding">' +
      `<h5><span class="badge norma-${escape(cssSlug(achado.status!))}">${escape(achado.status!)}</span></h5>` +
      `${itens}</article>`
    );
  });
  return `<section class="${escape(classes.join(" "))}"><h4>Fundamentação normativa verificada</h4>${cards.join("")}</section>`;
}

function rotuloOcorrencia(ocorrencia: Objeto, indice: number): string {
  for (const chave of ["secao", "localizador", "papel"]) {
    if (verdadeiro(ocorrencia[chave])) return strPy(ocorrencia[chave]);
  }
  return `Ponto ${indice}`;
}

function renderizarPontosTransversais(ocorrencias: Objeto[]): string {
  if (!ocorrencias.length) return '<p class="muted">Nenhum ponto específico informado.</p>';
  const itens = ocorrencias.map((ocorrencia, posicao) => {
    const rotulo = rotuloOcorrencia(ocorrencia, posicao + 1);
    const trecho = aparar(texto(ou(ocorrencia.trecho, ocorrencia.quote)));
    const papel = aparar(texto(ocorrencia.papel));
    const destino = aparar(texto(ocorrencia.anchor_id));
    const botao = destino
      ? `<a class="backlink alert-point-link" href="#${escape(destino)}">${escape(rotulo)}</a>`
      : `<span class="alert-point-label">${escape(rotulo)}</span>`;
    const detalhes = trecho ? `<p>${escape(trecho)}</p>` : "";
    const papelHtml = papel ? `<p class="annotation-meta"><strong>Papel:</strong> ${escape(papel)}</p>` : "";
    return `<li>${botao}${detalhes}${papelHtml}</li>`;
  });
  return `<ol class="alert-points">${itens.join("")}</ol>`;
}

function renderizarAlertas(alertas: Objeto[]): string {
  if (!alertas.length) return '<p class="muted">Nenhum alerta transversal registrado.</p>';
  return alertas
    .map((alerta) => {
      const fichas = (alerta.fichas_relacionadas as string[]).join(", ") || "Sem fichas específicas";
      const criticidade = alerta.criticidade as string;
      const ocorrencias = (verdadeiro(alerta.ocorrencias) ? alerta.ocorrencias : alerta.evidencias) as Objeto[];
      return (
        `<article class="alert-card" id="${escape(alerta.id as string)}">` +
        `<div class="finding-heading"><h3>${escape(alerta.id as string)} · ${escape(alerta.titulo as string)}</h3>` +
        `<span class="badge criticidade-${escape(criticidade.toLowerCase())}">${escape(criticidade)}</span></div>` +
        `<p><strong>Validação cruzada:</strong> ${escape(alerta.validacao_id as string)} · ${escape(alerta.validacao_titulo as string)}</p>` +
        `<p>${escape(alerta.descricao as string)}</p>` +
        `<p><strong>Fichas relacionadas:</strong> ${escape(fichas)}</p>` +
        `<section><h4>Pontos no PPC</h4>${renderizarPontosTransversais(ocorrencias)}</section>` +
        `<p><strong>Revisão humana obrigatória:</strong> ${alerta.revisao_humana_obrigatoria ? "Sim" : "Não"}</p>` +
        "</article>"
      );
    })
    .join("");
}

function renderizarMarcadores(anotacoes: Anotacao[]): string {
  if (!anotacoes.length) return "";
  const links = anotacoes.map((anotacao) => {
    const estado = texto(anotacao.estado);
    const rotulo = texto(ou(anotacao.ficha_id, anotacao.id, ""));
    return (
      `<a class="annotation-marker estado-${escape(classeEstado(estado))}" ` +
      `href="#${escape(anotacao.annotation_id)}" ` +
      `data-annotation-ref="${escape(anotacao.annotation_id)}" ` +
      `aria-label="Anotação ${escape(rotulo)}">${escape(rotulo)}</a>`
    );
  });
  return `<div class="annotation-markers" aria-label="Anotações do bloco">\n${links.join("\n")}\n</div>`;
}

/** Se `posicao` do HTML está em texto, fora de tag e de atributo (o último `<` antes dela já fechou). */
function emTexto(html: string, posicao: number): boolean {
  return html.lastIndexOf("<", posicao - 1) <= html.lastIndexOf(">", posicao - 1);
}

function linkEvidencia(anotacao: Anotacao, conteudo: string): string {
  const annotationId = escape(texto(anotacao.annotation_id));
  const fichaId = escape(texto(ou(anotacao.ficha_id, annotationId)));
  const titulo = escape(texto(ou(anotacao.titulo, fichaId)));
  const classe = classeEstado(texto(anotacao.estado));
  return (
    `<a class="evidence-link evidence-state-${escape(classe)}" href="#${annotationId}" ` +
    `data-evidence-ref="${annotationId}" ` +
    `title="Evidência de ${fichaId}: ${titulo}" ` +
    `aria-label="Trecho usado como evidência de ${fichaId}">` +
    conteudo +
    `<span class="evidence-ref" aria-hidden="true">${fichaId}</span>` +
    "</a>"
  );
}

/**
 * Destaca no HTML do bloco o trecho citado por cada anotação: a primeira ocorrência em texto (fora
 * de tags e atributos) que não se sobrepõe a um destaque anterior. Fichas que citam o mesmo trecho
 * dividem um destaque só: a primeira leva o `<mark>`, as demais entram como links logo depois.
 */
function aplicarDestaques(html: string, anotacoes: Anotacao[]): string {
  type Destaque = { inicio: number; fim: number; alvo: string; anotacoes: Anotacao[] };
  const destaques: Destaque[] = [];
  for (const anotacao of anotacoes) {
    const trecho = aparar(texto(anotacao.quote));
    if (!trecho) continue;
    const alvo = escape(trecho);
    const mesmo = destaques.find((destaque) => destaque.alvo === alvo);
    if (mesmo) {
      mesmo.anotacoes.push(anotacao);
      continue;
    }
    for (let posicao = html.indexOf(alvo); posicao >= 0; posicao = html.indexOf(alvo, posicao + 1)) {
      const fim = posicao + alvo.length;
      const sobrepoe = destaques.some((destaque) => posicao < destaque.fim && destaque.inicio < fim);
      if (emTexto(html, posicao) && !sobrepoe) {
        destaques.push({ inicio: posicao, fim, alvo, anotacoes: [anotacao] });
        break;
      }
    }
  }
  let renderizado = "";
  let cursor = 0;
  for (const destaque of destaques.sort((a, b) => a.inicio - b.inicio)) {
    const [primeira, ...demais] = destaque.anotacoes;
    renderizado +=
      html.slice(cursor, destaque.inicio) +
      linkEvidencia(primeira!, `<mark class="evidence-highlight">${destaque.alvo}</mark>`) +
      demais.map((anotacao) => linkEvidencia(anotacao, "")).join("");
    cursor = destaque.fim;
  }
  return renderizado + html.slice(cursor);
}

function renderizarPpc(blocos: BlocoPpc[], anotacoesPorBloco: Map<string, Anotacao[]>): string {
  return blocos
    .map((bloco) => {
      const anotacoes = anotacoesPorBloco.get(bloco.id) ?? [];
      return (
        `<section id="${escape(bloco.id)}" class="ppc-block ppc-block-${escape(bloco.kind)}" ` +
        `data-block-id="${escape(bloco.id)}" data-annotations="${anotacoes.length}">` +
        `<div class="block-content">${aplicarDestaques(bloco.html, anotacoes)}</div>` +
        `${renderizarMarcadores(anotacoes)}</section>`
      );
    })
    .join("");
}

function renderizarAnotacao(item: Objeto, compacta = true): string {
  const quote = aparar(texto(item.quote));
  const quoteHtml = quote ? `<blockquote>${escape(quote)}</blockquote>` : "";
  const lacunas = verdadeiro(item.lacunas)
    ? `<section><h4>Lacunas</h4>${renderizarLista(item.lacunas as string[])}</section>`
    : "";
  const evidencia = compacta
    ? ""
    : `<section><h4>Evidências</h4>${renderizarEvidencias(item.evidencias as Objeto[])}</section>`;
  const feedback = compacta ? "" : renderizarFeedbackAutores(texto(item.feedback_autores));
  const fundamentacao = compacta
    ? ""
    : renderizarFundamentacaoNormativa((ou(item.fundamentacao_normativa, []) as Array<Record<string, string>>) ?? []);
  const revisao = item.revisao_humana_obrigatoria;
  return (
    '<article class="annotation-card finding" ' +
    `id="${escape(item.annotation_id as string)}" ` +
    `data-estado="${escape(item.estado as string)}" ` +
    `data-criticidade="${escape(item.criticidade as string)}" ` +
    `data-revisao="${revisao ? "sim" : "nao"}" ` +
    `data-acionavel="${item.acionavel ? "sim" : "nao"}">` +
    "<header>" +
    `<p class="annotation-kicker">${escape(item.ficha_id as string)} · ${escape(item.criticidade as string)}</p>` +
    `<h3>${escape(item.titulo as string)}</h3>` +
    `<span class="badge estado-${escape(cssSlug(item.estado as string))}">${escape(item.estado as string)}</span>` +
    "</header>" +
    `${quoteHtml}<p>${escape(item.justificativa as string)}</p>${lacunas}${evidencia}${feedback}${fundamentacao}` +
    `<p class="annotation-meta"><strong>Confiança:</strong> ${formatoFixoPy(numeroPy(item.confianca), 2)} · ` +
    `<strong>Grupo:</strong> ${escape(item.grupo_id as string)} · ` +
    `<strong>Revisão humana:</strong> ${revisao ? "Sim" : "Não"}</p>` +
    "</article>"
  );
}

function renderizarAnotacoesLaterais(anotacoes: Anotacao[], soltas: Anotacao[], alertas: Objeto[]): string {
  let cards = anotacoes
    .filter((item) => item.anchor_id)
    .map((item) => renderizarAnotacao(item, false))
    .join("");
  if (soltas.length) {
    cards +=
      '<section class="unanchored-notes"><h3>Anotações sem âncora precisa</h3>' +
      soltas.map((item) => renderizarAnotacao(item, false)).join("") +
      "</section>";
  }
  if (alertas.length) {
    cards += `<section class="transversal-notes"><h3>Alertas transversais</h3>${renderizarAlertas(alertas)}</section>`;
  }
  return cards;
}

function contagemOrdenada(valores: string[]): Array<[string, number]> {
  const total = new Map<string, number>();
  for (const valor of valores) total.set(valor, (total.get(valor) ?? 0) + 1);
  return [...total.entries()].sort(([a], [b]) => compararTexto(a, b));
}

/** Aviso do cabeçalho e do rodapé: a revisão é prévia e não é o ato oficial da PROENS. */
const AVISO_REVISAO =
  "Revisão prévia, antes da submissão à PROENS: não substitui a análise oficial da PROENS nem emite parecer.";

/** `_render_html`: o HTML do relatório antes da indentação. */
export function renderizarHtml(
  metadata: ObjetoPy,
  resultados: ResultadoNormalizado[],
  alertas: ObjetoPy[],
  ppcMarkdown: string,
): string {
  const blocos = gerarBlocosPpc(ppcMarkdown);
  const contextoAnotacoes = prepararAnotacoes(resultados, blocos);
  const contextoAlertas = prepararAlertasTransversais(alertas, blocos);
  const { anotacoes, porBloco: anotacoesPorBloco, soltas } = contextoAnotacoes;
  for (const [blocoId, alertasDoBloco] of contextoAlertas.porBloco) {
    anotacoesPorBloco.set(blocoId, [...(anotacoesPorBloco.get(blocoId) ?? []), ...alertasDoBloco]);
  }

  const contar = (filtro: (item: ResultadoNormalizado) => boolean) => resultados.filter(filtro).length;
  const situacaoGeral = situacao(resultados, alertas);
  const revisaoHumana = contar((item) => item.revisao_humana_obrigatoria);
  const feedbacksAutores = contar((item) => verdadeiro(item.feedback_autores));
  const fundamentacoes = resultados.reduce(
    (soma, item) => soma + ((ou(item.fundamentacao_normativa, []) as unknown[]) ?? []).length,
    0,
  );
  const naoAtende = contar((item) => item.estado === "NAO_ATENDE");
  const inconclusivos = contar((item) => item.estado === "INCONCLUSIVO");
  const acionaveis = anotacoes.filter((item) => item.acionavel).length;

  const linhasContagem = (valores: string[]) =>
    contagemOrdenada(valores)
      .map(([chave, quantidade]) => `<tr><th scope="row">${escape(chave)}</th><td>${quantidade}</td></tr>`)
      .join("");
  const estadosHtml = linhasContagem(resultados.map((item) => item.estado));
  const criticidadeHtml = linhasContagem(resultados.map((item) => item.criticidade));
  const resumo =
    `A revisão conferiu ${resultados.length} fichas. ` +
    `Foram identificados ${naoAtende} itens não atendidos, ${inconclusivos} inconclusivos ` +
    `e ${revisaoHumana} itens com revisão humana obrigatória.`;
  const meta = (chave: string, padrao: string) => escape(strPy(ou(obter(metadata, chave), padrao)));

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Relatório de revisão do PPC · ${meta("curso", "PPC")}</title>
  <link rel="stylesheet" href="assets/revisar-ppc.css">
  <script src="assets/revisar-ppc.js" defer></script>
</head>
<body data-annotation-mode="acionaveis">
  <main class="review-shell">
    <header class="review-header">
      <p class="eyebrow">Relatório de revisão do PPC · PPC anotado</p>
      <h1>${meta("curso", "Curso não identificado")}</h1>
      <p class="lead">${escape(resumo)}</p>
      <p class="aviso-revisao">${AVISO_REVISAO}</p>
      <div class="status-row">
        <span><strong>Situação:</strong> <span class="badge estado-${escape(cssSlug(situacaoGeral))}" title="${escape(situacaoGeral)}">${escape(SITUACOES_REVISAO[situacaoGeral])}</span></span>
        <span><strong>Campus:</strong> ${meta("campus", "Não informado")}</span>
        <span><strong>Modalidade:</strong> ${meta("modalidade", "Não informada")}</span>
      </div>
    </header>

    <section class="summary-panel" id="resumo">
      <h2>Resumo executivo</h2>
      <div class="metrics">
        <div class="metric"><span>Total de fichas</span><strong>${resultados.length}</strong></div>
        <div class="metric"><span>Acionáveis</span><strong>${acionaveis}</strong></div>
        <div class="metric"><span>Não atendidas</span><strong>${naoAtende}</strong></div>
        <div class="metric"><span>Inconclusivas</span><strong>${inconclusivos}</strong></div>
        <div class="metric"><span>Revisão humana</span><strong>${revisaoHumana}</strong></div>
        <div class="metric"><span>Alertas</span><strong>${alertas.length}</strong></div>
        <div class="metric"><span>Feedback aos autores</span><strong>${feedbacksAutores}</strong></div>
        <div class="metric"><span>Fundamentações</span><strong>${fundamentacoes}</strong></div>
      </div>
    </section>

    <section class="section">
      <h2>Contagens</h2>
      <div class="finding-grid">
        <section><h3>Por estado</h3><table><tbody>${estadosHtml}</tbody></table></section>
        <section><h3>Por criticidade</h3><table><tbody>${criticidadeHtml}</tbody></table></section>
      </div>
    </section>

    <section class="control-panel" id="filtros" aria-label="Filtros da revisão">
      <label class="search-control">Busca
        <input id="filtro-busca" type="search" placeholder="Ficha, justificativa, evidência ou lacuna">
      </label>
      <label>Modo
        <select id="filtro-modo">
          <option value="acionaveis" selected>Acionáveis</option>
          <option value="todos">Todos os achados</option>
        </select>
      </label>
      <label>Estado
        <select id="filtro-estado">
          <option value="">Todos</option>
          <option value="ATENDE">ATENDE</option>
          <option value="NAO_ATENDE">NAO_ATENDE</option>
          <option value="INCONCLUSIVO">INCONCLUSIVO</option>
          <option value="NAO_APLICAVEL">NAO_APLICAVEL</option>
        </select>
      </label>
      <label>Criticidade
        <select id="filtro-criticidade">
          <option value="">Todas</option>
          <option value="BLOQ">BLOQ</option>
          <option value="OBRIG">OBRIG</option>
          <option value="REC">REC</option>
        </select>
      </label>
      <label>Revisão humana
        <select id="filtro-revisao">
          <option value="">Todas</option>
          <option value="sim">Sim</option>
          <option value="nao">Não</option>
        </select>
      </label>
      <p class="visible-count">Anotações visíveis: <strong id="contador-visivel">${acionaveis}</strong></p>
    </section>

    <section class="reader-layout" id="ppc-anotado" aria-label="PPC com anotações de revisão">
      <article class="ppc-document" aria-label="Conteúdo do PPC">
        ${renderizarPpc(blocos, anotacoesPorBloco)}
      </article>
      <aside class="review-margin" aria-label="Anotações da revisão">
        <div class="margin-heading">
          <p class="eyebrow">Margem de revisão</p>
          <h2>Anotações</h2>
        </div>
        ${renderizarAnotacoesLaterais(anotacoes, soltas, contextoAlertas.alertas)}
      </aside>
    </section>

    <footer class="review-footer">
      <p>Relatório de revisão do PPC. ${AVISO_REVISAO}</p>
    </footer>
  </main>
</body>
</html>
`;
}

const ASSETS = ["revisar-ppc.css", "revisar-ppc.js"];

/** `_copiar_assets`: copia o CSS e o JS do relatório para `<destino>/assets`. */
function copiarAssets(destinoDir: string, caminhos: CaminhosAnalise): string[] {
  const destino = NodePath.join(destinoDir, "assets");
  NodeFS.mkdirSync(destino, { recursive: true });
  return ASSETS.map((nome) => {
    const arquivo = NodePath.join(destino, nome);
    NodeFS.copyFileSync(NodePath.join(caminhos.appDir, "assets", nome), arquivo);
    return arquivo;
  });
}

export type RelatorioGerado = {
  relatorio_html: string;
  assets: string[];
  total_fichas: number;
  total_alertas_transversais: number;
  situacao: string;
  situacao_rotulo: string;
};

/** `gerar_relatorio_html`: valida os resultados, grava `relatorio-revisao.html` e copia os assets. */
export function gerarRelatorioHtml(
  rodada: string,
  resultados: string,
  caminhos: CaminhosAnalise = caminhosPadrao(),
): RelatorioGerado {
  const rodadaPaths = caminhosRodada(rodada);
  const metadata = lerJsonPy(rodadaPaths.metadata);
  const caminhoResultados = resolverResultadosPath(rodadaPaths.rodadaDir, resultados);
  const payload = lerJsonPy(caminhoResultados);
  if (!ehObjetoPy(payload)) throw new Error("AttributeError: o JSON de resultados precisa ser objeto");
  const fichasPorId = catalogoFichas(caminhos.fichasDir);
  const validacoesPorId = catalogoValidacoes(caminhos.validacoesCruzadasDir);
  const normalizados = validarResultadosSubagents(payload, fichasPorId);
  const alertas = validarAlertasTransversais(payload, fichasPorId, validacoesPorId);
  const ppcMarkdown = lerTexto(rodadaPaths.ppc);
  if (!ehObjetoPy(metadata)) throw new Error("AttributeError: metadata.json precisa ser objeto");
  const html = formatarHtml(renderizarHtml(metadata, normalizados, alertas, ppcMarkdown));
  const situacaoGeral = situacao(normalizados, alertas);
  escreverTextoPy(rodadaPaths.relatorioHtml, html);
  const assets = copiarAssets(rodadaPaths.rodadaDir, caminhos);
  return {
    relatorio_html: rodadaPaths.relatorioHtml,
    assets,
    total_fichas: normalizados.length,
    total_alertas_transversais: alertas.length,
    situacao: situacaoGeral,
    situacao_rotulo: SITUACOES_REVISAO[situacaoGeral],
  };
}
