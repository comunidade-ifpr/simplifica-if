/**
 * `kb pacote-contexto <tarefa> <ppc>`: o contexto de uma tarefa da revisão de PPC montado pelo banco,
 * em vez do PPC inteiro mais os manifestos.
 *
 * Tarefa: uma ficha (`CT-CURR-12`), várias separadas por vírgula, um tópico de
 * `topicos-fichas.json` (`estagio`) ou `todas`. O PPC é um da base (`campus/curso`) ou, por
 * `abrirPpcAvulso`, um Markdown fora dela, segmentado num banco em memória (`ppc-avulso.ts`).
 *
 * O pacote traz:
 * - o PPC (ID, arquivo, curso, forma, ano) e o curso do CNCT inteiro;
 * - as fichas (o JSON de cada uma);
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
 * O léxico, os tópicos e a data de referência vêm de `FontesNormativas` (do banco ou dos arquivos,
 * conforme a layer); o tamanho do PPC, de `ppcs.caracteres`. As consultas pedem o `SqlClient` do
 * ambiente: o `kb.sqlite` ou, para as partes que leem um PPC fora da base, o banco em memória de
 * `ppc-avulso.ts` (`abrirPpcAvulso`).
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type { Sinonimos } from "../busca/sinonimos.ts";
import * as FontesNormativas from "../FontesNormativas.ts";
import { PpcNaoEncontrado, TarefaNaoReconhecida } from "../pacote-contexto-erros.ts";
import { idDoAto } from "../normas/ids.ts";
import { extrairFatosPpc, type FatoPpc } from "../fatos/ppc.ts";
import { palavrasDeCampi, type SecaoPpc, segmentarPpc } from "../ppcs/secoes.ts";
import type { TopicosSecoes } from "../ppcs/topicos.ts";
import { compararTexto } from "../texto.ts";
import { idCnct, idPpc } from "./chaves.ts";
import { fatosDosPpcs } from "./consultas-fatos.ts";
import { buscarSecoes, secoesDoPpc } from "./consultas-secoes.ts";
import {
  obterNorma,
  type TransicaoNoBanco,
  type TrechoDispositivo,
  transicoesDosAtos,
  trechoDoDispositivo,
} from "./consultas-normas.ts";
import * as PpcAvulsoDb from "./ppc-avulso.ts";
import * as Sql from "./sql.ts";

/* ------------------------------------------------------------ fichas */

/** Ficha como entra no pacote: o JSON da ficha (`id`, tópicos, consultas, referências). */
export type FichaPacote = { id: string } & Record<string, unknown>;

function textos(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === "string") : [];
}

/* ------------------------------------------------------------ linhas do banco */

const TextoNulo = Schema.NullOr(Schema.String);

// o JSON da ficha entra no pacote como está (chaves e ordem do arquivo)
const linhasFichas = Sql.todas(
  Schema.Struct({ id: Schema.String, path: Schema.String, dados_json: Schema.fromJsonString(Schema.Unknown) }),
);
const linhasIdsFichas = Sql.todas(Schema.Struct({ id: Schema.String }));
const linhasFichasTopico = Sql.todas(Schema.Struct({ ficha_id: Schema.String }));

const LinhaPpc = Schema.Struct({
  id: Schema.String,
  curso_nome: Schema.String,
  campus_nome: Schema.String,
  nivel: Schema.String,
  tipo_oferta: Schema.String,
  path: Schema.String,
  curso_id: TextoNulo,
  ano_documento: Schema.NullOr(Schema.Int),
  cnct_id: TextoNulo,
});
const primeiroPpc = Sql.primeira(LinhaPpc);
const primeirosCaracteres = Sql.primeira(Schema.Struct({ caracteres: Schema.Int }));

// `normas_json` entra no pacote como está (as chaves do arquivo de marcos)
const linhasMarcos = Sql.todas(
  Schema.Struct({
    id: Schema.String,
    tema: Schema.String,
    vigente: Schema.String,
    aplica_a: TextoNulo,
    transicao: TextoNulo,
    orientacao_analise: TextoNulo,
    normas_json: Schema.fromJsonString(Schema.Unknown),
    path: Schema.String,
  }),
);

/** As normas de um marco, como `marcos-normativos.json` as grava. */
interface NormasDoMarco {
  linha: string[];
  vigente: string;
  substitui: string[];
  antecessoras_historicas: string[];
  dispositivos_revogados: string[];
}

const LinhaCitacao = Schema.Struct({
  ato_id: Schema.String,
  linha: Schema.Int,
  trecho: Schema.String,
  papel: Schema.String,
  secao_tipo: TextoNulo,
  regra: Schema.String,
});
type CitacaoPpc = typeof LinhaCitacao.Type;
const linhasCitacoes = Sql.todas(LinhaCitacao);

// o JSON do curso do CNCT entra no pacote como está
const primeiroCnct = Sql.primeira(
  Schema.Struct({ dados_json: Schema.fromJsonString(Schema.Unknown), path: TextoNulo }),
);

const linhasCampi = Sql.todas(Schema.Struct({ campus_nome: Schema.String }));

/** Tamanho do pacote em JSON indentado, como a CLI o imprime. */
function caracteresDoJson(valor: unknown): number {
  return JSON.stringify(valor, null, 2).length;
}

/* ------------------------------------------------------------ fichas da tarefa */

/** Fichas do banco (JSON da ficha), em ordem de ID. */
export const fichasDoBanco = Effect.fn("pacoteContexto.fichasDoBanco")(function* (ids?: readonly string[]) {
  const filtro = ids ? ` WHERE id IN (${ids.map(() => "?").join(", ")})` : "";
  const linhas = yield* linhasFichas(`SELECT id, path, dados_json FROM fichas${filtro} ORDER BY id`, ids ?? []);
  return linhas.map((f) => f.dados_json as FichaPacote);
});

const LinhaFichaResumida = Schema.Struct({
  id: Schema.String,
  titulo: Schema.String,
  dominio: TextoNulo,
  criticidade: TextoNulo,
  path: Schema.String,
});
const linhasFichasResumidas = Sql.todas(LinhaFichaResumida);

/** Uma ficha pelas colunas da tabela `fichas`, sem o JSON: título, domínio, criticidade e arquivo. */
export type FichaResumida = typeof LinhaFichaResumida.Type;

/** Todas as fichas, resumidas, em ordem de ID. */
export const fichasResumidas = Effect.fn("pacoteContexto.fichasResumidas")(function* () {
  const fichas: ReadonlyArray<FichaResumida> = yield* linhasFichasResumidas(
    "SELECT id, titulo, dominio, criticidade, path FROM fichas ORDER BY id",
  );
  return fichas;
});

/** IDs das fichas de uma tarefa: `todas`, um tópico ou fichas separadas por vírgula. */
export const fichasDaTarefa = Effect.fn("pacoteContexto.fichasDaTarefa")(function* (tarefa: string) {
  const todas = (yield* linhasIdsFichas("SELECT id FROM fichas")).map((f) => f.id).sort(compararTexto);
  if (tarefa === "todas") return todas;
  const topico = yield* linhasFichasTopico(
    "SELECT ficha_id FROM fichas_topicos WHERE topico_id = ? ORDER BY ficha_id",
    [tarefa],
  );
  if (topico.length) return topico.map((t) => t.ficha_id).filter((id) => todas.includes(id));
  const pedidas = tarefa.split(",").map((t) => t.trim().toUpperCase());
  const faltando = pedidas.filter((id) => !todas.includes(id));
  if (faltando.length) return yield* new TarefaNaoReconhecida({ fichas: faltando });
  return pedidas;
});

/* ------------------------------------------------------------ tipos do pacote */

/**
 * Dispositivo citado no pacote: o essencial de `TrechoDispositivo`, sem os campos vazios (caput,
 * subordinados e notas só quando existem; `citados` só quando o trecho cobre outros IDs pedidos).
 */
export interface DispositivoDoPacote {
  id: string;
  /** Todos os IDs pedidos pelas fichas que este trecho cobre (o próprio e subordinados). */
  citados?: string[];
  fichas: string[];
  caput?: TrechoDispositivo["caput"];
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
  caput?: TrechoDispositivo["caput"];
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
  ppc: typeof LinhaPpc.Type & { path: string };
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
export const normasDoPacote = Effect.fn("pacoteContexto.normasDoPacote")(function* (refs: readonly RefFicha[]) {
  const porRef = new Map<string, RefFicha[]>();
  for (const r of refs) if (!r.ref.startsWith("cnct:")) porRef.set(r.ref, [...(porRef.get(r.ref) ?? []), r]);
  const normas: NormaDoPacote[] = [];
  for (const [ref, lista] of porRef) {
    const norma = yield* obterNorma(ref);
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
      const trecho = norma?.path ? yield* trechoDoDispositivo(id, { subordinados: true }) : null;
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
});

/** Citações normativas resolvidas de um PPC (`citacoes`), na ordem do texto. */
export const citacoesDoPpc = Effect.fn("pacoteContexto.citacoesDoPpc")(function* (ppcId: string) {
  return yield* linhasCitacoes(
    "SELECT ato_id, linha, trecho, papel, secao_tipo, regra FROM citacoes WHERE ppc_id = ? AND ato_id IS NOT NULL ORDER BY ordem",
    [ppcId],
  );
});

/** Marcos ligados às normas das fichas ou às citadas pelo PPC, com as citações do PPC (fundamento) a elas. */
export const marcosDoPacote = Effect.fn("pacoteContexto.marcosDoPacote")(function* (
  refs: readonly RefFicha[],
  citacoesPpc: readonly CitacaoPpc[],
) {
  const atosCitadosPpc = new Set(citacoesPpc.map((c) => c.ato_id));
  const atosFichas = new Set(refs.map((r) => idDoAto(r.ref)));
  const marcos: MarcoDoPacote[] = [];
  for (const m of yield* linhasMarcos(
    "SELECT id, tema, vigente, aplica_a, transicao, orientacao_analise, normas_json, path FROM marcos ORDER BY id",
  )) {
    const normasMarco = m.normas_json as NormasDoMarco;
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
});

/**
 * Regras de transição (tabela `transicoes`) das normas das fichas e das que o PPC cita como
 * fundamento, com a situação na `data_referencia` (de `FontesNormativas`) e o texto do dispositivo
 * que as estabelece.
 */
export const transicoesDoPacote = Effect.fn("pacoteContexto.transicoesDoPacote")(function* (
  refs: readonly RefFicha[],
  citacoesPpc: readonly CitacaoPpc[],
) {
  const { dataReferencia: data } = yield* FontesNormativas.FontesNormativas;
  const atosFichas = new Set(refs.map((r) => idDoAto(r.ref)));
  const atosTransicao = [
    ...new Set([...atosFichas, ...citacoesPpc.filter((c) => c.papel === "fundamento").map((c) => c.ato_id)]),
  ].sort(compararTexto);
  const transicoes: TransicaoDoPacote[] = [];
  for (const t of yield* transicoesDosAtos(atosTransicao, data)) {
    const d = yield* trechoDoDispositivo(`${t.norma_id}${t.dispositivo}`);
    transicoes.push({
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
    });
  }
  return { data_referencia: data, transicoes };
});

/** Consultas da ficha que são texto do PPC (as que são nomes de campo, como `cnct_contexto.x`, ficam fora). */
export function consultasDeTexto(ficha: FichaPacote): string[] {
  return textos(ficha.consultas).filter((c) => !/^[\w.]+$/.test(c) || !/[._]/.test(c));
}

/** Opções da seleção de seções do PPC. */
interface OpcoesSecoes {
  /** Léxico da busca (padrão: o de `FontesNormativas`, que `buscarSecoes` lê). */
  lexico?: Sinonimos;
  /** Mapa tópico → tipos de seção (padrão: o de `FontesNormativas`). */
  topicosSecoes?: TopicosSecoes;
  /** Seções por consulta de ficha (padrão 1: a melhor com todos os termos). */
  buscasPorFicha?: number;
}

/**
 * Seções do PPC para as fichas: as dos tipos mapeados para os tópicos das fichas
 * (`dados/topicos-secoes.yaml`), mais, por consulta de cada ficha, a melhor seção com todos os
 * termos (AND); em ordem do documento. O `SqlClient` do ambiente é o `kb.sqlite` (PPC da base) ou
 * o banco em memória de `abrirPpcAvulso` (PPC fora da base): as consultas são as mesmas.
 */
export const secoesDoPacote = Effect.fn("pacoteContexto.secoesDoPacote")(function* (
  ppcId: string,
  fichas: readonly FichaPacote[],
  opcoes: OpcoesSecoes = {},
) {
  const mapa = opcoes.topicosSecoes ?? (yield* FontesNormativas.FontesNormativas).topicosSecoes;
  const secoes = new Map<string, SecaoDoPacote>();
  const topicos = [...new Set(fichas.flatMap((f) => textos(f.topicos_tematicos)))].sort(compararTexto);
  for (const topico of topicos) {
    for (const s of yield* secoesDoPpc(ppcId, mapa[topico] ?? [])) {
      const atual = secoes.get(s.id) ?? { ...s, motivo: [] };
      atual.motivo.push(`topico:${topico}`);
      secoes.set(s.id, atual);
    }
  }
  const buscas = opcoes.buscasPorFicha ?? 1;
  for (const ficha of [...fichas].sort((a, b) => compararTexto(a.id, b.id))) {
    for (const consulta of consultasDeTexto(ficha)) {
      const achados = yield* buscarSecoes(
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
});

/** O curso do CNCT (`cnct`) com ID e arquivo, ou `null`. */
const cnctDoBanco = Effect.fn("pacoteContexto.cnctDoBanco")(function* (cnctId: string | null) {
  if (!cnctId) return null;
  const id = idCnct(cnctId);
  const linha = yield* primeiroCnct("SELECT dados_json, path FROM cnct WHERE id = ?", [id]);
  return linha ? { id, path: linha.path, ...(linha.dados_json as Record<string, unknown>) } : null;
});

/* ------------------------------------------------------------ pacotes */

/** Opções do pacote. `lexico` e `topicosSecoes` informados prevalecem sobre os de `FontesNormativas`. */
export type OpcoesPacote = OpcoesSecoes;

/** `lexico` e `topicosSecoes` das opções ou, onde faltam, os de `FontesNormativas`. */
function opcoesComFontes(
  opcoes: OpcoesSecoes,
  fontes: { readonly sinonimos: Sinonimos; readonly topicosSecoes: TopicosSecoes },
): OpcoesSecoes & { lexico: Sinonimos; topicosSecoes: TopicosSecoes } {
  return {
    ...opcoes,
    lexico: opcoes.lexico ?? fontes.sinonimos,
    topicosSecoes: opcoes.topicosSecoes ?? fontes.topicosSecoes,
  };
}

/** Pacote de contexto de uma tarefa para um PPC da base (`campus/curso` ou `ppc:campus/curso`). */
export const pacoteContexto = Effect.fn("pacoteContexto.pacoteContexto")(function* (
  tarefa: string,
  ppcArg: string,
  opcoes: OpcoesPacote = {},
) {
  const ppcId = idPpc(ppcArg);
  const ppc = yield* primeiroPpc(
    `SELECT p.id, p.curso_nome, p.campus_nome, p.nivel, p.tipo_oferta, p.path, p.curso_id, p.ano_documento, c.cnct_id
       FROM ppcs p LEFT JOIN cursos c ON c.id = p.curso_id WHERE p.id = ?`,
    [ppcId],
  );
  if (!ppc) return yield* new PpcNaoEncontrado({ ppc: ppcId });
  const secoesOpcoes = opcoesComFontes(opcoes, yield* FontesNormativas.FontesNormativas);
  const fichasIds = yield* fichasDaTarefa(tarefa);
  const fichas = yield* fichasDoBanco(fichasIds);
  const refs = referenciasDasFichas(fichas);
  const citacoesPpc = yield* citacoesDoPpc(ppc.id);
  const listaSecoes = yield* secoesDoPacote(ppc.id, fichas, secoesOpcoes);
  const fatos = (yield* fatosDosPpcs({ ppc: ppc.id }))[0] ?? null;
  const caracteresSecoes = listaSecoes.reduce((t, s) => t + s.texto.length, 0);
  const ppcInteiro = yield* primeirosCaracteres("SELECT caracteres FROM ppcs WHERE id = ?", [ppc.id]);
  if (!ppcInteiro) return yield* new Sql.FalhaNaConsulta({ consulta: "ppcs.caracteres", cause: "ausente" });
  const pacote: PacoteContexto = {
    tarefa,
    fichas_ids: fichasIds,
    ppc,
    cnct: yield* cnctDoBanco(ppc.cnct_id),
    fichas,
    normas: yield* normasDoPacote(refs),
    marcos: yield* marcosDoPacote(refs, citacoesPpc),
    ...(yield* transicoesDoPacote(refs, citacoesPpc)),
    secoes: listaSecoes,
    fatos: fatos ? { fatos: fatos.fatos, suap: fatos.suap, cruzamento: fatos.cruzamento } : null,
    tamanho: {
      caracteres: 0,
      secoes: listaSecoes.length,
      caracteres_secoes: caracteresSecoes,
      caracteres_ppc_inteiro: ppcInteiro.caracteres,
    },
  };
  pacote.tamanho.caracteres = caracteresDoJson(pacote);
  return pacote;
});

/** Pacote de fichas para um PPC fora da base (o `PPC.md` de uma rodada), sem o PPC e sem as fichas. */
export interface PacoteAvulso {
  fichas_ids: string[];
  /** Curso do CNCT (`cnct`), quando o chamador identificou o `cnct_id`. */
  cnct: unknown;
  normas: NormaDoPacote[];
  marcos: MarcoDoPacote[];
  data_referencia: string;
  transicoes: TransicaoDoPacote[];
  /** Seções do PPC dos tópicos das fichas, mais as achadas pelas `consultas`. */
  secoes: SecaoDoPacote[];
  /** Todas as citações normativas resolvidas do PPC, com linha, seção e papel (só com `citacoesPpc`). */
  citacoes_ppc?: CitacaoPpc[];
}

/** Opções do pacote de um PPC fora da base (`PpcAvulso.pacote`). */
export type OpcoesPacoteAvulso = {
  cnctId?: string | null;
  /** Inclui `citacoes_ppc`: as fichas que conferem a base normativa citada no PPC inteiro. */
  citacoesPpc?: boolean;
} & OpcoesSecoes;

/**
 * Pacote de contexto de um conjunto de fichas para um PPC que pode não estar na base: as normas,
 * os marcos, as transições e o CNCT vêm do `SqlClient` do ambiente (o `kb.sqlite`); as seções e as
 * citações do PPC, do banco em memória (`doPpc`), com as mesmas consultas do pacote de um PPC da base.
 */
const pacoteContextoAvulso = Effect.fn("pacoteContexto.pacoteContextoAvulso")(function* (
  doPpc: Context.Context<SqlClient.SqlClient>,
  ppcId: string,
  fichas: readonly FichaPacote[],
  opcoes: OpcoesPacoteAvulso,
) {
  const noPpc = Effect.provide(doPpc);
  const refs = referenciasDasFichas(fichas);
  const citacoesPpc = yield* citacoesDoPpc(ppcId).pipe(noPpc);
  const pacote: PacoteAvulso = {
    fichas_ids: [...fichas].map((f) => f.id).sort(compararTexto),
    cnct: yield* cnctDoBanco(opcoes.cnctId ?? null),
    normas: yield* normasDoPacote(refs),
    marcos: yield* marcosDoPacote(refs, citacoesPpc),
    ...(yield* transicoesDoPacote(refs, citacoesPpc)),
    secoes: yield* secoesDoPacote(ppcId, fichas, opcoes).pipe(noPpc),
    ...(opcoes.citacoesPpc ? { citacoes_ppc: [...citacoesPpc] } : {}),
  };
  return pacote;
});

/**
 * Opções de `abrirPpcAvulso`. O registro de normas, os nomes dos campi e, sem `lexico`, o léxico vêm
 * da base.
 */
export type OpcoesAbrirAvulso = Pick<
  PpcAvulsoDb.OpcoesPpcAvulso,
  "ppcId" | "path" | "taxonomia" | "todasAsSecoes" | "titulosNivel1"
> & {
  /** Léxico da busca nas seções (padrão: o de `FontesNormativas`). */
  lexico?: Sinonimos;
};

/** A estrutura de um PPC fora da base: todas as seções (`segmentarPpc`) e os fatos sobre elas. */
export interface EstruturaAvulsa {
  secoes: SecaoPpc[];
  fatos: FatoPpc[];
}

/** Um PPC fora da base, segmentado num banco em memória que vive até o fim do escopo de quem o abriu. */
export interface PpcAvulso {
  /** Pacote de um conjunto de fichas sobre este PPC; o CNCT, as normas e os marcos vêm da base. */
  readonly pacote: (
    fichas: readonly FichaPacote[],
    opcoes?: OpcoesPacoteAvulso,
  ) => Effect.Effect<PacoteAvulso, Sql.FalhaNaConsulta>;
  /**
   * As seções do Markdown sem o recorte do índice (todas, como com `todasAsSecoes`), segmentado
   * como o banco o segmentou (quebras de linha, `titulosNivel1`), na taxonomia do banco e com os
   * cabeçalhos de página dos campi, e os fatos do PPC (carga horária, estágio) sobre elas.
   */
  readonly estrutura: () => EstruturaAvulsa;
}

/**
 * Abre um PPC fora da base (o `PPC.md` de uma rodada, o PPC que a pessoa revisa no app): o banco em
 * memória com as seções e as citações, gravado pelo mesmo código da compilação e fechado no fim do
 * escopo. O pacote de cada conjunto de fichas sai do handle, sobre o mesmo banco.
 */
export const abrirPpcAvulso = Effect.fn("pacoteContexto.abrirPpcAvulso")(function* (
  markdown: string,
  opcoes: OpcoesAbrirAvulso = {},
) {
  // só o banco e as fontes: o escopo e o span de quem abriu não passam por cima dos de quem pede o pacote
  const ambiente = Context.pick(
    SqlClient.SqlClient,
    FontesNormativas.FontesNormativas,
  )(yield* Effect.context<SqlClient.SqlClient | FontesNormativas.FontesNormativas>());
  const fontes = yield* FontesNormativas.FontesNormativas;
  const { lexico, ...doBanco } = opcoes;
  const ppcId = doBanco.ppcId ?? "ppc:avulso";
  const taxonomia = doBanco.taxonomia ?? "tecnico";
  const palavrasCampi = palavrasDeCampi(yield* nomesDeCampiDoBanco());
  const doPpc = yield* PpcAvulsoDb.abrirPpcAvulso(markdown, {
    ...doBanco,
    palavrasCampi,
    registro: fontes.registro,
    sinonimos: lexico ?? fontes.sinonimos,
  });
  const avulso: PpcAvulso = {
    pacote: (fichas, opcoesPacote = {}) =>
      pacoteContextoAvulso(doPpc, ppcId, fichas, opcoesPacote).pipe(Effect.provide(ambiente)),
    estrutura: () => {
      // o texto que o banco recebeu (quebras de linha, `titulosNivel1`); todas as seções, com ou sem `todasAsSecoes`
      const texto = PpcAvulsoDb.textoDoPpcAvulso(markdown, doBanco);
      const secoes = segmentarPpc(texto.paraSegmentar, taxonomia, palavrasCampi);
      const fatos = extrairFatosPpc(
        texto.markdown,
        secoes.map((x) => ({ tipo: x.tipo, linha_inicio: x.linhaInicio, linha_fim: x.linhaFim })),
      );
      return { secoes, fatos };
    },
  };
  return avulso;
});

/** Nomes dos campi dos PPCs do banco, para reconhecer cabeçalhos de página (`palavrasDeCampi`). */
export const nomesDeCampiDoBanco = Effect.fn("pacoteContexto.nomesDeCampiDoBanco")(function* () {
  const linhas = yield* linhasCampi("SELECT DISTINCT campus_nome FROM ppcs ORDER BY campus_nome");
  return linhas.map((l) => l.campus_nome);
});

/** Pacote de `pacoteDoMarkdown`: o avulso, mais o arquivo, as fichas e os tamanhos. */
export type PacoteDoMarkdown = PacoteAvulso & {
  path: string;
  fichas: FichaPacote[];
  tamanho: { caracteres: number; caracteres_ppc_inteiro: number };
};

/**
 * `kb pacote-contexto <tarefa> <arquivo.md>`: o pacote de uma tarefa para um PPC fora da base. As
 * fichas vêm do banco; o PPC (`markdown`, o
 * texto já lido de `arquivo`, que fica só como `path`) é segmentado e indexado num banco em memória
 * (`abrirPpcAvulso`), fechado no fim.
 */
export const pacoteDoMarkdown = Effect.fn("pacoteContexto.pacoteDoMarkdown")(function* (
  tarefa: string,
  arquivo: string,
  opcoes: OpcoesPacote & { markdown: string },
) {
  const fontes = yield* FontesNormativas.FontesNormativas;
  const secoes = opcoesComFontes(opcoes, fontes);
  const ids = yield* fichasDaTarefa(tarefa);
  const fichas = yield* fichasDoBanco(ids);
  const markdown = opcoes.markdown;
  const avulso = yield* abrirPpcAvulso(markdown, { path: arquivo, lexico: secoes.lexico });
  const pacote = yield* avulso.pacote(fichas, {
    lexico: secoes.lexico,
    topicosSecoes: secoes.topicosSecoes,
  });
  const saida: PacoteDoMarkdown = {
    path: arquivo,
    ...pacote,
    fichas,
    tamanho: { caracteres: 0, caracteres_ppc_inteiro: markdown.length },
  };
  saida.tamanho.caracteres = caracteresDoJson(saida);
  return saida;
}, Effect.scoped);
