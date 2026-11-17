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
