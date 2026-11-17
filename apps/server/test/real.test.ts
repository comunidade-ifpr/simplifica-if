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
 *
 * No Antigravity, um segundo turno pede a leitura de um link `ifpr://` (`read_resource`, que o `agy`
 * usa no lugar de `resources/read`) e confere que o evento sai com o resumo que o servidor viu: o
 * `agy` não manda o resultado pelo ACP, e o motor casa a leitura pelo URI.
 *
 * O teste imprime, por turno, cada ferramenta (nome, entrada, se falhou e o começo do resumo), o tempo
 * do turno e se a resposta cita um link `ifpr://`.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { type Evento, LinhaPartida, Provider, VARIAVEL_TOKEN } from "@simplifica-if/contratos-app";
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
const LINK_LEITURA = "ifpr://cnct/tecnico-em-enfermagem";
const PERGUNTA_LEITURA = `Leia o recurso ${LINK_LEITURA} do servidor MCP ifpr (read_resource) e diga o eixo tecnológico do curso.`;

/**
 * O registro de um turno: as ferramentas, com a entrada e o resumo, o tempo e os links `ifpr://`. Vai
 * direto ao stderr, como o log do servidor: o vitest esconde o `console` dos testes que passam.
 */
const registrarTurno = (rotulo: string, eventos: ReadonlyArray<Evento>, ms: number) =>
  Effect.sync(() => {
    const texto = eventos.flatMap((e) => (e._tag === "TextoFinal" ? [e.texto] : [])).join("\n");
    const linhas = [`[${PROVIDER}] ${rotulo}: ${(ms / 1000).toFixed(1)} s, ${eventos.length} eventos`];
    for (const evento of eventos) {
      if (evento._tag === "FerramentaIniciada") {
        linhas.push(`  ▶ ${evento.nome} ${JSON.stringify(evento.entrada).slice(0, 200)}`);
      } else if (evento._tag === "FerramentaConcluida") {
        const resumo = evento.resumo.replace(/\s+/g, " ").slice(0, 120);
        linhas.push(`  ■ ${evento.nome}${evento.falhou ? " (falhou)" : ""}: ${resumo || "(sem resumo)"}`);
      }
    }
    const links = [...new Set(texto.match(/ifpr:\/\/[^\s)\]>"'`]+/g) ?? [])];
    linhas.push(`  links ifpr:// na resposta: ${links.length ? links.join(", ") : "nenhum"}`);
    process.stderr.write(`${linhas.join("\n")}\n`);
  });

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
        // Como a pessoa no primeiro uso: sem o aviso aceito, o servidor não manda nada à IA (M1.8).
        yield* c["preferencias.aceitarAviso"]({});
        const { sessao } = yield* c["conversa.iniciar"]({ provider: PROVIDER, pastaTrabalho: pasta });
        const turno = (rotulo: string, texto: string) =>
          Effect.gen(function* () {
            const inicio = yield* Clock.currentTimeMillis;
            const eventos = yield* c["conversa.enviar"]({ sessao, texto }).pipe(
              Stream.tap((evento) =>
                evento._tag === "PedidoAprovacao"
                  ? c["conversa.responderAprovacao"]({ sessao, aprovacao: evento.id, decisao: "permitir" })
                  : Effect.void,
              ),
              Stream.runCollect,
            );
            yield* registrarTurno(rotulo, eventos, (yield* Clock.currentTimeMillis) - inicio);
            return eventos;
          });
        const eventos = yield* turno("pergunta do CNCT", PERGUNTA);
        const leitura = PROVIDER === "antigravity" ? yield* turno("leitura de link", PERGUNTA_LEITURA) : [];
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

        if (PROVIDER === "antigravity") {
          const iniciadas = leitura.flatMap((e) =>
            e._tag === "FerramentaIniciada" && e.nome === "read_resource" ? [e.id] : [],
          );
          assert.isNotEmpty(iniciadas, "o agy não chamou read_resource");
          const concluidas = leitura.flatMap((e) =>
            e._tag === "FerramentaConcluida" && iniciadas.includes(e.id) ? [e] : [],
          );
          assert.isNotEmpty(concluidas);
          for (const concluida of concluidas) assert.notStrictEqual(concluida.resumo, "", "read_resource sem resumo");
        }
      }).pipe(Effect.scoped),
    300_000,
  );
});
