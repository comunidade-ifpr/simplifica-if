/**
 * Revisão prévia sem IA de um PPC em DOCX (M1.11, etapa 3): converte, identifica o curso no CNCT,
 * roda a pré-conferência (`pre-conferencia.ts`) e devolve a lista de pendências e uma cópia do DOCX
 * com um comentário do Word por pendência (`@simplifica-if/docx/comentarios`).
 *
 * Função pura sobre bytes e dados planos: não lê arquivo nem banco. O servidor do app a chama num
 * `Worker` (`apps/server/src/revisao-ppc/`), com a base montada do `kb.sqlite`; por isso a base
 * (`BaseRevisaoPrevia`) é só dado clonável, e o `Registro` é remontado aqui.
 *
 * Quem lê os comentários é a coordenação ou a pedagogia, no Word: cada comentário diz o problema
 * numa frase, o que fazer e a fonte com nome e dispositivo da norma (e o endereço oficial, quando a
 * base o tem; `ifpr://` não abre no Word). O que é "a conferir" sai como "Confira:", nunca como erro.
 * Um comentário no título avisa que é revisão prévia, não parecer da PROENS, com a data da base e o
 * que foi e o que não foi conferido. Trecho que não se acha num só parágrafo do DOCX não é ancorado
 * em lugar nenhum: fica na lista e no aviso do título.
 */
import { comentarDocx } from "@simplifica-if/docx/comentarios";
import { strFromU8, unzipSync } from "fflate";
import type { EntradaRegistro } from "@simplifica-if/kb/normas/registro";
import { Registro } from "@simplifica-if/kb/normas/registro";
import type { Relacao } from "@simplifica-if/kb/normas/relacoes";
import type { DatasNorma, Transicao } from "@simplifica-if/kb/normas/vigencia";
import { converterPpc } from "./conversao-docx/conversao.ts";
import { achadosParaComentarios, type PreConferencia, preConferir } from "./pre-conferencia.ts";
import { chave, type CursoCnct, type Fonte } from "./verificadores/comum.ts";
import { comoNoDocumento } from "./verificadores/curriculo.ts";
import { rotuloDispositivo } from "./verificadores/dispositivos.ts";
import { vigenciaDeDados } from "./verificadores/vigencia.ts";

export { rotuloDispositivo };

/** A base da revisão prévia, só com dados planos (atravessa o `postMessage` do Worker). */
export type BaseRevisaoPrevia = {
  /** `Registro.entradas` (normas da base, stubs e externos). */
  normas: readonly EntradaRegistro[];
  relacoes: readonly Relacao[];
  cncts: readonly CursoCnct[];
  /** Endereço oficial (http) da norma, quando a base o registra. */
  urls: Readonly<Record<string, string>>;
  /** Título de cada ficha da `revisar-ppc` (o total é o número de critérios da revisão). */
  fichas: Readonly<Record<string, string>>;
  /** Tópicos das fichas (`topicos-fichas.json`), na ordem da taxonomia. */
  topicos: readonly { id: string; fichas: readonly string[] }[];
  /** Datas dos atos (publicação, início da vigência), para a vigência na data da base. */
  datas: ReadonlyMap<string, DatasNorma>;
  /** Regras de transição (`transicoes.yaml`). */
  transicoes: readonly Transicao[];
  /** `data_referencia` da base (AAAA-MM-DD): a data em que a vigência é calculada. */
  dataBase: string;
};

/**
 * O resultado de uma ficha S ou J avaliada pela IA e já conferido em código (`revisao-ia/`). `FALHOU`:
 * a resposta não passou na conferência duas vezes; a ficha sai "a conferir", com `motivoFalha`.
 */
export type ResultadoFichaIa = {
  ficha: string;
  estado: "ATENDE" | "NAO_ATENDE" | "INCONCLUSIVO" | "NAO_APLICAVEL" | "FALHOU";
  confianca: number;
  justificativa: string;
  lacunas: string[];
  oQueFazer: string;
  /** Trechos literais do PPC (Markdown), conferidos. */
  trechos: string[];
  /** IDs de fonte conferidos (`br/cne-cp/res/2026/2#art29`, `cnct`). */
  fontes: string[];
  revisaoHumana: boolean;
  motivoFalha?: string | undefined;
};

/** O que a revisão com IA acrescenta: os resultados conferidos e as fichas que ficaram de fora. */
export type EntradaIa = {
  resultados: ResultadoFichaIa[];
  /** Fichas S e J fora da revisão (modo rápido), para o aviso do título. */
  fora: string[];
};

export type OpcoesRevisaoPrevia = {
  /** Relógio da rodada (data dos comentários e do aviso). */
  agora: Date;
  /** Os resultados da revisão com IA, para juntar à lista e aos comentários (etapa 4). */
  ia?: EntradaIa | undefined;
  /** CNCT escolhido pela pessoa (slug); sem ele, o curso é identificado no documento. */
  cnct?: string | undefined;
  /** Forma de oferta escolhida pela pessoa; sem ela, identificada no documento. */
  forma?: string | undefined;
};

export type FonteLegivel = { rotulo: string; url: string | null; link: Fonte };

/** Onde o comentário ficou no DOCX. */
export type LocalNoDocumento = "no-trecho" | "no-inicio" | "so-na-lista";

export type PendenciaRevisao = {
  ficha: string;
  tituloFicha: string;
  tema: string;
  ordemTema: number;
  estado: "nao_atende" | "a_conferir";
  mensagem: string;
  oQueFazer: string;
  /** Trecho do PPC como está no documento (o primeiro), quando há. */
  trecho: string | null;
  secao: string | null;
  fontes: FonteLegivel[];
  /** Outras fichas que apontam o mesmo trecho ou a mesma norma ausente (`ItemComentario.fichas`). */
  tambemEm: { ficha: string; titulo: string }[];
  noDocumento: LocalNoDocumento;
  /** `codigo`: conferido pela base (fichas D e triagem); `ia`: avaliação da IA, conferida em código. */
  origem: "codigo" | "ia";
};

export type CriterioConferido = {
  ficha: string;
  titulo: string;
  tema: string;
  ordemTema: number;
  estado: "atende" | "nao_atende" | "a_conferir" | "nao_se_aplica";
  mensagem: string;
  origem: "codigo" | "ia";
};

export type CursoIdentificado = {
  cnct: { slug: string; denominacao: string } | null;
  forma: string | null;
  /** `documento`: achado no texto; `pessoa`: escolhido na tela. */
  origem: "documento" | "pessoa";
};

export type RevisaoPrevia = {
  docx: Uint8Array;
  curso: CursoIdentificado;
  pendencias: PendenciaRevisao[];
  criterios: CriterioConferido[];
  /** Critérios conferidos pelo código (fichas D). */
  conferidos: number;
  /** Critérios avaliados pela IA (fichas S e J), 0 sem a revisão com IA. */
  conferidosIa: number;
  /** Títulos dos critérios que ficaram de fora (o modo rápido), vazio sem IA ou no completo. */
  foraDaRevisao: string[];
  totalCriterios: number;
  dataBase: string;
  /** Texto do comentário-aviso no título. */
  aviso: string;
  /** O PPC convertido (a revisão com IA monta os recortes dele). */
  markdown: string;
  /** Linhas do Markdown com texto dirigido a IA (a triagem): retiradas do que a IA recebe. */
  linhasTextoParaIa: number[];
};

export const AUTOR_COMENTARIOS = "Simplifica IF (revisão prévia)";
const URL_CNCT = "https://portal.mec.gov.br/catalogos-nacionais-de-cursos-tecnicos";

/**
 * Temas na ordem do parecer da PROENS (as paradas da proposta B), com os tópicos da taxonomia de
 * cada um. A pendência vai para o tema do primeiro tópico da ficha que aparece aqui.
 */
export const TEMAS: readonly { titulo: string; topicos: readonly string[] }[] = [
  { titulo: "Antes de começar", topicos: [] },
  { titulo: "Identificação e oferta", topicos: ["identificacao_oferta"] },
  { titulo: "Matriz e estrutura curricular", topicos: ["matriz_curricular"] },
  { titulo: "Perfil do egresso e CNCT", topicos: ["perfil_egresso_mundo_trabalho"] },
  { titulo: "Ementário e referências", topicos: ["ementario_bibliografias"] },
  { titulo: "Fundamentos legais e normativos", topicos: ["referencias_normativas"] },
  {
    titulo: "Acesso, permanência, AEE e inclusão",
    topicos: ["assistencia_estudantil_permanencia", "aee_acessibilidade_inclusao"],
  },
  { titulo: "Estágio, aproveitamento e TFC", topicos: ["estagio", "aproveitamento_certificacao_tfc"] },
  {
    titulo: "Justificativa, objetivos, concepção e metodologias",
    topicos: ["justificativa_objetivos", "concepcao_metodologias"],
  },
  { titulo: "Avaliação da aprendizagem e do curso", topicos: ["avaliacao_aprendizagem", "avaliacao_ppc_egressos"] },
  { titulo: "Corpo docente, gestão e infraestrutura", topicos: ["corpo_docente_gestao", "infraestrutura"] },
  { titulo: "Temas transversais", topicos: ["temas_transversais_cidadania"] },
  { titulo: "Coerência do conjunto", topicos: ["sintese_transversal_revisao"] },
];

/** O que fazer, por ficha D (e pela triagem): uma frase para quem edita o PPC. */
const O_QUE_FAZER: Record<string, string> = {
  "CT-IDENT-01": "Use no PPC a denominação do curso exatamente como está no CNCT.",
  "CT-IDENT-08":
    "Nas seções de identidade, fundamente o curso nas diretrizes vigentes (DCN da EPT e, no integrado, a DCNEM), no lugar das revogadas.",
  "CT-IDENT-13": "Declare o eixo tecnológico como está no CNCT.",
  "CT-CURR-02":
    "Confira a carga horária total na identificação, na matriz e no texto, e se ela atinge o mínimo exigido.",
  "CT-CURR-16": "Descreva a escolaridade exigida no ingresso conforme o CNCT e a forma de oferta.",
  "CT-CURR-18": "Inclua na matriz ou no ementário os componentes obrigatórios da Formação Geral Básica.",
  "CT-CURR-22":
    "Retire o AEE da matriz e do quadro de componentes; descreva-o como serviço de apoio, na seção de inclusão.",
  "CT-SUP-09": "Inclua na seção de referências as normas citadas no texto e os marcos vigentes da forma de oferta.",
  "CT-SUP-12": "Substitua a norma revogada pela vigente ou deixe claro que a citação é só histórica.",
  "CT-SUP-14": "Mencione o CNCT e os marcos institucionais do IFPR (PDI, PPI, Regimento Geral ou Estatuto).",
  "CT-SUP-21": "Trate a legislação profissional que o CNCT indica (atribuições, registro no conselho).",
  "CT-SUP-24":
    "Cite a Resolução CONSUP/IFPR nº 239/2025, a Política de Assistência Estudantil vigente, no lugar das revogadas.",
  "texto-dirigido-a-ia": "Remova o trecho antes de submeter o PPC.",
  "secoes-do-modelo":
    "Confira se as seções existem com outro título; se faltarem, inclua-as conforme o modelo de PPC da PROENS.",
};

/* ============================================================ curso */

const dentroDoInicio = (markdown: string) =>
  chave(
    markdown
      .split("\n")
      .slice(0, 200)
      .join(" ")
      .replace(/[*_#|]/g, " "),
  );

/** O curso do CNCT cuja denominação aparece no início do PPC (a mais longa, se houver várias). */
export function identificarCnct(markdown: string, cncts: readonly CursoCnct[]): CursoCnct | null {
  const inicio = ` ${dentroDoInicio(markdown)
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")} `;
  let melhor: CursoCnct | null = null;
  for (const curso of cncts) {
    const alvo = chave(curso.denominacao)
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (alvo && inicio.includes(` ${alvo} `) && (!melhor || alvo.length > chave(melhor.denominacao).length))
      melhor = curso;
  }
  return melhor;
}

/** A forma de oferta declarada no início do PPC: PROEJA se aparece; senão, a mais citada. */
export function identificarForma(markdown: string): string | null {
  const inicio = dentroDoInicio(markdown);
  if (/\bproeja\b|educacao de jovens e adultos/.test(inicio)) return "proeja";
  const contagem = (padrao: RegExp) => inicio.match(padrao)?.length ?? 0;
  const formas = [
    ["integrado", contagem(/\bintegrad[oa]\b/g)],
    ["subsequente", contagem(/\bsubsequente\b/g)],
    ["concomitante", contagem(/\bconcomitante\b/g)],
  ] as const;
  const [forma, vezes] = [...formas].sort((a, b) => b[1] - a[1])[0]!;
  return vezes > 0 ? forma : null;
}

/* ============================================================ fontes */

function fonteLegivel(link: Fonte, registro: Registro, base: BaseRevisaoPrevia): FonteLegivel | null {
  const norma = /^ifpr:\/\/norma\/([^#]+)(?:#(.+))?$/.exec(link);
  if (norma) {
    const [, id, dispositivo] = norma;
    const titulo = registro.obter(id!)?.title ?? id!;
    return {
      rotulo: dispositivo ? `${titulo}, ${rotuloDispositivo(dispositivo)}` : titulo,
      url: base.urls[id!] ?? null,
      link,
    };
  }
  const cnct = /^ifpr:\/\/cnct\/(.+)$/.exec(link);
  if (cnct) {
    const curso = base.cncts.find((c) => c.slug === cnct[1]);
    return {
      rotulo: `Catálogo Nacional de Cursos Técnicos (CNCT)${curso ? `, ${curso.denominacao}` : ""}`,
      url: URL_CNCT,
      link,
    };
  }
  return null; // ifpr://ficha/… é interno: não vai ao Word.
}

/**
 * As fontes legíveis, uma por norma: os dispositivos da mesma norma vão juntos ("Resolução CNE/CP
 * nº 2/2026, arts. 70 e 71"), e a norma citada inteira some quando também há dispositivo dela.
 */
export function agruparFontes(links: readonly Fonte[], registro: Registro, base: BaseRevisaoPrevia): FonteLegivel[] {
  const grupos = new Map<string, { primeira: FonteLegivel; titulo: string; dispositivos: string[] }>();
  for (const link of links) {
    const legivel = fonteLegivel(link, registro, base);
    if (!legivel) continue;
    const norma = /^ifpr:\/\/norma\/([^#]+)(?:#(.+))?$/.exec(link);
    const chaveGrupo = norma ? `norma:${norma[1]}` : `outro:${legivel.rotulo}`;
    const grupo = grupos.get(chaveGrupo) ?? {
      primeira: legivel,
      titulo: norma ? (registro.obter(norma[1]!)?.title ?? norma[1]!) : legivel.rotulo,
      dispositivos: [],
    };
    if (norma?.[2]) {
      const rotulo = rotuloDispositivo(norma[2]);
      if (!grupo.dispositivos.includes(rotulo)) grupo.dispositivos.push(rotulo);
    }
    grupos.set(chaveGrupo, grupo);
  }
  return [...grupos.values()].map(({ primeira, titulo, dispositivos }) => {
    if (!dispositivos.length) return { ...primeira, rotulo: primeira.rotulo };
    const soArtigos = dispositivos.every((d) => /^art\. [^,]+$/.test(d));
    const juntos =
      dispositivos.length === 1
        ? dispositivos[0]!
        : soArtigos
          ? `arts. ${dispositivos
              .map((d) => d.slice(5))
              .join(", ")
              .replace(/, ([^,]+)$/, " e $1")}`
          : dispositivos.join("; ");
    return { ...primeira, rotulo: `${titulo}, ${juntos}` };
  });
}

/* ============================================================ pendências e comentários */

function temaDaFicha(ficha: string, base: BaseRevisaoPrevia): number {
  const topicos = base.topicos.filter((t) => t.fichas.includes(ficha)).map((t) => t.id);
  const indice = TEMAS.findIndex((tema) => tema.topicos.some((t) => topicos.includes(t)));
  // Ficha sem tópico conhecido (base sem a taxonomia): fica em "Coerência do conjunto", no fim.
  return indice >= 0 ? indice : TEMAS.length - 1;
}

type ItemInterno = Omit<PendenciaRevisao, "noDocumento"> & { trechos: string[] };

/** A fonte de um resultado da IA como link `ifpr://` (a base dá o rótulo legível). */
const linkDaFonte = (fonte: string, cnct: string | null): Fonte | null =>
  fonte.startsWith("cnct") ? (cnct ? `ifpr://cnct/${cnct}` : null) : `ifpr://norma/${fonte}`;

/** O estado da lista para um resultado da IA, ou nulo quando não há pendência. */
function estadoDaIa(r: ResultadoFichaIa): "nao_atende" | "a_conferir" | null {
  if (r.estado === "FALHOU" || r.estado === "INCONCLUSIVO") return "a_conferir";
  if (r.estado === "NAO_ATENDE") return r.confianca >= 0.6 && !r.revisaoHumana ? "nao_atende" : "a_conferir";
  if (r.revisaoHumana && r.lacunas.length) return "a_conferir";
  return null;
}

const ponto = (texto: string) => (/[.!?]$/.test(texto.trim()) ? texto.trim() : `${texto.trim()}.`);

function itensDaIa(ia: EntradaIa, registro: Registro, base: BaseRevisaoPrevia, cnct: string | null): ItemInterno[] {
  const itens: ItemInterno[] = [];
  for (const r of ia.resultados) {
    const estado = estadoDaIa(r);
    if (!estado) continue;
    const ordemTema = temaDaFicha(r.ficha, base);
    const mensagem =
      r.estado === "FALHOU"
        ? `Não foi possível conferir este critério com a IA (${r.motivoFalha ?? "resposta fora do formato"}). Confira na leitura: ${base.fichas[r.ficha] ?? r.ficha}.`
        : [
            ponto(r.justificativa),
            r.lacunas.length ? `Falta: ${r.lacunas.map((l) => l.replace(/[.;]\s*$/, "")).join("; ")}.` : "",
          ]
            .filter(Boolean)
            .join(" ");
    const trechos = r.trechos.map(comoNoDocumento).filter(Boolean);
    itens.push({
      ficha: r.ficha,
      tituloFicha: base.fichas[r.ficha] ?? r.ficha,
      tema: TEMAS[ordemTema]!.titulo,
      ordemTema,
      estado,
      mensagem,
      oQueFazer: r.oQueFazer.trim() ? ponto(r.oQueFazer) : "Confira o critério no PPC.",
      trecho: trechos[0] ?? null,
      secao: null,
      trechos: trechos.slice(0, 1),
      fontes: agruparFontes(
        r.fontes.map((f) => linkDaFonte(f, cnct)).filter((f): f is Fonte => f !== null),
        registro,
        base,
      ),
      tambemEm: [],
      origem: "ia",
    });
  }
  return itens;
}

const ESTADO_CRITERIO_IA: Record<ResultadoFichaIa["estado"], CriterioConferido["estado"]> = {
  ATENDE: "atende",
  NAO_ATENDE: "nao_atende",
  INCONCLUSIVO: "a_conferir",
  NAO_APLICAVEL: "nao_se_aplica",
  FALHOU: "a_conferir",
};

/**
 * A mensagem do verificador para quem lê no Word: os dispositivos citados como ID (`art70`,
 * `art29-par2`) por extenso, e a transição e a orientação sobre a data do PPC em linhas próprias.
 */
export const legivel = (mensagem: string) =>
  mensagem
    .replace(/, ((?:art|anexo)\d[0-9a-z-]*)\)/gi, (_, dispositivo: string) => `, ${rotuloDispositivo(dispositivo)})`)
    // A nota interna de que outra ficha é a responsável (as fichas vão em "Também apontado em").
    .replace(/ Registrado aqui; a pendência é da [A-Z]+-[A-Z]+-\d+\./g, "")
    .replace(/ (Regras de transição: )/, "\n$1")
    .replace(/ (Se o PPC foi elaborado antes de a nova norma)/, "\n$1");

/** O sufixo que `achadosParaComentarios` põe na mensagem; aqui as outras fichas vão em `tambemEm`. */
const SUFIXO_TAMBEM = / \(Também em [^)]*\.\)$/;

function itensDaPreConferencia(resultado: PreConferencia, registro: Registro, base: BaseRevisaoPrevia): ItemInterno[] {
  const fontes = (links: readonly Fonte[]) => agruparFontes(links, registro, base);
  const dadosDaFicha = (ficha: string) => {
    const ordemTema = temaDaFicha(ficha, base);
    return {
      ficha,
      tituloFicha: base.fichas[ficha] ?? ficha,
      tema: TEMAS[ordemTema]!.titulo,
      ordemTema,
      oQueFazer: O_QUE_FAZER[ficha] ?? "Confira o critério no PPC.",
    };
  };
  const itens: ItemInterno[] = resultado.triagem.map((achado) => ({
    ficha: "TRIAGEM",
    tituloFicha: achado.regra === "texto-dirigido-a-ia" ? "Texto dirigido a IA" : "Seções do modelo",
    tema: TEMAS[0]!.titulo,
    ordemTema: 0,
    estado: achado.estado,
    // A ação vai em "O que fazer"; a mensagem da triagem a repetia.
    mensagem: achado.mensagem.replace(/ Remova antes de submeter\.$/, ""),
    oQueFazer: O_QUE_FAZER[achado.regra]!,
    trecho: achado.trechos[0] ? comoNoDocumento(achado.trechos[0].texto) : null,
    secao: achado.trechos[0]?.secao ?? null,
    trechos: achado.trechos.map((t) => comoNoDocumento(t.texto)).filter(Boolean),
    fontes: [],
    tambemEm: [],
    origem: "codigo" as const,
  }));
  // A seção de cada trecho (o item agrupado traz só o texto como no documento).
  const secoes = new Map<string, string | null>();
  for (const ficha of resultado.fichas)
    for (const apontamento of ficha.apontamentos)
      for (const t of apontamento.trechos) secoes.set(comoNoDocumento(t.texto), t.secao);
  // Um item por trecho (ou por norma ausente), com a ficha que define a gravidade e as demais.
  for (const item of achadosParaComentarios(resultado)) {
    if (item.ficha === "TRIAGEM") continue;
    itens.push({
      ...dadosDaFicha(item.ficha),
      estado: item.estado,
      mensagem: legivel(item.mensagem.replace(SUFIXO_TAMBEM, "")),
      trecho: item.trechos[0] ?? null,
      secao: item.trechos[0] ? (secoes.get(item.trechos[0]) ?? null) : null,
      trechos: item.trechos,
      fontes: fontes(item.fontes),
      tambemEm: item.fichas.slice(1).map((ficha) => ({ ficha, titulo: base.fichas[ficha] ?? ficha })),
      origem: "codigo",
    });
  }
  // Ficha sem apontamento mas sem "atende" (o curso não foi identificado no CNCT): um item só.
  for (const ficha of resultado.fichas)
    if (
      !ficha.apontamentos.length &&
      (ficha.estado === "a_conferir" || ficha.estado === "nao_atende") &&
      ficha.mensagem
    )
      itens.push({
        ...dadosDaFicha(ficha.ficha),
        estado: ficha.estado,
        mensagem: legivel(ficha.mensagem),
        trecho: null,
        secao: null,
        trechos: [],
        fontes: fontes(ficha.fontes),
        tambemEm: [],
        origem: "codigo",
      });
  return itens.sort((a, b) => a.ordemTema - b.ordemTema);
}

type ItemDoComentario = Pick<
  PendenciaRevisao,
  "estado" | "mensagem" | "oQueFazer" | "fontes" | "ficha" | "tambemEm" | "origem"
>;

const linhaFontes = (fontes: readonly FonteLegivel[]) =>
  `Fonte: ${fontes.map((f) => (f.url ? `${f.rotulo} (${f.url})` : f.rotulo)).join("; ")}.`;

const linhaTambem = (item: ItemDoComentario) => `Também apontado em: ${item.tambemEm.map((t) => t.titulo).join("; ")}.`;

/** As linhas de uma pendência: o problema, o que fazer, a fonte e as outras fichas. */
function linhasDaPendencia(item: ItemDoComentario): string[] {
  const linhas = [
    item.estado === "nao_atende" ? `Pendência: ${item.mensagem}` : `Confira: ${item.mensagem}`,
    item.estado === "nao_atende" ? `O que fazer: ${item.oQueFazer}` : `Se for o caso: ${item.oQueFazer}`,
  ];
  if (item.fontes.length) linhas.push(linhaFontes(item.fontes));
  if (item.tambemEm.length) linhas.push(linhaTambem(item));
  return linhas;
}

/** Texto do comentário de uma pendência ancorada num trecho, para quem lê no Word. */
export function textoDoComentario(item: ItemDoComentario) {
  // Os códigos das fichas só numa referência discreta no fim, para quem cruza com a lista do app.
  const codigos =
    item.ficha === "TRIAGEM" ? "" : ` (ref. ${[item.ficha, ...item.tambemEm.map((t) => t.ficha)].join(", ")})`;
  const quem = item.origem === "ia" ? ", avaliação da IA conferida pelo app" : "";
  return `${linhasDaPendencia(item).join("\n")}\n\nRevisão prévia do Simplifica IF${quem}${codigos}.`;
}

const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** A forma de oferta como a pessoa a escreve (o slug fica na API). */
export const NOME_DA_FORMA: Record<string, string> = {
  integrado: "Integrado",
  subsequente: "Subsequente",
  concomitante: "Concomitante",
  proeja: "PROEJA",
};

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

const ONDE_DESCONHECIDO = "que pode estar dividido entre parágrafos ou escrito de outro jeito no arquivo";

/** O começo do trecho, com reticências, para citá-lo num comentário. */
const resumir = (trecho: string, limite = 80) =>
  trecho.length <= limite ? trecho : `${trecho.slice(0, limite).replace(/\s+\S*$/, "")}…`;

const normalizarTexto = (texto: string) => texto.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Onde provavelmente está um trecho que não se achou num parágrafo do corpo: numa caixa de texto ou
 * forma (a conversão lê o texto delas; o comentário do Word não as alcança), ou, sem isso, dividido
 * entre parágrafos ou escrito de outro jeito.
 */
export function ondeNoArquivo(docx: Uint8Array, trecho: string): string {
  const alvo = normalizarTexto(trecho);
  if (!alvo) return ONDE_DESCONHECIDO;
  const documento = unzipSync(docx, { filter: (f) => f.name === "word/document.xml" })["word/document.xml"];
  if (!documento) return ONDE_DESCONHECIDO;
  for (const caixa of strFromU8(documento).matchAll(/<w:txbxContent\b[\s\S]*?<\/w:txbxContent>/g)) {
    const texto = [...caixa[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(" ");
    if (normalizarTexto(texto).includes(alvo))
      return "provavelmente numa caixa de texto ou forma, onde o comentário do Word não alcança";
  }
  return ONDE_DESCONHECIDO;
}

/**
 * O comentário do título: o aviso de revisão prévia, o que foi conferido, as ausências (o que falta
 * no documento não tem trecho onde comentar: vai aqui, numa lista, em vez de vários comentários
 * empilhados no título) e os itens não localizados no texto.
 */
function textoDoAviso(entrada: {
  agora: Date;
  dataBase: string;
  conferidos: number;
  conferidosIa: number;
  foraDaRevisao: readonly string[];
  totalCriterios: number;
  curso: CursoIdentificado;
  pendencias: readonly PendenciaRevisao[];
  /** Onde o trecho não localizado provavelmente está (`ondeNoArquivo`). */
  onde: ReadonlyMap<PendenciaRevisao, string>;
}): string {
  const naoAtende = entrada.pendencias.filter((p) => p.estado === "nao_atende").length;
  const aConferir = entrada.pendencias.length - naoAtende;
  const vistos = entrada.conferidos + entrada.conferidosIa;
  const total =
    entrada.conferidosIa > 0
      ? `${vistos} de ${entrada.totalCriterios} critérios conferidos: ${entrada.conferidos} pelo código, com a base de normas, e ${entrada.conferidosIa} pela IA, com cada trecho e cada norma citados conferidos pelo app. ${
          entrada.foraDaRevisao.length
            ? `Ficaram de fora (modo rápido): ${entrada.foraDaRevisao.join("; ")}.`
            : vistos < entrada.totalCriterios
              ? "Os demais exigem leitura."
              : ""
        }`.trim()
      : entrada.totalCriterios > entrada.conferidos
        ? `${entrada.conferidos} de ${entrada.totalCriterios} critérios conferidos automaticamente; os demais exigem leitura.`
        : `${entrada.conferidos} critérios conferidos automaticamente; os demais exigem leitura.`;
  const curso = entrada.curso.cnct
    ? `Curso considerado: ${entrada.curso.cnct.denominacao} (CNCT)${entrada.curso.forma ? `, forma de oferta: ${NOME_DA_FORMA[entrada.curso.forma] ?? entrada.curso.forma}` : ""}.`
    : "O curso não foi identificado no CNCT: os critérios que dependem dele ficaram para conferir.";
  const partes = [
    `Revisão prévia do Simplifica IF, de ${dataBr(entrada.agora.toISOString())}, com a base de normas de ${dataBr(entrada.dataBase)}. Não é parecer da PROENS e não substitui a análise oficial.`,
    `${total} ${curso}`,
    `Resultado: ${plural(naoAtende, "pendência", "pendências")} e ${plural(aConferir, "ponto para conferir", "pontos para conferir")}.`,
  ];
  const ausentes = entrada.pendencias.filter((p) => p.noDocumento === "no-inicio");
  if (ausentes.length)
    partes.push(
      `O que falta no documento (sem trecho onde comentar):\n${ausentes.map((p) => `- ${linhasDaPendencia(p).join(" ")}`).join("\n")}`,
    );
  const fora = entrada.pendencias.filter((p) => p.noDocumento === "so-na-lista");
  if (fora.length)
    partes.push(
      `Não localizados no texto (sem marca no documento):\n${fora
        .map((p) => {
          const [problema, ...resto] = linhasDaPendencia(p);
          const onde = entrada.onde.get(p) ?? ONDE_DESCONHECIDO;
          return `- ${problema} Trecho: "${resumir(p.trecho ?? "")}", ${onde}. ${resto.join(" ")}`;
        })
        .join("\n")}`,
    );
  return partes.join("\n\n");
}

/** Converte, pré-confere e comenta. Lança `ErroDocx` (mensagem em português) para arquivo inválido. */
export function revisarDocx(
  bytes: Uint8Array,
  nomeDoArquivo: string,
  base: BaseRevisaoPrevia,
  opcoes: OpcoesRevisaoPrevia,
): RevisaoPrevia {
  const conversao = converterPpc(bytes, nomeDoArquivo, { agora: opcoes.agora });
  const registro = new Registro(base.normas);
  const escolhido = opcoes.cnct ? (base.cncts.find((c) => c.slug === opcoes.cnct) ?? null) : undefined;
  const cnct = escolhido !== undefined ? escolhido : identificarCnct(conversao.markdown, base.cncts);
  const forma = opcoes.forma ?? identificarForma(conversao.markdown);
  const curso: CursoIdentificado = {
    cnct: cnct ? { slug: cnct.slug, denominacao: cnct.denominacao } : null,
    forma,
    origem: opcoes.cnct || opcoes.forma ? "pessoa" : "documento",
  };
  const resultado = preConferir(conversao.markdown, {
    cnct,
    forma: forma ?? "",
    registro,
    relacoes: base.relacoes,
    // Sempre da base recebida: sem ela, os verificadores leriam a vigência do checkout, que o app não tem.
    vigencia: vigenciaDeDados(base, base.dataBase),
  });
  const itens = [
    ...itensDaPreConferencia(resultado, registro, base),
    ...(opcoes.ia ? itensDaIa(opcoes.ia, registro, base, cnct?.slug ?? null) : []),
  ].sort((a, b) => a.ordemTema - b.ordemTema);
  const conferidos = resultado.fichas.length;
  const conferidosIa = opcoes.ia?.resultados.length ?? 0;
  const foraDaRevisao = (opcoes.ia?.fora ?? []).map((f) => base.fichas[f] ?? f);
  const totalCriterios = Math.max(Object.keys(base.fichas).length, conferidos);

  // Duas passadas: as pendências com trecho, e depois o aviso no título, com as ausências e o que
  // não foi localizado.
  const comentar = { data: opcoes.agora.toISOString(), autor: AUTOR_COMENTARIOS };
  const comTrecho = itens.flatMap((item, indice) => (item.trechos.length ? [indice] : []));
  const comentado = comentarDocx(
    bytes,
    comTrecho.map((indice) => ({ trechos: itens[indice]!.trechos, texto: textoDoComentario(itens[indice]!) })),
    comentar,
  );
  const ancoradas = new Set(comentado.ancoradas.map((a) => comTrecho[a.indice]!));
  const pendencias: PendenciaRevisao[] = itens.map(({ trechos, ...item }, indice) => ({
    ...item,
    noDocumento: !trechos.length ? "no-inicio" : ancoradas.has(indice) ? "no-trecho" : "so-na-lista",
  }));
  const onde = new Map(
    pendencias.filter((p) => p.noDocumento === "so-na-lista").map((p) => [p, ondeNoArquivo(bytes, p.trecho ?? "")]),
  );
  const aviso = textoDoAviso({
    onde,
    agora: opcoes.agora,
    dataBase: base.dataBase,
    conferidos,
    conferidosIa,
    foraDaRevisao,
    totalCriterios,
    curso,
    pendencias,
  });
  const final = comentarDocx(comentado.docx, [{ trechos: [], texto: aviso, noInicioSeAusente: true }], comentar);
  const criterios: CriterioConferido[] = resultado.fichas.map((ficha) => {
    const ordemTema = temaDaFicha(ficha.ficha, base);
    return {
      ficha: ficha.ficha,
      titulo: base.fichas[ficha.ficha] ?? ficha.ficha,
      tema: TEMAS[ordemTema]!.titulo,
      ordemTema,
      estado: ficha.estado,
      mensagem: ficha.mensagem,
      origem: "codigo" as const,
    };
  });
  for (const r of opcoes.ia?.resultados ?? []) {
    const ordemTema = temaDaFicha(r.ficha, base);
    criterios.push({
      ficha: r.ficha,
      titulo: base.fichas[r.ficha] ?? r.ficha,
      tema: TEMAS[ordemTema]!.titulo,
      ordemTema,
      estado: ESTADO_CRITERIO_IA[r.estado],
      mensagem: r.estado === "FALHOU" ? `Não conferido: ${r.motivoFalha ?? ""}` : r.justificativa,
      origem: "ia",
    });
  }
  return {
    docx: final.docx,
    curso,
    pendencias,
    criterios,
    conferidos,
    conferidosIa,
    foraDaRevisao,
    totalCriterios,
    dataBase: base.dataBase,
    aviso,
    markdown: conversao.markdown,
    linhasTextoParaIa: resultado.triagem
      .filter((a) => a.regra === "texto-dirigido-a-ia")
      .flatMap((a) => a.trechos.map((t) => t.linha)),
  };
}
