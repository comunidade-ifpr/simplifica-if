/**
 * Os três drivers reais, sobre os processos do Node. O ambiente (PATH, HOME…) vem de quem monta a
 * layer: o motor não lê `process.env`. Num app aberto pelo Finder, rode antes o `fixPath` do T3
 * (`src/t3/os-jank.ts`), que completa o PATH com o do shell de login.
 *
 * `pastaEstado` é a pasta do app: as instalações gerenciadas ficam em `tools/` e o perfil próprio do
 * Antigravity em `providers/antigravity/`, como no T3. Não ponha dentro de um repositório: o token
 * do Antigravity mora ali.
 */
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as AtualizacaoHarnesses from "../atualizacao-harnesses.ts";
import * as Driver from "../Driver.ts";
import { ambienteSemTelemetria } from "../politica.ts";
import { type Ambiente, limparAmbiente } from "../processo.ts";
import { makeAntigravityInstallation } from "../t3/AntigravityInstallation.ts";
import { makeCodexInstallation } from "../t3/CodexInstallation.ts";
import * as Antigravity from "./antigravity.ts";
import * as Claude from "./claude.ts";
import * as Codex from "./codex.ts";

/** Envolve um `HttpClient` para seguir redirecionamentos (GitHub Releases devolve 302 para o CDN). */
export const layerHttpComRedirecionamento = (
  base: Layer.Layer<HttpClient.HttpClient> = NodeHttpClient.layerUndici,
): Layer.Layer<HttpClient.HttpClient> =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.map(HttpClient.HttpClient, (cliente) => HttpClient.followRedirects(cliente)),
  ).pipe(Layer.provide(base));

export const layerNode = (opcoes: {
  readonly ambiente: Ambiente;
  readonly pastaEstado: string;
  /** Executável próprio do Antigravity (o `binaryPath` do T3); sem ele, a instalação gerenciada. */
  readonly binarioAntigravity?: string;
  /** Ponte stdio → HTTP do MCP para o Antigravity (ver `PonteMcp` em `antigravity.ts`). */
  readonly ponteMcp?: Antigravity.PonteMcp;
  /** Camada HTTP das instalações gerenciadas (padrão: `NodeHttpClient.layerUndici`; no servidor, com proxy). */
  readonly http?: Layer.Layer<HttpClient.HttpClient>;
}) =>
  Layer.effect(
    Driver.Drivers,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const instalacaoCodex = yield* makeCodexInstallation({ baseDir: opcoes.pastaEstado });
      const instalacaoAntigravity = yield* makeAntigravityInstallation({ baseDir: opcoes.pastaEstado });
      const ambienteAntigravity = ambienteSemTelemetria(
        "antigravity",
        limparAmbiente(opcoes.ambiente),
      ) as NodeJS.ProcessEnv;
      const codex = yield* Codex.make({ ambiente: opcoes.ambiente, instalacao: instalacaoCodex });
      const antigravity = yield* Antigravity.make({
        ambiente: opcoes.ambiente,
        pastaEstado: opcoes.pastaEstado,
        instalacao: instalacaoAntigravity,
        ...(opcoes.binarioAntigravity ? { binario: opcoes.binarioAntigravity } : {}),
        ...(opcoes.ponteMcp ? { ponteMcp: opcoes.ponteMcp } : {}),
      });
      const comFs = <A>(efeito: Effect.Effect<A, never, FileSystem.FileSystem | Path.Path>) =>
        efeito.pipe(Effect.provideService(FileSystem.FileSystem, fs), Effect.provideService(Path.Path, path));
      const binarioCustomizado = (opcoes.binarioAntigravity ?? "").trim() !== "";
      return Driver.Drivers.of({
        claude: yield* Claude.make(opcoes),
        codex: {
          ...codex,
          atualizarHarness: AtualizacaoHarnesses.atualizarCodex(instalacaoCodex),
          limparVersoesAntigas: comFs(
            AtualizacaoHarnesses.limparVersoesAntigasCodex(instalacaoCodex.managedDirectory, {
              emAndamento: Effect.map(instalacaoCodex.state, (estado) =>
                AtualizacaoHarnesses.ehEmAndamento(estado.phase),
              ),
            }),
          ),
        },
        antigravity: {
          ...antigravity,
          atualizarHarness: AtualizacaoHarnesses.atualizarAntigravity(instalacaoAntigravity, {
            ...(opcoes.binarioAntigravity ? { binario: opcoes.binarioAntigravity } : {}),
            ambiente: ambienteAntigravity,
          }),
          // Com binário customizado, não mexe na pasta gerenciada (o binário pode apontar para dentro dela).
          limparVersoesAntigas: binarioCustomizado
            ? Effect.succeed(0)
            : comFs(
                AtualizacaoHarnesses.limparVersoesAntigasAntigravity(instalacaoAntigravity.managedDirectory, {
                  emAndamento: Effect.map(instalacaoAntigravity.state, (estado) =>
                    AtualizacaoHarnesses.ehEmAndamento(estado.phase),
                  ),
                }),
              ),
        },
      });
    }),
  ).pipe(Layer.provide(Layer.mergeAll(NodeCrypto.layer, layerHttpComRedirecionamento(opcoes.http))));
