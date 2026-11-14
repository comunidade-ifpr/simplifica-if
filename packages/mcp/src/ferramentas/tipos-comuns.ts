/**
 * Tipos comuns às ferramentas de normas e às de PPCs e cursos (especificação M0.1, "Tipos comuns"):
 * os schemas de `NormaResumo` e `Relacao` e a conversão das estruturas do kb para eles. Um único
 * formato de norma e de relação em todas as respostas. Nenhuma regra normativa: só formato.
 */
import type { DatabaseSync } from "node:sqlite";
import { type NormaDoBanco, normaBanco, type Relacao } from "@simplifica-if/kb/db/modo-banco";
import { z } from "zod";
import { esquemaLink } from "../envelope.ts";
import { linkNorma } from "../links.ts";

export const SITUACOES_NORMA = ["base", "stub", "externo"] as const;

export const esquemaNormaResumo = z.strictObject({
  id: z.string(),
  titulo: z.string(),
  situacao: z.enum(SITUACOES_NORMA),
  /** Status publicado, calculado na `data_referencia` da base. */
  status_vigencia: z.string().nullable(),
  /** O front matter publicado traz `vigencia_a_confirmar`, ou o status é "a confirmar". */
  vigencia_a_confirmar: z.boolean(),
  data_publicacao: z.string().nullable(),
  ementa: z.string().nullable(),
  link: esquemaLink,
});
export type NormaResumo = z.infer<typeof esquemaNormaResumo>;

export const esquemaRelacao = z.strictObject({
  tipo: z.string(),
  origem: z.string(),
  /** Dispositivo da origem que opera a relação (`#art74-ii`). */
  operador: z.string().nullable(),
  alvo: z.string(),
  alvo_dispositivo: z.string().nullable(),
  /** Parte do alvo atingida, quando descrita em texto. */
  alcance: z.string().nullable(),
  evidencia: z.strictObject({ em: z.string(), trecho: z.string() }),
  confirmado_em: z.string().nullable(),
  nota: z.string().nullable(),
});
export type RelacaoSaida = z.infer<typeof esquemaRelacao>;

export function resumoDaNorma(norma: NormaDoBanco): NormaResumo {
  return {
    id: norma.id,
    titulo: norma.titulo,
    situacao: norma.situacao,
    status_vigencia: norma.status_vigencia,
    vigencia_a_confirmar: norma.vigencia_a_confirmar,
    data_publicacao: norma.data_publicacao,
    ementa: norma.ementa,
    link: linkNorma(norma.id),
  };
}

/** A norma (o ato, sem dispositivo) pela tabela `normas`, ou `null` se não está registrada. */
export function normaResumo(db: DatabaseSync, id: string): NormaResumo | null {
  const norma = normaBanco(db, id);
  return norma ? resumoDaNorma(norma) : null;
}

/** `normaBanco` com cache por chamada (várias respostas citam a mesma norma). */
export function leitorDeNormas(db: DatabaseSync): (id: string) => NormaDoBanco | null {
  const cache = new Map<string, NormaDoBanco | null>();
  return (id) => {
    if (!cache.has(id)) cache.set(id, normaBanco(db, id));
    return cache.get(id)!;
  };
}

export function relacaoSaida(r: Relacao): RelacaoSaida {
  return {
    tipo: r.tipo,
    origem: r.origem,
    operador: r.operador ?? null,
    alvo: r.alvo,
    alvo_dispositivo: r.alvo_dispositivo ?? null,
    alcance: r.alcance ?? null,
    evidencia: { em: r.evidencia.em, trecho: r.evidencia.trecho },
    confirmado_em: r.confirmado_em ?? null,
    nota: r.nota ?? null,
  };
}
