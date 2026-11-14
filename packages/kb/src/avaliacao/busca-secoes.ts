// @effect-diagnostics nodeBuiltinImport:off -- leitura síncrona do conjunto rotulado da avaliação
/**
 * Recall@10 da busca de seções (`kb buscar-secoes`) no conjunto rotulado de
 * `avaliacao/busca-secoes/consultas.yaml`, nos três modos: sem stemmer nem sinônimos (`simples`),
 * só radicais (`radicais`) e radicais com o léxico de sinônimos (`completo`, o padrão da CLI).
 * Meta do plano (fase 6): recall@10 ≥ 0,8.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parse } from "yaml";
import type { Sinonimos } from "../busca/sinonimos.ts";
import { semDiacriticos } from "../busca/tokens.ts";
import * as Ppcs from "../Ppcs.ts";
import type { FiltrosSecoes, ModoBusca } from "../db/consultas.ts";
import { raizRepositorio } from "../normas/registro.ts";

const esquemaConsultas = Schema.Struct({
  consultas: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      consulta: Schema.String.check(Schema.isMinLength(1)),
      filtros: Schema.Struct({
        ppc: Schema.optionalKey(Schema.String),
        cnct: Schema.optionalKey(Schema.String),
        campus: Schema.optionalKey(Schema.String),
        nivel: Schema.optionalKey(Schema.String),
        forma: Schema.optionalKey(Schema.String),
        tipo: Schema.optionalKey(Schema.String),
      }).pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
      esperadas: Schema.Array(
        Schema.Struct({ ppc: Schema.String, titulo: Schema.String.check(Schema.isMinLength(1)) }),
      ).check(Schema.isMinLength(1)),
    }),
  ),
});
export type ConsultasRotuladas = typeof esquemaConsultas.Type;
const decodificarConsultas = Schema.decodeUnknownSync(esquemaConsultas, { onExcessProperty: "error", errors: "all" });

export function caminhoConsultas(raiz: string = raizRepositorio()): string {
  return NodePath.join(raiz, "avaliacao", "busca-secoes", "consultas.yaml");
}

export function lerConsultas(caminho: string = caminhoConsultas()): ConsultasRotuladas {
  return decodificarConsultas(parse(NodeFS.readFileSync(caminho, "utf-8"), { schema: "failsafe" }));
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

/** Léxico sem grupos nem tipos: os modos `simples` e `radicais` medem a busca sem sinônimos. */
const LEXICO_VAZIO: Sinonimos = { tipos: {}, grupos: [] };

export class ConsultasRotuladasIlegiveis extends Schema.TaggedError<ConsultasRotuladasIlegiveis>()(
  "ConsultasRotuladasIlegiveis",
  { caminho: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `não foi possível ler o conjunto rotulado da busca de seções (${this.caminho})`;
  }
}

export const ehConsultasRotuladasIlegiveis = Schema.is(ConsultasRotuladasIlegiveis);

/**
 * Recall@k de cada consulta rotulada nos três modos, pelo `Ppcs.buscarSecoes`. O modo `completo` usa
 * o léxico de `FontesNormativas` (ou `opcoes.lexico`); os outros, um léxico vazio.
 */
export const avaliarBusca = Effect.fn("avaliacao.avaliarBusca")(function* (
  opcoes: { readonly lexico?: Sinonimos; readonly k?: number; readonly conjunto?: ConsultasRotuladas } = {},
) {
  const ppcs = yield* Ppcs.Ppcs;
  const k = opcoes.k ?? 10;
  const conjunto =
    opcoes.conjunto ??
    (yield* Effect.try({
      try: () => lerConsultas(),
      catch: (cause) => new ConsultasRotuladasIlegiveis({ caminho: caminhoConsultas(), cause }),
    }));
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
      const lexico = modo === "completo" ? opcoes.lexico : LEXICO_VAZIO;
      const achados = yield* ppcs.buscarSecoes(c.consulta, filtros, {
        limite: k,
        modo,
        ...(lexico ? { lexico } : {}),
      });
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
  const resultado: ResultadoAvaliacaoBusca = {
    k,
    consultas: n,
    recall: { simples: media("simples"), radicais: media("radicais"), completo: media("completo") },
    meta: 0.8,
    detalhes,
  };
  return resultado;
});
