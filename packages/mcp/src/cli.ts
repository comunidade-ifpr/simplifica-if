#!/usr/bin/env node
/**
 * CLI `simplifica-mcp`: inicia o servidor MCP só de leitura, em stdio, sobre um `kb.sqlite`.
 *
 *   node packages/mcp/src/cli.ts --banco tmp/kb.sqlite
 *   SIMPLIFICA_KB=~/SimplificaIF/kb.sqlite simplifica-mcp --canal beta
 *
 * O stdout é do protocolo MCP; as mensagens vão para o stderr. Um `~/` no início dos caminhos é
 * expandido aqui, porque nem todo cliente MCP passa os argumentos por um shell.
 */
import os from "node:os";
import path from "node:path";
import { Command, Option } from "commander";
import { CANAIS, type Canal } from "./envelope.ts";
import { iniciarStdio, VERSAO_PACOTE } from "./servidor.ts";

function expandirCaminho(caminho: string): string {
  if (caminho === "~") return os.homedir();
  if (caminho.startsWith("~/")) return path.join(os.homedir(), caminho.slice(2));
  return path.resolve(caminho);
}

interface Opcoes {
  banco: string;
  pastaTrabalho: string;
  canal: Canal;
}

const programa = new Command()
  .name("simplifica-mcp")
  .description("Servidor MCP só de leitura sobre o kb.sqlite da base de conhecimento do IFPR (transporte stdio).")
  .version(VERSAO_PACOTE)
  .addOption(new Option("--banco <caminho>", "caminho do kb.sqlite").env("SIMPLIFICA_KB").makeOptionMandatory())
  .addOption(
    new Option("--pasta-trabalho <dir>", "única pasta de onde o servidor lê arquivos").default(
      process.cwd(),
      "o diretório atual",
    ),
  )
  .addOption(
    new Option("--canal <canal>", "canal da base, quando o banco não o registra").choices(CANAIS).default("dev"),
  )
  .showHelpAfterError()
  .action(async (opcoes: Opcoes) => {
    try {
      const { ctx } = await iniciarStdio({
        banco: expandirCaminho(opcoes.banco),
        pastaTrabalho: expandirCaminho(opcoes.pastaTrabalho),
        canal: opcoes.canal,
      });
      process.stderr.write(
        `simplifica-mcp ${VERSAO_PACOTE}: base ${ctx.base.versao} (referência ${ctx.base.data_referencia}, canal ${ctx.base.canal})\n`,
      );
    } catch (erro) {
      process.stderr.write(`simplifica-mcp: ${erro instanceof Error ? erro.message : String(erro)}\n`);
      process.exit(1);
    }
  });

await programa.parseAsync();
