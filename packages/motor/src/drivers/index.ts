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
import * as Layer from "effect/Layer";
import { Drivers } from "../Driver.ts";
import type { Ambiente } from "../processo.ts";
import { makeAntigravityInstallation } from "../t3/AntigravityInstallation.ts";
import { makeCodexInstallation } from "../t3/CodexInstallation.ts";
import * as Antigravity from "./antigravity.ts";
import * as Claude from "./claude.ts";
import * as Codex from "./codex.ts";

export const layerNode = (opcoes: {
  readonly ambiente: Ambiente;
  readonly pastaEstado: string;
  /** Executável próprio do Antigravity (o `binaryPath` do T3); sem ele, a instalação gerenciada. */
  readonly binarioAntigravity?: string;
  /** Ponte stdio → HTTP do MCP para o Antigravity (ver `PonteMcp` em `antigravity.ts`). */
  readonly ponteMcp?: Antigravity.PonteMcp;
}) =>
  Layer.effect(
    Drivers,
    Effect.gen(function* () {
      const instalacaoCodex = yield* makeCodexInstallation({ baseDir: opcoes.pastaEstado });
      const instalacaoAntigravity = yield* makeAntigravityInstallation({ baseDir: opcoes.pastaEstado });
      return Drivers.of({
        claude: yield* Claude.make(opcoes),
        codex: yield* Codex.make({ ambiente: opcoes.ambiente, instalacao: instalacaoCodex }),
        antigravity: yield* Antigravity.make({
          ambiente: opcoes.ambiente,
          pastaEstado: opcoes.pastaEstado,
          instalacao: instalacaoAntigravity,
          ...(opcoes.binarioAntigravity ? { binario: opcoes.binarioAntigravity } : {}),
          ...(opcoes.ponteMcp ? { ponteMcp: opcoes.ponteMcp } : {}),
        }),
      });
    }),
  ).pipe(Layer.provide(Layer.mergeAll(NodeCrypto.layer, NodeHttpClient.layerUndici)));
