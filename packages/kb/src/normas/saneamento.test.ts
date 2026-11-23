// @effect-diagnostics nodeBuiltinImport:off -- lê as normas e o commit de referência (git) com node:fs e node:child_process síncronos
/**
 * Prova de que mexer na marcação das normas não muda o texto: removida a marcação Markdown e
 * normalizados os espaços, a sequência de palavras de cada norma é idêntica à do texto normativo do
 * commit de referência (`REF_DO_TEXTO`, `palavrasNormativasDaReferencia`). O front matter fica fora
 * da comparação: ele muda de propósito (datas, relações geradas, status calculado, metadados
 * editoriais).
 *
 * Roda num checkout git que tenha o commit de referência. Num clone raso (o CI) é pulado; com o
 * histórico inteiro e sem o commit, falha: a referência ficou velha (`situacaoDaReferencia`).
 */
import * as NodeChildProcess from "node:child_process";
import { describe, expect, test } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { listarNormas } from "./estrutura.ts";
import { palavrasMarkdown, primeiraDivergencia } from "./markdown.ts";
import { raizRepositorio } from "../caminhos.ts";
import { palavrasNormativasDaReferencia, REF_DO_TEXTO, situacaoDaReferencia } from "./referencia-saneamento.ts";

/**
 * Normas cujo texto mudou de propósito depois da referência (não é mudança de marcação). A
 * comparação de palavras não se aplica a elas.
 */
const TEXTO_SUBSTITUIDO = new Map<string, string>([
  ...[
    "normas/ifpr/resolucoes/RESOLUCAO_CONSUP-IFPR_8-2014_regimento-interno-comum-campi.md",
    "normas/ifpr/resolucoes/RESOLUCAO_CONSUP-IFPR_222-2024_altera-regimento-interno-comum-campi.md",
    "normas/ifpr/resolucoes/RESOLUCAO_CONSUP-IFPR_242-2025_altera-regimento-interno-comum-campi.md",
  ].map((path): [string, string] => [path, "trechos trocados pelo texto integral da fonte oficial em 23/11/2026"]),
  ...[
    "normas/br/leis/LEI_BR_12711-2012_cotas.md",
    "normas/br/leis/LEI_BR_11788-2008_lei-estagio.md",
    "normas/br/leis/LEI_BR_9394-1996_ldb.md",
    "normas/br/leis/LEI_BR_13146-2015_estatuto-pcd.md",
    "normas/br/leis/LEI_BR_11892-2008_criacao-ifs.md",
    "normas/ifpr/resolucoes/RESOLUCAO_CONSUP-IFPR_55-2011_odp-educacao-superior.md",
    "normas/ifpr/resolucoes/RESOLUCAO_CONSUP-IFPR_64-2022_cursos-integrados.md",
    "normas/ifpr/resolucoes/RESOLUCAO_CONSUP-IFPR_148-2023_adaptacao-flexibilizacao-curricular.md",
  ].map((path): [string, string] => [
    path,
    "texto conferido com a fonte oficial e corrigido em 23/11/2026 (paráfrase, redação desatualizada ou trecho que faltava)",
  ]),
  [
    "normas/ifpr/notas-tecnicas/NOTA-TECNICA_PROENS-IFPR_1-2025_aee-nao-componente-curricular.md",
    'saiu do corpo o rótulo editorial "Trecho central da nota técnica:"',
  ],
  [
    "normas/br/resolucoes/RESOLUCAO_CNE-CEB_2-2024_dcnem.md",
    'art. 1º, parágrafo único: o "1996." que a conversão deixou numa linha só dele (e o Markdown lia como lista vazia) voltou ao fim da frase',
  ],
]);

const raiz = raizRepositorio();

function versaoAnterior(relativo: string): string | null {
  const resultado = NodeChildProcess.spawnSync("git", ["show", `${REF_DO_TEXTO}:${relativo}`], {
    cwd: raiz,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return resultado.status === 0 ? resultado.stdout : null;
}

const referencia = situacaoDaReferencia(raiz, REF_DO_TEXTO);
const refDisponivel = referencia === "disponivel";

test(`o commit de referência (${REF_DO_TEXTO}) existe quando o histórico está inteiro`, () => {
  expect(referencia, "atualize REF_DO_TEXTO para o commit equivalente").not.toBe("ausente");
});

describe.skipIf(!refDisponivel)(`saneamento: palavras iguais às de ${REF_DO_TEXTO}`, () => {
  const normas = listarNormas(raiz).filter((norma) => !TEXTO_SUBSTITUIDO.has(norma.path));
  test("toda norma que não teve o texto substituído existia na referência", () => {
    for (const norma of normas) {
      expect(versaoAnterior(NodePath.posix.join("base-conhecimento", norma.path)), norma.path).not.toBeNull();
    }
  });
  test.each(normas)("$path", (norma) => {
    const relativo = NodePath.posix.join("base-conhecimento", norma.path);
    const antes = versaoAnterior(relativo);
    expect(antes).not.toBeNull();
    const depois = NodeFS.readFileSync(NodePath.join(raiz, relativo), "utf-8");
    expect(primeiraDivergencia(palavrasNormativasDaReferencia(antes!), palavrasMarkdown(depois))).toBeNull();
  });
});
