/**
 * O vocabulário do campo `publico` do manifesto de skill (bloco `simplifica:` do `SKILL.md`): a quem a
 * tarefa serve. É o mesmo que a função do perfil da pessoa no app (`@simplifica-if/contratos-app`,
 * primeiro uso, M1.8): o Início põe primeiro as tarefas cujo `publico` inclui a função dela.
 *
 * Módulo sem dependência de Node, para a interface poder importá-lo.
 */

/** Os públicos, na ordem em que o perfil os oferece. */
export const PUBLICOS = ["coordenacao-curso", "pedagogia", "docente", "direcao-ensino", "proens", "dens"] as const;

export type Publico = (typeof PUBLICOS)[number];
