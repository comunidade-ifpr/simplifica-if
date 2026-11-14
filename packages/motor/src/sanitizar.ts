/**
 * Limpa uma mensagem nativa antes de gravá-la (fixtures, logs): tira e-mails, valores de chaves com
 * cara de segredo e a pasta pessoal do usuário. Função pura.
 */

const CHAVE_SECRETA = /token|secret|password|senha|api_?key|authorization|cookie|credential|email/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER = /\b(Bearer\s+|sk-)[A-Za-z0-9._~+/=-]{8,}/g;

/** Chaves que só contam tokens (uso), não segredos: ficam como estão. */
const CHAVE_DE_CONTAGEM = /tokens$|^tokenUsage$|^tokenSource$|^apiKeySource$/i;

export function sanitizar(valor: unknown, opcoes: { readonly home: string }): unknown {
  const limparTexto = (texto: string): string => {
    let limpo = texto.replace(EMAIL, "<email>").replace(BEARER, "<segredo>");
    if (opcoes.home.length > 1) limpo = limpo.split(opcoes.home).join("~");
    return limpo;
  };
  const visitar = (atual: unknown, chave: string | undefined): unknown => {
    if (typeof atual === "string") {
      if (chave !== undefined && CHAVE_SECRETA.test(chave) && !CHAVE_DE_CONTAGEM.test(chave)) return "<removido>";
      return limparTexto(atual);
    }
    if (Array.isArray(atual)) return atual.map((item) => visitar(item, undefined));
    if (typeof atual === "object" && atual !== null) {
      const saida: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(atual)) saida[k] = visitar(v, k);
      return saida;
    }
    return atual;
  };
  return visitar(valor, undefined);
}
