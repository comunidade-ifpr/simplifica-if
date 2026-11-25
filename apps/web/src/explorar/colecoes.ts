/**
 * As coleções do Explorar na memória: os nomes em português dos valores da base (situação de vigência,
 * turno, resultado do cruzamento PPC × SUAP…), os filtros de cada coleção e as opções de cada filtro,
 * tiradas dos próprios dados. O índice inteiro chega uma vez pelo `explorarIndice`; filtrar é local e
 * instantâneo.
 *
 * Funções puras, sem React: o teste de unidade as confere.
 */
import type {
  CnctDoIndice,
  CursoDoIndice,
  DadosIndice,
  NormaDoIndice,
  PpcDoIndice,
  TipoResultado,
} from "@simplifica-if/contratos-app";
import { normalizar } from "./normalizar.ts";

/* ================================================================== nomes */

const SITUACOES_VIGENCIA: Readonly<Record<string, string>> = {
  vigente: "Em vigor",
  "parcialmente revogada": "Revogada em parte",
  revogada: "Revogada",
  alterada: "Alterada",
  "ainda-nao-vigente": "Ainda não está em vigor",
  "a confirmar": "Vigência a confirmar",
};

/** A situação de vigência publicada, como o leitor a chama. */
export function nomeVigencia(status: string | null): string {
  if (status === null) return "Sem situação registrada";
  return SITUACOES_VIGENCIA[status] ?? primeiraMaiuscula(status);
}

const SITUACOES_NORMA: Readonly<Record<NormaDoIndice["situacao"], string>> = {
  base: "Com o texto na base",
  stub: "Só a referência",
  externo: "Referência externa",
};

export function nomeSituacaoNorma(situacao: NormaDoIndice["situacao"]): string {
  return SITUACOES_NORMA[situacao];
}

export function primeiraMaiuscula(texto: string): string {
  return texto.length === 0 ? texto : texto[0]!.toLocaleUpperCase("pt-BR") + texto.slice(1);
}

/** "matutino-com-contraturno" → "Matutino com contraturno". */
export function nomeTurno(turno: string): string {
  return primeiraMaiuscula(turno.replaceAll("-", " "));
}

/** "processo-seletivo-2026" → o nome do processo no índice, ou o identificador legível. */
export function nomeProcesso(id: string, processos: DadosIndice["processos"]): string {
  return processos.find((p) => p.id === id)?.nome ?? primeiraMaiuscula(id.replaceAll("-", " "));
}

const RESULTADOS_CRUZAMENTO: Readonly<Record<string, { readonly nome: string; readonly alerta: boolean }>> = {
  confere: { nome: "Confere", alerta: false },
  "confere-com-uma-matriz": { nome: "Confere com uma das matrizes", alerta: false },
  diverge: { nome: "Diverge", alerta: true },
  "explicada-pelo-estagio": { nome: "Diferença explicada pelo estágio", alerta: false },
  "ppc-mais-recente-que-matrizes": { nome: "PPC mais recente que as matrizes do SUAP", alerta: true },
  "sem-ano": { nome: "Sem o ano para comparar", alerta: false },
  "sem-fato-ppc": { nome: "O PPC não informa", alerta: false },
  "sem-suap": { nome: "Sem dados do SUAP", alerta: false },
};

/** O resultado do cruzamento PPC × SUAP (`ppc-fatos`) e se ele pede atenção. */
export function nomeResultado(resultado: string): { readonly nome: string; readonly alerta: boolean } {
  return RESULTADOS_CRUZAMENTO[resultado] ?? { nome: primeiraMaiuscula(resultado.replaceAll("-", " ")), alerta: false };
}

const ASPECTOS: Readonly<Record<string, string>> = {
  ano: "Ano do PPC",
  carga_horaria: "Carga horária",
  estagio: "Estágio",
};

export function nomeAspecto(aspecto: string): string {
  return ASPECTOS[aspecto] ?? primeiraMaiuscula(aspecto.replaceAll("_", " "));
}

const FATOS: Readonly<Record<string, string>> = {
  carga_horaria_total_h: "Carga horária total",
  estagio_obrigatorio: "Estágio obrigatório",
  estagio_carga_h: "Carga horária do estágio",
  ano_documento: "Ano do documento",
};

export function nomeFato(fato: string): string {
  return FATOS[fato] ?? primeiraMaiuscula(fato.replaceAll("_", " "));
}

/**
 * A ressalva de um fato do PPC pelo status da curadoria: nenhuma para o revisado; "Extraído, conferir"
 * para o que saiu do texto por regra (`extraido`); "Precisa de revisão" para qualquer outro (`Precisa de
 * revisão`, `Pendente`…), como o ano do documento vindo dos dados institucionais ainda não conferido.
 */
export function ressalvaDoFato(status: string): string | null {
  if (normalizar(status) === "revisado") return null;
  return status === "extraido" ? "Extraído, conferir" : "Precisa de revisão";
}

/** O valor de um fato do PPC, com a unidade ("1600 h", "sim"). */
export function valorFato(fato: { readonly valor: string; readonly unidade: string | null }): string {
  return fato.unidade === null ? fato.valor : `${fato.valor} ${fato.unidade}`;
}

const CRITICIDADES: Readonly<Record<string, string>> = {
  BLOQ: "Bloqueante",
  OBRIG: "Obrigatória",
  REC: "Recomendação",
};

/** A criticidade de um critério da revisão de PPC (`BLOQ`, `OBRIG`, `REC`). */
export function nomeCriticidade(criticidade: string): string {
  return CRITICIDADES[criticidade] ?? criticidade;
}

/** Os grupos da paleta e as abas do Explorar, no singular e no plural. */
export const NOMES_TIPO: Readonly<Record<TipoResultado, { readonly grupo: string; readonly item: string }>> = {
  dispositivo: { grupo: "Trechos de normas", item: "Trecho de norma" },
  norma: { grupo: "Normas", item: "Norma" },
  curso: { grupo: "Cursos", item: "Curso" },
  ppc: { grupo: "PPCs", item: "PPC" },
  secao: { grupo: "Seções de PPC", item: "Seção de PPC" },
  campus: { grupo: "Campi", item: "Campus" },
  cnct: { grupo: "Catálogo Nacional de Cursos Técnicos", item: "CNCT" },
  consepe: { grupo: "Consepe", item: "Consepe" },
};

/* ================================================================== ordem e opções */

const comparar = (a: string, b: string) => a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true });

/** Os valores distintos, não nulos, em ordem alfabética do português. */
export function opcoes(valores: Iterable<string | null | undefined>): string[] {
  const vistos = new Set<string>();
  for (const v of valores) if (v !== null && v !== undefined && v !== "") vistos.add(v);
  return [...vistos].sort(comparar);
}

/** Algum termo do texto livre falta em `textos`? (cada termo começa alguma palavra, sem acento). */
function respondeAoTexto(texto: string, textos: ReadonlyArray<string | null | undefined>): boolean {
  const termos = normalizar(texto)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (termos.length === 0) return true;
  const palavras = normalizar(textos.filter(Boolean).join(" ")).split(/[^\p{L}\p{N}]+/u);
  return termos.every((t) => palavras.some((p) => p.startsWith(t)));
}

/* ================================================================== normas */

export interface FiltrosNormas {
  readonly texto?: string | undefined;
  readonly orgao?: string | undefined;
  readonly tipo?: string | undefined;
  readonly ano?: string | undefined;
  /** O `status_vigencia` publicado. */
  readonly vigencia?: string | undefined;
}

/**
 * A situação de vigência que a tela mostra: a publicada; "a confirmar" quando falta (stub com o status
 * não conferido, ou sem status).
 */
export type Vigencia =
  | "vigente"
  | "alterada"
  | "parcialmente revogada"
  | "revogada"
  | "ainda-nao-vigente"
  | "a confirmar";

const VIGENCIAS: ReadonlySet<string> = new Set([
  "vigente",
  "alterada",
  "parcialmente revogada",
  "revogada",
  "ainda-nao-vigente",
]);

export function vigenciaDaNorma(norma: Pick<NormaDoIndice, "status_vigencia">): Vigencia {
  return norma.status_vigencia !== null && VIGENCIAS.has(norma.status_vigencia)
    ? (norma.status_vigencia as Vigencia)
    : "a confirmar";
}

/** As normas por ano, do mais recente ao mais antigo; as sem ano (referências externas) ficam no fim. */
export function normasPorAno<N extends Pick<NormaDoIndice, "ano">>(
  normas: ReadonlyArray<N>,
): ReadonlyArray<{ readonly ano: number | null; readonly normas: ReadonlyArray<N> }> {
  const grupos = new Map<number | null, N[]>();
  for (const n of normas) {
    grupos.set(n.ano, [...(grupos.get(n.ano) ?? []), n]);
  }
  return [...grupos].sort(([a], [b]) => (b ?? -1) - (a ?? -1)).map(([ano, doAno]) => ({ ano, normas: doAno }));
}

export function filtrarNormas(normas: ReadonlyArray<NormaDoIndice>, f: FiltrosNormas): NormaDoIndice[] {
  return normas
    .filter(
      (n) =>
        (f.orgao === undefined || n.orgao === f.orgao) &&
        (f.tipo === undefined || n.tipo === f.tipo) &&
        (f.ano === undefined || String(n.ano) === f.ano) &&
        (f.vigencia === undefined || n.status_vigencia === f.vigencia) &&
        (f.texto === undefined || respondeAoTexto(f.texto, [n.titulo, n.ementa, n.numero, ...n.apelidos])),
    )
    .sort((a, b) => (b.ano ?? 0) - (a.ano ?? 0) || comparar(a.titulo, b.titulo));
}

/* ================================================================== cursos */

export type SituacaoSuapCurso = "divergencia" | "confere" | "sem-suap";

const SITUACOES_SUAP_CURSO: Readonly<Record<SituacaoSuapCurso, string>> = {
  divergencia: "Com divergência PPC × SUAP",
  confere: "Sem divergências",
  "sem-suap": "Sem matriz no SUAP",
};

export function nomeSituacaoSuapCurso(valor: string): string {
  return SITUACOES_SUAP_CURSO[valor as SituacaoSuapCurso] ?? primeiraMaiuscula(valor);
}

/** A situação do curso no filtro SUAP do Explorar. */
export function situacaoSuapCurso(c: Pick<CursoDoIndice, "suap">): SituacaoSuapCurso {
  if (c.suap === null || c.suap.matrizes === 0) return "sem-suap";
  return c.suap.divergencias > 0 ? "divergencia" : "confere";
}

export interface FiltrosCursos {
  readonly texto?: string | undefined;
  readonly campus?: string | undefined;
  readonly nivel?: string | undefined;
  readonly eixo?: string | undefined;
  readonly forma?: string | undefined;
  readonly turno?: string | undefined;
  readonly processo?: string | undefined;
  readonly suap?: string | undefined;
}

export function filtrarCursos(cursos: ReadonlyArray<CursoDoIndice>, f: FiltrosCursos): CursoDoIndice[] {
  return cursos
    .filter(
      (c) =>
        (f.campus === undefined || c.campus === f.campus) &&
        (f.nivel === undefined || c.nivel === f.nivel) &&
        (f.eixo === undefined || c.cnct?.eixo === f.eixo) &&
        (f.forma === undefined || c.forma_oferta === f.forma) &&
        (f.turno === undefined || c.turnos.includes(f.turno)) &&
        (f.processo === undefined || c.processos.includes(f.processo)) &&
        (f.suap === undefined || situacaoSuapCurso(c) === f.suap) &&
        (f.texto === undefined || respondeAoTexto(f.texto, [c.nome, c.campus_nome, c.cnct?.nome, c.suap?.codigo])),
    )
    .sort((a, b) => comparar(a.nome, b.nome) || comparar(a.campus_nome, b.campus_nome));
}

/* ================================================================== PPCs e CNCT */

export interface FiltrosPpcs {
  readonly texto?: string | undefined;
  readonly campus?: string | undefined;
  readonly nivel?: string | undefined;
  readonly forma?: string | undefined;
  /** Inclui os PPCs substituídos por uma versão mais nova; sem ele, só os vigentes. */
  readonly substituidos?: boolean | undefined;
}

export function filtrarPpcs(ppcs: ReadonlyArray<PpcDoIndice>, f: FiltrosPpcs): PpcDoIndice[] {
  return ppcs
    .filter(
      (p) =>
        (f.substituidos === true || p.vigente) &&
        (f.campus === undefined || p.campus === f.campus) &&
        (f.nivel === undefined || p.nivel === f.nivel) &&
        (f.forma === undefined || p.forma === f.forma) &&
        (f.texto === undefined || respondeAoTexto(f.texto, [p.nome, p.campus_nome])),
    )
    .sort((a, b) => comparar(a.nome, b.nome) || comparar(a.campus_nome, b.campus_nome) || comparar(b.versao, a.versao));
}

export interface FiltrosCnct {
  readonly texto?: string | undefined;
  readonly eixo?: string | undefined;
  /** Só os cursos do catálogo que o IFPR oferta (algum curso da base aponta para ele). */
  readonly ofertados?: boolean | undefined;
}

export function filtrarCnct(
  cnct: ReadonlyArray<CnctDoIndice>,
  cursos: ReadonlyArray<CursoDoIndice>,
  f: FiltrosCnct,
): CnctDoIndice[] {
  const ofertados = new Set(cursos.flatMap((c) => (c.cnct === null ? [] : [c.cnct.slug])));
  return cnct
    .filter(
      (c) =>
        (f.eixo === undefined || c.eixo === f.eixo) &&
        (f.ofertados !== true || ofertados.has(c.slug)) &&
        (f.texto === undefined || respondeAoTexto(f.texto, [c.denominacao, c.area])),
    )
    .sort((a, b) => comparar(a.denominacao, b.denominacao));
}

/** Quantos cursos do IFPR na base têm cada curso do CNCT. */
export function cursosPorCnct(cursos: ReadonlyArray<CursoDoIndice>): ReadonlyMap<string, number> {
  const contagem = new Map<string, number>();
  for (const c of cursos) if (c.cnct !== null) contagem.set(c.cnct.slug, (contagem.get(c.cnct.slug) ?? 0) + 1);
  return contagem;
}

/* ================================================================== links */

/**
 * O pedido para a IA sobre uma página do Explorar: o nome dela e o link `ifpr://` (que a IA lê pelas
 * ferramentas da base), numa linha, e a linha em branco onde a pessoa escreve a pergunta.
 */
export function pedidoSobre(nome: string, links: ReadonlyArray<string>): string {
  return `Sobre ${nome}${links.length ? ` (${links.join(", ")})` : ""}:\n`;
}

/** A contagem com o nome no singular ou no plural ("1 item de pauta", "3 itens de pauta"). */
export function quantos(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** "2026-03-20" → "20/03/2026". */
export function dataBr(data: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(data);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : data;
}
