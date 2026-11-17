/**
 * URLs pré-assinadas (S3 do SUAP e afins) não entram na base: a query string traz a chave de acesso,
 * a assinatura e a validade (`AWSAccessKeyId`, `Signature`, `Expires`, `X-Amz-*`). O link expira em
 * horas e a credencial não deve ser publicada; grava-se só o endereço do objeto, sem a query.
 */

/** Parâmetros de query que marcam uma URL assinada. */
const PARAMETROS =
  "(?:AWSAccessKeyId|Signature|X-Amz-(?:Algorithm|Credential|Signature|Security-Token)|GoogleAccessId)";
const PARAMETRO_ASSINATURA = new RegExp(`[?&]${PARAMETROS}=`, "i");

/** Uma URL `http(s)` com assinatura na query string, em qualquer ponto do texto. */
export const RE_URL_ASSINADA = new RegExp(`https?://[^\\s"'<>)\\]]*[?&]${PARAMETROS}=`, "i");

export function ehUrlAssinada(valor: string): boolean {
  return /^https?:\/\//i.test(valor) && PARAMETRO_ASSINATURA.test(valor);
}

/** A URL sem a query string quando ela é assinada; as demais voltam como estão. */
export function semAssinatura(valor: string): string {
  if (!ehUrlAssinada(valor)) return valor;
  const url = new URL(valor);
  return `${url.origin}${url.pathname}`;
}

/** Aplica `semAssinatura` a todo texto de um valor JSON. */
export function limparUrlsAssinadas<T>(valor: T): T {
  if (typeof valor === "string") return semAssinatura(valor) as T;
  if (Array.isArray(valor)) return valor.map(limparUrlsAssinadas) as T;
  if (valor && typeof valor === "object") {
    return Object.fromEntries(
      Object.entries(valor as Record<string, unknown>).map(([chave, item]) => [chave, limparUrlsAssinadas(item)]),
    ) as T;
  }
  return valor;
}

/**
 * Planilha do Google (`docs.google.com/spreadsheets/...`): na base só como `horarios_url` de um campus
 * (grade pública apontada pelo site oficial). Em qualquer outro lugar é planilha interna de
 * acompanhamento: o texto fica e o link sai (`semPlanilhasGoogle`).
 */
export const RE_PLANILHA_GOOGLE = /https?:\/\/docs\.google\.com\/spreadsheets\/[^\s"'<>)\]]*/gi;
export const TEXTO_PLANILHA = "planilha interna (link omitido)";

export function semPlanilhasGoogle(texto: string): string {
  return texto.replace(RE_PLANILHA_GOOGLE, TEXTO_PLANILHA);
}

/**
 * URL de sessão do SEI: `infra_hash` (com `infra_sistema` e `infra_unidade_atual`) só vale na sessão de
 * quem copiou o link. Os parâmetros saem e o resto da URL fica; o `hash_download` da autenticação
 * pública de documentos não é de sessão e fica.
 */
export const RE_URL_SESSAO_SEI = /infra_hash\s?=\s?[0-9a-f]{8}/i;
/** O hash fora de uma URL contínua (a conversão do PDF parte a URL e o próprio hash com espaços). */
const RE_HASH_SOLTO = /[?&]?\s?infra_hash\s?=\s?[0-9a-f]{8,}(?: [0-9a-f]{4,})?/gi;
const RE_PARAMETRO_SESSAO = /[?&]infra_(?:hash|sistema|unidade_atual)=[\w%-]*/gi;

export function semSessaoSei(texto: string): string {
  return texto
    .replace(/https?:\/\/[^\s"'<>)\]|]*infra_hash=[\w%-]*/gi, (url) => {
      const limpa = url.replace(RE_PARAMETRO_SESSAO, "");
      return limpa.includes("?") ? limpa : limpa.replace("&", "?");
    })
    .replace(RE_HASH_SOLTO, "");
}
