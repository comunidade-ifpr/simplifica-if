/**
 * O que uma mudança na norma `id` (revogação, alteração, nova redação) atinge.
 *
 * `impactoEm` (`kb impacto-da-norma`, ferramenta `impacto_da_norma`), na base:
 * - normas: relações de `relacoes.yaml` (quem a revoga, altera, regulamenta ou nela se
 *   fundamenta) e dispositivos de outras normas da base que a citam no texto;
 * - sucessora e correspondência: se a norma foi revogada no todo, a norma que a revogou, as regras
 *   de transição e os dispositivos correspondentes (tabela de correspondência);
 * - PPCs convertidos que citam a norma (`citacoes_da_norma`).
 *
 * `criteriosAtingidosEm` (`kb criterios-revisao-ppc --norma`, ferramenta `criterios_revisao_ppc`),
 * nos critérios da tarefa "Revisar um PPC" (as fichas), que não são base: referência estruturada à
 * norma, referência a um dispositivo correspondente da sucessora, citação no texto (resolvedor de
 * citações) ou tópico cujos termos aparecem num dispositivo com mudança material; e os outros arquivos
 * da tarefa (os marcos normativos, a taxonomia dos tópicos) que citam a norma.
 *
 * As duas são puras, sobre fontes já carregadas: o serviço `Impacto` monta a primeira, e o
 * `PacoteRevisaoPpc`, a segunda, do `kb.sqlite`.
 */
import type { PpcCitante } from "../ppcs/citacoes.ts";
import type { CitacaoResolvida } from "./citacoes-normas.ts";
import { citacoesResolvidas } from "./citacoes-normas.ts";
import { correspondenciaEm, destinosDeOrigemEm, type FonteCorrespondencia } from "./correspondencia.ts";
import { sucessorasDe } from "./relacoes.ts";
import { type FonteVigencia, statusEm, transicoesAplicaveis } from "./vigencia.ts";

export type MotivoCriterio =
  | "referencia"
  | "referencia-correspondente"
  | "citacao"
  | "citacao-sucessora"
  /** O critério pertence a um tópico cujos termos aparecem em dispositivos com mudança material. */
  | "tema";

/** Um critério da revisão de PPC (ficha) que a norma atinge. */
export interface CriterioAtingido {
  id: string;
  /** Caminho do arquivo da ficha, relativo à raiz do repositório. */
  arquivo: string;
  motivos: MotivoCriterio[];
  /** Dispositivos citados (da norma ou correspondentes da sucessora). */
  dispositivos: string[];
  /** Tópicos atingidos a que o critério pertence (motivo `tema`). */
  topicos?: string[];
}

export interface ResultadoImpacto {
  id: string;
  titulo: string | null;
  vigencia_em: string;
  status: string;
  sucessoras: string[];
  transicoes: string[];
  relacoes: { tipo: string; origem: string; operador: string | null; alvo: string; alvo_dispositivo: string | null }[];
  normas_que_citam: { id: string; dispositivos: string[] }[];
  ppcs: { total: number; ids: string[] };
}

function semAcentoMinusculo(texto: string): string {
  return texto
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Tópico da taxonomia das fichas (`topicos-fichas.json`), como o impacto o lê. */
export interface TopicoTaxonomia {
  id: string;
  termos_busca?: string[];
  fichas?: string[];
}

/** A vigência, as relações e a correspondência da base inteira, que as duas regras leem. */
interface FonteNormativa {
  /** A norma (ato, ou ato e dispositivo) para a qual a fonte foi carregada. */
  readonly id: string;
  /** Registro, datas, relações e transições (`statusEm`, `transicoesAplicaveis`). */
  readonly vigencia: FonteVigencia;
  readonly dataReferencia: string;
  readonly correspondencia: FonteCorrespondencia;
}

/**
 * O que o impacto da norma em análise lê, já carregado: a fonte normativa e, só da norma `id`, os
 * segmentos de outras normas que a citam e os PPCs que a citam. O `id` vai junto porque esses
 * recortes só valem para ele.
 */
export interface FonteImpacto extends FonteNormativa {
  /** Segmentos das normas da base de outros atos, com as citações resolvidas. */
  readonly segmentosCitantes: Iterable<{ norma: string; segmento: string; citacoes: CitacaoResolvida[] }>;
  /** PPCs que citam a norma (`id`, com o dispositivo, se houver). */
  readonly ppcsQueCitam: ReadonlyArray<PpcCitante>;
}

/** O que `criteriosAtingidosEm` lê: a fonte normativa, os dispositivos da norma, os tópicos e as fichas. */
export interface FonteCriterios extends FonteNormativa {
  /** Dispositivos da norma, em ordem, com o texto. */
  readonly dispositivos: ReadonlyArray<{ dispositivo: string; texto: string }>;
  /** Tópicos de `topicos-fichas.json`, na ordem do arquivo (vazio sem a taxonomia). */
  readonly topicos: ReadonlyArray<TopicoTaxonomia>;
  /** As fichas (caminho relativo à raiz do repositório e o JSON do arquivo), em ordem. */
  readonly fichas: Iterable<{ arquivo: string; texto: string }>;
  /** Os outros arquivos da tarefa (os marcos normativos, a taxonomia dos tópicos), como as fichas. */
  readonly arquivos: Iterable<{ arquivo: string; texto: string }>;
}

/** Um outro arquivo da tarefa "Revisar um PPC" (os marcos, a taxonomia) que cita a norma. */
export interface ArquivoDaTarefaAtingido {
  /** Caminho relativo à raiz do repositório. */
  arquivo: string;
  motivos: Exclude<MotivoCriterio, "tema">[];
  /** Dispositivos citados (da norma ou correspondentes da sucessora). */
  dispositivos: string[];
}

/**
 * Tópicos da taxonomia das fichas (`topicos-fichas.json`) atingidos: algum termo de busca do
 * tópico aparece num dispositivo da norma com mudança material (correspondência `parcial` ou
 * `sem-equivalente`; sem tabela, qualquer dispositivo). Sinal temático, mais largo que a citação.
 */
function topicosAtingidos(ato: string, fonte: FonteCriterios): Map<string, { fichas: string[] }> {
  const saida = new Map<string, { fichas: string[] }>();
  const taxonomia = fonte.topicos;
  if (!taxonomia.length) return saida;
  const dispositivos = fonte.dispositivos;
  const comTabela = (fonte.correspondencia.tabelas.get(ato) ?? []).length > 0;
  const materiais = comTabela
    ? dispositivos.filter((d) =>
        correspondenciaEm(`${ato}${d.dispositivo}`, fonte.correspondencia).some((c) => c.item.tipo !== "equivalente"),
      )
    : dispositivos;
  const texto = semAcentoMinusculo(materiais.map((d) => d.texto).join("\n"));
  for (const topico of taxonomia) {
    if (topico.id === "referencias_normativas" || topico.id === "sintese_transversal_revisao") continue;
    const termos = (topico.termos_busca ?? []).map(semAcentoMinusculo).filter((t) => t.length >= 4);
    if (termos.some((termo) => new RegExp(`\\b${termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(texto))) {
      saida.set(topico.id, { fichas: topico.fichas ?? [] });
    }
  }
  return saida;
}

function textosDoJson(valor: unknown, saida: string[] = []): string[] {
  if (typeof valor === "string") saida.push(valor);
  else if (Array.isArray(valor)) for (const item of valor) textosDoJson(item, saida);
  else if (valor && typeof valor === "object") for (const item of Object.values(valor)) textosDoJson(item, saida);
  return saida;
}

interface RefEstruturada {
  ref: string;
  dispositivo?: string;
}

function referenciasEstruturadas(json: unknown): RefEstruturada[] {
  const saida: RefEstruturada[] = [];
  const visitar = (valor: unknown) => {
    if (Array.isArray(valor)) valor.forEach(visitar);
    else if (valor && typeof valor === "object") {
      const objeto = valor as Record<string, unknown>;
      if (typeof objeto.ref === "string") {
        saida.push({
          ref: objeto.ref,
          ...(typeof objeto.dispositivo === "string" ? { dispositivo: objeto.dispositivo } : {}),
        });
      }
      Object.values(objeto).forEach(visitar);
    }
  };
  visitar(json);
  return saida;
}

/** O que a norma `fonte.id` alcança: o ato, o dispositivo, as sucessoras e os correspondentes nelas. */
function alcance(fonte: FonteNormativa) {
  const id = fonte.id;
  const [ato, sufixo] = id.split("#") as [string, string | undefined];
  const relacoes = fonte.vigencia.relacoes.filter((r) => r.origem === ato || r.alvo === ato);
  const sucessoras = sucessorasDe(ato, relacoes);
  // dispositivos de destino que correspondem ao ato ou, com sufixo, ao dispositivo consultado e aos subordinados
  const correspondentes = destinosDeOrigemEm(sufixo ? `${ato}#${sufixo}` : ato, fonte.correspondencia);
  /** O dispositivo citado é o consultado ou um subordinado dele (`#art2` não casa `#art29`). */
  const noDispositivo = (d: string | undefined) => !!d && (d === `#${sufixo}` || d.startsWith(`#${sufixo}-`));
  const citaLista = (
    citacoes: readonly CitacaoResolvida[],
  ): { cita: boolean; dispositivos: string[]; sucessora: boolean } => {
    let cita = false;
    let sucessora = false;
    const dispositivos: string[] = [];
    for (const c of citacoes) {
      const alvo = c.id;
      const lista = c.dispositivos;
      if (alvo === ato) {
        if (sufixo && !lista.some(noDispositivo)) continue;
        cita = true;
        dispositivos.push(...lista.map((d) => `${ato}${d}`));
      } else if (sucessoras.includes(alvo) && lista.some((d) => correspondentes.has(`${alvo}${d}`))) {
        sucessora = true;
        dispositivos.push(...lista.filter((d) => correspondentes.has(`${alvo}${d}`)).map((d) => `${alvo}${d}`));
      }
    }
    return { cita, dispositivos, sucessora };
  };
  return { ato, sufixo, relacoes, sucessoras, correspondentes, noDispositivo, citaLista };
}

/** Impacto da mudança na norma `fonte.id` (ato; o dispositivo, se houver, restringe as citações). */
export function impactoEm(
  fonte: FonteImpacto,
  opcoes: { data?: string; incluirPpcs?: boolean } = {},
): ResultadoImpacto {
  const id = fonte.id;
  const registro = fonte.vigencia.registro;
  const { ato, relacoes, sucessoras, citaLista } = alcance(fonte);
  const data = opcoes.data ?? fonte.dataReferencia;
  const vigencia = statusEm(ato, data, fonte.vigencia);
  const transicoes = transicoesAplicaveis(ato, data, fonte.vigencia).map((t) => t.id);

  // Normas da base que citam a norma: dispositivos e preâmbulo (fundamento citado nos considerandos).
  const normasQueCitam = new Map<string, Set<string>>();
  for (const segmento of fonte.segmentosCitantes) {
    if (segmento.norma === ato || !citaLista(segmento.citacoes).cita) continue;
    const lista = normasQueCitam.get(segmento.norma) ?? new Set<string>();
    lista.add(segmento.segmento);
    normasQueCitam.set(segmento.norma, lista);
  }

  const ppcs = opcoes.incluirPpcs === false ? [] : fonte.ppcsQueCitam;
  return {
    id,
    titulo: registro.obter(ato)?.title ?? null,
    vigencia_em: data,
    status: vigencia.status,
    sucessoras,
    transicoes,
    relacoes: relacoes.map((r) => ({
      tipo: r.tipo,
      origem: r.origem,
      operador: r.operador ?? null,
      alvo: r.alvo,
      alvo_dispositivo: r.alvo_dispositivo ?? null,
    })),
    normas_que_citam: [...normasQueCitam].map(([n, d]) => ({ id: n, dispositivos: [...d] })),
    ppcs: { total: ppcs.length, ids: ppcs.map((p) => p.ppc) },
  };
}

/**
 * Por que a norma atinge um arquivo JSON da tarefa: referência estruturada (a norma ou o correspondente na
 * sucessora), ID canônico num valor (a linha de um marco) ou citação no texto. Fora o `tema`.
 */
function atingeArquivo(
  texto: string,
  registro: FonteVigencia["registro"],
  { ato, sufixo, sucessoras, correspondentes, noDispositivo, citaLista }: ReturnType<typeof alcance>,
): { json: unknown; motivos: Set<MotivoCriterio>; dispositivos: Set<string> } {
  const motivos = new Set<MotivoCriterio>();
  const dispositivos = new Set<string>();
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    json = null;
  }
  const valores = json === null ? [texto] : textosDoJson(json);
  for (const ref of json === null ? [] : referenciasEstruturadas(json)) {
    if (ref.ref === ato && (!sufixo || noDispositivo(ref.dispositivo))) {
      motivos.add("referencia");
      if (ref.dispositivo) dispositivos.add(`${ato}${ref.dispositivo}`);
    } else if (sucessoras.includes(ref.ref) && ref.dispositivo && correspondentes.has(`${ref.ref}${ref.dispositivo}`)) {
      motivos.add("referencia-correspondente");
      dispositivos.add(`${ref.ref}${ref.dispositivo}`);
    }
  }
  // O ID canônico sozinho num valor (a `linha` de um marco normativo) é referência ao ato inteiro.
  if (!sufixo && valores.some((v) => v === ato)) motivos.add("referencia");
  const citacoes = citaLista(citacoesResolvidas(valores.join("\n"), registro));
  if (citacoes.cita) motivos.add("citacao");
  if (citacoes.sucessora) motivos.add("citacao-sucessora");
  for (const d of citacoes.dispositivos) dispositivos.add(d);
  return { json, motivos, dispositivos };
}

/**
 * Os critérios da revisão de PPC (fichas) que a norma `fonte.id` atinge, na ordem das fichas, e os
 * tópicos atingidos (sem o dispositivo na consulta: com ele, o sinal temático não vale).
 */
export function criteriosAtingidosEm(fonte: FonteCriterios): {
  criterios: CriterioAtingido[];
  topicos: string[];
  arquivos: ArquivoDaTarefaAtingido[];
} {
  const registro = fonte.vigencia.registro;
  const alcanceDaNorma = alcance(fonte);
  const { ato, sufixo } = alcanceDaNorma;
  const topicos = sufixo ? new Map<string, { fichas: string[] }>() : topicosAtingidos(ato, fonte);
  const topicosPorFicha = new Map<string, string[]>();
  for (const [topico, { fichas }] of topicos) {
    for (const ficha of fichas) topicosPorFicha.set(ficha, [...(topicosPorFicha.get(ficha) ?? []), topico]);
  }

  const criterios: CriterioAtingido[] = [];
  for (const { arquivo, texto } of fonte.fichas) {
    const { json, motivos, dispositivos } = atingeArquivo(texto, registro, alcanceDaNorma);
    const doJson = json !== null && typeof json === "object" && "id" in json ? (json as { id: unknown }).id : undefined;
    const id =
      typeof doJson === "string"
        ? doJson
        : arquivo
            .slice(arquivo.lastIndexOf("/") + 1)
            .replace(/\.json$/, "")
            .toUpperCase();
    const topicosDaFicha = topicosPorFicha.get(id);
    if (topicosDaFicha) motivos.add("tema");
    if (motivos.size) {
      criterios.push({
        id,
        arquivo,
        motivos: [...motivos],
        dispositivos: [...dispositivos].sort(),
        ...(topicosDaFicha ? { topicos: topicosDaFicha } : {}),
      });
    }
  }

  const arquivos: ArquivoDaTarefaAtingido[] = [];
  for (const { arquivo, texto } of fonte.arquivos) {
    const { motivos, dispositivos } = atingeArquivo(texto, registro, alcanceDaNorma);
    if (motivos.size) {
      arquivos.push({
        arquivo,
        motivos: [...motivos].filter((m): m is Exclude<MotivoCriterio, "tema"> => m !== "tema"),
        dispositivos: [...dispositivos].sort(),
      });
    }
  }
  return { criterios, topicos: [...topicos.keys()], arquivos };
}
