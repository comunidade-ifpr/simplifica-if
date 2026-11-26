// @effect-diagnostics nodeBuiltinImport:off -- processo principal do Electron, sem runtime Effect (ver README)
/**
 * As regras de segurança da janela, sem o Electron (os testes as conferem com o Node): a CSP da
 * interface, a navegação permitida, os links externos e os arquivos servidos pelo protocolo próprio. As
 * do módulo da revisão de PPC (o `.docx` escolhido e a cópia comentada) ficam com ele, em
 * `modulos/revisao-ppc/seguranca.ts`.
 * Os trechos marcados `// T3:` vêm de `apps/desktop/src/window/DesktopWindow.ts`,
 * `electron/ElectronShell.ts` e `electron/ElectronProtocol.ts` do T3 Code (MIT, ver
 * `docs/upstream-t3.md`).
 */
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";
import { EXTENSOES_DOCUMENTO, ehPastaDoApp } from "@simplifica-if/contratos-app/ponte";

/**
 * A CSP da interface empacotada. Mais estreita que a do T3 (que aceita qualquer `http:`/`ws:`, por
 * causa dos ambientes remotos e do Clerk): a interface só fala com o servidor local, na porta desta
 * execução, e não roda `eval` nem script inline, salvo os do `index.html` do build, pelo hash
 * (`hashesScriptsInline`; o do tema, que roda antes do React).
 */
export function politicaConteudo(portaServidor: number | undefined, hashesScripts: ReadonlyArray<string> = []): string {
  const servidor =
    portaServidor === undefined ? [] : [`http://127.0.0.1:${portaServidor}`, `ws://127.0.0.1:${portaServidor}`];
  return [
    "default-src 'self'",
    ["script-src 'self'", ...hashesScripts].join(" "),
    ["connect-src 'self'", ...servidor].join(" "),
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

/** As fontes `'sha256-…'` dos `<script>` inline (sem `src`) de um HTML, para a CSP. */
export function hashesScriptsInline(html: string): Array<string> {
  const hashes: Array<string> = [];
  for (const [, atributos, corpo] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(atributos ?? "") || (corpo ?? "").trim() === "") continue;
    hashes.push(
      `'sha256-${NodeCrypto.createHash("sha256")
        .update(corpo ?? "", "utf8")
        .digest("base64")}'`,
    );
  }
  return hashes;
}

// T3: apps/desktop/src/window/DesktopWindow.ts (isSameOriginRendererNavigation)
export function isSameOriginRendererNavigation(input: {
  readonly applicationUrl: string;
  readonly navigationUrl: string;
}): boolean {
  try {
    const applicationUrl = new URL(input.applicationUrl);
    const navigationUrl = new URL(input.navigationUrl);
    // Node serializes custom-scheme origins as "null", even for different hosts and schemes.
    return (
      applicationUrl.host !== "" &&
      navigationUrl.protocol === applicationUrl.protocol &&
      navigationUrl.host === applicationUrl.host
    );
  } catch {
    return false;
  }
}

// T3: apps/desktop/src/electron/ElectronShell.ts (SAFE_WEB_PROTOCOLS e parseSafeExternalUrl, só http e
// https). Aqui entra também o `mailto:`, para o contato da Ajuda: abre um rascunho, que a pessoa envia.
const SAFE_WEB_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** A URL normalizada, se for um link que o sistema pode abrir: http e https no navegador, `mailto:` no e-mail. */
export function urlExternaSegura(rawUrl: unknown): string | undefined {
  if (typeof rawUrl !== "string") return undefined;
  try {
    const url = new URL(rawUrl);
    return SAFE_WEB_PROTOCOLS.has(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Tipos dos arquivos do build da interface. */
const TIPOS: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

export function tipoConteudo(arquivo: string): string {
  return TIPOS[NodePath.extname(arquivo).toLowerCase()] ?? "application/octet-stream";
}

export type ArquivoPedido =
  | { readonly tipo: "arquivo"; readonly caminho: string }
  | { readonly tipo: "erro"; readonly status: 400 | 404 | 405 };

/**
 * O arquivo da interface para um pedido ao protocolo próprio. Fora da pasta, 404; rota da interface
 * (sem extensão, ou pedindo HTML), o `index.html`, como num servidor de SPA.
 */
// T3: apps/desktop/src/electron/ElectronProtocol.ts (serveDesktopAsset), sem Effect
export function resolverArquivo(input: {
  readonly url: string;
  readonly method: string;
  readonly accept: string | null;
  readonly host: string;
  readonly assetDirectory: string;
  readonly isFile: (path: string) => boolean;
}): ArquivoPedido {
  const url = new URL(input.url);
  if (url.host !== input.host) return { tipo: "erro", status: 404 };
  if (input.method !== "GET" && input.method !== "HEAD") return { tipo: "erro", status: 405 };
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return { tipo: "erro", status: 400 };
  }
  if (pathname.includes("\0")) return { tipo: "erro", status: 400 };
  const root = NodePath.resolve(input.assetDirectory);
  const assetPath = NodePath.resolve(root, `.${pathname}`);
  if (assetPath !== root && !assetPath.startsWith(root + NodePath.sep)) {
    return { tipo: "erro", status: 404 };
  }
  if (input.isFile(assetPath)) return { tipo: "arquivo", caminho: assetPath };
  const wantsHtml = input.accept?.includes("text/html") ?? false;
  if (NodePath.extname(assetPath) !== "" && !wantsHtml) {
    // O build usa caminhos relativos (`base: "./"`): recarregada numa rota funda, a página pede
    // `/rota/assets/x.js`. Vale o sufixo mais longo que existe na pasta (`/assets/x.js`).
    const partes = NodePath.relative(root, assetPath).split(NodePath.sep);
    for (let inicio = 1; inicio < partes.length; inicio++) {
      const candidato = NodePath.join(root, ...partes.slice(inicio));
      if (input.isFile(candidato)) return { tipo: "arquivo", caminho: candidato };
    }
    return { tipo: "erro", status: 404 };
  }
  return { tipo: "arquivo", caminho: NodePath.join(root, "index.html") };
}

const ehDocumento = (caminho: string) =>
  (EXTENSOES_DOCUMENTO as ReadonlyArray<string>).includes(NodePath.extname(caminho).toLowerCase());

/** As extensões pedidas pela interface para o diálogo, só as de `EXTENSOES_DOCUMENTO` (todas, sem pedido). */
export function extensoesAnexo(pedidas: unknown): ReadonlyArray<string> {
  if (!Array.isArray(pedidas) || pedidas.length === 0) return EXTENSOES_DOCUMENTO;
  const validas = pedidas.filter(
    (extensao): extensao is string =>
      typeof extensao === "string" && (EXTENSOES_DOCUMENTO as ReadonlyArray<string>).includes(extensao.toLowerCase()),
  );
  return validas.length === 0 ? EXTENSOES_DOCUMENTO : validas.map((extensao) => extensao.toLowerCase());
}

/** Um arquivo escolhido no diálogo de anexo, se a extensão é uma das aceitas; `undefined` para outro. */
export function anexoEscolhido(caminho: unknown, aceitas: ReadonlyArray<string>): string | undefined {
  if (typeof caminho !== "string" || !NodePath.isAbsolute(caminho)) return undefined;
  return aceitas.includes(NodePath.extname(caminho).toLowerCase()) ? NodePath.normalize(caminho) : undefined;
}

/**
 * Um arquivo de uma pasta de tarefa (`<raiz>/<tarefa>/…`, a raiz sendo `Documentos/Simplifica IF`),
 * pelo caminho que a interface mandou: absoluto, normalizado, pelo menos dois níveis abaixo da raiz, sem
 * parte oculta (`.simplifica/`). Com `abrir`, só as extensões de `EXTENSOES_DOCUMENTO`. Quem chama
 * confere ainda o caminho real (sem link que saia da raiz) e que é arquivo comum.
 */
export function arquivoDeTarefaPermitido(caminho: unknown, raiz: string, abrir: boolean): string | undefined {
  if (typeof caminho !== "string" || !NodePath.isAbsolute(caminho)) return undefined;
  if (NodePath.normalize(caminho) !== caminho) return undefined;
  // `:` só na unidade do Windows (`C:\`); fora dela, é fluxo alternativo do NTFS (`arquivo.md:oculto`).
  const semUnidade = /^[A-Za-z]:[\\/]/.test(caminho) ? caminho.slice(2) : caminho;
  if (semUnidade.includes(":")) return undefined;
  const relativo = NodePath.relative(raiz, caminho);
  if (relativo === "" || relativo.startsWith("..") || NodePath.isAbsolute(relativo)) return undefined;
  const partes = relativo.split(NodePath.sep);
  if (partes.length < 2 || partes.some((parte) => parte === "" || parte.startsWith("."))) return undefined;
  if (abrir && !ehDocumento(caminho)) return undefined;
  return caminho;
}

/**
 * A pasta de uma tarefa para mandar à Lixeira, pelo caminho que a interface mandou: absoluto,
 * normalizado, filha direta da raiz, sem nome oculto e fora das pastas do app (relatos, diagnósticos).
 * Quem chama aplica a regra de novo ao caminho real contra a raiz real (um nome curto 8.3 do Windows ou
 * um link na raiz não escapam) e confere que é pasta, não link.
 */
export function pastaDeTarefaPermitida(caminho: unknown, raiz: string): string | undefined {
  if (typeof caminho !== "string" || !NodePath.isAbsolute(caminho)) return undefined;
  if (NodePath.normalize(caminho) !== caminho) return undefined;
  const semUnidade = /^[A-Za-z]:[\\/]/.test(caminho) ? caminho.slice(2) : caminho;
  if (semUnidade.includes(":")) return undefined;
  const relativo = NodePath.relative(raiz, caminho);
  if (relativo === "" || relativo.startsWith("..") || NodePath.isAbsolute(relativo)) return undefined;
  if (relativo.includes(NodePath.sep) || relativo.startsWith(".")) return undefined;
  if (ehPastaDoApp(relativo)) return undefined;
  return caminho;
}
