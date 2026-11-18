/**
 * Configuração e segredos dos scripts: o `ConfigProvider` único.
 *
 * O valor vem do ambiente do processo e, na falta, do `.env.local` da raiz (o Node não carrega `.env*`
 * sozinho). `executarPrincipal` instala esse provedor em todo script; o SUAP troca o arquivo pelo
 * `--env-file`, que então substitui o `.env.local`. Variável vazia conta como ausente, nos dois.
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

/** O arquivo `.env` pedido não existe ou não pôde ser lido. Nunca leva valores. */
export class ArquivoEnvIndisponivel extends Schema.TaggedError<ArquivoEnvIndisponivel>()("ArquivoEnvIndisponivel", {
  arquivo: Schema.String,
  motivo: Schema.Literals(["ausente", "ilegivel"]),
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    return this.motivo === "ausente"
      ? `Arquivo de configuração não encontrado: ${this.arquivo}`
      : `Arquivo de configuração ilegível: ${this.arquivo}`;
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
 * raiz). Arquivo ausente só é erro com `exigirArquivo`; um `.env.local` ausente é o caso comum.
 */
export const provedor = Effect.fn("configuracao.provedor")(function* (
  arquivo?: string,
  opcoes: { readonly exigirArquivo?: boolean } = {},
) {
  const path = yield* Path.Path;
  const caminho = arquivo ?? path.join(RAIZ_PROJETO, ".env.local");
  const ambiente = yield* Ambiente;
  const doArquivo = yield* ConfigProvider.fromDotEnv({ path: caminho }).pipe(
    Effect.catchTags({
      PlatformError: (cause) =>
        cause.reason._tag === "NotFound" && !opcoes.exigirArquivo
          ? Effect.succeed(sem)
          : Effect.fail(
              new ArquivoEnvIndisponivel({
                arquivo: caminho,
                motivo: cause.reason._tag === "NotFound" ? "ausente" : "ilegivel",
                cause,
              }),
            ),
    }),
  );
  return ConfigProvider.orElse(ambiente, doArquivo);
});

/** Instala o provedor com o `.env.local` da raiz; é o que `executarPrincipal` usa. */
export const layer = ConfigProvider.layer(provedor());

/** Instala o provedor com outro arquivo no lugar do `.env.local` (o `--env-file`), que precisa existir. */
export const layerArquivo = (arquivo: string) => ConfigProvider.layer(provedor(arquivo, { exigirArquivo: true }));

/** Para os testes: ambiente e provedor só com as variáveis dadas, sem arquivo. */
export const layerAmbiente = (variaveis: Record<string, string>) => {
  const provedorTeste = ConfigProvider.fromEnv({ env: variaveis });
  return Layer.mergeAll(Layer.succeed(Ambiente, provedorTeste), ConfigProvider.layer(provedorTeste));
};
