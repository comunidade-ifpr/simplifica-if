/**
 * Fontes classificadas como publicáveis: o `kb.sqlite` do pacote só pode vir delas (plano, "Pacote da
 * base"). Uma fonte nova do compilador (`arquivosFonte` do kb) fora desta lista faz a fábrica falhar
 * até alguém classificá-la aqui. O que não for público fica de fora.
 */
export const FONTES_PUBLICAVEIS = ["base-conhecimento/", "packages/kb/dados/", "packages/kb/src/"] as const;

export function fontesNaoClassificadas(fontes: ReadonlyArray<string>): ReadonlyArray<string> {
  return fontes.filter((fonte) => !FONTES_PUBLICAVEIS.some((prefixo) => fonte.startsWith(prefixo)));
}
