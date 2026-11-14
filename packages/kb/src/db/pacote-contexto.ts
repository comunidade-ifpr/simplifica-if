/**
 * `kb pacote-contexto <tarefa> <ppc>`: o contexto de uma tarefa da `analise-ppc` montado pelo banco,
 * em vez do PPC inteiro mais os manifestos.
 *
 * Tarefa: uma ficha (`CT-CURR-12`), várias separadas por vírgula, um tópico de
 * `topicos-fichas.json` (`estagio`), um grupo da rodada (`grupo-001`: as fichas em ordem de ID,
 * de 20 em 20, como `agruparFichas` da skill) ou `todas`.
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
 */
import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import type { Sinonimos } from "../busca/sinonimos.ts";
import { idDoAto } from "../normas/ids.ts";
import { compararTexto } from "../texto.ts";
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
  caminho: string = path.resolve(import.meta.dir, "..", "..", "dados", "topicos-secoes.yaml"),
): TopicosSecoes {
  return esquemaTopicosSecoes.parse(parse(readFileSync(caminho, "utf-8"), { schema: "failsafe" }) ?? {});
}

const TAMANHO_GRUPO = 20;

const esquemaFicha = z.strictObject({ id: z.string(), path: z.string(), dados_json: z.string() });
const esquemaRef = z.strictObject({
  ficha_id: z.string(),
  ref: z.string(),
  dispositivo: z.string().nullable(),
  papel: z.string(),
  nota: z.string().nullable(),
});
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

/** IDs das fichas de uma tarefa. */
export function fichasDaTarefa(db: Database, tarefa: string): string[] {
  const todas = z
    .array(z.strictObject({ id: z.string() }))
    .parse(db.query("SELECT id FROM fichas").all())
    .map((f) => f.id)
    .sort(compararTexto);
  if (tarefa === "todas") return todas;
  const grupo = /^grupo-(\d{3})$/.exec(tarefa);
  if (grupo) {
    const indice = Number(grupo[1]) - 1;
    const fichas = todas.slice(indice * TAMANHO_GRUPO, (indice + 1) * TAMANHO_GRUPO);
    if (!fichas.length) throw new Error(`grupo inexistente: ${tarefa} (há ${Math.ceil(todas.length / TAMANHO_GRUPO)})`);
    return fichas;
  }
  const topico = z
    .array(z.strictObject({ ficha_id: z.string() }))
    .parse(db.query("SELECT ficha_id FROM fichas_topicos WHERE topico_id = ? ORDER BY ficha_id").all(tarefa));
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

export interface PacoteContexto {
  tarefa: string;
  fichas_ids: string[];
  ppc: z.output<typeof esquemaPpc> & { path: string };
  cnct: unknown;
  fichas: unknown[];
  normas: {
    ref: string;
    titulo: string | null;
    status_vigencia: string | null;
    path: string | null;
    fichas: string[];
    /** Dispositivos citados, com o texto, na ordem do arquivo. */
    dispositivos: DispositivoDoPacote[];
    /** Dispositivos citados que não estão no texto da base (stub, por exemplo). */
    sem_texto: string[];
  }[];
  marcos: {
    marco: string;
    tema: string;
    vigente: string;
    normas: unknown;
    transicao: string | null;
    orientacao_analise: string | null;
    path: string;
    citacoes_no_ppc: z.output<typeof esquemaCitacao>[];
  }[];
  /** Data da situação das regras de transição (`data_referencia` de `config/vigencia.yaml`). */
  data_referencia: string;
  /** Regras de transição, com a situação em `data_referencia` e o texto do dispositivo que as estabelece. */
  transicoes: TransicaoDoPacote[];
  secoes: {
    id: string;
    tipo: string;
    titulo: string;
    path: string;
    linha_inicio: number;
    linha_fim: number;
    motivo: string[];
    texto: string;
  }[];
  fatos: unknown;
  tamanho: { caracteres: number; secoes: number; caracteres_secoes: number; caracteres_ppc_inteiro: number };
}

export function pacoteContexto(
  db: Database,
  tarefa: string,
  ppcArg: string,
  opcoes: { lexico?: Sinonimos; topicosSecoes?: TopicosSecoes; buscasPorFicha?: number; raiz: string },
): PacoteContexto {
  const ppcId = ppcArg.startsWith("ppc:") ? ppcArg : `ppc:${ppcArg}`;
  const ppcLinha = db
    .query(
      `SELECT p.id, p.curso_nome, p.campus_nome, p.nivel, p.tipo_oferta, p.path, p.curso_id, p.ano_documento, c.cnct_id
       FROM ppcs p LEFT JOIN cursos c ON c.id = p.curso_id WHERE p.id = ?`,
    )
    .get(ppcId);
  if (!ppcLinha) throw new Error(`PPC não encontrado: ${ppcId}`);
  const ppc = esquemaPpc.parse(ppcLinha);
  const fichasIds = fichasDaTarefa(db, tarefa);
  const marcadores = fichasIds.map(() => "?").join(", ");

  const fichas = z
    .array(esquemaFicha)
    .parse(
      db.query(`SELECT id, path, dados_json FROM fichas WHERE id IN (${marcadores}) ORDER BY id`).all(...fichasIds),
    )
    .map((f) => JSON.parse(f.dados_json) as Record<string, unknown>);

  // CNCT do curso
  const cnct = ppc.cnct_id
    ? (() => {
        const linha = z
          .strictObject({ dados_json: z.string(), path: z.string().nullable() })
          .nullable()
          .parse(db.query("SELECT dados_json, path FROM cnct WHERE id = ?").get(ppc.cnct_id) ?? null);
        return linha ? { id: ppc.cnct_id, path: linha.path, ...JSON.parse(linha.dados_json) } : null;
      })()
    : null;

  // normas citadas pelas fichas, com o texto dos artigos
  const refs = z
    .array(esquemaRef)
    .parse(
      db
        .query(
          `SELECT ficha_id, ref, dispositivo, papel, nota FROM fichas_referencias WHERE ficha_id IN (${marcadores}) ORDER BY ref, dispositivo, ficha_id`,
        )
        .all(...fichasIds),
    );
  const porRef = new Map<string, z.output<typeof esquemaRef>[]>();
  for (const r of refs) if (!r.ref.startsWith("cnct:")) porRef.set(r.ref, [...(porRef.get(r.ref) ?? []), r]);
  const normas: PacoteContexto["normas"] = [];
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

  // transições: marcos ligados às normas das fichas ou às citadas pelo PPC
  const citacoesPpc = z
    .array(esquemaCitacao)
    .parse(
      db
        .query(
          "SELECT ato_id, linha, trecho, papel, secao_tipo, regra FROM citacoes WHERE ppc_id = ? AND ato_id IS NOT NULL ORDER BY ordem",
        )
        .all(ppc.id),
    );
  const atosCitadosPpc = new Set(citacoesPpc.map((c) => c.ato_id));
  const atosFichas = new Set(refs.map((r) => idDoAto(r.ref)));
  const marcos: PacoteContexto["marcos"] = [];
  for (const m of z
    .array(esquemaMarco)
    .parse(
      db
        .query(
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

  // regras de transição das normas das fichas e das que o PPC cita como fundamento
  const data = dataReferenciaBanco(db);
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

  // seções do PPC: pelos tipos dos tópicos e pela busca das consultas das fichas
  const mapa = opcoes.topicosSecoes ?? lerTopicosSecoes();
  const secoes = new Map<string, PacoteContexto["secoes"][number]>();
  const topicos = z
    .array(z.strictObject({ ficha_id: z.string(), topico_id: z.string() }))
    .parse(
      db
        .query(
          `SELECT ficha_id, topico_id FROM fichas_topicos WHERE ficha_id IN (${marcadores}) ORDER BY topico_id, ficha_id`,
        )
        .all(...fichasIds),
    );
  const tiposPorTopico = new Map<string, string[]>();
  for (const t of topicos) tiposPorTopico.set(t.topico_id, mapa[t.topico_id] ?? []);
  for (const [topico, tipos] of tiposPorTopico) {
    for (const s of secoesDoPpc(db, ppc.id, tipos)) {
      const atual = secoes.get(s.id) ?? { ...s, motivo: [] };
      atual.motivo.push(`topico:${topico}`);
      secoes.set(s.id, atual);
    }
  }
  // busca: só seções com todos os termos da consulta (AND), a melhor por consulta; consultas que
  // são nomes de campo ("cnct_contexto.comparacoes.estagio_cnct") não são texto do PPC
  const buscas = opcoes.buscasPorFicha ?? 1;
  for (const ficha of fichas) {
    const consultas = (Array.isArray(ficha.consultas) ? (ficha.consultas as string[]) : []).filter(
      (c) => !/^[\w.]+$/.test(c) || !/[._]/.test(c),
    );
    for (const consulta of consultas) {
      const achados = buscarSecoes(
        db,
        consulta,
        { ppc: ppc.id },
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
        const motivo = `busca:${String(ficha.id)}:${consulta}`;
        if (!atual.motivo.includes(motivo)) atual.motivo.push(motivo);
        secoes.set(a.id, atual);
      }
    }
  }
  const listaSecoes = [...secoes.values()].sort((a, b) => a.linha_inicio - b.linha_inicio);

  const fatos = fatosDosPpcs(db, { ppc: ppc.id })[0] ?? null;
  const caracteresSecoes = listaSecoes.reduce((t, s) => t + s.texto.length, 0);
  const ppcInteiro = readFileSync(path.join(opcoes.raiz, ppc.path), "utf-8").length;
  const pacote: PacoteContexto = {
    tarefa,
    fichas_ids: fichasIds,
    ppc,
    cnct,
    fichas,
    normas,
    marcos,
    data_referencia: data,
    transicoes,
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
