// @effect-diagnostics nodeBuiltinImport:off -- processo principal do Electron, sem runtime Effect (ver README)
/**
 * As regras de segurança da janela, sem o Electron (os testes as conferem com o Node): a CSP da
 * interface, a navegação permitida, os links externos e os arquivos servidos pelo protocolo próprio.
 * Os trechos marcados `// T3:` vêm de `apps/desktop/src/window/DesktopWindow.ts`,
 * `electron/ElectronShell.ts` e `electron/ElectronProtocol.ts` do T3 Code (MIT, ver
 * `docs/upstream-t3.md`).
 */
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";

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

// T3: apps/desktop/src/electron/ElectronShell.ts (SAFE_WEB_PROTOCOLS e parseSafeExternalUrl, só http e https)
const SAFE_WEB_PROTOCOLS = new Set(["http:", "https:"]);

/** A URL normalizada, se for um link que pode abrir no navegador do sistema (só http e https). */
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

/** `SUFIXO_REVISAO_PREVIA` do `@simplifica-if/contratos-app` (o teste confere que são iguais). */
export const SUFIXO_REVISAO_PREVIA = " - revisão prévia (Simplifica IF)";

/** Um `.docx` escolhido no diálogo do sistema (`escolherDocx`); `undefined` para outro arquivo. */
export function docxEscolhido(caminho: unknown): string | undefined {
  if (typeof caminho !== "string" || !NodePath.isAbsolute(caminho)) return undefined;
  return NodePath.extname(caminho).toLowerCase() === ".docx" ? NodePath.normalize(caminho) : undefined;
}

/**
 * A cópia comentada que o servidor gravou para um dos `.docx` escolhidos no diálogo nesta execução:
 * na mesma pasta, `<nome> - revisão prévia (Simplifica IF).docx` ou com ` (2)` a ` (99)`. Só esses
 * arquivos "Abrir o documento comentado" e "Mostrar na pasta" aceitam: a interface não abre outro
 * arquivo do computador por esse caminho. Quem chama confere ainda que é arquivo comum (não link).
 */
export function copiaComentadaPermitida(caminho: unknown, escolhidos: ReadonlySet<string>): string | undefined {
  if (typeof caminho !== "string" || !NodePath.isAbsolute(caminho)) return undefined;
  if (NodePath.normalize(caminho) !== caminho) return undefined;
  const pasta = NodePath.dirname(caminho);
  const nome = NodePath.basename(caminho);
  for (const escolhido of escolhidos) {
    if (NodePath.dirname(escolhido) !== pasta) continue;
    const prefixo = NodePath.basename(escolhido, NodePath.extname(escolhido)) + SUFIXO_REVISAO_PREVIA;
    if (!nome.startsWith(prefixo) || !nome.toLowerCase().endsWith(".docx")) continue;
    const resto = nome.slice(prefixo.length, -".docx".length);
    if (resto === "" || /^ \(([2-9]|[1-9]\d)\)$/.test(resto)) return caminho;
  }
  return undefined;
}
