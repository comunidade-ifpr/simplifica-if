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
/**
 * Link Markdown para a planilha (`[texto](url)`, `[texto](<url>)`, `[texto](url "título")`): sai inteiro,
 * para não sobrar `[texto](planilha interna (link omitido))`, que é link quebrado.
 */
const RE_LINK_PLANILHA =
  /\[([^\]\n]*)\]\(\s*<?https?:\/\/docs\.google\.com\/spreadsheets\/[^\s<>)]*>?(?:\s+"[^"\n]*")?\s*\)/gi;
const RE_SO_PLANILHA = /^https?:\/\/docs\.google\.com\/spreadsheets\/\S*$/i;

/** O texto do link fica, com a nota no lugar do endereço; sem texto (ou com a própria URL), só a nota. */
function semLinkDePlanilha(rotulo: string): string {
  const texto = rotulo.trim();
  return !texto || RE_SO_PLANILHA.test(texto) ? TEXTO_PLANILHA : `${texto} (planilha interna, link omitido)`;
}

export function semPlanilhasGoogle(texto: string): string {
  return texto
    .replace(RE_LINK_PLANILHA, (_link, rotulo: string) => semLinkDePlanilha(rotulo))
    .replace(RE_PLANILHA_GOOGLE, TEXTO_PLANILHA);
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

/** URL `http(s)` contínua num texto (para achar as pré-assinadas). */
const RE_URL = /https?:\/\/[^\s"'<>)\]]+/gi;

export type ContagemUrls = { planilhas: number; sessoesSei: number; assinadas: number };

/**
 * URLs internas de um texto que vai para a base pública: tira os parâmetros de sessão do SEI
 * (`semSessaoSei`), os links de planilha do Google (`semPlanilhasGoogle`) e a query das URLs
 * pré-assinadas (`semAssinatura`). A contagem diz quantas de cada havia, nunca o valor.
 */
export function limparUrlsInternas(texto: string): { texto: string; contagem: ContagemUrls } {
  const contagem: ContagemUrls = { planilhas: 0, sessoesSei: 0, assinadas: 0 };
  contagem.sessoesSei = texto.match(new RegExp(RE_URL_SESSAO_SEI.source, "gi"))?.length ?? 0;
  const limpo = semSessaoSei(texto)
    .replace(RE_LINK_PLANILHA, (_link, rotulo: string) => {
      contagem.planilhas += 1;
      return semLinkDePlanilha(rotulo);
    })
    .replace(RE_PLANILHA_GOOGLE, () => {
      contagem.planilhas += 1;
      return TEXTO_PLANILHA;
    })
    .replace(RE_URL, (url) => {
      if (!ehUrlAssinada(url)) return url;
      contagem.assinadas += 1;
      return semAssinatura(url);
    });
  return { texto: limpo, contagem };
}
