#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off -- ponto de entrada: o `~` dos caminhos se expande com o diretório do usuário do sistema
/**
 * CLI `simplifica-mcp`: inicia o servidor MCP só de leitura, em stdio, sobre um `kb.sqlite`.
 *
 *   node packages/mcp/src/cli.ts --banco tmp/kb.sqlite
 *   SIMPLIFICA_KB=~/SimplificaIF/kb.sqlite simplifica-mcp --canal beta
 *   simplifica-mcp --pasta-atualizacao ~/SimplificaIF --feed-atualizacao <url com {canal}> --chave-atualizacao <base64>
 *
 * Com `--pasta-atualizacao`, a base se atualiza pelo feed do canal (`atualizacao.ts`, M1.10).
 *
 * O stdout é do protocolo MCP; as mensagens vão para o stderr. Um `~/` no início dos caminhos é
 * expandido aqui, porque nem todo cliente MCP passa os argumentos por um shell.
 *
 * Erros: pelo ponto de entrada comum (`@simplifica-if/kb/principal`), longe do stdout, que é do
 * protocolo. Um erro tipado vira `simplifica-mcp: <mensagem>` no stderr, com código 1; os
 * erros de abertura do banco usam as mensagens do simplifica-mcp (`mensagemDeAbertura`).
 */
import * as NodeOS from "node:os";
import * as NodeStdio from "@effect/platform-node/NodeStdio";
import * as BaseKb from "@simplifica-if/kb/BaseKb";
import * as Sql from "@simplifica-if/kb/db/sql";
import { executarPrincipal, mensagemDoErro } from "@simplifica-if/kb/principal";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FontesNormativas from "@simplifica-if/kb/FontesNormativas";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { prepararAtualizacao } from "./atualizacao.ts";
import { CANAIS, CANAIS_DISTRIBUICAO } from "@simplifica-if/kb/canal";
import * as Leitura from "./leitura/Leitura.ts";
import * as PastaTrabalho from "./leitura/PastaTrabalho.ts";
import { layerStdio, mensagemDeAbertura, MENSAGEM_INCOMPATIVEL, VERSAO_PACOTE } from "./servidor.ts";

/** Sem `--banco`, sem `SIMPLIFICA_KB` e sem a atualização, que traria o banco. */
class SemBanco extends Schema.TaggedError<SemBanco>()("SemBanco", {}) {
  override get message(): string {
    return "informe o kb.sqlite com --banco <caminho> ou com a variável SIMPLIFICA_KB";
  }
}

function expandirCaminho(path: Path.Path, caminho: string): string {
  if (caminho === "~") return NodeOS.homedir();
  if (caminho.startsWith("~/")) return path.join(NodeOS.homedir(), caminho.slice(2));
  return path.resolve(caminho);
}

const flagBanco = Flag.String("banco").pipe(
  Flag.withDescription("caminho do kb.sqlite (ou a variável SIMPLIFICA_KB)"),
  Flag.withFallbackConfig(Config.String("SIMPLIFICA_KB")),
  Flag.optional,
);

const flagPastaTrabalho = Flag.String("pasta-trabalho").pipe(
  Flag.withDescription("única pasta de onde o servidor lê arquivos (padrão: o diretório atual)"),
  Flag.optional,
);

const flagVigenciaNaReferencia = Flag.Boolean("vigencia-na-referencia").pipe(
  Flag.withDescription(
    "calcula a vigência na data de referência gravada na base, e não no dia (respostas que não mudam com o calendário)",
  ),
  Flag.withDefault(false),
);

/** Sem `--vigencia-na-referencia`, as consultas sem data calculam a vigência no dia. */
const layerVigencia = (naReferencia: boolean) => (naReferencia ? Layer.empty : FontesNormativas.layerVigenciaHoje);

const comando = Command.make(
  "simplifica-mcp",
  {
    banco: flagBanco,
    pastaTrabalho: flagPastaTrabalho,
    canal: Flag.Literals("canal", CANAIS).pipe(
      Flag.withDescription(`canal da base, quando o banco não o registra: ${CANAIS.join(", ")} (padrão: dev)`),
      Flag.withDefault("dev"),
    ),
    pastaAtualizacao: Flag.String("pasta-atualizacao").pipe(
      Flag.withDescription("liga a atualização da base, gravando nesta pasta (ou SIMPLIFICA_ATUALIZACAO_PASTA)"),
      Flag.withFallbackConfig(Config.String("SIMPLIFICA_ATUALIZACAO_PASTA")),
      Flag.optional,
    ),
    feedAtualizacao: Flag.String("feed-atualizacao").pipe(
      Flag.withDescription("feed da atualização, com {canal} (ou SIMPLIFICA_ATUALIZACAO_FEED)"),
      Flag.withFallbackConfig(Config.String("SIMPLIFICA_ATUALIZACAO_FEED")),
      Flag.optional,
    ),
    chaveAtualizacao: Flag.String("chave-atualizacao").pipe(
      Flag.withDescription("chave pública minisign da fábrica, a linha base64 (ou SIMPLIFICA_ATUALIZACAO_CHAVE)"),
      Flag.withFallbackConfig(Config.String("SIMPLIFICA_ATUALIZACAO_CHAVE")),
      Flag.optional,
    ),
    canalAtualizacao: Flag.Literals("canal-atualizacao", CANAIS_DISTRIBUICAO).pipe(
      Flag.withDescription("canal da atualização (padrão: beta)"),
      Flag.withDefault("beta"),
    ),
    vigenciaNaReferencia: flagVigenciaNaReferencia,
  },
  Effect.fn("simplifica-mcp")(function* (opcoes) {
    const { banco, pastaTrabalho, canal } = opcoes;
    const path = yield* Path.Path;
    if (Option.isNone(banco) && Option.isNone(opcoes.pastaAtualizacao)) {
      return yield* new SemBanco();
    }
    const bancoDado = Option.isSome(banco) ? expandirCaminho(path, banco.value) : undefined;
    let caminho = bancoDado ?? "";
    let periodica: Effect.Effect<void> = Effect.void;
    if (Option.isSome(opcoes.pastaAtualizacao)) {
      const atualizacao = yield* prepararAtualizacao({
        pasta: expandirCaminho(path, opcoes.pastaAtualizacao.value),
        banco: bancoDado,
        feed: Option.getOrUndefined(opcoes.feedAtualizacao),
        chave: Option.getOrUndefined(opcoes.chaveAtualizacao),
        canal: opcoes.canalAtualizacao,
      });
      caminho = atualizacao.banco;
      periodica = atualizacao.periodica;
    }
    const pasta = expandirCaminho(
      path,
      Option.getOrElse(pastaTrabalho, () => "."),
    );
    const servicos = yield* Layer.build(
      layerStdio({
        banco: caminho,
        // A base da fábrica não grava canal: com a atualização, vale o canal dela.
        canal: Option.isSome(opcoes.pastaAtualizacao) && canal === "dev" ? opcoes.canalAtualizacao : canal,
        pastaTrabalho: pasta,
      }).pipe(Layer.provide(NodeStdio.layer), Layer.provide(layerVigencia(opcoes.vigenciaNaReferencia))),
    );
    const { base } = Context.get(servicos, Leitura.Leitura);
    yield* Console.error(`simplifica-mcp ${VERSAO_PACOTE}: base ${base.versao} (canal ${base.canal})`);
    yield* Effect.forkScoped(periodica);
    return yield* Effect.never;
  }, Effect.scoped),
).pipe(
  Command.withDescription(
    "Servidor MCP só de leitura sobre o kb.sqlite da base de conhecimento do IFPR (transporte stdio).",
  ),
);

/** A linha do stderr de um erro tipado; os de abertura do banco usam as mensagens do simplifica-mcp. */
const mensagemDe = (erro: unknown): string => {
  if (BaseKb.ehBaseAusente(erro) || BaseKb.ehBaseIncompativel(erro)) {
    return `simplifica-mcp: ${mensagemDeAbertura(erro)}`;
  }
  if (PastaTrabalho.ehPastaTrabalhoInvalida(erro)) return `simplifica-mcp: ${erro.message}`;
  if (Sql.ehFalhaNaConsulta(erro)) return `simplifica-mcp: ${MENSAGEM_INCOMPATIVEL} (o arquivo não é um kb.sqlite)`;
  return `simplifica-mcp: ${mensagemDoErro(erro)}`;
};

executarPrincipal("simplifica-mcp", Command.run(comando, { version: VERSAO_PACOTE }), { mensagemDe });
