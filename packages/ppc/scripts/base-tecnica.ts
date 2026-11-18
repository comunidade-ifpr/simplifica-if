// @effect-diagnostics nodeBuiltinImport:off -- leitura síncrona da base para a medição e o teste de regressão
/**
 * Os PPCs técnicos da base (cursos de nível médio com PPC convertido, em `base-conhecimento/institucional/ifpr/cursos`),
 * com o CNCT e a forma de oferta de cada um: a amostra em que a precisão dos verificadores D é medida
 * (`pre-conferencia.ts --base`, `PRECISAO.md`) e fixada (`test/precisao-base.test.ts`).
 *
 * Lê só arquivos versionados (não usa o `tmp/kb.sqlite`), para o teste rodar num checkout limpo.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { carregarRegistro, raizRepositorio } from "@simplifica-if/kb/normas/registro";
import { carregarRelacoes } from "@simplifica-if/kb/normas/relacoes";
import { carregarDatas, carregarTransicoes, dataReferencia } from "@simplifica-if/kb/normas/vigencia";
import type { BaseRevisaoPrevia } from "../src/revisao-previa.ts";
import type { BaseVerificacao, CursoCnct } from "../src/verificadores/comum.ts";
import { type ConsultaVigencia, consultarVigencia } from "../src/verificadores/vigencia.ts";

export type PpcDaBase = {
  id: string;
  caminho: string;
  forma: string;
  cnct: CursoCnct | null;
  /** `ppc.ano_documento` do curso: a data do PPC para a regra da revogação recente (`dataPpc`). */
  ano: number | null;
};

const lerJson = (arquivo: string): unknown => JSON.parse(NodeFS.readFileSync(arquivo, "utf8"));

export function ppcsTecnicos(raiz: string = raizRepositorio()): PpcDaBase[] {
  const dirCursos = NodePath.join(raiz, "base-conhecimento/institucional/ifpr/cursos");
  const cnct = (slug: string) => {
    const arquivo = NodePath.join(raiz, "base-conhecimento/catalogos/cnct/cursos", `${slug}.json`);
    return NodeFS.existsSync(arquivo) ? ({ ...(lerJson(arquivo) as object), slug } as CursoCnct) : null;
  };
  const saida: PpcDaBase[] = [];
  // O index.json da coleção fica ao lado das pastas de campus.
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
        ppc?: { markdown_path?: string; ano_documento?: number | null };
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
        ano: curso.ppc?.ano_documento ?? null,
      });
    }
  // Um PPC pode servir a mais de um curso: fica o primeiro.
  return [...new Map(saida.map((p) => [p.id, p])).values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * A vigência lida dos arquivos do checkout, memorizada, na data (padrão: a `data_referencia` de
 * `config/vigencia.yaml`). O app não tem o checkout: monta a vigência do `kb.sqlite` (`vigenciaDeDados`).
 */
export function carregarVigencia(
  raiz: string = raizRepositorio(),
  data: string = dataReferencia(raiz),
): ConsultaVigencia {
  const uma = <T>(carregar: () => T) => {
    let valor: T | undefined;
    return () => (valor ??= carregar());
  };
  return consultarVigencia(
    {
      registro: uma(() => carregarRegistro(raiz)),
      datas: uma(() => carregarDatas(raiz)),
      relacoes: uma(() => carregarRelacoes(raiz)),
      transicoes: uma(() => carregarTransicoes(raiz)),
    },
    data,
  );
}

/** A parte da base que não depende do PPC (registro, relações e vigência), carregada uma vez. */
export function baseComum(raiz: string = raizRepositorio()): Omit<BaseVerificacao, "cnct" | "forma"> {
  return { registro: carregarRegistro(raiz), relacoes: carregarRelacoes(raiz), vigencia: carregarVigencia(raiz) };
}

export const lerPpc = (ppc: PpcDaBase) => NodeFS.readFileSync(ppc.caminho, "utf8");

/**
 * A base da revisão prévia lida dos arquivos do checkout (testes e amostras). No app, o servidor a
 * monta do `kb.sqlite` (`montarBase`, em `apps/server/src/revisao-ppc/RevisorPpc.ts`).
 */
export function baseRevisaoDeArquivos(raiz: string = raizRepositorio()): BaseRevisaoPrevia {
  const { registro, relacoes } = baseComum(raiz);
  const dirCnct = NodePath.join(raiz, "base-conhecimento/catalogos/cnct/cursos");
  const cncts = NodeFS.readdirSync(dirCnct)
    .filter((nome) => nome.endsWith(".json"))
    .map((nome) => ({ ...(lerJson(NodePath.join(dirCnct, nome)) as object), slug: nome.slice(0, -5) }) as CursoCnct);
  const dirFichas = NodePath.join(raiz, ".agents/skills/revisar-ppc/base-analise/fichas");
  const fichas: Record<string, string> = {};
  for (const nome of NodeFS.readdirSync(dirFichas).filter((n) => n.endsWith(".json"))) {
    const ficha = lerJson(NodePath.join(dirFichas, nome)) as { id: string; titulo: string };
    fichas[ficha.id] = ficha.titulo;
  }
  const topicos = (
    lerJson(NodePath.join(raiz, ".agents/skills/revisar-ppc/base-analise/topicos-fichas.json")) as {
      topicos: { id: string; fichas?: string[] }[];
    }
  ).topicos.map((t) => ({ id: t.id, fichas: t.fichas ?? [] }));
  const urls: Record<string, string> = {};
  for (const entrada of lerJson(NodePath.join(raiz, "base-conhecimento/manifest.json")) as {
    id: string;
    fonte?: string;
  }[])
    if (entrada.fonte?.startsWith("http")) urls[entrada.id] = entrada.fonte;
  return {
    normas: registro.entradas,
    relacoes,
    datas: carregarDatas(raiz, registro),
    transicoes: carregarTransicoes(raiz),
    cncts,
    urls,
    fichas,
    topicos,
    dataBase: dataReferencia(raiz),
  };
}
