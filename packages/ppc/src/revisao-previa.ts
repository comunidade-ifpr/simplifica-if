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
import { textosDeCaixas } from "@simplifica-if/docx/leitor";
import { PacoteOoxml } from "@simplifica-if/docx/pacote";
import type { EntradaRegistro } from "@simplifica-if/kb/normas/registro";
import type { SecaoPpc } from "@simplifica-if/kb/ppcs/secoes";
import { Registro } from "@simplifica-if/kb/normas/registro";
import type { Relacao } from "@simplifica-if/kb/normas/relacoes";
import type { DatasNorma, TextoConsolidado, Transicao } from "@simplifica-if/kb/normas/vigencia";
import { converterPpc } from "./conversao-docx/conversao.ts";
import { identificarCurso } from "./identificacao.ts";
import { indiceDeLinhas } from "./localizar-trecho.ts";
import { alvoDosTrechos, LIMITES_RESPOSTA, textoDoMaiorPedaco } from "./revisao-ia/conferencia.ts";
import { achadosParaComentarios, type PreConferencia, preConferir } from "./pre-conferencia.ts";
import { TEMAS, ordemDoTema } from "./temas.ts";
import {
  type BaseVerificacao,
  type CursoCnct,
  type Fonte,
  linkCnct,
  linkNorma,
  tituloDaNorma,
} from "./verificadores/comum.ts";
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
  /** Título de cada ficha da revisão de PPC (o total é o número de critérios da revisão). */
  fichas: Readonly<Record<string, string>>;
  /** Tópicos das fichas (`topicos-fichas.json`), na ordem da taxonomia. */
  topicos: readonly { id: string; fichas: readonly string[] }[];
  /** Datas dos atos (publicação, início da vigência), para a vigência na data da base. */
  datas: ReadonlyMap<string, DatasNorma>;
  /** Regras de transição (`transicoes.yaml`). */
  transicoes: readonly Transicao[];
  /** O que os textos consolidados mostram na data da base (piso do status das normas). */
  consolidado: TextoConsolidado;
  /**
   * O dia em que a vigência é calculada (AAAA-MM-DD): no app, o da revisão; nos scripts e testes, a
   * `data_referencia` da base, para o resultado não mudar com o calendário.
   */
  dataBase: string;
};

/**
 * A parte da base dos verificadores que não depende do PPC, derivada da base da revisão prévia: o
 * registro, as relações e a vigência na data (padrão: a `dataBase`). É a mesma no app, nos scripts e
 * nos testes, porque a base é uma só (`base-revisao.ts`).
 */
export function verificacaoDaBase(
  base: BaseRevisaoPrevia,
  data: string = base.dataBase,
): Pick<BaseVerificacao, "registro" | "relacoes" | "vigencia"> {
  return { registro: new Registro(base.normas), relacoes: base.relacoes, vigencia: vigenciaDeDados(base, data) };
}

/**
 * O resultado de uma ficha S ou J avaliada pela IA e já conferido em código (`revisao-ia/`). `FALHOU`:
 * a resposta não passou na conferência duas vezes; a ficha sai "a conferir", com `motivoFalha`.
 */
export type ResultadoFichaIa = {
  ficha: string;
  estado: "ATENDE" | "NAO_ATENDE" | "INCONCLUSIVO" | "NAO_APLICAVEL" | "FALHOU";
  confianca: number;
  /** O problema numa frase curta, escrito pela IA; ausente nas respostas gravadas antes deste campo. */
  titulo?: string | undefined;
  justificativa: string;
  lacunas: string[];
  oQueFazer: string;
  /** Trechos literais do PPC (Markdown), conferidos. */
  trechos: string[];
  /** IDs de fonte conferidos (`br/cne-cp/res/2026/2#art29`, `cnct`). */
  fontes: string[];
  /**
   * Revisão humana obrigatória, decidida pelo código: a triagem achou texto dirigido a IA no PPC
   * (desde a revisão da etapa 5, a IA não responde mais este campo).
   */
  revisaoHumana: boolean;
  motivoFalha?: string | undefined;
  /**
   * O tipo do NAO_ATENDE, só no critério `ausencia` da revisão com IA (etapa 5):
   * `ausencia_em_secao_presente`, `contradicao` ou `merito`.
   */
  tipoAchado?: "ausencia_em_secao_presente" | "contradicao" | "merito" | undefined;
};

/** O que a revisão com IA acrescenta: os resultados conferidos e as fichas que ficaram de fora. */
export type EntradaIa = {
  resultados: ResultadoFichaIa[];
  /** Fichas S e J fora da revisão (modo rápido), para o aviso do título. */
  fora: string[];
  /**
   * A leitura com IA ainda não leu todos os blocos (em andamento, pausada ou encerrada antes do fim):
   * os resultados são parciais, e o aviso diz quantos critérios ainda não foram lidos.
   */
  parcial?: boolean | undefined;
};

/** Quanto a leitura com IA cobriu: nada, uma parte dos blocos ou todos. */
export type LeituraIa = "nenhuma" | "parcial" | "completa";

export const leituraDaIa = (ia: EntradaIa | undefined): LeituraIa =>
  ia === undefined ? "nenhuma" : ia.parcial === true ? "parcial" : "completa";

export type OpcoesRevisaoPrevia = {
  /** Relógio da rodada (data dos comentários e do aviso). */
  agora: Date;
  /** Os resultados da revisão com IA, para juntar à lista e aos comentários (etapa 4). */
  ia?: EntradaIa | undefined;
  /** CNCT escolhido pela pessoa (slug); sem ele, o curso é identificado no documento. */
  cnct?: string | undefined;
  /** Forma de oferta escolhida pela pessoa; sem ela, identificada no documento. */
  forma?: string | undefined;
  /**
   * A situação de cada pendência na lista viva (etapa 5b), pela `chavePendencia`: a retirada depois de
   * contestação conferida sai do documento; as outras levam a situação no comentário; o aviso do
   * título conta tudo.
   */
  situacoes?: Readonly<Record<string, MarcaPendencia>> | undefined;
  /**
   * Avisado quando cada etapa começa (o servidor repassa à interface): a identificação do curso, a
   * conferência dos critérios e a gravação dos comentários. A leitura do arquivo começa antes.
   */
  aoEtapa?: ((etapa: EtapaRevisaoPrevia) => void) | undefined;
};

/** As etapas de `revisarDocx` depois da conversão, na ordem em que começam. */
export type EtapaRevisaoPrevia = "identificando" | "conferindo" | "gravando";

export type FonteLegivel = { rotulo: string; url: string | null; link: Fonte };

/** Onde o comentário ficou no DOCX. */
export type LocalNoDocumento = "no-trecho" | "no-inicio" | "so-na-lista";

export type PendenciaRevisao = {
  ficha: string;
  tituloFicha: string;
  tema: string;
  ordemTema: number;
  estado: "nao_atende" | "a_conferir";
  /** O problema numa frase: o título da linha na tela e a primeira linha do comentário no Word. */
  titulo: string;
  /** O resto da explicação (o raciocínio da IA, a regra de transição); `null` quando o título diz tudo. */
  explicacao: string | null;
  /** O que falta no PPC, item a item (as lacunas da IA); vazio quando a pendência não é de ausência. */
  faltas: readonly string[];
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
  /**
   * A pendência existe porque o curso não foi identificado no CNCT (`FICHAS_DO_CURSO`): some quando a
   * pessoa escolhe o curso e a revisão roda de novo com ele.
   */
  dependeDoCurso: boolean;
};

/**
 * As fichas D que conferem o PPC contra o curso do CNCT (denominação, eixo, carga horária mínima,
 * escolaridade de ingresso, legislação profissional). Sem o curso, o que elas apontam depende dele.
 */
export const FICHAS_DO_CURSO: ReadonlySet<string> = new Set([
  "CT-IDENT-01",
  "CT-IDENT-13",
  "CT-CURR-02",
  "CT-CURR-16",
  "CT-SUP-21",
]);

/** A situação de uma pendência na lista viva (M1.11, etapa 5b), mantida pelo servidor. */
export type SituacaoPendencia = "aberta" | "resolvida" | "contestada_aceita" | "contestada_mantida";

/** A situação e, quando há, a nota que vai ao comentário (quem resolveu, o que a revisão manteve). */
export type MarcaPendencia = {
  situacao: SituacaoPendencia;
  nota?: string | undefined;
  /** Sai do documento: só a pendência que a reanálise do arquivo atualizado confirmou como resolvida. */
  foraDoDocumento?: boolean | undefined;
};

/** O texto de uma pendência (título, explicação e o que falta): o que a pessoa lê, sem a ação. */
type TextoPendencia = Pick<PendenciaRevisao, "titulo" | "explicacao" | "faltas">;

/** "Falta: a; b." (vazio sem faltas): o que falta numa linha, para o Word e para os pedidos à IA. */
export const linhaDasFaltas = (faltas: readonly string[]): string =>
  faltas.length ? `Falta: ${faltas.join("; ")}.` : "";

/**
 * A pendência num texto só, uma parte por linha: para o comentário no Word, o pedido à IA (contestar,
 * sugerir), a exportação e a chave. A tela não usa: ela mostra as partes.
 */
export const textoDaPendencia = (p: TextoPendencia): string =>
  [p.titulo, p.explicacao ?? "", linhaDasFaltas(p.faltas)].filter(Boolean).join("\n");

/** Palavras que terminam em ponto sem fechar a frase ("art. 28", "Res. CNE/CP", "nº"). */
const ABREVIATURA =
  /(?:^|[\s(“"])(?:arts?|incs?|als?|n|nº|res|resol|port|dec|cf|ex|p|pp|par|parág|sec|cap|prof|profa|dr|dra|sr|sra|obs|vs|fls?|proc|etc)$/i;

/**
 * Separa um texto no título (a primeira frase, ou a primeira linha) e no resto. Abreviatura e número
 * não fecham a frase. Nenhuma palavra se perde: o que não é o título é a explicação.
 */
export function tituloEExplicacao(texto: string): Pick<PendenciaRevisao, "titulo" | "explicacao"> {
  const limpo = texto.trim();
  const quebra = limpo.indexOf("\n");
  let corte = quebra;
  const fim = /[.!?](?=\s+[A-ZÀ-Ý“"(])/g;
  for (let m = fim.exec(limpo); m !== null; m = fim.exec(limpo)) {
    if (quebra !== -1 && m.index > quebra) break;
    const antes = limpo.slice(0, m.index);
    if (antes.length < 24 || (m[0] === "." && ABREVIATURA.test(antes))) continue;
    corte = m.index + 1;
    break;
  }
  if (corte <= 0) return { titulo: limpo, explicacao: null };
  const explicacao = limpo.slice(corte).trim();
  return { titulo: limpo.slice(0, corte).trim(), explicacao: explicacao === "" ? null : explicacao };
}

/**
 * A chave estável de uma pendência: a ficha e um hash (FNV-1a) da origem, do trecho e do texto. As do
 * código são determinísticas, e a mesma pendência da pré-conferência tem a mesma chave depois da
 * revisão com IA (a situação marcada passa de uma lista para a outra).
 */
export function chavePendencia(p: Pick<PendenciaRevisao, "ficha" | "origem" | "trecho"> & TextoPendencia): string {
  const texto = [p.ficha, p.origem, p.trecho ?? "", textoDaPendencia(p)]
    .map((t) => t.replace(/\s+/g, " ").trim())
    .join("|");
  let h = 0x811c9dc5;
  for (const c of texto) {
    h ^= c.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${p.ficha}:${h.toString(16).padStart(8, "0")}`;
}

const NOTA_SITUACAO: Record<SituacaoPendencia, string> = {
  aberta: "",
  resolvida: "Situação no app: marcada como resolvida.",
  contestada_aceita:
    "Situação no app: a coordenação contestou, e a IA trouxe um trecho do PPC que o app conferiu. Confira antes de dar por resolvido.",
  contestada_mantida: "Situação no app: a coordenação discordou, e a revisão manteve o apontamento.",
};

/** O parágrafo do aviso com as situações marcadas no app (vazio se nenhuma foi marcada). */
function textoDasSituacoes(marcas: readonly MarcaPendencia[]): string {
  const conta = (s: SituacaoPendencia, fora = false) =>
    marcas.filter((m) => m.situacao === s && (m.foraDoDocumento === true) === fora).length;
  const partes = [
    conta("resolvida", true)
      ? `${plural(conta("resolvida", true), "confirmada como resolvida", "confirmadas como resolvidas")} na reanálise do arquivo atualizado (sem comentário neste documento)`
      : "",
    conta("resolvida") ? plural(conta("resolvida"), "marcada como resolvida", "marcadas como resolvidas") : "",
    conta("contestada_mantida")
      ? plural(conta("contestada_mantida"), "contestada e mantida pela revisão", "contestadas e mantidas pela revisão")
      : "",
    conta("contestada_aceita")
      ? `${plural(conta("contestada_aceita"), "contestada", "contestadas")} com um trecho do PPC conferido pelo app (ficam para conferir)`
      : "",
  ].filter(Boolean);
  return partes.length
    ? `Situação marcada no app: ${partes.join("; ")}. Os comentários deste documento são sobre o arquivo original.`
    : "";
}

/**
 * Um critério da revisão (uma ficha), com a decisão. `nao_lido`: ninguém decidiu ainda (ficha S ou J
 * sem a revisão com IA, ou fora do modo rápido); a `origem` é então quem o decide, a IA.
 */
export type CriterioConferido = {
  ficha: string;
  titulo: string;
  tema: string;
  ordemTema: number;
  estado: "atende" | "nao_atende" | "a_conferir" | "nao_se_aplica" | "nao_lido";
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
  /** Todos os critérios da revisão (as fichas da base), na ordem dos temas, decididos ou `nao_lido`. */
  criterios: CriterioConferido[];
  /** Critérios conferidos pelo código (fichas D). */
  conferidos: number;
  /** Critérios que a IA decidiu (atende, não atende, não se aplica), com a resposta conferida pelo app. */
  conferidosIa: number;
  /** Critérios que foram à IA e ficaram para conferir (INCONCLUSIVO ou resposta recusada na conferência). */
  paraConferirIa: number;
  /** Títulos dos critérios que ficaram de fora (o modo rápido), vazio sem IA ou no completo. */
  foraDaRevisao: string[];
  /** Quantos critérios a revisão tem (`criterios.length`). */
  totalCriterios: number;
  /** Quanto a leitura com IA cobriu (`nenhuma` na pré-conferência). */
  leituraIa: LeituraIa;
  dataBase: string;
  /** Texto do comentário-aviso no título. */
  aviso: string;
  /** O PPC convertido (a revisão com IA monta os recortes dele). */
  markdown: string;
  /** Linhas do Markdown com texto dirigido a IA (a triagem): retiradas do que a IA recebe. */
  linhasTextoParaIa: number[];
};

/** O autor dos comentários no Word. */
const AUTORIA = { autor: "Simplifica IF (revisão prévia)", iniciais: "SIF" } as const;
const URL_CNCT = "https://portal.mec.gov.br/catalogos-nacionais-de-cursos-tecnicos";

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

/* ============================================================ fontes */

function fonteLegivel(link: Fonte, registro: Registro, base: BaseRevisaoPrevia): FonteLegivel | null {
  const norma = /^ifpr:\/\/norma\/([^#]+)(?:#(.+))?$/.exec(link);
  if (norma) {
    const [, id, dispositivo] = norma;
    const titulo = tituloDaNorma(registro, id!);
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
      titulo: norma ? tituloDaNorma(registro, norma[1]!) : legivel.rotulo,
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

const temaDaFicha = (ficha: string, base: BaseRevisaoPrevia): number =>
  ordemDoTema(base.topicos.filter((t) => t.fichas.includes(ficha)).map((t) => t.id));

/** O título humano da ficha: o da base ou o do tema; nunca o código. */
export const tituloDaFicha = (ficha: string, base: BaseRevisaoPrevia): string =>
  base.fichas[ficha] ?? `Critério do tema "${TEMAS[temaDaFicha(ficha, base)]!.titulo}"`;

type ItemInterno = Omit<PendenciaRevisao, "noDocumento" | "dependeDoCurso"> & { trechos: string[] };

/** A fonte de um resultado da IA como link `ifpr://` (a base dá o rótulo legível). */
const linkDaFonte = (fonte: string, cnct: string | null): Fonte | null =>
  fonte.startsWith("cnct") ? (cnct ? linkCnct(cnct) : null) : linkNorma(fonte);

/**
 * O estado da lista para um resultado da IA, ou nulo quando não há pendência.
 *
 * No critério conservador (sem `tipoAchado`), NAO_ATENDE com confiança abaixo de 0,6 vira "a conferir".
 * No critério `ausencia`, a ausência numa seção presente e a contradição já vêm com o trecho conferido
 * na seção do critério (a prova do achado): a confiança não as rebaixa. O de mérito segue o limiar.
 * `revisaoHumana` (decidida pelo código: a triagem achou texto dirigido a IA) nunca rebaixa um
 * NAO_ATENDE, porque o risco da injeção é empurrar para ATENDE; ela segura o ATENDE com lacunas.
 */
export function estadoDaIa(r: ResultadoFichaIa): "nao_atende" | "a_conferir" | null {
  if (r.estado === "FALHOU" || r.estado === "INCONCLUSIVO") return "a_conferir";
  if (r.estado === "NAO_ATENDE") {
    if (r.tipoAchado === "ausencia_em_secao_presente" || r.tipoAchado === "contradicao") return "nao_atende";
    return r.confianca >= 0.6 ? "nao_atende" : "a_conferir";
  }
  if (r.revisaoHumana && r.lacunas.length) return "a_conferir";
  return null;
}

const ponto = (texto: string) => (/[.!?]$/.test(texto.trim()) ? texto.trim() : `${texto.trim()}.`);

/**
 * Onde está um trecho citado pela IA: a seção da linha do Markdown que contém o maior pedaço contínuo
 * dele (entre reticências), normalizado como na conferência. Nulo se o trecho não tem a forma
 * conferível ou não se acha (a conferência já o recusaria).
 */
export function localizadorDeSecoes(markdown: string, secoes: readonly SecaoPpc[]): (trecho: string) => string | null {
  const { texto, linhaDe } = indiceDeLinhas(markdown.split("\n").map(alvoDosTrechos));
  return (trecho) => {
    const pedaco = textoDoMaiorPedaco(trecho);
    if (pedaco === null) return null;
    const onde = texto.indexOf(pedaco);
    if (onde < 0) return null;
    const linha = linhaDe(onde);
    let achada: SecaoPpc | null = null;
    for (const secao of secoes) if (secao.linhaInicio <= linha && linha <= secao.linhaFim) achada = secao;
    return achada?.titulo ?? null;
  };
}

function itensDaIa(
  ia: EntradaIa,
  registro: Registro,
  base: BaseRevisaoPrevia,
  cnct: string | null,
  secaoDe: (trecho: string) => string | null,
): ItemInterno[] {
  const itens: ItemInterno[] = [];
  for (const r of ia.resultados) {
    const estado = estadoDaIa(r);
    if (!estado) continue;
    const ordemTema = temaDaFicha(r.ficha, base);
    // O título é o que a IA escreveu para isso; sem ele (resposta gravada antes do campo) ou longo
    // demais, a primeira frase da justificativa. As lacunas ficam em lista.
    const tituloDaIa = (r.titulo ?? "").trim().length <= LIMITES_RESPOSTA.titulo ? (r.titulo ?? "").trim() : "";
    const texto =
      r.estado === "FALHOU"
        ? {
            titulo: `Não foi possível conferir este critério com a IA (${r.motivoFalha ?? "resposta fora do formato"}).`,
            explicacao: `Confira na leitura: ${tituloDaFicha(r.ficha, base)}.`,
            faltas: [],
          }
        : {
            ...(tituloDaIa === ""
              ? tituloEExplicacao(ponto(r.justificativa))
              : { titulo: ponto(tituloDaIa), explicacao: ponto(r.justificativa) }),
            // sem aparar nem tirar a vazia: o texto reunido é o da mensagem antiga, e a chave não muda
            faltas: r.lacunas.map((l) => l.replace(/[.;]\s*$/, "")),
          };
    const literal = r.trechos.find((t) => comoNoDocumento(t));
    const trechos = r.trechos.map(comoNoDocumento).filter(Boolean);
    itens.push({
      ficha: r.ficha,
      tituloFicha: tituloDaFicha(r.ficha, base),
      tema: TEMAS[ordemTema]!.titulo,
      ordemTema,
      estado,
      ...texto,
      oQueFazer: r.oQueFazer.trim() ? ponto(r.oQueFazer) : "Confira o critério no PPC.",
      trecho: trechos[0] ?? null,
      secao: literal === undefined ? null : secaoDe(literal),
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
      tituloFicha: tituloDaFicha(ficha, base),
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
    ...tituloEExplicacao(achado.mensagem.replace(/ Remova antes de submeter\.$/, "")),
    faltas: [],
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
      ...tituloEExplicacao(legivel(item.mensagem.replace(SUFIXO_TAMBEM, ""))),
      faltas: [],
      trecho: item.trechos[0] ?? null,
      secao: item.trechos[0] ? (secoes.get(item.trechos[0]) ?? null) : null,
      trechos: item.trechos,
      fontes: fontes(item.fontes),
      tambemEm: item.fichas.slice(1).map((ficha) => ({ ficha, titulo: tituloDaFicha(ficha, base) })),
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
        ...tituloEExplicacao(legivel(ficha.mensagem)),
        faltas: [],
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
  "estado" | "titulo" | "explicacao" | "faltas" | "oQueFazer" | "fontes" | "ficha" | "tambemEm" | "origem"
>;

const linhaFontes = (fontes: readonly FonteLegivel[]) =>
  `Fonte: ${fontes.map((f) => (f.url ? `${f.rotulo} (${f.url})` : f.rotulo)).join("; ")}.`;

const linhaTambem = (item: ItemDoComentario) => `Também apontado em: ${item.tambemEm.map((t) => t.titulo).join("; ")}.`;

/** As linhas de uma pendência: o problema, a explicação, o que falta, o que fazer, a fonte e as outras fichas. */
function linhasDaPendencia(item: ItemDoComentario): string[] {
  const linhas = [
    item.estado === "nao_atende" ? `Pendência: ${item.titulo}` : `Confira: ${item.titulo}`,
    ...(item.explicacao === null ? [] : [item.explicacao]),
    ...(item.faltas.length ? [linhaDasFaltas(item.faltas)] : []),
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
 * entre parágrafos ou escrito de outro jeito. `caixas` é o texto das caixas, já normalizado.
 */
export function ondeNoArquivo(caixas: readonly string[], trecho: string): string {
  const alvo = normalizarTexto(trecho);
  if (alvo && caixas.some((caixa) => caixa.includes(alvo)))
    return "provavelmente numa caixa de texto ou forma, onde o comentário do Word não alcança";
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
  paraConferirIa: number;
  foraDaRevisao: readonly string[];
  /** Os temas das fichas de fora, na ordem do parecer. */
  temasForaDaRevisao: readonly string[];
  totalCriterios: number;
  leituraIa: LeituraIa;
  curso: CursoIdentificado;
  pendencias: readonly PendenciaRevisao[];
  /** Onde o trecho não localizado provavelmente está (`ondeNoArquivo`). */
  onde: ReadonlyMap<PendenciaRevisao, string>;
  /** As situações marcadas no app (etapa 5b). */
  situacoes?: readonly MarcaPendencia[];
  /** A nota da situação de cada pendência (vai antes dela na lista do título). */
  notas?: ReadonlyMap<PendenciaRevisao, string>;
}): string {
  const nota = (p: PendenciaRevisao) => {
    const n = entrada.notas?.get(p);
    return n ? `${n} ` : "";
  };
  const naoAtende = entrada.pendencias.filter((p) => p.estado === "nao_atende").length;
  const aConferir = entrada.pendencias.length - naoAtende;
  const vistos = entrada.conferidos + entrada.conferidosIa;
  const comIa = entrada.leituraIa !== "nenhuma";
  // Os que nem a leitura nem o modo rápido cobriram: a leitura com IA parou antes do fim.
  const naoLidos = entrada.totalCriterios - vistos - entrada.paraConferirIa - entrada.foraDaRevisao.length;
  const total = comIa
    ? [
        `${vistos} de ${entrada.totalCriterios} critérios conferidos: ${entrada.conferidos} pelo código, com a base de normas, e ${entrada.conferidosIa} pela IA, com cada trecho e cada norma citados conferidos pelo app.`,
        entrada.paraConferirIa
          ? `${plural(entrada.paraConferirIa, "critério foi", "critérios foram")} à IA e ${entrada.paraConferirIa === 1 ? "ficou" : "ficaram"} para conferir na leitura.`
          : "",
        entrada.foraDaRevisao.length
          ? `No modo rápido, ficaram de fora ${plural(entrada.foraDaRevisao.length, "critério", "critérios")}, que exigem leitura, dos temas: ${entrada.temasForaDaRevisao.join("; ")}.`
          : "",
        // Com o modo rápido e a leitura encerrada antes do fim, as duas frases valem juntas.
        naoLidos > 0
          ? entrada.leituraIa === "parcial"
            ? `A conferência com IA parou antes do fim: ${plural(naoLidos, "critério ainda não foi conferido", "critérios ainda não foram conferidos")}.`
            : entrada.foraDaRevisao.length
              ? ""
              : "Os demais exigem leitura."
          : "",
      ]
        .filter(Boolean)
        .join(" ")
    : entrada.totalCriterios > entrada.conferidos
      ? `${entrada.conferidos} de ${entrada.totalCriterios} critérios conferidos automaticamente; os demais exigem leitura.`
      : `${entrada.conferidos} critérios conferidos automaticamente; os demais exigem leitura.`;
  const curso = entrada.curso.cnct
    ? `Curso considerado: ${entrada.curso.cnct.denominacao} (CNCT)${entrada.curso.forma ? `, forma de oferta: ${NOME_DA_FORMA[entrada.curso.forma] ?? entrada.curso.forma}` : ""}.`
    : "O curso não foi identificado no CNCT: os critérios que dependem dele ficaram para conferir.";
  const partes = [
    `Revisão prévia do Simplifica IF, de ${dataBr(entrada.agora.toISOString())}, com a vigência das normas em ${dataBr(entrada.dataBase)}. Não é parecer da PROENS e não substitui a análise oficial.`,
    `${total} ${curso}`,
    `Resultado: ${plural(naoAtende, "pendência", "pendências")} e ${plural(aConferir, "ponto para conferir", "pontos para conferir")}.`,
  ];
  const situacoes = textoDasSituacoes(entrada.situacoes ?? []);
  if (situacoes) partes.push(situacoes);
  const ausentes = entrada.pendencias.filter((p) => p.noDocumento === "no-inicio");
  if (ausentes.length)
    partes.push(
      `O que falta no documento (sem trecho onde comentar):\n${ausentes.map((p) => `- ${nota(p)}${linhasDaPendencia(p).join(" ")}`).join("\n")}`,
    );
  const fora = entrada.pendencias.filter((p) => p.noDocumento === "so-na-lista");
  if (fora.length)
    partes.push(
      `Não localizados no texto (sem marca no documento):\n${fora
        .map((p) => {
          const [problema, ...resto] = linhasDaPendencia(p);
          const onde = entrada.onde.get(p) ?? ONDE_DESCONHECIDO;
          return `- ${nota(p)}${problema} Trecho: "${resumir(p.trecho ?? "")}", ${onde}. ${resto.join(" ")}`;
        })
        .join("\n")}`,
    );
  return partes.join("\n\n");
}

/**
 * A régua da revisão: todas as fichas da base, na ordem dos temas (e, dentro do tema, na da base), com a
 * decisão do código (fichas D), a da IA ou `nao_lido`. Ficha decidida que a base não lista entra no fim
 * do tema dela.
 */
function todosOsCriterios(
  resultado: PreConferencia,
  ia: EntradaIa | undefined,
  base: BaseRevisaoPrevia,
): CriterioConferido[] {
  const criterio = (ficha: string, estado: CriterioConferido["estado"], mensagem: string, origem: "codigo" | "ia") => {
    const ordemTema = temaDaFicha(ficha, base);
    return {
      ficha,
      titulo: tituloDaFicha(ficha, base),
      tema: TEMAS[ordemTema]!.titulo,
      ordemTema,
      estado,
      mensagem,
      origem,
    };
  };
  const decididos = new Map<string, CriterioConferido>();
  for (const ficha of resultado.fichas)
    decididos.set(ficha.ficha, criterio(ficha.ficha, ficha.estado, ficha.mensagem, "codigo"));
  for (const r of ia?.resultados ?? [])
    decididos.set(
      r.ficha,
      criterio(
        r.ficha,
        ESTADO_CRITERIO_IA[r.estado],
        r.estado === "FALHOU" ? `Não conferido: ${r.motivoFalha ?? ""}` : r.justificativa,
        "ia",
      ),
    );
  const fichas = [...new Set([...Object.keys(base.fichas), ...decididos.keys()])];
  return fichas
    .map((ficha) => decididos.get(ficha) ?? criterio(ficha, "nao_lido", "", "ia"))
    .sort((a, b) => a.ordemTema - b.ordemTema);
}

/** Uma pendência antes da cópia comentada: com todos os trechos, que `comentarDocx` procura no documento. */
export type ItemMontado = ItemInterno;

/** A lista e a régua montadas da pré-conferência e dos resultados da IA, sem o documento. */
type Montagem = {
  /** As pendências do código e da IA, sem repetição, na ordem dos temas. */
  itens: ItemMontado[];
  criterios: CriterioConferido[];
  conferidos: number;
  conferidosIa: number;
  paraConferirIa: number;
  foraDaRevisao: string[];
  /** Os temas das fichas de fora, na ordem do parecer. */
  temasForaDaRevisao: string[];
  totalCriterios: number;
  leituraIa: LeituraIa;
};

/**
 * A montagem do resultado (pura, sem o `.docx`): as pendências da pré-conferência e as da IA, sem
 * repetição (a mesma ficha com a mesma mensagem no mesmo trecho é uma pendência só), a régua e as
 * contagens (`revisarMarkdown`).
 */
function montarResultado(
  preConferencia: PreConferencia,
  ia: EntradaIa | undefined,
  base: BaseRevisaoPrevia,
  entrada: { markdown: string; cnct: string | null; registro?: Registro },
): Montagem {
  const registro = entrada.registro ?? new Registro(base.normas);
  const secaoDe = localizadorDeSecoes(entrada.markdown, preConferencia.secoes);
  const vistos = new Set<string>();
  const itens = [
    ...itensDaPreConferencia(preConferencia, registro, base),
    ...(ia ? itensDaIa(ia, registro, base, entrada.cnct, secaoDe) : []),
  ]
    .filter((item) => {
      const igual = JSON.stringify([item.ficha, textoDaPendencia(item), item.trecho]);
      if (vistos.has(igual)) return false;
      vistos.add(igual);
      return true;
    })
    .sort((a, b) => a.ordemTema - b.ordemTema);
  // Só o que a IA decidiu conta como conferido; INCONCLUSIVO e a resposta recusada ficam para conferir.
  const decididos = (ia?.resultados ?? []).filter((r) => r.estado !== "INCONCLUSIVO" && r.estado !== "FALHOU");
  const criterios = todosOsCriterios(preConferencia, ia, base);
  return {
    itens,
    criterios,
    conferidos: preConferencia.fichas.length,
    conferidosIa: decididos.length,
    paraConferirIa: (ia?.resultados.length ?? 0) - decididos.length,
    foraDaRevisao: (ia?.fora ?? []).map((f) => tituloDaFicha(f, base)),
    temasForaDaRevisao: [...new Set((ia?.fora ?? []).map((f) => temaDaFicha(f, base)))]
      .sort((a, b) => a - b)
      .map((i) => TEMAS[i]!.titulo),
    totalCriterios: criterios.length,
    leituraIa: leituraDaIa(ia),
  };
}

/** A revisão do texto convertido, sem o documento (`revisarMarkdown`). */
export type RevisaoDoTexto = Omit<RevisaoPrevia, "docx" | "aviso" | "markdown"> & {
  /** As pendências com todos os trechos, que a cópia comentada procura no documento. */
  itens: ItemMontado[];
  /** Os temas das fichas de fora (modo rápido), na ordem do parecer, para o aviso do título. */
  temasForaDaRevisao: string[];
};

export type OpcoesRevisaoDoTexto = Pick<OpcoesRevisaoPrevia, "ia" | "cnct" | "forma"> & {
  aoEtapa?: ((etapa: Exclude<EtapaRevisaoPrevia, "gravando">) => void) | undefined;
  /** A parte da base que não depende do PPC (`verificacaoDaBase`), quando quem chama já a tem. */
  verificacao?: ReturnType<typeof verificacaoDaBase> | undefined;
};

/**
 * A revisão de um PPC já convertido (pura, sem o `.docx`): o curso (o escolhido ou o identificado no
 * texto), a pré-conferência, as pendências do código e as da IA sem repetição, a régua e as contagens.
 * Sem o documento, ninguém sabe ainda onde o Word ancora cada comentário: as pendências saem com
 * `noDocumento` provisório (no trecho, se há trecho; no início, se é ausência), que `revisarDocx`, ao
 * gravar a cópia comentada, troca pelo lugar real. O servidor a usa a cada bloco pronto da leitura com
 * IA, sobre o texto que a lista guarda, sem reler o arquivo.
 */
export function revisarMarkdown(
  markdown: string,
  base: BaseRevisaoPrevia,
  opcoes: OpcoesRevisaoDoTexto = {},
): RevisaoDoTexto {
  opcoes.aoEtapa?.("identificando");
  // Sempre da base recebida: sem ela, os verificadores leriam a vigência do checkout, que o app não tem.
  const comum = opcoes.verificacao ?? verificacaoDaBase(base);
  const noDocumento = identificarCurso(markdown, base.cncts);
  const cnct = opcoes.cnct ? (base.cncts.find((c) => c.slug === opcoes.cnct) ?? null) : noDocumento.cnct;
  const forma = opcoes.forma ?? noDocumento.forma;
  const curso: CursoIdentificado = {
    cnct: cnct ? { slug: cnct.slug, denominacao: cnct.denominacao } : null,
    forma,
    origem: opcoes.cnct || opcoes.forma ? "pessoa" : "documento",
  };
  opcoes.aoEtapa?.("conferindo");
  const resultado = preConferir(markdown, { cnct, forma: forma ?? "", ...comum });
  const montagem = montarResultado(resultado, opcoes.ia, base, {
    markdown,
    cnct: cnct?.slug ?? null,
    registro: comum.registro,
  });
  return {
    curso,
    pendencias: montagem.itens.map(({ trechos, ...item }) => ({
      ...item,
      noDocumento: trechos.length ? "no-trecho" : "no-inicio",
      dependeDoCurso: cnct === null && FICHAS_DO_CURSO.has(item.ficha),
    })),
    criterios: montagem.criterios,
    conferidos: montagem.conferidos,
    conferidosIa: montagem.conferidosIa,
    paraConferirIa: montagem.paraConferirIa,
    foraDaRevisao: montagem.foraDaRevisao,
    totalCriterios: montagem.totalCriterios,
    leituraIa: montagem.leituraIa,
    dataBase: base.dataBase,
    linhasTextoParaIa: resultado.triagem
      .filter((a) => a.regra === "texto-dirigido-a-ia")
      .flatMap((a) => a.trechos.map((t) => t.linha)),
    itens: montagem.itens,
    temasForaDaRevisao: montagem.temasForaDaRevisao,
  };
}

/**
 * Converte e revisa o texto (`revisarMarkdown`) sem comentar o `.docx` (pula `comentarDocx`,
 * `textosDeCaixas` e a recompactação do ZIP). Lança `ErroDocx` (mensagem em português) para arquivo
 * inválido.
 */
export function revisarDocxSemComentar(
  bytes: Uint8Array,
  nomeDoArquivo: string,
  base: BaseRevisaoPrevia,
  opcoes: Pick<OpcoesRevisaoPrevia, "agora" | "ia" | "cnct" | "forma"> & {
    aoEtapa?: ((etapa: Exclude<EtapaRevisaoPrevia, "gravando">) => void) | undefined;
  },
): Omit<RevisaoPrevia, "docx"> {
  const conversao = converterPpc(bytes, nomeDoArquivo);
  const { itens: _, temasForaDaRevisao: __, ...revisado } = revisarMarkdown(conversao.markdown, base, opcoes);
  return {
    ...revisado,
    aviso: "",
    markdown: conversao.markdown,
  };
}

/**
 * Converte, revisa o texto (`revisarMarkdown`) e comenta. Lança `ErroDocx` (mensagem em português) para
 * arquivo inválido.
 */
export function revisarDocx(
  bytes: Uint8Array,
  nomeDoArquivo: string,
  base: BaseRevisaoPrevia,
  opcoes: OpcoesRevisaoPrevia,
): RevisaoPrevia {
  const conversao = converterPpc(bytes, nomeDoArquivo);
  const texto = revisarMarkdown(conversao.markdown, base, opcoes);
  const { temasForaDaRevisao, ...revisado } = texto;
  // Cópia: a contestada com evidência muda de estado só no documento.
  const itens = [...texto.itens];
  const { curso, conferidos, conferidosIa, paraConferirIa, foraDaRevisao, totalCriterios } = revisado;
  const cnct = curso.cnct;

  opcoes.aoEtapa?.("gravando");
  // Duas passadas: as pendências com trecho, e depois o aviso no título, com as ausências e o que
  // não foi localizado.
  const comentar = { data: opcoes.agora.toISOString(), ...AUTORIA };
  const marcas = itens.map((item) => opcoes.situacoes?.[chavePendencia(item)]);
  // Só a pendência confirmada pela reanálise sai do documento; a contestada com evidência conferida
  // fica "a conferir", com o trecho e o motivo; as outras levam a situação.
  const retirada = (indice: number) => marcas[indice]?.foraDoDocumento === true;
  marcas.forEach((marca, indice) => {
    if (marca?.situacao === "contestada_aceita") itens[indice] = { ...itens[indice]!, estado: "a_conferir" };
  });
  const notaDe = (indice: number) => {
    const marca = marcas[indice];
    return marca ? [NOTA_SITUACAO[marca.situacao], marca.nota ?? ""].filter(Boolean).join(" ") : "";
  };
  const comSituacao = (indice: number) => {
    const nota = notaDe(indice);
    return nota ? `${nota}\n${textoDoComentario(itens[indice]!)}` : textoDoComentario(itens[indice]!);
  };
  const comTrecho = itens.flatMap((item, indice) => (item.trechos.length && !retirada(indice) ? [indice] : []));
  const comentado = comentarDocx(
    bytes,
    comTrecho.map((indice) => ({ trechos: itens[indice]!.trechos, texto: comSituacao(indice) })),
    comentar,
  );
  const ancoradas = new Set(comentado.ancoradas.map((a) => comTrecho[a.indice]!));
  const pendencias: PendenciaRevisao[] = itens.map(({ trechos, ...item }, indice) => ({
    ...item,
    noDocumento: !trechos.length ? "no-inicio" : ancoradas.has(indice) ? "no-trecho" : "so-na-lista",
    dependeDoCurso: cnct === null && FICHAS_DO_CURSO.has(item.ficha),
  }));
  const naoLocalizadas = pendencias.filter((p) => p.noDocumento === "so-na-lista");
  // Lido uma vez para todas as pendências não localizadas (e só se houver), pelo leitor e com os limites dele.
  const caixas = naoLocalizadas.length ? textosDeCaixas(new PacoteOoxml(bytes)).map(normalizarTexto) : [];
  const onde = new Map(naoLocalizadas.map((p) => [p, ondeNoArquivo(caixas, p.trecho ?? "")]));
  const aviso = textoDoAviso({
    onde,
    agora: opcoes.agora,
    dataBase: base.dataBase,
    conferidos,
    conferidosIa,
    paraConferirIa,
    foraDaRevisao,
    temasForaDaRevisao,
    totalCriterios,
    leituraIa: revisado.leituraIa,
    curso,
    pendencias: pendencias.filter((_, indice) => !retirada(indice)),
    situacoes: marcas.filter((m): m is MarcaPendencia => m !== undefined),
    notas: new Map(pendencias.map((p, indice) => [p, notaDe(indice)])),
  });
  const final = comentarDocx(comentado.docx, [{ trechos: [], texto: aviso, noInicioSeAusente: true }], comentar);
  return {
    docx: final.docx,
    curso,
    pendencias,
    criterios: revisado.criterios,
    conferidos,
    conferidosIa,
    paraConferirIa,
    foraDaRevisao,
    totalCriterios,
    leituraIa: revisado.leituraIa,
    dataBase: revisado.dataBase,
    aviso,
    markdown: conversao.markdown,
    linhasTextoParaIa: revisado.linhasTextoParaIa,
  };
}
