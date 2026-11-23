// @effect-diagnostics nodeBuiltinImport:off -- pergunta ao git, com node:child_process síncrono, se o commit de referência existe
/**
 * Referências dos testes que comparam as normas com um commit anterior: o status manual de antes do
 * saneamento da fase 5 (`fase5.test.ts`, `REF_ANTES_SANEAMENTO`) e as palavras do texto
 * (`saneamento.test.ts`, `REF_DO_TEXTO`). Só os testes as usam.
 */
import * as NodeChildProcess from "node:child_process";

/** Último commit antes do saneamento da fase 5 (merge da fase 4 em `main`). */
export const REF_ANTES_SANEAMENTO = "98e391b7";

/**
 * O commit de referência neste checkout: `disponivel`; `clone-raso` (o histórico não veio inteiro, como
 * no CI, ou a pasta não é um checkout git), e os testes que dependem dele se pulam; ou `ausente`, com o
 * histórico inteiro e sem o commit. `ausente` é erro: a referência ficou velha (uma reescrita do
 * histórico troca os SHAs) e precisa apontar para o commit equivalente, senão os testes pulam calados.
 */
export function situacaoDaReferencia(
  raiz: string,
  commit: string = REF_ANTES_SANEAMENTO,
): "disponivel" | "clone-raso" | "ausente" {
  const git = (argumentos: ReadonlyArray<string>) =>
    NodeChildProcess.spawnSync("git", argumentos, {
      cwd: raiz,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  if (git(["cat-file", "-e", `${commit}^{commit}`]).status === 0) return "disponivel";
  const raso = git(["rev-parse", "--is-shallow-repository"]);
  return raso.status === 0 && raso.stdout.trim() === "false" ? "ausente" : "clone-raso";
}

/**
 * Normas incluídas na base depois de `REF_ANTES_SANEAMENTO`, por caminho relativo a
 * `base-conhecimento/`: não têm texto nem status manual anteriores a comparar. Toda norma nova
 * entra aqui; os testes conferem que o caminho existe e que ele não existia na referência.
 */
export const INCLUIDAS_DEPOIS: ReadonlyMap<string, string> = new Map([
  [
    "normas/br/decretos-lei/DECRETO-LEI_BR_1044-1969_regime-domiciliar.md",
    "incluída em 18/11/2026 do texto oficial (Planalto)",
  ],
  ["normas/br/leis/LEI_BR_6202-1975_estudante-gestante.md", "incluída em 18/11/2026 do texto oficial (Planalto)"],
  [
    "normas/br/pareceres/PARECER_CNE-CEB_31-2002_atendimento-domiciliar.md",
    "incluída em 19/11/2026 do texto oficial (PDF do CNE)",
  ],
]);

/**
 * Referência das palavras do texto das normas (`saneamento.test.ts`): o commit em que o corpo de
 * cada norma, já só o texto oficial, foi conferido com a fonte pela última vez. Correção de texto
 * (e não de marcação) pede subir a referência para o commit que a traz.
 */
export const REF_DO_TEXTO = "f6ecfaec";
