// @effect-diagnostics nodeBuiltinImport:off globalJsonInEffect:off -- script de teste: lê argv, gera o token e imprime a linha de partida
/**
 * O `apps/server` de verdade, com os drivers de demonstração (`drivers-demonstracao.ts`) e o banco de
 * fixture do MCP: a interface conversa com ele por RPC sem chamar provider real e sem `tmp/kb.sqlite`.
 *
 *   node apps/web/test/servidor-teste.ts [--porta 0] [--origem http://localhost:5190]… [--atraso-login 2000]
 *
 * Pronto o servidor, imprime uma linha JSON com `porta`, `urlServidor`, `token` (o de
 * `SIMPLIFICA_SERVIDOR_TOKEN` ou um aleatório), `pasta`, uma pasta de trabalho temporária, e `ppc`, um
 * PPC sintético em DOCX dentro dela (para a revisão prévia). Encerra com SIGTERM, SIGINT ou, se o stdin não for um
 * terminal, quando ele fecha (o processo que o iniciou morreu). Os logs vão para o stderr: o stdout é
 * só da linha JSON.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeUtil from "node:util";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Redacted from "effect/Redacted";
import * as Servidor from "@simplifica-if/server";
import { criarBancoFixture, diretorioTemporario, limparTemporarios } from "../../../packages/mcp/test/fixture.ts";
import { inserirNormas } from "../../../packages/mcp/test/fixture-normas.ts";
import { ppcSintetico } from "../../../packages/ppc/src/testes/revisao-previa.ts";
import * as Demonstracao from "./drivers-demonstracao.ts";

const { values: opcoes } = NodeUtil.parseArgs({
  options: {
    porta: { type: "string", default: "0" },
    origem: { type: "string", multiple: true, default: [] },
    "atraso-login": { type: "string", default: "2000" },
  },
});

const token = process.env.SIMPLIFICA_SERVIDOR_TOKEN ?? NodeCrypto.randomBytes(32).toString("base64url");
delete process.env.SIMPLIFICA_SERVIDOR_TOKEN;

if (!process.stdin.isTTY) {
  process.stdin.resume();
  process.stdin.on("close", () => process.kill(process.pid, "SIGTERM"));
}

const banco = criarBancoFixture();
/** Uma pasta de trabalho que existe, para as conversas dos testes de navegador. */
const pasta = diretorioTemporario("simplifica-web-pasta-");
inserirNormas(banco);
// A taxonomia de tópicos das fichas da `revisar-ppc`, para a revisão prévia agrupar por tema.
{
  const arquivo = NodePath.resolve(
    import.meta.dirname,
    "../../../.agents/skills/revisar-ppc/base-analise/topicos-fichas.json",
  );
  const { topicos } = JSON.parse(NodeFS.readFileSync(arquivo, "utf8")) as {
    topicos: Array<{ id: string; titulo: string }>;
  };
  const db = new NodeSqlite.DatabaseSync(banco);
  const inserir = db.prepare(
    "INSERT INTO topicos (id, ordem, titulo, termos_json, path, dados_json) VALUES (?, ?, ?, '[]', ?, ?)",
  );
  topicos.forEach((topico, ordem) =>
    inserir.run(
      topico.id,
      ordem,
      topico.titulo,
      ".agents/skills/revisar-ppc/base-analise/topicos-fichas.json",
      JSON.stringify(topico),
    ),
  );
  db.close();
}
/** Um PPC sintético (fictício) na pasta, para a revisão prévia. */
const ppc = NodePath.join(pasta, "PPC de teste.docx");
NodeFS.writeFileSync(ppc, ppcSintetico());

const camada = Servidor.layer({
  banco,
  token: Redacted.make(token),
  porta: Number(opcoes.porta),
  origens: opcoes.origem,
}).pipe(
  Layer.provide(Demonstracao.layer({ atrasoLogin: Duration.millis(Number(opcoes["atraso-login"])) })),
  Layer.provide(NodeServices.layer),
);

const programa = Effect.gen(function* () {
  yield* Effect.addFinalizer(() => Effect.sync(limparTemporarios));
  const app = yield* Servidor.ServidorApp;
  yield* Console.log(
    JSON.stringify({ porta: app.porta, urlServidor: `http://127.0.0.1:${app.porta}`, token, pasta, ppc }),
  );
  return yield* Effect.never;
}).pipe(Effect.scoped, Effect.provide(camada), Effect.provideService(Logger.LogToStderr, true));

NodeRuntime.runMain(programa);
