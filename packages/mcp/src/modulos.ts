/**
 * Os módulos que este app traz: o código de um fluxo próprio (telas, RPC, tabelas), que sai com o
 * instalador. A tarefa de abertura `modulo` cita um deles pelo nome; o servidor esconde a tarefa cujo
 * módulo o app instalado não tem, e o `validar_base.ts` recusa o manifesto que cita outro. A rota de
 * cada módulo fica no código da interface (`apps/web/src/tarefas/abrir.ts`), não aqui.
 *
 * Módulo sem dependência de Node, para a interface poder importá-lo.
 */
export const MODULOS = ["revisao-ppc"] as const;

export type Modulo = (typeof MODULOS)[number];

export const ehModulo = (nome: string): nome is Modulo => (MODULOS as ReadonlyArray<string>).includes(nome);
