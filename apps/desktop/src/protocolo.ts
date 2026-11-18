// @effect-diagnostics nodeBuiltinImport:off -- processo principal do Electron, sem runtime Effect (ver README)
/**
 * O protocolo `simplifica://app/`, que serve o build da interface no app empacotado, com a CSP em cada
 * resposta. As regras (qual arquivo, que tipo, que CSP) ficam em `seguranca.ts`; aqui só o Electron.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { protocol } from "electron";
import { ESQUEMA, HOST_APP } from "./configuracao.ts";
import { hashesScriptsInline, politicaConteudo, resolverArquivo, tipoConteudo } from "./seguranca.ts";

// T3: apps/desktop/src/electron/ElectronProtocol.ts (registerDesktopSchemePrivilegesSync) — antes do `ready`.
export function registrarPrivilegiosEsquema(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ESQUEMA,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        codeCache: true,
      },
    },
  ]);
}

/** Serve o build da interface em `simplifica://app/`, com a CSP. */
export function registrarProtocolo(
  pasta: string,
  opcoes: {
    /** A porta do servidor em execução, para o `connect-src` da CSP. */
    readonly portaAtual: () => number | undefined;
    readonly registrar: (mensagem: string) => void;
  },
): void {
  // O build não muda enquanto o app roda: os hashes dos scripts inline do index.html, uma vez.
  let hashes: Array<string> = [];
  try {
    hashes = hashesScriptsInline(NodeFS.readFileSync(NodePath.join(pasta, "index.html"), "utf-8"));
  } catch {
    opcoes.registrar(`sem o index.html da interface em ${pasta}`);
  }
  protocol.handle(ESQUEMA, async (pedido) => {
    const arquivo = resolverArquivo({
      url: pedido.url,
      method: pedido.method,
      accept: pedido.headers.get("accept"),
      host: HOST_APP,
      assetDirectory: pasta,
      isFile: (caminho) => {
        try {
          return NodeFS.statSync(caminho).isFile();
        } catch {
          return false;
        }
      },
    });
    if (arquivo.tipo === "erro") return new Response(null, { status: arquivo.status });
    let conteudo: Buffer;
    try {
      conteudo = await NodeFS.promises.readFile(arquivo.caminho);
    } catch {
      return new Response(null, { status: 404 });
    }
    return new Response(pedido.method === "HEAD" ? null : new Uint8Array(conteudo), {
      headers: {
        "content-type": tipoConteudo(arquivo.caminho),
        "content-security-policy": politicaConteudo(opcoes.portaAtual(), hashes),
        "x-content-type-options": "nosniff",
      },
    });
  });
}
