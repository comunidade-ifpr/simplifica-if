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
import type { EntradaRegistro } from "@simplifica-if/kb/normas/registro";
import { Registro } from "@simplifica-if/kb/normas/registro";
import type { Relacao } from "@simplifica-if/kb/normas/relacoes";
import { converterPpc } from "./conversao-docx/conversao.ts";
import { type PreConferencia, preConferir } from "./pre-conferencia.ts";
import { chave, type CursoCnct, type Fonte } from "./verificadores/comum.ts";
import { comoNoDocumento } from "./verificadores/curriculo.ts";

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
  /** `data_referencia` da base (AAAA-MM-DD). */
  dataBase: string;
};

export type OpcoesRevisaoPrevia = {
  /** Relógio da rodada (data dos comentários e do aviso). */
  agora: Date;
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
  noDocumento: LocalNoDocumento;
};

export type CriterioConferido = {
  ficha: string;
  titulo: string;
  tema: string;
  ordemTema: number;
  estado: "atende" | "nao_atende" | "a_conferir" | "nao_se_aplica";
  mensagem: string;
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
  conferidos: number;
  totalCriterios: number;
  dataBase: string;
  /** Texto do comentário-aviso no título. */
  aviso: string;
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

const dentroDoInicio = (markdown: string) => chave(markdown.split("\n").slice(0, 200).join(" ").replace(/[*_#|]/g, " "));

/** O curso do CNCT cuja denominação aparece no início do PPC (a mais longa, se houver várias). */
export function identificarCnct(markdown: string, cncts: readonly CursoCnct[]): CursoCnct | null {
  const inicio = ` ${dentroDoInicio(markdown).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ")} `;
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

const ROMANOS = /^(?=[ivxlc]+$)c{0,3}(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/;
const ordinal = (n: string) => (Number(n) <= 9 ? `${n}º` : n);

/** `art29-par2` → "art. 29, § 2º"; `art28-xviii` → "art. 28, inciso XVIII"; `anexo1-art5` → "Anexo 1, art. 5º". */
export function rotuloDispositivo(dispositivo: string): string {
  return dispositivo
    .split("-")
    .map((parte) => {
      let m = /^art(\d+)([a-z]?)$/i.exec(parte);
      if (m) return `art. ${ordinal(m[1]!)}${m[2] ? `-${m[2].toUpperCase()}` : ""}`;
      if (parte === "parunico") return "parágrafo único";
      m = /^par(\d+)$/.exec(parte);
      if (m) return `§ ${ordinal(m[1]!)}`;
      m = /^anexo(\d*)$/.exec(parte);
      if (m) return `Anexo${m[1] ? ` ${m[1]}` : ""}`;
      // Letra só é alínea, salvo i, v e x, que são incisos (c e l, em romanos, seriam 100 e 50).
      if (/^[a-z]$/.test(parte) && !"ivx".includes(parte)) return `alínea ${parte}`;
      if (ROMANOS.test(parte)) return `inciso ${parte.toUpperCase()}`;
      return parte;
    })
    .join(", ");
}

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

/* ============================================================ pendências e comentários */

function temaDaFicha(ficha: string, base: BaseRevisaoPrevia): number {
  const topicos = base.topicos.filter((t) => t.fichas.includes(ficha)).map((t) => t.id);
  const indice = TEMAS.findIndex((tema) => tema.topicos.some((t) => topicos.includes(t)));
  // Ficha sem tópico conhecido (base sem a taxonomia): fica em "Coerência do conjunto", no fim.
  return indice >= 0 ? indice : TEMAS.length - 1;
}

type ItemInterno = Omit<PendenciaRevisao, "noDocumento"> & { trechos: string[] };

function itensDaPreConferencia(resultado: PreConferencia, registro: Registro, base: BaseRevisaoPrevia): ItemInterno[] {
  const fontes = (links: readonly Fonte[]) =>
    links.flatMap((link) => fonteLegivel(link, registro, base) ?? []).filter((f, i, todas) => {
      return todas.findIndex((g) => g.rotulo === f.rotulo) === i;
    });
  const itens: ItemInterno[] = resultado.triagem.map((achado) => ({
    ficha: "TRIAGEM",
    tituloFicha: achado.regra === "texto-dirigido-a-ia" ? "Texto dirigido a IA" : "Seções do modelo",
    tema: TEMAS[0]!.titulo,
    ordemTema: 0,
    estado: achado.estado,
    mensagem: achado.mensagem,
    oQueFazer: O_QUE_FAZER[achado.regra]!,
    trecho: achado.trechos[0] ? comoNoDocumento(achado.trechos[0].texto) : null,
    secao: achado.trechos[0]?.secao ?? null,
    trechos: achado.trechos.map((t) => comoNoDocumento(t.texto)).filter(Boolean),
    fontes: [],
  }));
  for (const ficha of resultado.fichas) {
    const ordemTema = temaDaFicha(ficha.ficha, base);
    const comum = {
      ficha: ficha.ficha,
      tituloFicha: base.fichas[ficha.ficha] ?? ficha.ficha,
      tema: TEMAS[ordemTema]!.titulo,
      ordemTema,
      oQueFazer: O_QUE_FAZER[ficha.ficha] ?? "Confira o critério no PPC.",
    };
    for (const apontamento of ficha.apontamentos) {
      const trechos = apontamento.trechos.map((t) => comoNoDocumento(t.texto)).filter(Boolean);
      itens.push({
        ...comum,
        estado: apontamento.estado,
        mensagem: apontamento.mensagem,
        trecho: trechos[0] ?? null,
        secao: apontamento.trechos[0]?.secao ?? null,
        trechos,
        fontes: fontes(apontamento.fontes),
      });
    }
    // Ficha sem apontamento mas sem "atende" (o curso não foi identificado no CNCT): um item só.
    if (!ficha.apontamentos.length && (ficha.estado === "a_conferir" || ficha.estado === "nao_atende") && ficha.mensagem)
      itens.push({
        ...comum,
        estado: ficha.estado,
        mensagem: ficha.mensagem,
        trecho: null,
        secao: null,
        trechos: [],
        fontes: fontes(ficha.fontes),
      });
  }
  return itens.sort((a, b) => a.ordemTema - b.ordemTema);
}

/** Texto do comentário de uma pendência, para quem lê no Word. */
export function textoDoComentario(item: Pick<PendenciaRevisao, "estado" | "mensagem" | "oQueFazer" | "fontes" | "ficha">) {
  const linhas = [
    item.estado === "nao_atende" ? `Pendência: ${item.mensagem}` : `Confira: ${item.mensagem}`,
    item.estado === "nao_atende" ? `O que fazer: ${item.oQueFazer}` : `Se for o caso: ${item.oQueFazer}`,
  ];
  if (item.fontes.length)
    linhas.push(`Fonte: ${item.fontes.map((f) => (f.url ? `${f.rotulo} (${f.url})` : f.rotulo)).join("; ")}.`);
  const criterio = item.ficha === "TRIAGEM" ? "Triagem" : `Critério ${item.ficha}`;
  return `${linhas.join("\n")}\n\n${criterio} da revisão prévia do Simplifica IF.`;
}

const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

function textoDoAviso(entrada: {
  agora: Date;
  dataBase: string;
  conferidos: number;
  totalCriterios: number;
  curso: CursoIdentificado;
  pendencias: readonly PendenciaRevisao[];
}): string {
  const naoAtende = entrada.pendencias.filter((p) => p.estado === "nao_atende").length;
  const aConferir = entrada.pendencias.length - naoAtende;
  const total =
    entrada.totalCriterios > entrada.conferidos
      ? `${entrada.conferidos} de ${entrada.totalCriterios} critérios conferidos automaticamente; os demais exigem leitura.`
      : `${entrada.conferidos} critérios conferidos automaticamente; os demais exigem leitura.`;
  const curso = entrada.curso.cnct
    ? `Curso considerado: ${entrada.curso.cnct.denominacao} (CNCT)${entrada.curso.forma ? `, forma ${entrada.curso.forma}` : ""}.`
    : "O curso não foi identificado no CNCT: os critérios que dependem dele ficaram para conferir.";
  const fora = entrada.pendencias.filter((p) => p.noDocumento === "so-na-lista");
  const partes = [
    `Revisão prévia do Simplifica IF, de ${dataBr(entrada.agora.toISOString())}, com a base de normas de ${dataBr(entrada.dataBase)}. Não é parecer da PROENS e não substitui a análise oficial.`,
    `${total} ${curso}`,
    `Resultado: ${naoAtende} pendência(s) e ${aConferir} ponto(s) para conferir.`,
  ];
  if (fora.length)
    partes.push(
      `Não localizados no texto (sem marca no documento):\n${fora.map((p) => `- ${p.estado === "nao_atende" ? "Pendência" : "Confira"}: ${p.mensagem}`).join("\n")}`,
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
  });
  const itens = itensDaPreConferencia(resultado, registro, base);
  const conferidos = resultado.fichas.length;
  const totalCriterios = Math.max(Object.keys(base.fichas).length, conferidos);

  // Duas passadas: as pendências, e depois o aviso no título, cujo texto depende de onde elas ficaram.
  const comentar = { data: opcoes.agora.toISOString(), autor: AUTOR_COMENTARIOS };
  const anotacoes = itens.map((item) => ({
    trechos: item.trechos,
    texto: textoDoComentario(item),
    noInicioSeAusente: item.trechos.length === 0,
  }));
  const comentado = comentarDocx(bytes, anotacoes, comentar);
  const ancoradas = new Map(comentado.ancoradas.map((a) => [a.indice, a.noInicio]));
  const pendencias: PendenciaRevisao[] = itens.map(({ trechos: _, ...item }, indice) => ({
    ...item,
    noDocumento: !ancoradas.has(indice) ? "so-na-lista" : ancoradas.get(indice) ? "no-inicio" : "no-trecho",
  }));
  const aviso = textoDoAviso({ agora: opcoes.agora, dataBase: base.dataBase, conferidos, totalCriterios, curso, pendencias });
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
    };
  });
  return {
    docx: final.docx,
    curso,
    pendencias,
    criterios,
    conferidos,
    totalCriterios,
    dataBase: base.dataBase,
    aviso,
  };
}
