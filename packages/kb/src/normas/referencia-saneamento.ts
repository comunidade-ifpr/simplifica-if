/**
 * Referência dos testes que comparam as normas com o estado anterior ao saneamento da fase 5
 * (`saneamento.test.ts`, palavras; `fase5.test.ts`, status manual). Só os testes a usam.
 */

/** Último commit antes do saneamento da fase 5 (merge da fase 4 em `main`). */
export const REF_ANTES_SANEAMENTO = "fcfc006";

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
]);
