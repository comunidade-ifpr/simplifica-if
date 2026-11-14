/**
 * Servidor MCP `ifpr`: registra as ferramentas de `FERRAMENTAS` sobre um `kb.sqlite` aberto só
 * para leitura. Cada chamada devolve `structuredContent` (a `Resposta`, validada pelo
 * `outputSchema`) e `content` (o texto Markdown para a IA).
 *
 * O SDK 1.32 aceita schemas do zod 4 em `registerTool`, converte-os para JSON Schema na listagem e
 * valida entrada e saída; entrada inválida volta como resultado `isError` com o caminho do campo.
 */
import { realpathSync, statSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
// Import de texto: o conteúdo vai embutido no bundle, e o binário compilado não precisa do arquivo.
import instrucoes from "../instrucoes.md" with { type: "text" };
import { abrirBanco } from "./banco.ts";
import { type Canal, montarBase } from "./envelope.ts";
import { type Contexto, FERRAMENTAS, type Ferramenta } from "./ferramentas/index.ts";

/** Nome do servidor; nos clientes, as ferramentas aparecem como `mcp__ifpr__<ferramenta>`. */
export const NOME_SERVIDOR = "ifpr";
/** Mesma versão do package.json (conferida nos testes). */
export const VERSAO_PACOTE = "0.1.0";
export const INSTRUCOES: string = instrucoes;

export interface OpcoesServidor {
  /** Caminho absoluto do kb.sqlite. */
  banco: string;
  /** Caminho absoluto da pasta de trabalho. */
  pastaTrabalho: string;
  canal: Canal;
}

function pastaReal(dir: string): string {
  try {
    if (statSync(dir).isDirectory()) return realpathSync(dir);
  } catch {
    // tratado abaixo
  }
  throw new Error(`pasta de trabalho não encontrada: ${dir}`);
}

export function criarContexto(opcoes: OpcoesServidor): Contexto {
  const pastaTrabalho = pastaReal(opcoes.pastaTrabalho);
  const { db, meta } = abrirBanco(opcoes.banco);
  return { db, meta, base: montarBase(meta, opcoes.canal), pastaTrabalho };
}

export function criarServidor(ctx: Contexto, ferramentas: readonly Ferramenta[] = FERRAMENTAS): McpServer {
  // Mensagens de validação do zod (entrada inválida) em português, para a IA corrigir a chamada.
  z.config(z.locales.ptBR());
  const servidor = new McpServer(
    { name: NOME_SERVIDOR, title: "Base de conhecimento do IFPR", version: VERSAO_PACOTE },
    { instructions: INSTRUCOES },
  );
  for (const ferramenta of ferramentas) {
    servidor.registerTool(
      ferramenta.nome,
      {
        title: ferramenta.titulo,
        description: ferramenta.descricao,
        inputSchema: ferramenta.entrada,
        outputSchema: ferramenta.saida,
        annotations: ferramenta.anotacoes,
      },
      (args) => {
        const { resposta, texto } = ferramenta.responder(args, ctx);
        return { structuredContent: resposta, content: [{ type: "text", text: texto }] };
      },
    );
  }
  return servidor;
}

/** Abre o banco, cria o servidor e o conecta ao stdin/stdout do processo. */
export async function iniciarStdio(opcoes: OpcoesServidor): Promise<{ servidor: McpServer; ctx: Contexto }> {
  const ctx = criarContexto(opcoes);
  const servidor = criarServidor(ctx);
  await servidor.connect(new StdioServerTransport());
  return { servidor, ctx };
}
