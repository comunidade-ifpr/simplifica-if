/**
 * Os atalhos de teclado do app e como escrevê-los: no macOS, ⌘ e ⌥; nos outros sistemas, Ctrl e Alt. A
 * detecção do macOS é só esta, para os atalhos, as dicas e os testes.
 */

export const NO_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.userAgent);

/** Busca no texto do leitor. No macOS, só ⌘F: Ctrl+F num campo de texto avança o cursor. */
export const ATALHO_BUSCA = NO_MAC ? "⌘F" : "Ctrl+F";
export const eAtalhoBusca = (e: KeyboardEvent) =>
  (NO_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) &&
  !e.altKey &&
  !e.shiftKey &&
  e.key.toLowerCase() === "f";

/** Buscar na base (a paleta). */
export const ATALHO_PALETA = NO_MAC ? "⌘K" : "Ctrl+K";

/** Mostra e esconde o painel do app. */
export const ATALHO_PAINEL = NO_MAC ? "⌘\\" : "Ctrl+\\";

/** ⌘J ou Ctrl+J: a conversa ao lado (na paleta, com o texto digitado como pergunta). */
export const ATALHO_CONVERSAR = NO_MAC ? "⌘J" : "Ctrl+J";

/** O clique que abre um link no outro lugar (no painel, em vez da tela, ou o contrário). */
export const CLIQUE_OUTRO_LUGAR = NO_MAC ? "⌥-clique" : "Alt+clique";

/** ⌘ ou Ctrl com a tecla, sem Alt nem Shift; os dois valem em qualquer sistema, como o ⌘K sempre aceitou. */
export const eComando = (e: KeyboardEvent, tecla: string) =>
  (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === tecla;

/** Abrir em nova janela (no desktop): ⇧⌘N, Ctrl+Shift+N. */
export const eNovaJanela = (e: KeyboardEvent) =>
  !e.repeat && (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "n";

/** O `aria-keyshortcuts` de um atalho de ⌘ ou Ctrl. */
export const ariaAtalho = (tecla: string) => (NO_MAC ? `Meta+${tecla}` : `Control+${tecla}`);
