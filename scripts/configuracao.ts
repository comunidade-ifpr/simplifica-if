/**
 * Configuração e segredos dos scripts: o `ConfigProvider` único.
 *
 * O valor vem do ambiente do processo e, na falta, do `.env.local` da raiz (o Node não carrega `.env*`
 * sozinho). `executarPrincipal` instala esse provedor em todo script. Variável vazia conta como ausente,
 * nos dois.
 *
 * Quem lê usa `Config` (`Config.Redacted` para segredo), nunca `process.env`. O arquivo nunca entra
 * no `process.env`, e os valores nunca entram em mensagem de erro.
 */
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { RAIZ_PROJETO } from "./config.ts";

/** O arquivo `.env` existe, mas não pôde ser lido. Nunca leva valores. */
export class ArquivoEnvIndisponivel extends Schema.TaggedError<ArquivoEnvIndisponivel>()("ArquivoEnvIndisponivel", {
  arquivo: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    return `Arquivo de configuração ilegível: ${this.arquivo}`;
  }
}

/**
 * O ambiente do processo, como provedor. Os testes o trocam (`layerAmbiente`) para que nenhuma
 * variável da máquina de quem roda entre no resultado.
 */
export const Ambiente = Context.Reference<ConfigProvider.ConfigProvider>(
  "simplifica-if/scripts/configuracao/Ambiente",
  {
    defaultValue: () => ConfigProvider.fromEnv(),
  },
);

const sem = ConfigProvider.fromUnknown({});

/**
 * O provedor: o ambiente (`Ambiente`) e, na falta, o arquivo `.env` dado (padrão: o `.env.local` da
 * raiz). Arquivo ausente não é erro: um `.env.local` ausente é o caso comum.
 */
export const provedor = Effect.fn("configuracao.provedor")(function* (arquivo?: string) {
  const path = yield* Path.Path;
  const caminho = arquivo ?? path.join(RAIZ_PROJETO, ".env.local");
  const ambiente = yield* Ambiente;
  const doArquivo = yield* ConfigProvider.fromDotEnv({ path: caminho }).pipe(
    Effect.catchTags({
      PlatformError: (cause) =>
        cause.reason._tag === "NotFound"
          ? Effect.succeed(sem)
          : Effect.fail(new ArquivoEnvIndisponivel({ arquivo: caminho, cause })),
    }),
  );
  return ConfigProvider.orElse(ambiente, doArquivo);
});

/** Instala o provedor com o `.env.local` da raiz; é o que `executarPrincipal` usa. */
export const layer = ConfigProvider.layer(provedor());

/** Para os testes: ambiente e provedor só com as variáveis dadas, sem arquivo. */
export const layerAmbiente = (variaveis: Record<string, string>) => {
  const provedorTeste = ConfigProvider.fromEnv({ env: variaveis });
  return Layer.mergeAll(Layer.succeed(Ambiente, provedorTeste), ConfigProvider.layer(provedorTeste));
};
