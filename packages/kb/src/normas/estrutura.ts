/**
 * Parser de dispositivos das normas (fase 5): Markdown → mdast (`remark-parse` + `remark-gfm`) →
 * artigos, parágrafos, incisos, alíneas, itens, anexos e seções, com ID canônico, caput herdado,
 * notas de redação e linha de origem.
 *
 * Convenções do Markdown (conferidas pelo lint de `scripts/validar_base.ts`; ver
 * `base-conhecimento/docs/padrao-front-matter-legislacao.md`, "Corpo da norma"):
 *
 * - regiões: `## Resumo` (até o primeiro `---` ou o próximo `##`) e seções `##` editoriais (notas,
 *   observações, análises) ficam fora do texto normativo; `## Texto ...` e cabeçalhos estruturais
 *   (`TÍTULO`, `CAPÍTULO`, `ANEXO`...) abrem ou continuam o texto normativo;
 * - artigo: cabeçalho `#### Art. 1º` só com o rótulo; o caput vem no parágrafo seguinte;
 * - parágrafo: parágrafo iniciado por `**§ 1º**` ou `**Parágrafo único.**`;
 * - inciso: item de lista iniciado por `**I –**` (filho do parágrafo corrente ou do caput);
 * - alínea: item de lista iniciado por `a)`, aninhado no inciso ou logo depois dele;
 * - item: item de lista numerada (ou `1.`/`1)`) dentro de alínea ou de anexo;
 * - anexo: cabeçalho `ANEXO ...` (ou `REGULAMENTO`/`ESTATUTO`/`REGIMENTO` depois dos artigos do
 *   ato); artigos de anexo ganham o prefixo `anexoN-`;
 * - citação (`>`), tabela e parágrafo sem rótulo pertencem ao último dispositivo aberto: é assim
 *   que o texto de outra norma alterado por esta ("passa a vigorar com a seguinte redação") fica
 *   dentro do artigo que opera a alteração, sem virar dispositivo desta norma;
 * - norma sem artigos (nota técnica): um dispositivo `#secaoN` por cabeçalho do texto normativo.
 *
 * IDs (plano, "Arquitetura alvo"): `#art28-xvi`, `#art28-par1-iv`, `#art71-parunico`, `#art36A`,
 * `#art5-al-a`, `#art4-i-al-a-item1`, `#anexo1`, `#anexo1-item3`, `#anexo1-art5`, `#secao1`.
 *
 * Só o texto vigente: notas como "(Redação dada pela Lei nº ...)" e "(Incluído pela ...)" viram
 * metadado (`notas`); o dispositivo cujo texto é só a nota de revogação fica com `revogado: true`.
 *
 * Reconstituição: `segmentos` cobre o corpo inteiro (resumo, preâmbulo, estrutura, dispositivos,
 * fecho, notas editoriais) na ordem do arquivo; as palavras dos segmentos concatenados são as
 * palavras do arquivo (`palavrasMarkdown`). O teste `estrutura.test.ts` confere isso nas 36 normas.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Heading, List, ListItem, Nodes, Paragraph, RootContent } from "mdast";
import { analisarFrontMatter } from "./front-matter.ts";
import { idDoAto, varianteDoId } from "./ids.ts";
import { arvoreMarkdown, palavrasDoTexto, textoDoNo } from "./markdown.ts";
import { raizRepositorio } from "./registro.ts";
import { compararTexto } from "../texto.ts";

export type TipoDispositivo = "artigo" | "paragrafo" | "inciso" | "alinea" | "item" | "anexo" | "secao";

export type TipoNota = "redacao" | "inclusao" | "revogacao" | "renumeracao" | "vide" | "vigencia" | "regulamento";

export interface NotaDispositivo {
  tipo: TipoNota;
  texto: string;
}

export interface Dispositivo {
  /** ID completo: `<id da norma (arquivo)>#<dispositivo>`. */
  id: string;
  /** Sufixo do dispositivo: `#art28-xvi`. */
  dispositivo: string;
  /** ID do arquivo (com variante, se houver). */
  norma: string;
  /** ID do ato (sem variante). */
  ato: string;
  tipo: TipoDispositivo;
  /** Rótulo como está no texto: `Art. 28`, `§ 1º`, `XVI`, `a)`. */
  rotulo: string;
  /** ID completo do dispositivo pai (`null` para artigo, anexo e seção de primeiro nível). */
  pai: string | null;
  /** Texto do próprio dispositivo (com o rótulo), sem os filhos. */
  texto: string;
  /** Textos dos ancestrais, do artigo até o pai (o caput herdado). */
  caput: string[];
  /** Divisões estruturais em que o dispositivo está (`TÍTULO V`, `CAPÍTULO III`...). */
  estrutura: string[];
  notas: NotaDispositivo[];
  revogado: boolean;
  vetado: boolean;
  /** Linhas no arquivo (1-based, inclusivas), contando o front matter. */
  linha_inicio: number;
  linha_fim: number;
  /** Ordem no arquivo (0-based). */
  ordem: number;
}

export type TipoSegmento =
  "resumo" | "editorial" | "rotulo" | "preambulo" | "estrutura" | "dispositivo" | "fecho" | "nao-vigente";

export interface Segmento {
  tipo: TipoSegmento;
  /** ID completo do dispositivo, quando `tipo` é `dispositivo`. */
  dispositivo?: string;
  texto: string;
  linha_inicio: number;
  linha_fim: number;
}

export interface EstruturaNorma {
  id: string;
  ato: string;
  variante: string | null;
  /** Caminho relativo a `base-conhecimento/`. */
  path: string;
  dispositivos: Dispositivo[];
  segmentos: Segmento[];
  /** Problemas de estrutura (o lint de `validar_base.ts` os acusa). */
  problemas: string[];
}

// ---------------------------------------------------------------------------------------------
// Rótulos

const ORDINAL = String.raw`(?:\s*[º°ª]|o(?=[\s.\-–:]|$))?`;
const LETRA = String.raw`(?:\s*[-–]\s*([A-Z])(?![a-zà-ú]))?`;
/** Rótulo de artigo no início de um texto: `Art. 4º-A.`, `Art. 5o`, `ARTIGO 1º`, `Art 5º`, `Art. 10.`. */
const RE_ARTIGO = new RegExp(String.raw`^(?:Art\.?|Artigo|ARTIGO)\s*(\d+)${ORDINAL}${LETRA}\s*[.:]?(?:\*\*)?\s*`);
const RE_PARAGRAFO = new RegExp(String.raw`^§\s*(\d+)${ORDINAL}${LETRA}\s*[.:]?\s*$`);
const RE_PARAGRAFO_UNICO = /^Parágrafo\s+único\s*[.:]?\s*$/i;
const RE_INCISO = /^([IVXLC]+)(?:\s*[-–]\s*([A-Z])(?![a-zà-ú]))?\s*[–—-](?:\s|$)/;
const RE_ALINEA = /^([a-z])\)\s/;
const RE_ITEM = /^(\d+)[.)]\s/;
const RE_ANEXO = /^ANEXO\b(?:\s+([IVXLC]+|\d+)\b)?/i;
const RE_ANEXO_IMPLICITO = /^(?:REGULAMENTO|ESTATUTO|REGIMENTO)\b/;
const RE_FECHO =
  /^(?:(?:Brasília|Curitiba)\s*[,/–-]|Publicad[oa] no Diário|Este (?:texto|conteúdo) não substitui|Documento assinado eletronicamente|A autenticidade d)/i;
/** Assinatura: três ou mais palavras em caixa alta no início do parágrafo (nome de quem assina). */
const RE_ASSINATURA = /^[A-ZÀ-Ú]{3,}(?:\s+(?:D[AEO]S?|[A-ZÀ-Ú]{2,})){2,}(?:\s|$)/;
/**
 * Marcadores (comentário HTML, que não é texto) de trecho que fica fora dos dispositivos:
 * `redacao-nao-vigente` (redação anterior que o arquivo reproduz ao lado da vigente) e
 * `fora-do-ato` (texto que não consta do ato publicado). Fecham com `<!-- /marcador -->`.
 */
const RE_MARCADOR = /^<!--\s*(redacao-nao-vigente|fora-do-ato)\b[^>]*-->$/;
const RE_FIM_MARCADOR = /^<!--\s*\/(redacao-nao-vigente|fora-do-ato)\s*-->$/;

/** Inteiro → romano (I a CCCXCIX). */
export function inteiroParaRomano(n: number): string {
  const tabela: [number, string][] = [
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let resto = n;
  let saida = "";
  for (const [valor, simbolo] of tabela) {
    while (resto >= valor) {
      saida += simbolo;
      resto -= valor;
    }
  }
  return saida;
}

/** Romano → inteiro (para ordenar e validar), ou `null`. */
export function romanoParaInteiro(romano: string): number | null {
  const valores: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let total = 0;
  for (let i = 0; i < romano.length; i++) {
    const atual = valores[romano[i]!];
    const proximo = valores[romano[i + 1] ?? ""] ?? 0;
    if (atual === undefined) return null;
    total += atual < proximo ? -atual : atual;
  }
  return total;
}

/** Rótulo de artigo no início do texto: número, letra e o resto (caput no próprio cabeçalho). */
export function rotuloArtigo(texto: string): { numero: string; letra: string; rotulo: string; resto: string } | null {
  const m = RE_ARTIGO.exec(texto.trim());
  if (!m) return null;
  return {
    numero: m[1]!,
    letra: m[2] ?? "",
    rotulo: m[0].replace(/\*\*/g, "").trim(),
    resto: texto.trim().slice(m[0].length),
  };
}

// ---------------------------------------------------------------------------------------------
// Regiões

/** `## ...` que abrem o texto normativo (além de `## Texto ...`). */
const RE_H2_NORMATIVO =
  /^(?:TÍTULO|CAPÍTULO|LIVRO|PARTE|SEÇÃO|Seção|Subseção|ANEXO|ARTIGO|Art\.|REGULAMENTO|ESTATUTO|REGIMENTO|Lei de Diretrizes e Bases)\b/i;
const RE_H2_TEXTO = /^Texto\b/i;

export type ClasseH2 = "resumo" | "texto" | "normativo" | "editorial";

/** Classe de um cabeçalho `##` do corpo da norma. */
export function classeH2(titulo: string): ClasseH2 {
  const t = titulo.trim();
  if (/^Resumo$/i.test(t)) return "resumo";
  if (RE_H2_TEXTO.test(t)) return "texto";
  if (RE_H2_NORMATIVO.test(t)) return "normativo";
  return "editorial";
}

// ---------------------------------------------------------------------------------------------
// Notas de redação

const RE_NOTA =
  /\((?:\s*)(Redação dada|Incluíd[oa]|Acrescid[oa]|Acrescentad[oa]|Revogad[oa]|Renumerad[oa]|Vide|Vigência|Regulamento|Produção de efeitos)\b[^()]*(?:\([^()]*\)[^()]*)*\)/g;

function tipoNota(chave: string): TipoNota {
  const k = chave.toLowerCase();
  if (k.startsWith("redação")) return "redacao";
  if (k.startsWith("incluíd") || k.startsWith("acrescid") || k.startsWith("acrescentad")) return "inclusao";
  if (k.startsWith("revogad")) return "revogacao";
  if (k.startsWith("renumerad")) return "renumeracao";
  if (k.startsWith("vide")) return "vide";
  if (k.startsWith("regulamento")) return "regulamento";
  return "vigencia";
}

/** Notas de redação de um texto: "(Redação dada pela Lei nº ...)", "(Incluído pela ...)" etc. */
export function notasDoTexto(texto: string): NotaDispositivo[] {
  const notas: NotaDispositivo[] = [];
  for (const m of texto.matchAll(RE_NOTA)) notas.push({ tipo: tipoNota(m[1]!), texto: m[0] });
  return notas;
}

/** Dispositivo revogado: o texto, sem rótulo e sem notas, fica vazio ou é só "Revogado". */
function textoEhRevogado(semRotulo: string, notas: NotaDispositivo[]): boolean {
  const resto = semRotulo
    .replace(RE_NOTA, " ")
    .replace(/[\s.;:,]+/g, " ")
    .trim();
  if (/^\(?\s*revogad[oa]s?\b[^)]*\)?\.?$/i.test(resto)) return true;
  return resto === "" && notas.some((nota) => nota.tipo === "revogacao");
}

function textoEhVetado(semRotulo: string): boolean {
  return /^\(?\s*vetad[oa]\s*\)?\.?$/i.test(semRotulo.replace(RE_NOTA, " ").trim());
}

// ---------------------------------------------------------------------------------------------
// Parser

function linhaInicio(no: Nodes): number {
  return no.position?.start.line ?? 0;
}
function linhaFim(no: Nodes): number {
  return no.position?.end.line ?? 0;
}

/** Texto do primeiro `strong` no início de um parágrafo (o rótulo em negrito), se houver. */
function rotuloNegrito(paragrafo: Paragraph): string | null {
  let primeiro = paragrafo.children.find((filho) => !(filho.type === "text" && filho.value.trim() === ""));
  // Rótulo tachado (dispositivo revogado mantido no arquivo): `~~**Parágrafo único.** ...~~`.
  if (primeiro?.type === "delete") primeiro = primeiro.children[0];
  if (!primeiro || primeiro.type !== "strong") return null;
  return textoDoNo(primeiro as Nodes).trim();
}

interface NoAberto {
  disp: Dispositivo;
  partes: string[];
  /** Partes sem o texto tachado (para reconhecer o dispositivo revogado). */
  vigentes: string[];
  /** Parte local do ID (`art12`, `par1`, `ii`, `al-a`, `item1`, `anexo1-art3`). */
  local: string;
  paiNo: NoAberto | null;
}

class Parser {
  readonly dispositivos: Dispositivo[] = [];
  readonly segmentos: Segmento[] = [];
  readonly problemas: string[] = [];
  private readonly porId = new Map<string, NoAberto>();
  private readonly nos: NoAberto[] = [];
  private readonly alvos = new Map<Segmento, NoAberto>();
  private estrutura: string[] = [];
  /** Artigo corrente, parágrafo corrente (ou `null` no caput), último inciso, última alínea. */
  private artigo: NoAberto | null = null;
  private paragrafo: NoAberto | null = null;
  private inciso: NoAberto | null = null;
  private alinea: NoAberto | null = null;
  /** Último dispositivo que recebeu texto (destino de parágrafos sem rótulo, citações e tabelas). */
  private ultimo: NoAberto | null = null;
  private anexo: NoAberto | null = null;
  private numeroAnexo = 0;
  private artigosNoAto = 0;
  private emFecho = false;
  private secao: NoAberto | null = null;
  private numeroSecao = 0;

  constructor(
    readonly norma: string,
    readonly rotulo: string,
    readonly modoSecao: boolean,
  ) {}

  private prefixo(): string {
    return this.anexo ? `${this.anexo.disp.dispositivo.slice(1)}-` : "";
  }

  segmento(
    tipo: TipoSegmento,
    texto: string,
    inicio: number,
    fim: number,
    alvo?: NoAberto,
    vigente: string = texto,
  ): void {
    if (alvo) {
      alvo.partes.push(texto);
      alvo.vigentes.push(vigente);
      alvo.disp.linha_fim = Math.max(alvo.disp.linha_fim, fim);
      this.ultimo = alvo;
      const segmento: Segmento = {
        tipo: "dispositivo",
        dispositivo: alvo.disp.id,
        texto,
        linha_inicio: inicio,
        linha_fim: fim,
      };
      this.segmentos.push(segmento);
      this.alvos.set(segmento, alvo);
      return;
    }
    this.segmentos.push({ tipo, texto, linha_inicio: inicio, linha_fim: fim });
  }

  private abrir(tipo: TipoDispositivo, sufixo: string, rotulo: string, pai: NoAberto | null, inicio: number): NoAberto {
    const dispositivo = `#${sufixo}`;
    const id = `${this.norma}#${sufixo}`;
    const local = pai ? sufixo.slice(pai.disp.dispositivo.length - 1) : sufixo;
    const caput = pai ? [...pai.disp.caput, this.textoAtual(pai)] : [];
    const disp: Dispositivo = {
      id,
      dispositivo,
      norma: this.norma,
      ato: idDoAto(this.norma),
      tipo,
      rotulo,
      pai: pai?.disp.id ?? null,
      texto: "",
      caput,
      estrutura: [...this.estrutura],
      notas: [],
      revogado: false,
      vetado: false,
      linha_inicio: inicio,
      linha_fim: inicio,
      ordem: this.dispositivos.length,
    };
    const no: NoAberto = { disp, partes: [], vigentes: [], local, paiNo: pai };
    this.dispositivos.push(disp);
    this.nos.push(no);
    if (!this.porId.has(id)) this.porId.set(id, no);
    return no;
  }

  private textoAtual(no: NoAberto): string {
    return palavrasDoTexto(no.partes.join("\n")).join(" ");
  }

  /**
   * Rótulo repetido entre irmãos (erro material do texto publicado, como dois "II" seguidos): os
   * IDs do grupo passam a seguir a posição (`i`, `ii`, `iii`...; `par1`, `par2`...), o `rotulo`
   * continua o do texto e o caso fica em `problemas` como aviso. Só vale para grupos sem letra
   * (`IV-A`), em que a posição não basta.
   */
  private renumerarRepetidos(): void {
    const grupos = new Map<string, NoAberto[]>();
    for (const no of this.nos) {
      if (no.disp.tipo !== "inciso" && no.disp.tipo !== "paragrafo") continue;
      const chave = `${no.paiNo?.disp.ordem ?? -1}|${no.disp.tipo}`;
      grupos.set(chave, [...(grupos.get(chave) ?? []), no]);
    }
    for (const grupo of grupos.values()) {
      const locais = grupo.map((no) => no.local);
      if (new Set(locais).size === locais.length) continue;
      if (locais.some((local) => /[A-Z]$/.test(local) || local === "-parunico")) continue;
      grupo.forEach((no, indice) => {
        const novo =
          no.disp.tipo === "inciso" ? `-${inteiroParaRomano(indice + 1).toLowerCase()}` : `-par${indice + 1}`;
        if (novo !== no.local) {
          this.problemas.push(
            `aviso: ${this.rotulo}:${no.disp.linha_inicio}: rótulo "${no.disp.rotulo}" repetido ou fora de ordem no texto; ID pela posição (${novo.slice(1)})`,
          );
          no.local = novo;
        }
      });
    }
    for (const no of this.nos) {
      const sufixo = no.paiNo ? `${no.paiNo.disp.dispositivo.slice(1)}${no.local}` : no.local;
      no.disp.dispositivo = `#${sufixo}`;
      no.disp.id = `${this.norma}#${sufixo}`;
      no.disp.pai = no.paiNo?.disp.id ?? null;
    }
    for (const [segmento, alvo] of this.alvos) segmento.dispositivo = alvo.disp.id;
    const vistos = new Set<string>();
    for (const no of this.nos) {
      if (vistos.has(no.disp.id)) {
        this.problemas.push(`${this.rotulo}:${no.disp.linha_inicio}: dispositivo repetido ${no.disp.dispositivo}`);
      }
      vistos.add(no.disp.id);
    }
  }

  /** Fecha os textos: junta as partes, extrai notas e marca revogados. */
  finalizar(): void {
    this.renumerarRepetidos();
    for (const no of this.nos) {
      const texto = this.textoAtual(no);
      no.disp.texto = texto;
      no.disp.notas = notasDoTexto(texto);
      const vigente = palavrasDoTexto(no.vigentes.join("\n")).join(" ");
      const semRotulo = vigente.startsWith(no.disp.rotulo) ? vigente.slice(no.disp.rotulo.length) : vigente;
      no.disp.revogado = textoEhRevogado(semRotulo.replace(/^[\s.–—-]+/, ""), no.disp.notas);
      no.disp.vetado = textoEhVetado(semRotulo.replace(/^[\s.–—-]+/, ""));
    }
  }

  private fecharArtigo(): void {
    this.artigo = null;
    this.paragrafo = null;
    this.inciso = null;
    this.alinea = null;
  }

  /** Cabeçalho dentro do texto normativo. */
  cabecalho(no: Heading): void {
    const texto = textoDoNo(no).trim();
    const inicio = linhaInicio(no);
    const fim = linhaFim(no);
    const art = this.modoSecao ? null : rotuloArtigo(texto);
    if (art) {
      this.emFecho = false;
      this.inciso = null;
      this.alinea = null;
      this.paragrafo = null;
      const sufixo = `${this.prefixo()}art${art.numero}${art.letra}`;
      this.artigo = this.abrir("artigo", sufixo, art.rotulo, null, inicio);
      if (!this.anexo) this.artigosNoAto++;
      this.segmento("dispositivo", texto, inicio, fim, this.artigo);
      if (art.resto.trim())
        this.problemas.push(`${this.rotulo}:${inicio}: cabeçalho de artigo com texto além do rótulo`);
      if (no.depth !== 4)
        this.problemas.push(`${this.rotulo}:${inicio}: cabeçalho de artigo deve ser de nível 4 (####)`);
      return;
    }
    this.fecharArtigo();
    this.emFecho = false;
    const anexo = RE_ANEXO.exec(texto);
    const implicito = !this.anexo && this.artigosNoAto > 0 && RE_ANEXO_IMPLICITO.test(texto);
    if (!this.modoSecao && (anexo || implicito)) {
      const numero = anexo?.[1]
        ? (romanoParaInteiro(anexo[1].toUpperCase()) ?? Number(anexo[1]))
        : this.numeroAnexo + 1;
      if (!this.anexo || numero !== this.numeroAnexo) {
        this.numeroAnexo = numero;
        this.anexo = null;
        this.estrutura = [];
        this.anexo = this.abrir("anexo", `anexo${numero}`, texto, null, inicio);
        this.segmento("dispositivo", texto, inicio, fim, this.anexo);
        return;
      }
    }
    if (this.modoSecao) {
      this.numeroSecao++;
      this.secao = this.abrir("secao", `secao${this.numeroSecao}`, texto, null, inicio);
      this.segmento("dispositivo", texto, inicio, fim, this.secao);
      return;
    }
    // Divisão estrutural ou rubrica: atualiza a pilha de estrutura pelo nível do cabeçalho.
    const nivel = no.depth;
    this.estrutura = [...this.estrutura.slice(0, Math.max(0, nivel - 2)), texto];
    this.ultimo = null;
    if (this.anexo) this.segmento("dispositivo", texto, inicio, fim, this.anexo);
    else this.segmento("estrutura", texto, inicio, fim);
  }

  /** Destino de um bloco sem rótulo próprio. */
  private destino(): NoAberto | null {
    if (this.emFecho) return null;
    if (this.modoSecao) return this.secao;
    return this.ultimo ?? this.artigo ?? this.anexo;
  }

  bloco(no: RootContent): void {
    const inicio = linhaInicio(no as Nodes);
    const fim = linhaFim(no as Nodes);
    if (no.type === "heading") return this.cabecalho(no);
    if (no.type === "list") return this.lista(no, null);
    if (no.type === "paragraph") return this.paragrafoMd(no);
    const texto = textoDoNo(no as Nodes);
    const alvo = this.destino();
    if (alvo) this.segmento("dispositivo", texto, inicio, fim, alvo);
    else
      this.segmento(
        this.emFecho ? "fecho" : this.artigosNoAto || this.anexo ? "estrutura" : "preambulo",
        texto,
        inicio,
        fim,
      );
  }

  private paragrafoMd(no: Paragraph): void {
    const inicio = linhaInicio(no);
    const fim = linhaFim(no);
    const texto = textoDoNo(no);
    const negrito = rotuloNegrito(no);
    if (!this.modoSecao && negrito === null && /^(?:§\s*\d|Parágrafo\s+único)/i.test(texto.trim())) {
      this.problemas.push(
        `${this.rotulo}:${inicio}: rótulo de parágrafo sem negrito (use **§ 1º** ou **Parágrafo único.**)`,
      );
    }
    if (texto.trim() === "**") this.problemas.push(`${this.rotulo}:${inicio}: \`**\` solto`);
    if (!this.modoSecao && this.artigo && negrito !== null) {
      const par = RE_PARAGRAFO.exec(negrito);
      const unico = RE_PARAGRAFO_UNICO.test(negrito);
      if (par || unico) {
        this.emFecho = false;
        const sufixo = `${this.artigo.disp.dispositivo.slice(1)}-par${unico ? "unico" : `${par![1]}${par![2] ?? ""}`}`;
        this.paragrafo = this.abrir("paragrafo", sufixo, negrito.replace(/[.:]$/, ""), this.artigo, inicio);
        this.inciso = null;
        this.alinea = null;
        this.segmento("dispositivo", texto, inicio, fim, this.paragrafo, textoDoNo(no, { semRiscado: true }));
        return;
      }
    }
    if (
      !this.modoSecao &&
      (this.artigosNoAto > 0 || this.anexo) &&
      !this.emFecho &&
      (RE_FECHO.test(texto.trim()) || (!this.anexo && this.artigo !== null && RE_ASSINATURA.test(texto.trim())))
    ) {
      this.emFecho = true;
      this.fecharArtigo();
      this.ultimo = null;
    }
    const alvo = this.destino();
    if (alvo) this.segmento("dispositivo", texto, inicio, fim, alvo, textoDoNo(no, { semRiscado: true }));
    else this.segmento(this.emFecho ? "fecho" : this.artigosNoAto > 0 ? "estrutura" : "preambulo", texto, inicio, fim);
  }

  /** Lista: incisos, alíneas e itens; itens sem rótulo vão para o último dispositivo. */
  private lista(lista: List, paiItem: NoAberto | null): void {
    let numero = lista.start ?? 1;
    for (const item of lista.children) {
      this.itemLista(item, lista, numero, paiItem);
      numero++;
    }
  }

  private itemLista(item: ListItem, lista: List, numero: number, paiItem: NoAberto | null): void {
    const inicio = linhaInicio(item);
    const primeiro = item.children[0];
    const textoPrimeiro = primeiro?.type === "paragraph" ? textoDoNo(primeiro).trim() : "";
    const negrito = primeiro?.type === "paragraph" ? rotuloNegrito(primeiro) : null;
    let aberto: NoAberto | null = null;

    if (!this.modoSecao && negrito === null && RE_INCISO.test(`${textoPrimeiro} `)) {
      this.problemas.push(`${this.rotulo}:${inicio}: inciso sem negrito (use - **I –** texto)`);
    }
    if (!this.modoSecao && !this.emFecho && (this.artigo || this.anexo)) {
      const inciso = negrito !== null ? RE_INCISO.exec(negrito + " ") : null;
      const alinea = RE_ALINEA.exec(textoPrimeiro);
      const itemNumerado = lista.ordered ? null : RE_ITEM.exec(textoPrimeiro);
      if (inciso && this.artigo) {
        const pai = this.paragrafo ?? this.artigo;
        const sufixo = `${pai.disp.dispositivo.slice(1)}-${inciso[1]!.toLowerCase()}${inciso[2] ?? ""}`;
        aberto = this.abrir("inciso", sufixo, `${inciso[1]}${inciso[2] ? `-${inciso[2]}` : ""}`, pai, inicio);
        this.inciso = aberto;
        this.alinea = null;
      } else if (alinea && this.artigo) {
        const pai = paiItem?.disp.tipo === "inciso" ? paiItem : (this.inciso ?? this.paragrafo ?? this.artigo);
        aberto = this.abrir("alinea", `${pai.disp.dispositivo.slice(1)}-al-${alinea[1]}`, `${alinea[1]})`, pai, inicio);
        this.alinea = aberto;
      } else if (
        (lista.ordered || itemNumerado) &&
        (paiItem?.disp.tipo === "alinea" || this.alinea === paiItem) &&
        paiItem
      ) {
        const n = itemNumerado ? Number(itemNumerado[1]) : numero;
        aberto = this.abrir("item", `${paiItem.disp.dispositivo.slice(1)}-item${n}`, `${n}`, paiItem, inicio);
      } else if (this.anexo && !this.artigo && paiItem === null) {
        const n = itemNumerado ? Number(itemNumerado[1]) : numero;
        aberto = this.abrir("item", `${this.anexo.disp.dispositivo.slice(1)}-item${n}`, `${n}`, this.anexo, inicio);
      }
    }

    for (const filho of item.children) {
      if (filho.type === "list") {
        this.lista(filho, aberto ?? paiItem);
        continue;
      }
      const texto = textoDoNo(filho as Nodes);
      const alvo = aberto ?? this.destino();
      if (alvo)
        this.segmento(
          "dispositivo",
          texto,
          linhaInicio(filho as Nodes),
          linhaFim(filho as Nodes),
          alvo,
          textoDoNo(filho as Nodes, { semRiscado: true }),
        );
      else
        this.segmento(
          this.emFecho ? "fecho" : this.artigosNoAto > 0 ? "estrutura" : "preambulo",
          texto,
          linhaInicio(filho as Nodes),
          linhaFim(filho as Nodes),
        );
      if (aberto) this.ultimo = aberto;
    }
  }
}

/** Há cabeçalho de artigo no texto normativo? (senão, a norma é lida por seção). */
function temArtigos(nos: RootContent[]): boolean {
  return nos.some((no) => no.type === "heading" && rotuloArtigo(textoDoNo(no).trim()) !== null);
}

/** Estrutura de uma norma a partir do texto do arquivo (com front matter). */
export function analisarNorma(texto: string, opcoes: { id: string; path: string }): EstruturaNorma {
  const arvore = arvoreMarkdown(texto);
  const rotulo = opcoes.path;
  type Regiao = "inicio" | "resumo" | "normativo" | "editorial";
  let regiao: Regiao = "inicio";
  const normativos: RootContent[] = [];
  const classes: { no: RootContent; regiao: Regiao; rotuloTexto: boolean }[] = [];
  for (const no of arvore.children) {
    let rotuloTexto = false;
    if (no.type === "heading" && no.depth <= 2) {
      const classe = classeH2(textoDoNo(no));
      if (classe === "resumo") regiao = "resumo";
      else if (classe === "editorial") regiao = "editorial";
      else {
        regiao = "normativo";
        rotuloTexto = classe === "texto";
      }
    } else if (no.type === "thematicBreak" && regiao === "resumo") {
      regiao = "normativo";
    }
    classes.push({ no, regiao, rotuloTexto });
    if (regiao === "normativo" && !rotuloTexto) normativos.push(no);
  }

  const parser = new Parser(opcoes.id, rotulo, !temArtigos(normativos));
  let marcador: TipoSegmento | null = null;
  for (const { no, regiao, rotuloTexto } of classes) {
    const inicio = linhaInicio(no as Nodes);
    const fim = linhaFim(no as Nodes);
    if (no.type === "html") {
      const abre = RE_MARCADOR.exec(no.value.trim());
      if (abre) {
        marcador = abre[1] === "fora-do-ato" ? "editorial" : "nao-vigente";
        continue;
      }
      if (RE_FIM_MARCADOR.test(no.value.trim())) {
        marcador = null;
        continue;
      }
    }
    if (marcador) {
      parser.segmento(marcador, textoDoNo(no as Nodes), inicio, fim);
      continue;
    }
    if (regiao === "normativo" && rotuloTexto && parser.modoSecao) {
      parser.cabecalho(no as Heading);
      continue;
    }
    if (regiao !== "normativo" || rotuloTexto) {
      const tipo: TipoSegmento = rotuloTexto
        ? "rotulo"
        : regiao === "resumo"
          ? "resumo"
          : regiao === "inicio"
            ? "editorial"
            : "editorial";
      parser.segmento(tipo, textoDoNo(no as Nodes), inicio, fim);
      continue;
    }
    parser.bloco(no);
  }
  if (marcador) parser.problemas.push(`${rotulo}: marcador de trecho (${marcador}) sem fechamento`);
  parser.finalizar();
  return {
    id: opcoes.id,
    ato: idDoAto(opcoes.id),
    variante: varianteDoId(opcoes.id),
    path: opcoes.path,
    dispositivos: parser.dispositivos,
    segmentos: parser.segmentos,
    problemas: parser.problemas,
  };
}

// ---------------------------------------------------------------------------------------------
// Carga das normas da base

export interface ArquivoNorma {
  id: string;
  /** Relativo a `base-conhecimento/`. */
  path: string;
  arquivo: string;
}

function listarMd(diretorio: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(diretorio)) {
    const caminho = path.join(diretorio, nome);
    if (statSync(caminho).isDirectory()) saida.push(...listarMd(caminho));
    else if (nome.endsWith(".md")) saida.push(caminho);
  }
  return saida;
}

/** Normas da base (Markdown em `base-conhecimento/normas/`), por ordem de caminho. */
export function listarNormas(raiz: string = raizRepositorio()): ArquivoNorma[] {
  const base = path.join(raiz, "base-conhecimento");
  return listarMd(path.join(base, "normas"))
    .map((arquivo) => {
      const relativo = path.relative(base, arquivo).split(path.sep).join("/");
      const { meta } = analisarFrontMatter(readFileSync(arquivo, "utf-8"), relativo);
      return { id: String(meta.id), path: relativo, arquivo };
    })
    .sort((a, b) => compararTexto(a.path, b.path));
}

const cacheEstruturas = new Map<string, EstruturaNorma[]>();

/** Estrutura de todas as normas da base. */
export function carregarEstruturas(raiz: string = raizRepositorio()): EstruturaNorma[] {
  const emCache = cacheEstruturas.get(raiz);
  if (emCache) return emCache;
  const estruturas = listarNormas(raiz).map((norma) =>
    analisarNorma(readFileSync(norma.arquivo, "utf-8"), { id: norma.id, path: norma.path }),
  );
  cacheEstruturas.set(raiz, estruturas);
  return estruturas;
}

/**
 * Dispositivos de todas as normas da base, na ordem dos arquivos. A compilação da LDB
 * (`br/lei/1996/9394~compilacao`) entra com o ID do arquivo; `dispositivosDoAto` deduplica.
 */
export function carregarDispositivos(raiz: string = raizRepositorio()): Dispositivo[] {
  return carregarEstruturas(raiz).flatMap((estrutura) => estrutura.dispositivos);
}

/**
 * Índice de dispositivos por ID do ato (`br/lei/1996/9394#art36`). Deduplicação da compilação: o
 * texto integral do ato prevalece; o dispositivo da compilação só entra quando o integral não o
 * tem (hoje não acontece: os trechos da LDB estão todos no texto integral).
 */
export function indiceDispositivos(raiz: string = raizRepositorio()): Map<string, Dispositivo> {
  const indice = new Map<string, Dispositivo>();
  const variantes: Dispositivo[] = [];
  for (const disp of carregarDispositivos(raiz)) {
    if (disp.norma !== disp.ato) {
      variantes.push(disp);
      continue;
    }
    indice.set(`${disp.ato}${disp.dispositivo}`, disp);
  }
  for (const disp of variantes) {
    const chave = `${disp.ato}${disp.dispositivo}`;
    if (!indice.has(chave)) indice.set(chave, disp);
  }
  return indice;
}

/** Dispositivos de um ato (deduplicados pela regra de `indiceDispositivos`), em ordem. */
export function dispositivosDoAto(ato: string, raiz: string = raizRepositorio()): Dispositivo[] {
  return [...indiceDispositivos(raiz).values()]
    .filter((disp) => disp.ato === ato)
    .sort((a, b) => (a.norma === b.norma ? a.ordem - b.ordem : a.norma === a.ato ? -1 : 1));
}

/** Dispositivo pelo ID (`br/cne-cp/res/2026/2#art71-parunico`); aceita o ID do arquivo com variante. */
export function obterDispositivo(id: string, raiz: string = raizRepositorio()): Dispositivo | undefined {
  const [norma, sufixo] = id.split("#");
  if (!sufixo) return undefined;
  const indice = indiceDispositivos(raiz);
  const direto = indice.get(`${idDoAto(norma!)}#${sufixo}`);
  if (direto && (norma === direto.ato || norma === direto.norma)) return direto;
  if (norma !== idDoAto(norma!)) return carregarDispositivos(raiz).find((disp) => disp.id === id);
  return direto;
}

/** Descendentes de um dispositivo (filhos, netos...), em ordem. */
export function descendentes(id: string, raiz: string = raizRepositorio()): Dispositivo[] {
  const todos = carregarDispositivos(raiz);
  const alvo = todos.find((disp) => disp.id === id);
  if (!alvo) return [];
  const ids = new Set([alvo.id]);
  const saida: Dispositivo[] = [];
  for (const disp of todos) {
    if (disp.pai && ids.has(disp.pai)) {
      ids.add(disp.id);
      saida.push(disp);
    }
  }
  return saida;
}

/** Palavras dos segmentos concatenados (régua da reconstituição). */
export function palavrasDosSegmentos(segmentos: readonly Segmento[]): string[] {
  return palavrasDoTexto(segmentos.map((segmento) => segmento.texto).join("\n"));
}
