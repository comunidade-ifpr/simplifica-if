/** Texto sem acento e em minúsculas, para comparar (a mesma regra da busca do Explorar no servidor). */
export function normalizar(texto: string): string {
  return texto.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
}
