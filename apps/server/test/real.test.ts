// @effect-diagnostics nodeBuiltinImport:off globalJsonInEffect:off -- teste real: o servidor como processo filho, com o envelope JSON no stdin
/**
 * Ponta a ponta com um provider de verdade, pela assinatura do usuário. Só roda com
 * `SIMPLIFICA_POC_REAL=1` (e `tmp/kb.sqlite` compilado); o provider é `SIMPLIFICA_PROVIDER` (padrão
 * `claude`):
 *
 *   SIMPLIFICA_POC_REAL=1 SIMPLIFICA_PROVIDER=claude pnpm --filter @simplifica-if/server test real
 *
 * Sobe `node apps/server/src/bin.ts` como o desktop vai subir (token no stdin, linha de partida no
 * stdout), conecta o cliente RPC, detecta o provider, inicia a conversa numa pasta temporária, envia a
 * pergunta do CNCT, permite o que for pedido e confere: o turno termina, alguma ferramenta `ifpr` foi
 * chamada, e a resposta traz 1.200 horas e um link `ifpr://`. A pasta de estado é a do harness do
 * motor (`SIMPLIFICA_ESTADO` ou `~/Library/Application Support/simplifica-if-poc`), onde estão a
 * instalação e o login do Antigravity.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { LinhaPartida, Provider, VARIAVEL_TOKEN } from "@simplifica-if/contratos-app";
import { cliente } from "./apoio.ts";

const REAL = process.env.SIMPLIFICA_POC_REAL === "1";
const PROVIDER = Schema.decodeUnknownSync(Provider)(process.env.SIMPLIFICA_PROVIDER ?? "claude");
const RAIZ = NodePath.resolve(import.meta.dirname, "../../..");
const BIN = NodePath.join(RAIZ, "apps/server/src/bin.ts");
const BANCO = NodePath.join(RAIZ, "tmp/kb.sqlite");
const PERGUNTA = "Qual a carga horária mínima do Técnico em Enfermagem no CNCT? Cite a fonte.";
const PASTA_ESTADO =
  process.env.SIMPLIFICA_ESTADO ??
  NodePath.join(
    NodeOS.homedir(),
    process.platform === "darwin" ? "Library/Application Support/simplifica-if-poc" : ".simplifica-if-poc",
  );

const decodificarLinha = Schema.decodeUnknownEffect(Schema.fromJsonString(LinhaPartida));

describe.skipIf(!REAL)("servidor com provider real", () => {
  it.live(
    `${PROVIDER}: pergunta do CNCT pelo RPC, de ponta a ponta`,
    () =>
      Effect.gen(function* () {
        assert.isTrue(NodeFS.existsSync(BANCO), "falta tmp/kb.sqlite: rode pnpm kb:compilar");
        const token = NodeCrypto.randomBytes(32).toString("base64url");
        const ambiente: Record<string, string | undefined> = { ...process.env };
        delete ambiente[VARIAVEL_TOKEN];
        const filho = yield* Effect.acquireRelease(
          Effect.sync(() =>
            NodeChildProcess.spawn(process.execPath, [BIN, "--banco", BANCO, "--pasta-estado", PASTA_ESTADO], {
              stdio: ["pipe", "pipe", "inherit"],
              env: ambiente,
            }),
          ),
          (filho) =>
            Effect.callback<void>((resume) => {
              if (filho.exitCode !== null) return resume(Effect.void);
              filho.once("close", () => resume(Effect.void));
              filho.stdin?.end();
            }),
        );
        filho.stdin?.write(`${JSON.stringify({ token })}\n`);
        const linha = yield* decodificarLinha(
          yield* Effect.callback<string>((resume) => {
            let acumulado = "";
            filho.stdout?.on("data", (pedaco: Buffer) => {
              acumulado += pedaco.toString("utf8");
              const fim = acumulado.indexOf("\n");
              if (fim >= 0) resume(Effect.succeed(acumulado.slice(0, fim)));
            });
            filho.once("exit", (codigo) => resume(Effect.die(new Error(`o servidor saiu (${codigo})`))));
          }),
        );

        const c = yield* cliente(linha.rpc, { authorization: `Bearer ${token}` });
        const estado = yield* c["providers.detectar"]({ provider: PROVIDER });
        assert.isTrue(estado.autenticado, estado.mensagem);

        const pasta = NodeFS.realpathSync(
          NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "simplifica-servidor-real-")),
        );
        yield* Effect.addFinalizer(() => Effect.sync(() => NodeFS.rmSync(pasta, { recursive: true, force: true })));
        const { sessao } = yield* c["conversa.iniciar"]({ provider: PROVIDER, pastaTrabalho: pasta });
        const eventos = yield* c["conversa.enviar"]({ sessao, texto: PERGUNTA }).pipe(
          Stream.tap((evento) =>
            evento._tag === "PedidoAprovacao"
              ? c["conversa.responderAprovacao"]({ sessao, aprovacao: evento.id, decisao: "permitir" })
              : Effect.void,
          ),
          Stream.runCollect,
        );
        yield* c["conversa.encerrar"]({ sessao });

        const ferramentas = eventos.flatMap((e) => (e._tag === "FerramentaIniciada" ? [e.nome] : []));
        const texto = eventos.flatMap((e) => (e._tag === "TextoFinal" ? [e.texto] : [])).join("\n");
        assert.isTrue(
          ferramentas.some((nome) => nome.startsWith("ifpr.")),
          ferramentas.join(", "),
        );
        assert.match(texto, /1\.200/);
        assert.match(texto, /ifpr:\/\//);
        assert.strictEqual(eventos.at(-1)?._tag, "FimTurno");
      }).pipe(Effect.scoped),
    300_000,
  );
});
