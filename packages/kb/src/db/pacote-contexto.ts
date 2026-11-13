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
 * - as normas citadas pelas fichas, com o texto do artigo citado (bloco do Markdown hoje; depois
 *   da fase 5, o dispositivo com o caput herdado), arquivo e linhas;
 * - as transições aplicáveis (`marcos-normativos.json`) e as citações do PPC às normas desses marcos;
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
import { blocoDoArtigo, buscarSecoes, fatosDosPpcs, obterNorma, secoesDoPpc } from "./consultas.ts";

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
    artigos: {
      dispositivos: string[];
      artigo: string;
      path: string;
      linha_inicio: number;
      linha_fim: number;
      texto: string;
      origem: string;
    }[];
  }[];
  transicoes: {
    marco: string;
    tema: string;
    vigente: string;
    normas: unknown;
    transicao: string | null;
    orientacao_analise: string | null;
    path: string;
    citacoes_no_ppc: z.output<typeof esquemaCitacao>[];
  }[];
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
    const artigos = new Map<string, string[]>();
    for (const r of lista) {
      const m = r.dispositivo ? /^#art(\d+)([A-Z])?/.exec(r.dispositivo) : null;
      if (!m) continue;
      const artigo = m[2] ? `${m[1]}-${m[2]}` : m[1]!;
      artigos.set(artigo, [...new Set([...(artigos.get(artigo) ?? []), r.dispositivo!])]);
    }
    normas.push({
      ref,
      titulo: norma?.titulo ?? null,
      status_vigencia: norma?.status_vigencia ?? null,
      path: norma?.path ?? null,
      fichas: [...new Set(lista.map((r) => r.ficha_id))],
      artigos: [...artigos.entries()]
        .sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10) || compararTexto(a, b))
        .flatMap(([artigo, dispositivos]) => {
          const bloco = norma?.path ? blocoDoArtigo(db, norma.id, artigo) : null;
          if (!bloco) return [];
          const { norma_id: _norma, ...resto } = bloco;
          return [{ dispositivos: dispositivos.sort(compararTexto), ...resto }];
        }),
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
  const transicoes: PacoteContexto["transicoes"] = [];
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
      vigente: string;
      substitui: string[];
      antecessoras_historicas: string[];
      dispositivos_revogados: string[];
    };
    const envolvidas = new Set([
      normasMarco.vigente,
      ...normasMarco.substitui,
      ...normasMarco.antecessoras_historicas,
      ...normasMarco.dispositivos_revogados.map(idDoAto),
    ]);
    const ligado = [...envolvidas].some((id) => atosFichas.has(id) || atosCitadosPpc.has(id));
    if (!ligado) continue;
    transicoes.push({
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
