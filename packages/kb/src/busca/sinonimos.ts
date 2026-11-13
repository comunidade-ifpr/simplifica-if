/**
 * Léxico de sinônimos da busca de seções (`packages/kb/dados/sinonimos.yaml`).
 *
 * - `tipos`: termos de cada tipo de seção, indexados (como radicais) na coluna `expansao` do FTS das
 *   seções daquele tipo — expansão do documento.
 * - `grupos`: termos equivalentes; a consulta que contém um deles ganha os outros — expansão da
 *   consulta.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { radicais } from "./tokens.ts";

export const esquemaSinonimos = z.strictObject({
  tipos: z.record(z.string().regex(/^[a-z_]+$/), z.array(z.string().min(1)).min(1)),
  grupos: z.array(z.array(z.string().min(1)).min(2)),
});
export type Sinonimos = z.output<typeof esquemaSinonimos>;

export function caminhoSinonimos(raizPacote: string = path.resolve(import.meta.dir, "..", "..")): string {
  return path.join(raizPacote, "dados", "sinonimos.yaml");
}

/** Lê e valida o léxico (YAML `failsafe`: todo escalar é texto). */
export function lerSinonimos(caminho: string = caminhoSinonimos()): Sinonimos {
  return esquemaSinonimos.parse(parse(readFileSync(caminho, "utf-8"), { schema: "failsafe", uniqueKeys: true }));
}

/** Texto de expansão de um tipo de seção: os termos do léxico, separados por " ; ". */
export function expansaoDoTipo(lexico: Sinonimos, tipo: string): string {
  return (lexico.tipos[tipo] ?? []).join(" ; ");
}

/**
 * Expansão da consulta: para cada grupo em que algum termo aparece inteiro nos radicais da
 * consulta, devolve os radicais dos outros termos do grupo (cada termo como sequência de radicais,
 * para virar frase no FTS5). Ordem estável: a do arquivo.
 */
export function expandirConsulta(lexico: Sinonimos, radicaisConsulta: readonly string[]): string[][] {
  const presentes = new Set(radicaisConsulta);
  const saida: string[][] = [];
  const vistos = new Set<string>();
  for (const grupo of lexico.grupos) {
    const termosGrupo = grupo.map((termo) => radicais(termo)).filter((r) => r.length > 0);
    const casou = termosGrupo.some((r) => r.every((radical) => presentes.has(radical)));
    if (!casou) continue;
    for (const r of termosGrupo) {
      if (r.every((radical) => presentes.has(radical))) continue;
      const chave = r.join(" ");
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      saida.push(r);
    }
  }
  return saida;
}
