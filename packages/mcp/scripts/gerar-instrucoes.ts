#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- gerador de código fora do runtime Effect: lê o Markdown, grava o módulo e escreve o resultado no terminal
/**
 * Gera `src/instrucoes.gerado.ts` a partir de `instrucoes.md`: o texto das instruções do servidor
 * vira uma constante, embutida no bundle e no executável sem import de texto (que cada ferramenta
 * trata de um jeito: Node, vitest, tsdown e o bundler do fork).
 *
 *   pnpm mcp:instrucoes            # regrava o módulo
 *   pnpm mcp:instrucoes --check    # só confere (falha se o módulo estiver desatualizado)
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const PACOTE = NodePath.resolve(import.meta.dirname, "..");
export const ORIGEM = NodePath.join(PACOTE, "instrucoes.md");
export const DESTINO = NodePath.join(PACOTE, "src", "instrucoes.gerado.ts");

/** Conteúdo do módulo gerado para o texto de `instrucoes.md`. */
export function moduloInstrucoes(texto: string): string {
  return `/**
 * Instruções do servidor MCP, geradas de \`packages/mcp/instrucoes.md\` por
 * \`packages/mcp/scripts/gerar-instrucoes.ts\`. Não edite à mão: edite o Markdown e rode
 * \`pnpm mcp:instrucoes\`.
 */
export const INSTRUCOES = ${JSON.stringify(texto)};
`;
}

/** Se o módulo gerado corresponde ao Markdown atual. */
export function instrucoesAtualizadas(): boolean {
  return NodeFS.readFileSync(DESTINO, "utf-8") === moduloInstrucoes(NodeFS.readFileSync(ORIGEM, "utf-8"));
}

if (import.meta.main) {
  const relativo = NodePath.relative(process.cwd(), DESTINO);
  if (process.argv.includes("--check")) {
    if (!instrucoesAtualizadas()) {
      console.error(`ERRO: ${relativo} está desatualizado; rode pnpm mcp:instrucoes`);
      process.exitCode = 1;
    } else {
      console.log(`OK: ${relativo}`);
    }
  } else {
    NodeFS.writeFileSync(DESTINO, moduloInstrucoes(NodeFS.readFileSync(ORIGEM, "utf-8")));
    console.log(`gerado: ${relativo}`);
  }
}
