// @effect-diagnostics nodeBuiltinImport:off -- carregador síncrono do léxico, usado pelos scripts, pela skill revisar-ppc e pela compilação do banco
/**
 * Léxico de sinônimos da busca de seções (`packages/kb/dados/sinonimos.yaml`).
 *
 * - `tipos`: termos de cada tipo de seção, indexados (como radicais) na coluna `expansao` do FTS das
 *   seções daquele tipo — expansão do documento.
 * - `grupos`: termos equivalentes; a consulta que contém um deles ganha os outros — expansão da
 *   consulta.
 */
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parse } from "yaml";
import { radicais } from "./tokens.ts";

const termo = Schema.String.check(Schema.isMinLength(1));

/** Contrato do léxico (decodificado sem chaves extras). */
export const esquemaSinonimos = Schema.Struct({
  tipos: Schema.Record(
    Schema.String.check(Schema.isPattern(/^[a-z_]+$/)),
    Schema.Array(termo).check(Schema.isMinLength(1)),
  ),
  grupos: Schema.Array(Schema.Array(termo).check(Schema.isMinLength(2))),
});
export type Sinonimos = typeof esquemaSinonimos.Type;
const decodificarSinonimos = Schema.decodeUnknownSync(esquemaSinonimos, { onExcessProperty: "error", errors: "all" });

export function caminhoSinonimos(raizPacote: string = NodePath.resolve(import.meta.dirname, "..", "..")): string {
  return NodePath.join(raizPacote, "dados", "sinonimos.yaml");
}

/**
 * Valida o léxico já interpretado (do YAML ou remontado das tabelas do banco). Fora do contrato,
 * lança o `Schema.SchemaError` (texto em português por `esquema/mensagens.ts`).
 */
export function sinonimosDeObjeto(objeto: unknown): Sinonimos {
  return decodificarSinonimos(objeto);
}

/** Léxico do texto de `sinonimos.yaml` (YAML `failsafe`: todo escalar é texto). */
export function sinonimosDoYaml(texto: string): Sinonimos {
  return sinonimosDeObjeto(parse(texto, { schema: "failsafe", uniqueKeys: true }));
}

/** Lê e valida o léxico. */
export function lerSinonimos(caminho: string = caminhoSinonimos()): Sinonimos {
  return sinonimosDoYaml(NodeFS.readFileSync(caminho, "utf-8"));
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
