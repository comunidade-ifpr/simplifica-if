/**
 * Os marcadores `{id}` do pedido de uma tarefa de conversa (`abre.conversa.pedido`): cada um é o
 * lugar de uma entrada do formulário. O manifesto confere que todo marcador tem entrada (`./tarefas.ts`);
 * a interface troca cada um pelo que a pessoa preencheu.
 *
 * Módulo sem dependência de Node, para a interface poder importá-lo.
 */

/** Um `{id}`; o grupo 1 é o `id`. Global: use com `matchAll` e `replace`, que não guardam `lastIndex`. */
export const RE_MARCADOR = /\{([^{}]*)\}/g;

/** Os `{id}` de um pedido, na ordem em que aparecem, sem repetir. */
export const marcadoresDoPedido = (pedido: string): ReadonlyArray<string> => [
  ...new Set([...pedido.matchAll(RE_MARCADOR)].map((casamento) => casamento[1]!)),
];
