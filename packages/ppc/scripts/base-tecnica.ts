// @effect-diagnostics nodeBuiltinImport:off -- leitura síncrona da base para a medição e o teste de regressão
/**
 * Os PPCs técnicos da base (cursos de nível médio com PPC convertido, em `dados/institucional/cursos`),
 * com o CNCT e a forma de oferta de cada um: a amostra em que a precisão dos verificadores D é medida
 * (`pre-conferencia.ts --base`, `PRECISAO.md`) e fixada (`test/precisao-base.test.ts`).
 *
 * Lê só arquivos versionados (não usa o `tmp/kb.sqlite`), para o teste rodar num checkout limpo.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { carregarRegistro, raizRepositorio } from "@simplifica-if/kb/normas/registro";
import { carregarRelacoes } from "@simplifica-if/kb/normas/relacoes";
import type { BaseVerificacao, CursoCnct } from "../src/verificadores/comum.ts";

export type PpcDaBase = { id: string; caminho: string; forma: string; cnct: CursoCnct | null };

const lerJson = (arquivo: string): unknown => JSON.parse(NodeFS.readFileSync(arquivo, "utf8"));

export function ppcsTecnicos(raiz: string = raizRepositorio()): PpcDaBase[] {
  const dirCursos = NodePath.join(raiz, "dados/institucional/cursos");
  const cnct = (slug: string) => {
    const arquivo = NodePath.join(raiz, "base-conhecimento/catalogos/cnct/cursos", `${slug}.json`);
    return NodeFS.existsSync(arquivo) ? ({ ...(lerJson(arquivo) as object), slug } as CursoCnct) : null;
  };
  const saida: PpcDaBase[] = [];
  for (const campus of NodeFS.readdirSync(dirCursos).sort())
    for (const nome of NodeFS.readdirSync(NodePath.join(dirCursos, campus)).sort()) {
      if (!nome.endsWith(".json")) continue;
      const curso = lerJson(NodePath.join(dirCursos, campus, nome)) as {
        nivel?: string;
        forma_oferta?: string;
        cnct_id?: string | null;
        ppc?: { markdown_path?: string };
      };
      const markdown = curso.ppc?.markdown_path;
      if (curso.nivel !== "médio" || !markdown) continue;
      const caminho = NodePath.join(raiz, "base-conhecimento", markdown);
      if (!NodeFS.existsSync(caminho)) continue;
      saida.push({
        id: markdown.replace(/^institucional\/ifpr\/ppcs\//, "").replace(/\.md$/, ""),
        caminho,
        forma: curso.forma_oferta ?? "",
        cnct: curso.cnct_id ? cnct(curso.cnct_id.replace(/^cnct:/, "")) : null,
      });
    }
  // Um PPC pode servir a mais de um curso: fica o primeiro.
  return [...new Map(saida.map((p) => [p.id, p])).values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** A parte da base que não depende do PPC (registro e relações), carregada uma vez. */
export function baseComum(raiz: string = raizRepositorio()): Omit<BaseVerificacao, "cnct" | "forma"> {
  return { registro: carregarRegistro(raiz), relacoes: carregarRelacoes(raiz) };
}

export const lerPpc = (ppc: PpcDaBase) => NodeFS.readFileSync(ppc.caminho, "utf8");
