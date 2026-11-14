/**
 * Interceptação dos testes "sem o repositório" (do `kb` e do MCP), no lugar do `spyOn` do Bun sobre
 * namespaces ESM, que o vitest não espiona. O arquivo de teste monta `vi.mock` de `node:fs`, de
 * `normas/registro.ts` e de `normas/resolver.ts` com as fábricas daqui; enquanto `interceptacao.atual`
 * estiver definido, as funções embrulhadas passam por ele, e fora disso chamam as originais.
 *
 *   vi.mock("node:fs", async (original) =>
 *     (await import("@simplifica-if/kb/testes/interceptacao")).fsInterceptado(await original()));
 *
 * Este módulo não importa `node:fs`: a fábrica do mock o carrega antes de o `node:fs` falso existir.
 */
export type Original = (...args: unknown[]) => unknown;
export type Interceptar = (nome: string, args: unknown[], original: Original) => unknown;

/** Interceptação em curso; `undefined` deixa passar tudo. */
export const interceptacao: { atual: Interceptar | undefined } = { atual: undefined };

/** Funções de `node:fs` embrulhadas por `fsInterceptado`. */
export const LEITURAS_FS = [
  "readFileSync",
  "readdirSync",
  "existsSync",
  "statSync",
  "lstatSync",
  "openSync",
  "realpathSync",
] as const;

function embrulhar(original: object, nomes: readonly string[]): Record<string, Original> {
  const funcoes = original as Record<string, Original>;
  return Object.fromEntries(
    nomes.map((nome) => {
      const funcao = funcoes[nome]!;
      const embrulhada: Original = (...args) =>
        interceptacao.atual ? interceptacao.atual(nome, args, funcao) : funcao(...args);
      return [nome, embrulhada];
    }),
  );
}

/** Módulo `node:fs` com as `LEITURAS_FS` embrulhadas, também no `default`. */
export function fsInterceptado<T extends object>(original: T): T {
  const embrulhadas = embrulhar(original, LEITURAS_FS);
  const padrao = (original as { default?: object }).default ?? original;
  return { ...original, ...embrulhadas, default: { ...padrao, ...embrulhadas } };
}

/** Módulo com as funções `nomes` embrulhadas (as chamadas de dentro do próprio módulo não passam aqui). */
export function moduloInterceptado<T extends object>(original: T, nomes: readonly (keyof T & string)[]): T {
  return { ...original, ...embrulhar(original, nomes) };
}
