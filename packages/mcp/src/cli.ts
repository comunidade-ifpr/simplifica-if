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
 * Erros: como na CLI `kb`, o relatório padrão do `runMain` fica desligado (ele escreveria no stdout,
 * que é do protocolo). Um erro tipado vira `simplifica-mcp: <mensagem>` no stderr, com código 1; os
 * erros de abertura do banco usam as mensagens do simplifica-mcp (`mensagemDeAbertura`).
 */
import * as NodeOS from "node:os";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeStdio from "@effect/platform-node/NodeStdio";
import * as BaseKb from "@simplifica-if/kb/BaseKb";
import * as Sql from "@simplifica-if/kb/db/sql";
import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as CliError from "effect/cli/CliError";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import { prepararAtualizacao } from "./atualizacao.ts";
import { CANAIS, type Canal } from "./contratos.ts";
import * as Leitura from "./leitura/Leitura.ts";
import { layerStdio, mensagemDeAbertura, MENSAGEM_INCOMPATIVEL, VERSAO_PACOTE } from "./servidor.ts";

/** Uso que os parsers de flag não pegam: banco ausente, canal fora da lista, pasta inexistente. */
export class UsoInvalido extends Schema.TaggedError<UsoInvalido>()("UsoInvalido", {
  motivo: Schema.Literals(["sem-banco", "canal", "pasta-trabalho"]),
  valor: Schema.optionalKey(Schema.String),
}) {
  override get message(): string {
    switch (this.motivo) {
      case "sem-banco":
        return "informe o kb.sqlite com --banco <caminho> ou com a variável SIMPLIFICA_KB";
      case "canal":
        return `--canal <canal>: esperava um destes valores: ${CANAIS.join(", ")} (veio "${this.valor ?? ""}")`;
      case "pasta-trabalho":
        return `pasta de trabalho não encontrada: ${this.valor ?? ""}`;
    }
  }
}

const ehUsoInvalido = Schema.is(UsoInvalido);
const ehCanal = Schema.is(Schema.Literals(CANAIS));

function expandirCaminho(path: Path.Path, caminho: string): string {
  if (caminho === "~") return NodeOS.homedir();
  if (caminho.startsWith("~/")) return path.join(NodeOS.homedir(), caminho.slice(2));
  return path.resolve(caminho);
}

/** A pasta de trabalho, conferida e com o caminho real (sem `..` nem symlink). */
const pastaReal = Effect.fn("simplifica-mcp.pastaReal")(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const info = yield* fs.stat(dir).pipe(Effect.option);
  if (Option.isNone(info) || info.value.type !== "Directory") {
    return yield* new UsoInvalido({ motivo: "pasta-trabalho", valor: dir });
  }
  return yield* fs
    .realPath(dir)
    .pipe(
      Effect.catchTags({ PlatformError: () => Effect.fail(new UsoInvalido({ motivo: "pasta-trabalho", valor: dir })) }),
    );
});

const comando = Command.make(
  "simplifica-mcp",
  {
    banco: Flag.String("banco").pipe(
      Flag.withDescription("caminho do kb.sqlite (ou a variável SIMPLIFICA_KB)"),
      Flag.withFallbackConfig(Config.String("SIMPLIFICA_KB")),
      Flag.optional,
    ),
    pastaTrabalho: Flag.String("pasta-trabalho").pipe(
      Flag.withDescription("única pasta de onde o servidor lê arquivos (padrão: o diretório atual)"),
      Flag.optional,
    ),
    canal: Flag.String("canal").pipe(
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
    canalAtualizacao: Flag.Literals("canal-atualizacao", ["beta", "estavel"]).pipe(
      Flag.withDescription("canal da atualização (padrão: beta)"),
      Flag.withDefault("beta"),
    ),
  },
  Effect.fn("simplifica-mcp")(function* (opcoes) {
    const { banco, pastaTrabalho, canal } = opcoes;
    const path = yield* Path.Path;
    if (Option.isNone(banco) && Option.isNone(opcoes.pastaAtualizacao)) {
      return yield* new UsoInvalido({ motivo: "sem-banco" });
    }
    if (!ehCanal(canal)) return yield* new UsoInvalido({ motivo: "canal", valor: canal });
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
    const pasta = yield* pastaReal(
      expandirCaminho(
        path,
        Option.getOrElse(pastaTrabalho, () => "."),
      ),
    );
    const servicos = yield* Layer.build(
      layerStdio({
        banco: caminho,
        // A base da fábrica não grava canal: com a atualização, vale o canal dela.
        canal: Option.isSome(opcoes.pastaAtualizacao) && canal === "dev" ? opcoes.canalAtualizacao : (canal as Canal),
        pastaTrabalho: pasta,
      }).pipe(Layer.provide(NodeStdio.layer)),
    );
    const { base } = Context.get(servicos, Leitura.Leitura);
    yield* Console.error(
      `simplifica-mcp ${VERSAO_PACOTE}: base ${base.versao} (referência ${base.data_referencia}, canal ${base.canal})`,
    );
    yield* Effect.forkScoped(periodica);
    return yield* Effect.never;
  }, Effect.scoped),
).pipe(
  Command.withDescription(
    "Servidor MCP só de leitura sobre o kb.sqlite da base de conhecimento do IFPR (transporte stdio).",
  ),
);

/** Escreve no stderr o que a falha tem a dizer; o código de saída fica com o `runMain`. */
const relatarFalha = (causa: Cause.Cause<unknown>): Effect.Effect<void> => {
  if (Cause.hasInterruptsOnly(causa)) return Effect.void;
  const erro = Cause.findErrorOption(causa);
  if (Option.isNone(erro)) return Console.error(Cause.pretty(causa));
  const valor = erro.value;
  if (CliError.isCliError(valor)) return Effect.void;
  if (BaseKb.ehBaseAusente(valor) || BaseKb.ehBaseIncompativel(valor) || Leitura.ehCanalDesconhecido(valor)) {
    return Console.error(`simplifica-mcp: ${mensagemDeAbertura(valor)}`);
  }
  if (Sql.ehFalhaNaConsulta(valor))
    return Console.error(`simplifica-mcp: ${MENSAGEM_INCOMPATIVEL} (o arquivo não é um kb.sqlite)`);
  if (ehUsoInvalido(valor)) return Console.error(`simplifica-mcp: ${valor.message}`);
  return Console.error(`simplifica-mcp: ${valor instanceof Error ? valor.message : String(valor)}`);
};

const programa = Command.run(comando, { version: VERSAO_PACOTE }).pipe(
  Effect.tapCause(relatarFalha),
  Effect.provide(NodeServices.layer),
);

NodeRuntime.runMain(programa, { disableErrorReporting: true });
