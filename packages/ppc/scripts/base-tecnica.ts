// @effect-diagnostics nodeBuiltinImport:off -- leitura síncrona da amostra de PPCs para a medição e o teste de regressão
/**
 * A base dos scripts e dos testes deste pacote:
 *
 * - `carregarBaseRevisao(raiz)`: a base da revisão prévia, pela montagem única (`src/base-revisao.ts`)
 *   sobre o `tmp/kb.sqlite` do checkout em `raiz`, como o app a monta. O banco é exigido: a CLI `kb` o
 *   recompila quando falta ou está velho (`KB_SQLITE` e `KB_RECOMPILAR` valem aqui também), e o CI
 *   roda `pnpm kb compilar` antes dos testes. É a borda que leva o Effect aos scripts e aos testes
 *   síncronos, carregada uma vez por processo.
 * - `ppcsTecnicos(raiz, cncts)`: os PPCs técnicos da base (cursos de nível médio com PPC convertido,
 *   em `base-conhecimento/institucional/ifpr/cursos`), com o CNCT (da base) e a forma de oferta de
 *   cada um: a amostra em que a precisão dos verificadores D é medida (`pre-conferencia.ts --base`,
 *   `PRECISAO.md`) e fixada (`test/precisao-base.test.ts`).
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Layers from "@simplifica-if/kb/layers";
import { analisarPpc } from "@simplifica-if/kb/ppcs/front-matter";
import { montarBaseRevisao } from "../src/base-revisao.ts";
import type { BaseRevisaoPrevia } from "../src/revisao-previa.ts";
import type { CursoCnct } from "../src/verificadores/comum.ts";

export type PpcDaBase = {
  id: string;
  caminho: string;
  forma: string;
  cnct: CursoCnct | null;
  /** `ano_documento` do front matter do PPC: a data do PPC para a regra da revogação recente (`dataPpc`). */
  ano: number | null;
};

const lerJson = (arquivo: string): unknown => JSON.parse(NodeFS.readFileSync(arquivo, "utf8"));

/** A base da revisão prévia do `kb.sqlite` do checkout em `raiz` (a mesma montagem do app). */
export function carregarBaseRevisao(raiz: string): Promise<BaseRevisaoPrevia> {
  return Effect.runPromise(
    montarBaseRevisao.pipe(Effect.provide(Layers.layerRepositorio({ raiz }).pipe(Layer.provide(NodeServices.layer)))),
  );
}

export function ppcsTecnicos(raiz: string, cncts: readonly CursoCnct[]): PpcDaBase[] {
  const dirCursos = NodePath.join(raiz, "base-conhecimento/institucional/ifpr/cursos");
  const porSlug = new Map(cncts.map((c) => [c.slug, c]));
  const saida: PpcDaBase[] = [];
  const campi = NodeFS.readdirSync(dirCursos).filter((nome) =>
    NodeFS.statSync(NodePath.join(dirCursos, nome)).isDirectory(),
  );
  for (const campus of campi.sort())
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
        cnct: curso.cnct_id ? (porSlug.get(curso.cnct_id.replace(/^cnct:/, "")) ?? null) : null,
        ano: Number(analisarPpc(NodeFS.readFileSync(caminho, "utf8"), markdown).proveniencia.ano_documento),
      });
    }
  // Um PPC pode servir a mais de um curso: fica o primeiro.
  return [...new Map(saida.map((p) => [p.id, p])).values()].sort((a, b) => a.id.localeCompare(b.id));
}

export const lerPpc = (ppc: PpcDaBase) => NodeFS.readFileSync(ppc.caminho, "utf8");
