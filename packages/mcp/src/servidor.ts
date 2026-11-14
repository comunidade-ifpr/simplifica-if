/**
 * Servidor MCP `ifpr`: registra as ferramentas de `FERRAMENTAS` sobre um `kb.sqlite` aberto só
 * para leitura. Cada chamada devolve `structuredContent` (a `Resposta`, validada pelo
 * `outputSchema`) e `content` (o texto Markdown para a IA).
 *
 * O SDK 2.x recebe os schemas do zod 4 como Standard Schema em `registerTool`, converte-os para JSON
 * Schema (2020-12) na listagem pelo próprio zod e valida entrada e saída; entrada inválida volta como
 * resultado `isError` com o caminho do campo.
 */
import { realpathSync, statSync } from "node:fs";
import * as Layers from "@simplifica-if/kb/layers";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { McpServer } from "@modelcontextprotocol/server";
import { type StdioServerHandle, serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { abrirBanco } from "./banco.ts";
import { type Canal, montarBase } from "./envelope.ts";
import { type Contexto, FERRAMENTAS, type Ferramenta, type Kb } from "./ferramentas/index.ts";
// Gerado de `instrucoes.md` (pnpm mcp:instrucoes): o texto vai embutido no bundle e no executável.
import { INSTRUCOES } from "./instrucoes.gerado.ts";

/** Nome do servidor; nos clientes, as ferramentas aparecem como `mcp__ifpr__<ferramenta>`. */
export const NOME_SERVIDOR = "ifpr";
/** Mesma versão do package.json (conferida nos testes). */
export const VERSAO_PACOTE = "0.1.0";
export { INSTRUCOES };

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

/**
 * Ponte temporária do C1 para os serviços do kb (sai no C2, quando as ferramentas viram um Toolkit
 * Effect): as layers de `layerSomenteLeitura` são montadas uma vez, num escopo que dura o processo, e
 * cada chamada roda com `Effect.runSync`. As ferramentas ainda são síncronas, e as consultas do kb
 * sobre o `node:sqlite` também: nada no caminho é assíncrono.
 */
export function abrirKb(caminho: string): { kb: Kb; fechar: () => void } {
  const escopo = Effect.runSync(Scope.make());
  const contexto = Effect.runSync(Layer.buildWithScope(Layers.layerSomenteLeitura({ caminho }), escopo));
  return {
    kb: (efeito) => Effect.runSync(Effect.provide(efeito, contexto)),
    fechar: () => Effect.runSync(Scope.close(escopo, Exit.void)),
  };
}

export function criarContexto(opcoes: OpcoesServidor): Contexto {
  const pastaTrabalho = pastaReal(opcoes.pastaTrabalho);
  const { db, meta } = abrirBanco(opcoes.banco);
  const { kb } = abrirKb(opcoes.banco);
  return { db, meta, base: montarBase(meta, opcoes.canal), pastaTrabalho, kb };
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

/**
 * Abre o banco e serve o MCP pelo stdin/stdout do processo. `serveStdio` decide a era na primeira
 * mensagem: `initialize` (clientes da revisão 2025-11-25 e anteriores) ou `server/discover` e
 * requisições com envelope `_meta` (revisão 2026-07-28); a fábrica cria o servidor da conexão.
 */
export async function iniciarStdio(opcoes: OpcoesServidor): Promise<{ conexao: StdioServerHandle; ctx: Contexto }> {
  const ctx = criarContexto(opcoes);
  const conexao = serveStdio(() => criarServidor(ctx));
  return { conexao, ctx };
}
