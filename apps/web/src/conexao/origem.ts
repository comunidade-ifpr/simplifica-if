/**
 * De onde a interface tira as credenciais do servidor local (`apps/server`):
 *
 * 1. **Desktop:** `window.simplifica.conexao()`, do `preload` (`ponte-desktop.ts`). Chamada a cada
 *    conexão, para que o desktop possa trocar o servidor (um reinício) sem recarregar a interface.
 * 2. **Navegador, em desenvolvimento:** `?servidor=…&token=…` na URL da página. As credenciais vão para
 *    o `sessionStorage` e saem da barra de endereço (e do histórico), para que o token não fique à vista
 *    nem se perca ao navegar entre as telas ou recarregar.
 * 3. **Navegador, em desenvolvimento:** `VITE_SIMPLIFICA_SERVIDOR` e `VITE_SIMPLIFICA_TOKEN`.
 *
 * Sem nada disso, a interface mostra como iniciar o servidor (`sem-servidor`).
 */
import type { CredenciaisServidor, PonteDesktop } from "../ponte-desktop.ts";

export type OrigemConexao =
  | { readonly tipo: "desktop"; readonly ponte: PonteDesktop }
  | { readonly tipo: "navegador"; readonly fonte: "url" | "ambiente"; readonly credenciais: CredenciaisServidor }
  | { readonly tipo: "ausente" };

/** O parâmetro da URL da página com o endereço do servidor (`http://127.0.0.1:<porta>` ou só a porta). */
export const PARAMETRO_SERVIDOR = "servidor";
/** O parâmetro da URL da página com o token do servidor. */
export const PARAMETRO_TOKEN = "token";
/** A chave do `sessionStorage` com as credenciais vindas da URL. */
export const CHAVE_SESSAO = "simplifica-if:credenciais";

/**
 * Normaliza o endereço do servidor: só a porta vira `http://127.0.0.1:<porta>`; sem esquema, `http://`;
 * sem barra final. Devolve `undefined` se não for uma URL HTTP.
 */
export function normalizarUrlServidor(valor: string): string | undefined {
  const texto = valor.trim();
  if (texto.length === 0) return undefined;
  const comEsquema = /^\d+$/.test(texto)
    ? `http://127.0.0.1:${texto}`
    : /^[a-z][a-z0-9+.-]*:\/\//i.test(texto)
      ? texto
      : `http://${texto}`;
  let url: URL;
  try {
    url = new URL(comEsquema);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  return url.origin;
}

function credenciais(servidor: string | null | undefined, token: string | null | undefined) {
  if (servidor === null || servidor === undefined || token === null || token === undefined) return undefined;
  const urlServidor = normalizarUrlServidor(servidor);
  const tokenLimpo = token.trim();
  return urlServidor === undefined || tokenLimpo.length === 0 ? undefined : { urlServidor, token: tokenLimpo };
}

/** O que `resolverOrigem` lê do ambiente; separado para os testes. */
export interface EntradaOrigem {
  readonly ponte: PonteDesktop | undefined;
  /** O `location.search` da página. */
  readonly busca: string;
  /** As credenciais guardadas no `sessionStorage` (JSON), se houver. */
  readonly sessao: string | null;
  readonly ambiente: { readonly servidor?: string | undefined; readonly token?: string | undefined };
}

export interface OrigemResolvida {
  readonly origem: OrigemConexao;
  /** Credenciais a guardar no `sessionStorage` (vieram da URL). */
  readonly guardar?: CredenciaisServidor;
  /** A busca da página sem os parâmetros de credencial, quando eles estavam lá. */
  readonly buscaLimpa?: string;
}

/** Decide a origem da conexão, pela ordem do comentário do módulo. Função pura. */
export function resolverOrigem(entrada: EntradaOrigem): OrigemResolvida {
  if (entrada.ponte !== undefined) return { origem: { tipo: "desktop", ponte: entrada.ponte } };

  const parametros = new URLSearchParams(entrada.busca);
  const daUrl = credenciais(parametros.get(PARAMETRO_SERVIDOR), parametros.get(PARAMETRO_TOKEN));
  let limpeza: { buscaLimpa?: string } = {};
  if (parametros.has(PARAMETRO_SERVIDOR) || parametros.has(PARAMETRO_TOKEN)) {
    parametros.delete(PARAMETRO_SERVIDOR);
    parametros.delete(PARAMETRO_TOKEN);
    const resto = parametros.toString();
    limpeza = { buscaLimpa: resto.length > 0 ? `?${resto}` : "" };
  }
  if (daUrl !== undefined) {
    return { origem: { tipo: "navegador", fonte: "url", credenciais: daUrl }, guardar: daUrl, ...limpeza };
  }

  const daSessao = lerSessao(entrada.sessao);
  if (daSessao !== undefined) return { origem: { tipo: "navegador", fonte: "url", credenciais: daSessao }, ...limpeza };

  const doAmbiente = credenciais(entrada.ambiente.servidor, entrada.ambiente.token);
  if (doAmbiente !== undefined) {
    return { origem: { tipo: "navegador", fonte: "ambiente", credenciais: doAmbiente }, ...limpeza };
  }
  return { origem: { tipo: "ausente" }, ...limpeza };
}

function lerSessao(texto: string | null): CredenciaisServidor | undefined {
  if (texto === null) return undefined;
  try {
    const valor: unknown = JSON.parse(texto);
    if (typeof valor !== "object" || valor === null) return undefined;
    const registro = valor as Record<string, unknown>;
    return typeof registro.urlServidor === "string" && typeof registro.token === "string"
      ? credenciais(registro.urlServidor, registro.token)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A origem da página atual: lê a ponte, a URL, o `sessionStorage` e o ambiente do Vite, guarda as
 * credenciais da URL e as tira da barra de endereço.
 */
export function origemDaPagina(): OrigemConexao {
  let sessao: string | null = null;
  try {
    sessao = window.sessionStorage.getItem(CHAVE_SESSAO);
  } catch {
    // Sem armazenamento (modo privado restrito): as credenciais valem só até recarregar.
  }
  const resolvida = resolverOrigem({
    ponte: window.simplifica,
    busca: window.location.search,
    sessao,
    ambiente: {
      servidor: import.meta.env.VITE_SIMPLIFICA_SERVIDOR,
      token: import.meta.env.VITE_SIMPLIFICA_TOKEN,
    },
  });
  if (resolvida.guardar !== undefined) {
    try {
      window.sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(resolvida.guardar));
    } catch {
      // Idem.
    }
  }
  if (resolvida.buscaLimpa !== undefined) {
    const { pathname, hash } = window.location;
    window.history.replaceState(window.history.state, "", `${pathname}${resolvida.buscaLimpa}${hash}`);
  }
  return resolvida.origem;
}
