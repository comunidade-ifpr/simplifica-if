/**
 * `kb pacote-contexto <tarefa> <ppc>`: o contexto de uma tarefa da `revisar-ppc` montado pelo banco,
 * em vez do PPC inteiro mais os manifestos.
 *
 * Tarefa: uma ficha (`CT-CURR-12`), várias separadas por vírgula, um tópico de
 * `topicos-fichas.json` (`estagio`), um grupo da rodada (`grupo-001`: o n-ésimo grupo por tópico de
 * `agruparPorTopico`, o mesmo da skill) ou `todas`. O PPC é um da base (`campus/curso`) ou, por
 * `pacoteContextoAvulso`, um Markdown fora dela, segmentado em memória (`bancoDoPpcAvulso`).
 *
 * O pacote traz:
 * - o PPC (ID, arquivo, curso, forma, ano) e o curso do CNCT inteiro;
 * - as fichas (JSON da ficha, como os sub-agentes recebem);
 * - as normas citadas pelas fichas, com o texto de cada dispositivo citado
 *   (`referencias_normativas[].dispositivo`) da tabela `dispositivos`: caput herdado, o próprio
 *   texto e os subordinados, arquivo e linhas; um dispositivo contido noutro citado não se repete;
 * - os marcos normativos ligados (`marcos-normativos.json`, com vigente, substituídas e antecessoras
 *   derivadas da fase 5) e as citações do PPC às normas desses marcos;
 * - as regras de transição (tabela `transicoes`) das normas das fichas e das citadas como
 *   fundamento pelo PPC, com a situação na `data_referencia` e o texto do dispositivo que as
 *   estabelece;
 * - as seções do PPC dos tópicos das fichas (`dados/topicos-secoes.yaml`), mais as que a busca
 *   pelas `consultas` das fichas achar, com o texto integral e as linhas;
 * - os fatos do PPC e o cruzamento com o SUAP.
 *
 * Com `raiz`, o léxico, os tópicos e o tamanho do PPC vêm dos arquivos do checkout (o comportamento
 * da CLI); sem `raiz`, do próprio banco (`sinonimos_*`, `topicos`, `topicos_secoes`,
 * `ppcs.caracteres`): é o modo banco, que responde só com o `kb.sqlite` (`db/modo-banco.ts`).
 */
import type { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import type { Sinonimos } from "../busca/sinonimos.ts";
import { idDoAto } from "../normas/ids.ts";
import { palavrasDeCampi } from "../ppcs/secoes.ts";
import { compararTexto } from "../texto.ts";
import { bancoDoPpcAvulso } from "./compilar.ts";
import { registroBanco, sinonimosBanco } from "./fontes-banco.ts";
import { buscarSecoes, fatosDosPpcs, obterNorma, secoesDoPpc } from "./consultas.ts";
import {
  dataReferenciaBanco,
  type TransicaoNoBanco,
  type TrechoDispositivo,
  transicoesNoBanco,
  trechoDoDispositivo,
} from "./consultas-normas.ts";

export const esquemaTopicosSecoes = z.record(z.string(), z.array(z.string().regex(/^[a-z_]+$/)));
export type TopicosSecoes = z.output<typeof esquemaTopicosSecoes>;

export function lerTopicosSecoes(
  caminho: string = path.resolve(import.meta.dirname, "..", "..", "dados", "topicos-secoes.yaml"),
): TopicosSecoes {
  return esquemaTopicosSecoes.parse(parse(readFileSync(caminho, "utf-8"), { schema: "failsafe" }) ?? {});
}

/** Tamanho máximo de um grupo de sub-agente da `revisar-ppc` (fichas por grupo). */
export const TAMANHO_MAXIMO_GRUPO = 20;
/** Grupo das fichas de escopo transversal, que recebem o PPC inteiro. */
export const TOPICO_TRANSVERSAL = "transversal";

const esquemaTopicosFichas = z.looseObject({
  topicos: z.array(
    z.looseObject({
      id: z.string(),
      titulo: z.string().optional(),
      tipo_escopo: z.string().optional(),
      fichas: z.array(z.string()).optional(),
    }),
  ),
});
/** Tópico de `topicos-fichas.json`, na ordem da taxonomia. */
export type TopicoFichas = z.output<typeof esquemaTopicosFichas>["topicos"][number];

/** Tópicos de `.agents/skills/revisar-ppc/base-analise/topicos-fichas.json`, na ordem do arquivo. */
export function lerTopicosFichas(raiz: string): TopicoFichas[] {
  const arquivo = path.join(raiz, ".agents", "skills", "revisar-ppc", "base-analise", "topicos-fichas.json");
  return esquemaTopicosFichas.parse(JSON.parse(readFileSync(arquivo, "utf-8"))).topicos;
}

/** Os tópicos de `lerTopicosFichas`, pela tabela `topicos` do banco (na ordem do arquivo). */
export function topicosFichasBanco(db: DatabaseSync): TopicoFichas[] {
  const linhas = z
    .array(z.strictObject({ dados_json: z.string() }))
    .parse(db.prepare("SELECT dados_json FROM topicos ORDER BY ordem").all());
  return esquemaTopicosFichas.parse({ topicos: linhas.map((l) => JSON.parse(l.dados_json)) }).topicos;
}

/** O mapa de `lerTopicosSecoes`, pela tabela `topicos_secoes` do banco (na ordem do arquivo). */
export function topicosSecoesBanco(db: DatabaseSync): TopicosSecoes {
  const linhas = z
    .array(z.strictObject({ topico: z.string(), tipos_json: z.string() }))
    .parse(db.prepare("SELECT topico, tipos_json FROM topicos_secoes ORDER BY ordem").all());
  return esquemaTopicosSecoes.parse(Object.fromEntries(linhas.map((l) => [l.topico, JSON.parse(l.tipos_json)])));
}

/** Ficha como entra no pacote e no agrupamento: o JSON da ficha (`id`, tópicos, consultas, referências). */
export type FichaPacote = { id: string } & Record<string, unknown>;

function textos(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Tópico principal de uma ficha, o que decide o grupo do sub-agente:
 * - ficha com `tipo_escopo: transversal` (as de síntese, que cruzam o PPC inteiro) ou sem tópico
 *   conhecido → `transversal`;
 * - senão, dos `topicos_tematicos` da ficha, o mais específico: o de menos fichas na taxonomia; no
 *   empate, o primeiro na ordem de `topicos-fichas.json`.
 * A ficha multitemática fica num grupo só, mas o pacote do grupo traz as seções de todos os tópicos
 * dela (`secoesDoPacote`).
 */
export function topicoPrincipal(ficha: FichaPacote, topicos: readonly TopicoFichas[]): string {
  if (ficha.tipo_escopo === "transversal") return TOPICO_TRANSVERSAL;
  const proprios = new Set(textos(ficha.topicos_tematicos));
  const candidatos = topicos
    .map((topico, ordem) => ({ id: topico.id, ordem, total: topico.fichas?.length ?? 0 }))
    .filter((topico) => proprios.has(topico.id));
  if (!candidatos.length) return TOPICO_TRANSVERSAL;
  candidatos.sort((a, b) => a.total - b.total || a.ordem - b.ordem);
  return candidatos[0]!.id;
}

/** Grupo de fichas de um tópico (ou parte dele) para um sub-agente. */
export interface GrupoDeTopico<F extends FichaPacote = FichaPacote> {
  topico: string;
  topico_titulo: string;
  /** Parte do tópico (1 a `partes`) quando ele passa do tamanho máximo. */
  parte: number;
  partes: number;
  /** `secoes`: o pacote traz as seções do PPC dos tópicos das fichas; `completo`: o PPC inteiro. */
  escopo: "secoes" | "completo";
  fichas: F[];
}

/**
 * Grupos de sub-agente por tópico: cada ficha entra uma vez, no grupo do seu tópico principal
 * (`topicoPrincipal`). Os grupos seguem a ordem de `topicos-fichas.json`, com o `transversal` por
 * último; dentro do grupo, as fichas vão em ordem de ID. Tópico com mais fichas que
 * `tamanhoMaximo` é dividido em partes de tamanho equilibrado (14 com máximo 10 → 7 + 7).
 */
export function agruparPorTopico<F extends FichaPacote>(
  fichas: readonly F[],
  topicos: readonly TopicoFichas[],
  tamanhoMaximo: number = TAMANHO_MAXIMO_GRUPO,
): GrupoDeTopico<F>[] {
  if (!Number.isInteger(tamanhoMaximo) || tamanhoMaximo <= 0) {
    throw new Error("O tamanho do grupo precisa ser maior que zero.");
  }
  const porTopico = new Map<string, F[]>();
  for (const ficha of [...fichas].sort((a, b) => compararTexto(a.id, b.id))) {
    const topico = topicoPrincipal(ficha, topicos);
    porTopico.set(topico, [...(porTopico.get(topico) ?? []), ficha]);
  }
  const ordem = [...topicos.map((t) => t.id).filter((id) => id !== TOPICO_TRANSVERSAL), TOPICO_TRANSVERSAL];
  const titulos = new Map(topicos.map((t) => [t.id, t.titulo ?? t.id]));
  titulos.set(TOPICO_TRANSVERSAL, "Fichas transversais (PPC completo)");
  const grupos: GrupoDeTopico<F>[] = [];
  for (const topico of ordem) {
    const lista = porTopico.get(topico);
    if (!lista?.length) continue;
    const partes = Math.ceil(lista.length / tamanhoMaximo);
    const base = Math.floor(lista.length / partes);
    const sobra = lista.length % partes;
    let inicio = 0;
    for (let parte = 1; parte <= partes; parte += 1) {
      const tamanho = base + (parte <= sobra ? 1 : 0);
      grupos.push({
        topico,
        topico_titulo: titulos.get(topico)!,
        parte,
        partes,
        escopo: topico === TOPICO_TRANSVERSAL ? "completo" : "secoes",
        fichas: lista.slice(inicio, inicio + tamanho),
      });
      inicio += tamanho;
    }
  }
  return grupos;
}

const esquemaFicha = z.strictObject({ id: z.string(), path: z.string(), dados_json: z.string() });
const esquemaPpc = z.strictObject({
  id: z.string(),
  curso_nome: z.string(),
  campus_nome: z.string(),
  nivel: z.string(),
  tipo_oferta: z.string(),
  path: z.string(),
  curso_id: z.string().nullable(),
  ano_documento: z.number().int().nullable(),
  cnct_id: z.string().nullable(),
});
const esquemaMarco = z.strictObject({
  id: z.string(),
  tema: z.string(),
  vigente: z.string(),
  aplica_a: z.string().nullable(),
  transicao: z.string().nullable(),
  orientacao_analise: z.string().nullable(),
  normas_json: z.string(),
  path: z.string(),
});
const esquemaCitacao = z.strictObject({
  ato_id: z.string(),
  linha: z.number().int(),
  trecho: z.string(),
  papel: z.string(),
  secao_tipo: z.string().nullable(),
  regra: z.string(),
});
type CitacaoPpc = z.output<typeof esquemaCitacao>;

/** Fichas do banco (JSON da ficha), em ordem de ID. */
export function fichasDoBanco(db: DatabaseSync, ids?: readonly string[]): FichaPacote[] {
  const filtro = ids ? ` WHERE id IN (${ids.map(() => "?").join(", ")})` : "";
  return z
    .array(esquemaFicha)
    .parse(db.prepare(`SELECT id, path, dados_json FROM fichas${filtro} ORDER BY id`).all(...(ids ?? [])))
    .map((f) => JSON.parse(f.dados_json) as FichaPacote);
}

/**
 * IDs das fichas de uma tarefa. `grupo-NNN` é o n-ésimo grupo por tópico da `revisar-ppc`
 * (`agruparPorTopico` com `topicos`, o tamanho máximo padrão e todas as fichas do banco).
 */
export function fichasDaTarefa(db: DatabaseSync, tarefa: string, topicos?: readonly TopicoFichas[]): string[] {
  const todas = z
    .array(z.strictObject({ id: z.string() }))
    .parse(db.prepare("SELECT id FROM fichas").all())
    .map((f) => f.id)
    .sort(compararTexto);
  if (tarefa === "todas") return todas;
  const grupo = /^grupo-(\d{3})$/.exec(tarefa);
  if (grupo) {
    if (!topicos) throw new Error("grupo-NNN exige os tópicos de topicos-fichas.json");
    const grupos = agruparPorTopico(fichasDoBanco(db), topicos);
    const escolhido = grupos[Number(grupo[1]) - 1];
    if (!escolhido) throw new Error(`grupo inexistente: ${tarefa} (há ${grupos.length})`);
    return escolhido.fichas.map((f) => f.id);
  }
  const topico = z
    .array(z.strictObject({ ficha_id: z.string() }))
    .parse(db.prepare("SELECT ficha_id FROM fichas_topicos WHERE topico_id = ? ORDER BY ficha_id").all(tarefa));
  if (topico.length) return topico.map((t) => t.ficha_id).filter((id) => todas.includes(id));
  const pedidas = tarefa.split(",").map((t) => t.trim().toUpperCase());
  const faltando = pedidas.filter((id) => !todas.includes(id));
  if (faltando.length)
    throw new Error(`tarefa não reconhecida (ficha, tópico, grupo-NNN ou todas): ${faltando.join(", ")}`);
  return pedidas;
}

/**
 * Dispositivo citado no pacote: o essencial de `TrechoDispositivo`, sem os campos vazios (caput,
 * subordinados e notas só quando existem; `citados` só quando o trecho cobre outros IDs pedidos).
 */
export interface DispositivoDoPacote {
  id: string;
  /** Todos os IDs pedidos pelas fichas que este trecho cobre (o próprio e subordinados). */
  citados?: string[];
  fichas: string[];
  caput?: string[];
  texto: string;
  subordinados?: TrechoDispositivo["subordinados"];
  notas?: TrechoDispositivo["notas"];
  revogado?: true;
  path: string;
  linha_inicio: number;
  linha_fim: number;
}

/** Regra de transição no pacote (tabela `transicoes`), com o texto literal do dispositivo. */
export interface TransicaoDoPacote {
  id: string;
  norma_id: string;
  dispositivo: string;
  tipo: string;
  norma_anterior: string | null;
  aplica_a: string;
  regra: string;
  situacao: TransicaoNoBanco["situacao"];
  inicio: string;
  inicio_em: string | null;
  inicio_minimo: string | null;
  fim: string;
  fim_em: string | null;
  caput?: string[];
  texto: string | null;
  path: string | null;
  linha_inicio: number | null;
  linha_fim: number | null;
}

function paraPacote(trecho: TrechoDispositivo, citados: string[], fichas: string[]): DispositivoDoPacote {
  return {
    id: trecho.id,
    ...(citados.length > 1 || citados[0] !== trecho.id ? { citados } : {}),
    fichas,
    ...(trecho.caput.length ? { caput: trecho.caput } : {}),
    texto: trecho.texto,
    ...(trecho.subordinados.length ? { subordinados: trecho.subordinados } : {}),
    ...(trecho.notas.length ? { notas: trecho.notas } : {}),
    ...(trecho.revogado ? { revogado: true as const } : {}),
    path: trecho.path,
    linha_inicio: trecho.linha_inicio,
    linha_fim: trecho.linha_fim,
  };
}

/** Norma citada pelas fichas, com o texto dos dispositivos citados. */
export interface NormaDoPacote {
  ref: string;
  titulo: string | null;
  status_vigencia: string | null;
  path: string | null;
  fichas: string[];
  /** Dispositivos citados, com o texto, na ordem do arquivo. */
  dispositivos: DispositivoDoPacote[];
  /** Dispositivos citados que não estão no texto da base (stub, por exemplo). */
  sem_texto: string[];
}

/** Marco normativo ligado às normas das fichas ou às citadas pelo PPC. */
export interface MarcoDoPacote {
  marco: string;
  tema: string;
  vigente: string;
  normas: unknown;
  transicao: string | null;
  orientacao_analise: string | null;
  path: string;
  citacoes_no_ppc: CitacaoPpc[];
}

/** Seção do PPC no pacote, com o texto integral e por que entrou (`topico:<id>`, `busca:<ficha>:<consulta>`). */
export interface SecaoDoPacote {
  id: string;
  tipo: string;
  titulo: string;
  path: string;
  linha_inicio: number;
  linha_fim: number;
  motivo: string[];
  texto: string;
}

export interface PacoteContexto {
  tarefa: string;
  fichas_ids: string[];
  ppc: z.output<typeof esquemaPpc> & { path: string };
  cnct: unknown;
  fichas: unknown[];
  normas: NormaDoPacote[];
  marcos: MarcoDoPacote[];
  /** Data da situação das regras de transição (`data_referencia` de `config/vigencia.yaml`). */
  data_referencia: string;
  /** Regras de transição, com a situação em `data_referencia` e o texto do dispositivo que as estabelece. */
  transicoes: TransicaoDoPacote[];
  secoes: SecaoDoPacote[];
  fatos: unknown;
  tamanho: { caracteres: number; secoes: number; caracteres_secoes: number; caracteres_ppc_inteiro: number };
}

/* ------------------------------------------------------------ partes do pacote */

/** Referência normativa de uma ficha (`referencias_normativas[]`). */
interface RefFicha {
  ficha_id: string;
  ref: string;
  dispositivo: string | null;
  papel: string;
  nota: string | null;
}

/** Referências das fichas, por norma, dispositivo (sem dispositivo antes) e ficha. */
export function referenciasDasFichas(fichas: readonly FichaPacote[]): RefFicha[] {
  const refs: RefFicha[] = [];
  for (const ficha of [...fichas].sort((a, b) => compararTexto(a.id, b.id))) {
    const lista = Array.isArray(ficha.referencias_normativas) ? ficha.referencias_normativas : [];
    for (const item of lista as Record<string, unknown>[]) {
      refs.push({
        ficha_id: ficha.id,
        ref: String(item.ref),
        dispositivo: typeof item.dispositivo === "string" ? item.dispositivo : null,
        papel: String(item.papel),
        nota: typeof item.nota === "string" ? item.nota : null,
      });
    }
  }
  const nulo = (a: string | null, b: string | null) =>
    a === b ? 0 : a === null ? -1 : b === null ? 1 : compararTexto(a, b);
  return refs.sort(
    (a, b) =>
      compararTexto(a.ref, b.ref) || nulo(a.dispositivo, b.dispositivo) || compararTexto(a.ficha_id, b.ficha_id),
  );
}

/**
 * Normas citadas pelas fichas, com o texto de cada dispositivo citado (`dispositivos` do banco):
 * caput herdado, o próprio texto e os subordinados; um dispositivo contido noutro citado não se
 * repete (vai em `citados`).
 */
export function normasDoPacote(db: DatabaseSync, refs: readonly RefFicha[]): NormaDoPacote[] {
  const porRef = new Map<string, RefFicha[]>();
  for (const r of refs) if (!r.ref.startsWith("cnct:")) porRef.set(r.ref, [...(porRef.get(r.ref) ?? []), r]);
  const normas: NormaDoPacote[] = [];
  for (const [ref, lista] of porRef) {
    const norma = obterNorma(db, ref);
    // um pedido por dispositivo, do mais geral (menos segmentos no ID) ao mais específico
    const pedidos = new Map<string, string[]>();
    for (const r of lista) {
      if (r.dispositivo) pedidos.set(r.dispositivo, [...new Set([...(pedidos.get(r.dispositivo) ?? []), r.ficha_id])]);
    }
    const ordenados = [...pedidos.keys()].sort(
      (a, b) => a.split("-").length - b.split("-").length || compararTexto(a, b),
    );
    const trechos: { trecho: TrechoDispositivo; citados: string[]; fichas: string[] }[] = [];
    const semTexto: string[] = [];
    for (const pedido of ordenados) {
      const id = `${idDoAto(ref)}${pedido}`;
      const fichasPedido = pedidos.get(pedido)!;
      const cobre = trechos.find((t) => t.trecho.id === id || t.trecho.subordinados.some((s) => s.id === id));
      if (cobre) {
        cobre.citados.push(id);
        cobre.fichas = [...new Set([...cobre.fichas, ...fichasPedido])].sort(compararTexto);
        continue;
      }
      const trecho = norma?.path ? trechoDoDispositivo(db, id, { subordinados: true }) : null;
      if (trecho) trechos.push({ trecho, citados: [id], fichas: [...fichasPedido].sort(compararTexto) });
      else semTexto.push(id);
    }
    normas.push({
      ref,
      titulo: norma?.titulo ?? null,
      status_vigencia: norma?.status_vigencia ?? null,
      path: norma?.path ?? null,
      fichas: [...new Set(lista.map((r) => r.ficha_id))],
      dispositivos: trechos
        .sort((a, b) => a.trecho.linha_inicio - b.trecho.linha_inicio)
        .map((t) => paraPacote(t.trecho, t.citados, t.fichas)),
      sem_texto: semTexto,
    });
  }
  return normas;
}

/** Citações normativas resolvidas de um PPC (`citacoes`), na ordem do texto. */
export function citacoesDoPpc(db: DatabaseSync, ppcId: string): CitacaoPpc[] {
  return z
    .array(esquemaCitacao)
    .parse(
      db
        .prepare(
          "SELECT ato_id, linha, trecho, papel, secao_tipo, regra FROM citacoes WHERE ppc_id = ? AND ato_id IS NOT NULL ORDER BY ordem",
        )
        .all(ppcId),
    );
}

/** Marcos ligados às normas das fichas ou às citadas pelo PPC, com as citações do PPC (fundamento) a elas. */
export function marcosDoPacote(
  db: DatabaseSync,
  refs: readonly RefFicha[],
  citacoesPpc: readonly CitacaoPpc[],
): MarcoDoPacote[] {
  const atosCitadosPpc = new Set(citacoesPpc.map((c) => c.ato_id));
  const atosFichas = new Set(refs.map((r) => idDoAto(r.ref)));
  const marcos: MarcoDoPacote[] = [];
  for (const m of z
    .array(esquemaMarco)
    .parse(
      db
        .prepare(
          "SELECT id, tema, vigente, aplica_a, transicao, orientacao_analise, normas_json, path FROM marcos ORDER BY id",
        )
        .all(),
    )) {
    const normasMarco = JSON.parse(m.normas_json) as {
      linha: string[];
      vigente: string;
      substitui: string[];
      antecessoras_historicas: string[];
      dispositivos_revogados: string[];
    };
    const envolvidas = new Set([
      ...normasMarco.linha,
      normasMarco.vigente,
      ...normasMarco.substitui,
      ...normasMarco.antecessoras_historicas,
      ...normasMarco.dispositivos_revogados.map(idDoAto),
    ]);
    const ligado = [...envolvidas].some((id) => atosFichas.has(id) || atosCitadosPpc.has(id));
    if (!ligado) continue;
    marcos.push({
      marco: m.id,
      tema: m.tema,
      vigente: m.vigente,
      normas: normasMarco,
      transicao: m.transicao,
      orientacao_analise: m.orientacao_analise,
      path: m.path,
      citacoes_no_ppc: citacoesPpc.filter((c) => envolvidas.has(c.ato_id) && c.papel === "fundamento"),
    });
  }
  return marcos;
}

/**
 * Regras de transição (tabela `transicoes`) das normas das fichas e das que o PPC cita como
 * fundamento, com a situação na `data_referencia` e o texto do dispositivo que as estabelece.
 */
export function transicoesDoPacote(
  db: DatabaseSync,
  refs: readonly RefFicha[],
  citacoesPpc: readonly CitacaoPpc[],
): { data_referencia: string; transicoes: TransicaoDoPacote[] } {
  const data = dataReferenciaBanco(db);
  const atosFichas = new Set(refs.map((r) => idDoAto(r.ref)));
  const atosTransicao = [
    ...new Set([...atosFichas, ...citacoesPpc.filter((c) => c.papel === "fundamento").map((c) => c.ato_id)]),
  ].sort(compararTexto);
  const transicoes: TransicaoDoPacote[] = transicoesNoBanco(db, atosTransicao, data).map((t) => {
    const d = trechoDoDispositivo(db, `${t.norma_id}${t.dispositivo}`);
    return {
      id: t.id,
      norma_id: t.norma_id,
      dispositivo: t.dispositivo,
      tipo: t.tipo,
      norma_anterior: t.norma_anterior,
      aplica_a: t.aplica_a,
      regra: t.regra,
      situacao: t.situacao,
      inicio: t.inicio,
      inicio_em: t.inicio_em,
      inicio_minimo: t.inicio_minimo,
      fim: t.fim,
      fim_em: t.fim_em,
      ...(d?.caput.length ? { caput: d.caput } : {}),
      texto: d?.texto ?? null,
      path: d?.path ?? null,
      linha_inicio: d?.linha_inicio ?? null,
      linha_fim: d?.linha_fim ?? null,
    };
  });
  return { data_referencia: data, transicoes };
}

/** Consultas da ficha que são texto do PPC (as que são nomes de campo, como `cnct_contexto.x`, ficam fora). */
export function consultasDeTexto(ficha: FichaPacote): string[] {
  return textos(ficha.consultas).filter((c) => !/^[\w.]+$/.test(c) || !/[._]/.test(c));
}

/**
 * Seções do PPC para as fichas: as dos tipos mapeados para os tópicos das fichas
 * (`dados/topicos-secoes.yaml`), mais, por consulta de cada ficha, a melhor seção com todos os
 * termos (AND); em ordem do documento. `db` é o `kb.sqlite` (PPC da base) ou o banco em memória de
 * `bancoDoPpcAvulso` (PPC fora da base): as consultas são as mesmas.
 */
export function secoesDoPacote(
  db: DatabaseSync,
  ppcId: string,
  fichas: readonly FichaPacote[],
  opcoes: OpcoesSecoes = {},
): SecaoDoPacote[] {
  const mapa = opcoes.topicosSecoes ?? lerTopicosSecoes();
  const secoes = new Map<string, SecaoDoPacote>();
  const topicos = [...new Set(fichas.flatMap((f) => textos(f.topicos_tematicos)))].sort(compararTexto);
  for (const topico of topicos) {
    for (const s of secoesDoPpc(db, ppcId, mapa[topico] ?? [])) {
      const atual = secoes.get(s.id) ?? { ...s, motivo: [] };
      atual.motivo.push(`topico:${topico}`);
      secoes.set(s.id, atual);
    }
  }
  const buscas = opcoes.buscasPorFicha ?? 1;
  for (const ficha of [...fichas].sort((a, b) => compararTexto(a.id, b.id))) {
    for (const consulta of consultasDeTexto(ficha)) {
      const achados = buscarSecoes(
        db,
        consulta,
        { ppc: ppcId },
        {
          limite: buscas,
          modo: "completo",
          ...(opcoes.lexico ? { lexico: opcoes.lexico } : {}),
          integral: true,
          somenteTodos: true,
        },
      );
      for (const a of achados) {
        const atual = secoes.get(a.id) ?? {
          id: a.id,
          tipo: a.tipo,
          titulo: a.titulo,
          path: a.path,
          linha_inicio: a.linha_inicio,
          linha_fim: a.linha_fim,
          texto: a.texto ?? "",
          motivo: [],
        };
        const motivo = `busca:${ficha.id}:${consulta}`;
        if (!atual.motivo.includes(motivo)) atual.motivo.push(motivo);
        secoes.set(a.id, atual);
      }
    }
  }
  return [...secoes.values()].sort((a, b) => a.linha_inicio - b.linha_inicio);
}

/** Opções da seleção de seções do PPC. */
export interface OpcoesSecoes {
  lexico?: Sinonimos;
  topicosSecoes?: TopicosSecoes;
  /** Seções por consulta de ficha (padrão 1: a melhor com todos os termos). */
  buscasPorFicha?: number;
}

/** Opções de seção com o léxico e o mapa tópico → seções do banco, onde não foram informados. */
function opcoesDoBanco(db: DatabaseSync, opcoes: OpcoesSecoes): OpcoesSecoes {
  return {
    ...opcoes,
    lexico: opcoes.lexico ?? sinonimosBanco(db),
    topicosSecoes: opcoes.topicosSecoes ?? topicosSecoesBanco(db),
  };
}

function cnctDoBanco(db: DatabaseSync, cnctId: string | null): unknown {
  if (!cnctId) return null;
  const id = cnctId.startsWith("cnct:") ? cnctId : `cnct:${cnctId}`;
  const linha = z
    .strictObject({ dados_json: z.string(), path: z.string().nullable() })
    .nullable()
    .parse(db.prepare("SELECT dados_json, path FROM cnct WHERE id = ?").get(id) ?? null);
  return linha ? { id, path: linha.path, ...JSON.parse(linha.dados_json) } : null;
}

/* ------------------------------------------------------------ pacotes */

/**
 * Opções do pacote. `raiz` (o checkout): léxico, tópicos e tamanho do PPC lidos dos arquivos, como
 * na CLI; sem ela, do banco. `lexico`, `topicosSecoes` e `topicosFichas` informados prevalecem.
 */
export interface OpcoesPacote extends OpcoesSecoes {
  raiz?: string;
  topicosFichas?: readonly TopicoFichas[];
}

export function pacoteContexto(db: DatabaseSync, tarefa: string, ppcArg: string, opcoes: OpcoesPacote): PacoteContexto {
  const ppcId = ppcArg.startsWith("ppc:") ? ppcArg : `ppc:${ppcArg}`;
  const ppcLinha = db
    .prepare(
      `SELECT p.id, p.curso_nome, p.campus_nome, p.nivel, p.tipo_oferta, p.path, p.curso_id, p.ano_documento, c.cnct_id
       FROM ppcs p LEFT JOIN cursos c ON c.id = p.curso_id WHERE p.id = ?`,
    )
    .get(ppcId);
  if (!ppcLinha) throw new Error(`PPC não encontrado: ${ppcId}`);
  const ppc = esquemaPpc.parse(ppcLinha);
  const raiz = opcoes.raiz;
  const topicosDaTarefa = () =>
    opcoes.topicosFichas ?? (raiz !== undefined ? lerTopicosFichas(raiz) : topicosFichasBanco(db));
  const fichasIds = fichasDaTarefa(db, tarefa, /^grupo-\d{3}$/.test(tarefa) ? topicosDaTarefa() : undefined);
  const fichas = fichasDoBanco(db, fichasIds);
  const refs = referenciasDasFichas(fichas);
  const citacoesPpc = citacoesDoPpc(db, ppc.id);
  const listaSecoes = secoesDoPacote(db, ppc.id, fichas, raiz !== undefined ? opcoes : opcoesDoBanco(db, opcoes));
  const fatos = fatosDosPpcs(db, { ppc: ppc.id })[0] ?? null;
  const caracteresSecoes = listaSecoes.reduce((t, s) => t + s.texto.length, 0);
  const ppcInteiro =
    raiz !== undefined
      ? readFileSync(path.join(raiz, ppc.path), "utf-8").length
      : z
          .strictObject({ caracteres: z.number().int() })
          .parse(db.prepare("SELECT caracteres FROM ppcs WHERE id = ?").get(ppc.id)).caracteres;
  const pacote: PacoteContexto = {
    tarefa,
    fichas_ids: fichasIds,
    ppc,
    cnct: cnctDoBanco(db, ppc.cnct_id),
    fichas,
    normas: normasDoPacote(db, refs),
    marcos: marcosDoPacote(db, refs, citacoesPpc),
    ...transicoesDoPacote(db, refs, citacoesPpc),
    secoes: listaSecoes,
    fatos: fatos ? { fatos: fatos.fatos, suap: fatos.suap, cruzamento: fatos.cruzamento } : null,
    tamanho: {
      caracteres: 0,
      secoes: listaSecoes.length,
      caracteres_secoes: caracteresSecoes,
      caracteres_ppc_inteiro: ppcInteiro,
    },
  };
  pacote.tamanho.caracteres = JSON.stringify(pacote, null, 2).length;
  return pacote;
}

/** Pacote de fichas para um PPC fora da base (o `PPC.md` de uma rodada), sem o PPC e sem as fichas. */
export interface PacoteAvulso {
  fichas_ids: string[];
  /** Curso do CNCT (`cnct`), quando o chamador identificou o `cnct_id`. */
  cnct: unknown;
  normas: NormaDoPacote[];
  marcos: MarcoDoPacote[];
  data_referencia: string;
  transicoes: TransicaoDoPacote[];
  escopo: "secoes" | "completo";
  /** Seções do PPC (vazio no escopo `completo`, em que o chamador usa o PPC inteiro). */
  secoes: SecaoDoPacote[];
  /** Todas as citações normativas resolvidas do PPC, com linha, seção e papel (só com `citacoesPpc`). */
  citacoes_ppc?: CitacaoPpc[];
}

/**
 * Pacote de contexto de um conjunto de fichas para um PPC que pode não estar na base: as normas,
 * os marcos, as transições e o CNCT vêm do `kb.sqlite` (`db`); as seções e as citações do PPC, do
 * banco em memória de `bancoDoPpcAvulso` (`dbPpc`), com as mesmas consultas do pacote de um PPC da
 * base. Usado pela `revisar-ppc` para montar o contexto de cada grupo de sub-agente.
 */
export function pacoteContextoAvulso(
  db: DatabaseSync,
  dbPpc: DatabaseSync,
  fichas: readonly FichaPacote[],
  opcoes: {
    ppcId?: string;
    cnctId?: string | null;
    escopo?: "secoes" | "completo";
    /** Inclui `citacoes_ppc`: as fichas que conferem a base normativa citada no PPC inteiro. */
    citacoesPpc?: boolean;
  } & OpcoesSecoes = {},
): PacoteAvulso {
  const ppcId = opcoes.ppcId ?? "ppc:avulso";
  const escopo = opcoes.escopo ?? "secoes";
  const refs = referenciasDasFichas(fichas);
  const citacoesPpc = citacoesDoPpc(dbPpc, ppcId);
  return {
    fichas_ids: [...fichas].map((f) => f.id).sort(compararTexto),
    cnct: cnctDoBanco(db, opcoes.cnctId ?? null),
    normas: normasDoPacote(db, refs),
    marcos: marcosDoPacote(db, refs, citacoesPpc),
    ...transicoesDoPacote(db, refs, citacoesPpc),
    escopo,
    secoes: escopo === "completo" ? [] : secoesDoPacote(dbPpc, ppcId, fichas, opcoes),
    ...(opcoes.citacoesPpc ? { citacoes_ppc: citacoesPpc } : {}),
  };
}

/** Palavras dos nomes dos campi dos PPCs do banco, para reconhecer cabeçalhos de página (`palavrasDeCampi`). */
export function nomesDeCampiDoBanco(db: DatabaseSync): string[] {
  return z
    .array(z.strictObject({ campus_nome: z.string() }))
    .parse(db.prepare("SELECT DISTINCT campus_nome FROM ppcs ORDER BY campus_nome").all())
    .map((l) => l.campus_nome);
}

/**
 * `kb pacote-contexto <tarefa> <arquivo.md>`: o pacote de uma tarefa para um PPC fora da base. As
 * fichas e o agrupamento vêm do banco (`grupo-NNN` traz o escopo do grupo); o PPC é segmentado e
 * indexado em memória (`bancoDoPpcAvulso`).
 */
export function pacoteDoMarkdown(
  db: DatabaseSync,
  tarefa: string,
  arquivo: string,
  opcoes: OpcoesPacote & {
    /** Texto do PPC (padrão: lido de `arquivo`, que fica só como `path` quando o texto vem aqui). */
    markdown?: string;
  },
): PacoteAvulso & {
  path: string;
  fichas: FichaPacote[];
  tamanho: { caracteres: number; caracteres_ppc_inteiro: number };
} {
  const raiz = opcoes.raiz;
  const secoes = raiz !== undefined ? opcoes : opcoesDoBanco(db, opcoes);
  const topicos = opcoes.topicosFichas ?? (raiz !== undefined ? lerTopicosFichas(raiz) : topicosFichasBanco(db));
  const ids = fichasDaTarefa(db, tarefa, topicos);
  const fichas = fichasDoBanco(db, ids);
  const grupo = /^grupo-\d{3}$/.test(tarefa)
    ? agruparPorTopico(fichasDoBanco(db), topicos)[Number(tarefa.slice(6)) - 1]
    : undefined;
  const markdown = opcoes.markdown ?? readFileSync(arquivo, "utf-8");
  const dbPpc = bancoDoPpcAvulso(markdown, {
    path: arquivo,
    ...(raiz !== undefined ? { raiz } : { registro: registroBanco(db) }),
    palavrasCampi: palavrasDeCampi(nomesDeCampiDoBanco(db)),
    ...(secoes.lexico ? { sinonimos: secoes.lexico } : {}),
  });
  try {
    const pacote = pacoteContextoAvulso(db, dbPpc, fichas, {
      escopo: grupo?.escopo ?? "secoes",
      ...(secoes.lexico ? { lexico: secoes.lexico } : {}),
      ...(secoes.topicosSecoes ? { topicosSecoes: secoes.topicosSecoes } : {}),
    });
    const saida = {
      path: arquivo,
      ...pacote,
      fichas,
      tamanho: { caracteres: 0, caracteres_ppc_inteiro: markdown.length },
    };
    saida.tamanho.caracteres = JSON.stringify(saida, null, 2).length;
    return saida;
  } finally {
    dbPpc.close();
  }
}
