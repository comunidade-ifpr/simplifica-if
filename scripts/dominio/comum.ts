const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type StatusCuradoria = "precisa_revisao" | "revisado" | "inconsistente" | "pendente";

const ALIASES_CURADORIA: Readonly<Record<string, StatusCuradoria>> = {
  "precisa de revisão": "precisa_revisao",
  "precisa de revisao": "precisa_revisao",
  precisa_revisao: "precisa_revisao",
  sugerido: "precisa_revisao",
  revisado: "revisado",
  inconsistente: "inconsistente",
  pendente: "pendente",
};

export function ehSlug(valor: string): boolean {
  return SLUG.test(valor);
}

export function ehHttps(valor: string): boolean {
  return valor.startsWith("https://");
}

/** Comparação por código: a ordem não muda com a localidade da máquina. */
export function compararTexto(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Rótulo de curadoria conhecido (como "Revisado" ou "Precisa de revisão"), sem caixa nem espaços nas pontas. */
export function ehRotuloCuradoria(rotulo: string): boolean {
  return Object.hasOwn(ALIASES_CURADORIA, rotulo.trim().toLowerCase());
}

/** Um status explícito vale; sem ele, a data de revisão indica se alguém já conferiu o dado. */
export function statusCuradoria(rotulo: string, revisadoEm: string): StatusCuradoria {
  return ALIASES_CURADORIA[rotulo.trim().toLowerCase()] ?? (revisadoEm ? "revisado" : "precisa_revisao");
}
