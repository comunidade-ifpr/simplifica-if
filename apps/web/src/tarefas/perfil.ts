/**
 * O perfil da pessoa (campus, função e cursos), que fica só neste computador. É o ponto de encaixe do
 * primeiro uso (M1.8): até lá, o perfil é vazio, o Início não mostra a linha do perfil e o catálogo não
 * filtra as tarefas.
 */

export interface Perfil {
  /** Como a pessoa se apresenta: "Coordenação de Curso". */
  readonly rotuloFuncao?: string;
  /** O slug da função, comparado com o `publico` do manifesto (`coordenacao-curso`). */
  readonly funcao?: string;
  /** "Campus Curitiba". */
  readonly campus?: string;
  readonly cursos?: ReadonlyArray<string>;
}

/** O perfil gravado; `undefined` até o primeiro uso (M1.8) existir. */
export function usePerfil(): Perfil | undefined {
  return undefined;
}

/** A linha do cabeçalho do Início: "Coordenação de Curso · Campus Curitiba". */
export function linhaDoPerfil(perfil: Perfil | undefined): string | undefined {
  const partes = [perfil?.rotuloFuncao, perfil?.campus].filter((parte): parte is string => !!parte);
  return partes.length === 0 ? undefined : partes.join(" · ");
}
