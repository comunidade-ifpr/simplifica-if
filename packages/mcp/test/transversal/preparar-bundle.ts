// @effect-diagnostics nodeBuiltinImport:off -- globalSetup do Vitest: compila o bundle do MCP uma vez por rodada
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { conferirBundle } from "../../scripts/construir-executavel.ts";

/**
 * Gancho de pré-carga do servidor isolado em Node (`servidorIsolado`, em `apoio.ts`). O `realpath` em
 * JavaScript do Node (que o `FileSystem` do Effect usa fora do Windows) faz `lstat` de cada diretório
 * acima do caminho, e o modelo de permissões trata isso como leitura fora da pasta; a versão nativa
 * resolve o mesmo caminho sem tocar nos ancestrais. O gancho só troca uma pela outra.
 */
const GANCHO = `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
fs.realpath = fs.realpath.native;
fs.promises.realpath = async (caminho, opcoes) => fs.realpathSync.native(caminho, opcoes);
syncBuiltinESMExports();
`;

export default async function prepararBundle(): Promise<() => void> {
  if (process.env.SIMPLIFICA_MCP_EXE || process.env.SIMPLIFICA_MCP_BUNDLE) {
    return () => {};
  }
  const pasta = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "simplifica-mcp-bundle-")));
  const gerado = await conferirBundle();
  const bundle = NodePath.join(pasta, NodePath.basename(gerado));
  NodeFS.copyFileSync(gerado, bundle);
  NodeFS.rmSync(NodePath.dirname(gerado), { recursive: true, force: true });
  NodeFS.writeFileSync(NodePath.join(pasta, "realpath-nativo.mjs"), GANCHO);
  process.env.SIMPLIFICA_MCP_BUNDLE = bundle;
  return () => {
    NodeFS.rmSync(pasta, { recursive: true, force: true });
  };
}
