/**
 * Recall@10 da busca de seções (`kb buscar-secoes`) no conjunto rotulado de
 * `avaliacao/busca-secoes/consultas.yaml`, nos três modos: sem stemmer nem sinônimos (`simples`),
 * só radicais (`radicais`) e radicais com o léxico de sinônimos (`completo`, o padrão da CLI).
 * Meta do plano (fase 6): recall@10 ≥ 0,8.
 */
import type { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import type { Sinonimos } from "../busca/sinonimos.ts";
import { semDiacriticos } from "../busca/tokens.ts";
import { buscarSecoes, type FiltrosSecoes, type ModoBusca } from "../db/consultas.ts";
import { raizRepositorio } from "../normas/registro.ts";

const esquemaConsultas = z.strictObject({
  consultas: z.array(
    z.strictObject({
      id: z.string(),
      consulta: z.string().min(1),
      filtros: z
        .strictObject({
          ppc: z.string().optional(),
          cnct: z.string().optional(),
          campus: z.string().optional(),
          nivel: z.string().optional(),
          forma: z.string().optional(),
          tipo: z.string().optional(),
        })
        .default({}),
      esperadas: z.array(z.strictObject({ ppc: z.string(), titulo: z.string().min(1) })).min(1),
    }),
  ),
});
export type ConsultasRotuladas = z.output<typeof esquemaConsultas>;

export function caminhoConsultas(raiz: string = raizRepositorio()): string {
  return path.join(raiz, "avaliacao", "busca-secoes", "consultas.yaml");
}

export function lerConsultas(caminho: string = caminhoConsultas()): ConsultasRotuladas {
  return esquemaConsultas.parse(parse(readFileSync(caminho, "utf-8"), { schema: "failsafe" }));
}

const normalizar = (t: string) => semDiacriticos(t).toLowerCase().replace(/\s+/g, " ").trim();

export const MODOS: readonly ModoBusca[] = ["simples", "radicais", "completo"];

export interface ResultadoAvaliacaoBusca {
  k: number;
  consultas: number;
  recall: Record<ModoBusca, number>;
  meta: number;
  detalhes: {
    id: string;
    consulta: string;
    esperadas: number;
    recall: Record<ModoBusca, number>;
    faltando: Record<ModoBusca, string[]>;
  }[];
}

export function avaliarBusca(
  db: DatabaseSync,
  opcoes: { lexico: Sinonimos; k?: number; conjunto?: ConsultasRotuladas },
): ResultadoAvaliacaoBusca {
  const k = opcoes.k ?? 10;
  const conjunto = opcoes.conjunto ?? lerConsultas();
  const somas: Record<ModoBusca, number> = { simples: 0, radicais: 0, completo: 0 };
  const detalhes: ResultadoAvaliacaoBusca["detalhes"] = [];
  for (const c of conjunto.consultas) {
    const filtros: FiltrosSecoes = {
      ppc: c.filtros.ppc,
      cnct: c.filtros.cnct,
      campus: c.filtros.campus,
      nivel: c.filtros.nivel,
      forma: c.filtros.forma,
      tipo: c.filtros.tipo ? [c.filtros.tipo] : undefined,
    };
    const recall = {} as Record<ModoBusca, number>;
    const faltando = {} as Record<ModoBusca, string[]>;
    for (const modo of MODOS) {
      const achados = buscarSecoes(db, c.consulta, filtros, { limite: k, modo, lexico: opcoes.lexico });
      const perdidas = c.esperadas.filter(
        (e) => !achados.some((a) => a.ppc === `ppc:${e.ppc}` && normalizar(a.titulo).includes(normalizar(e.titulo))),
      );
      const valor = (c.esperadas.length - perdidas.length) / Math.min(c.esperadas.length, k);
      recall[modo] = Math.round(valor * 1000) / 1000;
      faltando[modo] = perdidas.map((p) => `${p.ppc} :: ${p.titulo}`);
      somas[modo] += valor;
    }
    detalhes.push({ id: c.id, consulta: c.consulta, esperadas: c.esperadas.length, recall, faltando });
  }
  const n = conjunto.consultas.length;
  const media = (modo: ModoBusca) => Math.round((somas[modo] / n) * 1000) / 1000;
  return {
    k,
    consultas: n,
    recall: { simples: media("simples"), radicais: media("radicais"), completo: media("completo") },
    meta: 0.8,
    detalhes,
  };
}
