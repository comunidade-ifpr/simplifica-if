/**
 * Servidor MCP `ifpr` sobre um `kb.sqlite` só de leitura: as ferramentas de `FerramentasIfpr`,
 * registradas por `registrarFerramentas` num `McpServer` do `effect/ai`, em stdio
 * (`layerStdio`). Cada chamada devolve `structuredContent` (a `Resposta`, conferida pelo
 * `outputSchema`) e `content` (o texto Markdown para a IA).
 */
import * as BaseKb from "@simplifica-if/kb/BaseKb";
import { VERSAO_ESQUEMA } from "@simplifica-if/kb/db/esquema";
import * as Layers from "@simplifica-if/kb/layers";
import * as Layer from "effect/Layer";
import { McpProtocol, McpServer } from "effect/ai";
import type { Canal } from "@simplifica-if/kb/canal";
import { registrarFerramentas } from "./ferramentas/registrar.ts";
import { layerHandlers } from "./ferramentas/toolkit.ts";
// Gerado de `instrucoes.md` (pnpm mcp:instrucoes): o texto vai embutido no bundle e no executável.
import { INSTRUCOES } from "./instrucoes.gerado.ts";
import * as Leitura from "./leitura/Leitura.ts";
import * as PastaTrabalho from "./leitura/PastaTrabalho.ts";
import { layerRecursos } from "./recursos/recursos.ts";

/** Nome do servidor; nos clientes, as ferramentas aparecem como `mcp__ifpr__<ferramenta>`. */
export const NOME_SERVIDOR = "ifpr";
/** Mesma versão do package.json (conferida nos testes). */
export const VERSAO_PACOTE = "0.1.0";
export { INSTRUCOES };

/**
 * Revisões do protocolo MCP, as mesmas no stdio e no HTTP: a `2026-07-28` (sem sessão, `server/discover`),
 * que o Claude Code e o `agy` usam, e a `2025-11-25`, a única com `initialize`, para o Codex, que ainda
 * pede `2025-06-18` no `initialize` sem a opção `mcp_2026_07_28` e aceita a `2025-11-25` em resposta.
 */
export const PROTOCOLOS = [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25] as const;

export const MENSAGEM_INCOMPATIVEL = "base incompatível com esta versão do simplifica-mcp; atualize";

/**
 * O registro das ferramentas, com os handlers sobre o `Leitura` do ambiente, e dos recursos `ifpr://`
 * (`recursos/recursos.ts`), sobre o mesmo `Leitura`.
 */
export const layerRegistro = Layer.mergeAll(
  Layer.effectDiscard(registrarFerramentas).pipe(Layer.provide(layerHandlers)),
  layerRecursos,
);

/**
 * O `Leitura` sobre o `kb.sqlite` em `banco`, só leitura, sem o repositório. Com `etapaRegistrada`
 * (o app), a ferramenta `etapa` responde que registrou a etapa.
 */
export const layerLeitura = (opcoes: {
  readonly banco: string;
  readonly canal: Canal;
  readonly etapaRegistrada?: boolean;
}) =>
  Leitura.layer({
    canal: opcoes.canal,
    ...(opcoes.etapaRegistrada === undefined ? {} : { etapaRegistrada: opcoes.etapaRegistrada }),
  }).pipe(Layer.provideMerge(Layers.layerSomenteLeitura({ caminho: opcoes.banco })));

/**
 * O `Leitura` com a pasta de trabalho de onde o `pacote_contexto` lê um `.md` (`arquivo`). Pede
 * `FileSystem` e `Path` ao ambiente; o `layerLeitura`, sem pasta, não lê arquivo nenhum.
 */
export const layerLeituraComPasta = (opcoes: {
  readonly banco: string;
  readonly canal: Canal;
  readonly pastaTrabalho: string;
}) => layerLeitura(opcoes).pipe(Layer.provide(PastaTrabalho.layer({ pasta: opcoes.pastaTrabalho })));

/** O servidor MCP `ifpr` em stdio, sobre o `kb.sqlite` em `banco`, lendo arquivos só de `pastaTrabalho`. */
export const layerStdio = (opcoes: { readonly banco: string; readonly canal: Canal; readonly pastaTrabalho: string }) =>
  McpServer.layerStdio({
    name: NOME_SERVIDOR,
    version: VERSAO_PACOTE,
    instructions: INSTRUCOES,
    protocols: PROTOCOLOS,
    registrations: layerRegistro,
  }).pipe(Layer.provideMerge(layerLeituraComPasta(opcoes)));

/**
 * A mensagem dos erros de abertura do banco para quem instala o servidor: o kb fala "desta versão do
 * kb", e quem usa o simplifica-mcp precisa saber que é o servidor que está desatualizado.
 */
export function mensagemDeAbertura(erro: BaseKb.BaseIncompativel | BaseKb.BaseAusente): string {
  switch (erro._tag) {
    case "BaseAusente":
      return `kb.sqlite não encontrado ou ilegível: ${erro.caminho}`;
    case "BaseIncompativel":
      if (erro.motivo === "esquema") {
        return `${MENSAGEM_INCOMPATIVEL} (esquema da base: ${erro.encontrado ?? "ausente"}; esperado: ${VERSAO_ESQUEMA})`;
      }
      return `${MENSAGEM_INCOMPATIVEL} (${erro.problema ? `tabela meta: ${erro.problema}` : "o arquivo não é um kb.sqlite"})`;
  }
}
