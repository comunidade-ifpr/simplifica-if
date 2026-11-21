/**
 * Chamadas reais aos três providers, com a assinatura do usuário. Só rodam com
 * `SIMPLIFICA_POC_REAL=1` (e `tmp/kb.sqlite` compilado):
 *
 *   SIMPLIFICA_POC_REAL=1 pnpm --filter @simplifica-if/motor test real
 *
 * Cada provider recebe a pergunta do CNCT uma vez; o teste confere que o turno termina, que alguma
 * ferramenta `ifpr` foi chamada e que a resposta traz 1.200 horas.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { servidorIfprHttp } from "../scripts/mcp-http.ts";
import * as Drivers from "../src/drivers/index.ts";
import {
  buildAntigravityAcpSpawnInput,
  prepareAntigravityProfile,
  resolveAntigravityInstanceDirectories,
} from "../src/t3/antigravityAuthSupport.ts";
import { ProviderInstanceId } from "../src/t3/contracts-antigravity.ts";
import * as Motor from "../src/Motor.ts";

const REAL = process.env.SIMPLIFICA_POC_REAL === "1";

/** O relato de cada teste vai ao stderr: o `Console` do Effect não aparece na saída do vitest. */
const relatar = (linha: string) => Effect.sync(() => process.stderr.write(`${linha}\n`));
const RAIZ = new URL("../../..", import.meta.url).pathname;
const PERGUNTA = "Qual a carga horária mínima do Técnico em Enfermagem no CNCT? Cite a fonte.";

/** A mesma pasta de estado do harness, onde estão a instalação e o login do Antigravity. */
const PASTA_ESTADO =
  process.env.SIMPLIFICA_ESTADO ??
  `${process.env.HOME ?? ""}/${process.platform === "darwin" ? "Library/Application Support/simplifica-if-poc" : ".simplifica-if-poc"}`;

/** A ponte stdio → HTTP do MCP, para o Antigravity (o `agy` 1.5.9 não anuncia MCP por HTTP). */
const PONTE_MCP = { comando: process.execPath, argumentos: [`${RAIZ}packages/motor/scripts/ponte-mcp.ts`] };

const camada = Motor.layer.pipe(
  Layer.provide(Drivers.layerNode({ ambiente: process.env, pastaEstado: PASTA_ESTADO, ponteMcp: PONTE_MCP })),
  Layer.provideMerge(NodeServices.layer),
);

describe.skipIf(!REAL)("providers reais", () => {
  for (const provider of ["claude", "codex", "antigravity"] as const) {
    it.effect(
      `${provider}: pergunta do CNCT com o simplifica-mcp por HTTP local`,
      () =>
        Effect.gen(function* () {
          const motor = yield* Motor.Motor;
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          assert.isTrue(
            yield* fs.exists(path.join(RAIZ, "tmp/kb.sqlite")),
            "falta tmp/kb.sqlite: rode pnpm kb:compilar",
          );
          const estado = yield* motor.detectar(provider);
          assert.isTrue(estado.autenticado, estado.mensagem);
          const pasta = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-motor-" }));
          const servidor = yield* servidorIfprHttp({ banco: path.join(RAIZ, "tmp/kb.sqlite"), pastaTrabalho: pasta });
          const sessao = yield* motor.iniciarSessao({ provider, pastaTrabalho: pasta, servidoresMcp: [servidor] });
          const eventos = yield* Stream.runCollect(motor.enviarMensagem(sessao, PERGUNTA));
          yield* motor.encerrar(sessao);
          const ferramentas = eventos.flatMap((e) => (e._tag === "FerramentaIniciada" ? [e.nome] : []));
          const texto = eventos.flatMap((e) => (e._tag === "TextoFinal" ? [e.texto] : [])).join("\n");
          assert.isTrue(
            ferramentas.some((nome) => nome.startsWith("ifpr.")),
            ferramentas.join(", "),
          );
          assert.match(texto, /1\.200/);
          assert.strictEqual(eventos.at(-1)?._tag, "FimTurno");
        }).pipe(Effect.scoped, Effect.provide(camada)),
      300_000,
    );
  }
});

/**
 * O perfil próprio do Antigravity (o do T3) não usa a configuração do usuário.
 *
 * O `agy` só acha a configuração do usuário pelo HOME (`~/.gemini/config/mcp_config.json`; a
 * variável `GEMINI_HOME` ele ignora), e um HOME falso faz o macOS pedir para recriar o chaveiro de
 * login: este teste nunca troca o HOME. Ele confere a entrada de spawn que o driver usa (perfil do
 * app em `--gemini-dir` e `GEMINI_HOME`, sem as chaves e o `GEMINI_HOME` do usuário) e roda uma
 * sessão real com chaves falsas no ambiente, em que o único MCP é o `ifpr`. O controle positivo (sem
 * `--gemini-dir`, o MCP do `~/.gemini` sobe) está registrado no README do motor.
 *
 * Precisa da instalação e do login do harness: `pnpm motor:poc --instalar antigravity` e
 * `pnpm motor:poc --entrar antigravity`.
 */
describe.skipIf(!REAL)("Antigravity: perfil próprio", () => {
  it.effect(
    "spawn com o perfil do app, sem chaves do usuário; sessão real só com o MCP ifpr",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        assert.isTrue(yield* fs.exists(path.join(RAIZ, "tmp/kb.sqlite")), "falta tmp/kb.sqlite: rode pnpm kb:compilar");
        const ambiente = {
          ...process.env,
          GEMINI_API_KEY: "chave-falsa-do-usuario",
          GOOGLE_API_KEY: "chave-falsa-do-usuario",
          GOOGLE_APPLICATION_CREDENTIALS: "/caminho/falso.json",
          GEMINI_HOME: "/caminho/falso/gemini-do-usuario",
        };

        // A entrada de spawn, montada como o driver monta (`prepararSpawn`).
        const pastas = yield* resolveAntigravityInstanceDirectories(
          PASTA_ESTADO,
          ProviderInstanceId.make("antigravity"),
        );
        const perfil = yield* prepareAntigravityProfile({
          profileDirectory: pastas.profile,
          baseEnv: ambiente,
          tempDirectory: pastas.runtimeTemp,
        });
        const spawn = buildAntigravityAcpSpawnInput({
          installation: { executablePath: "agy", harnessPath: null },
          profile: perfil,
          cwd: "/tmp",
          baseEnv: ambiente,
        });
        assert.deepStrictEqual(spawn.args.slice(0, 3), ["acp", "--gemini-dir", path.resolve(pastas.profile)]);
        assert.strictEqual(spawn.env?.GEMINI_HOME, path.resolve(pastas.profile));
        for (const chave of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS"]) {
          assert.isUndefined(spawn.env?.[chave], chave);
        }
        assert.isTrue(path.resolve(pastas.profile).startsWith(path.resolve(PASTA_ESTADO)));
        const mcpDoPerfil = path.join(pastas.profile, "config", "mcp_config.json");
        if (yield* fs.exists(mcpDoPerfil)) {
          const texto = yield* fs.readFileString(mcpDoPerfil);
          assert.notMatch(texto, /"command"/, "o perfil do app não deve ter MCP configurado");
        }

        // A sessão real, com as chaves falsas no ambiente do driver.
        const camadaIsolada = Motor.layer.pipe(
          Layer.provide(Drivers.layerNode({ ambiente, pastaEstado: PASTA_ESTADO })),
        );
        const eventos = yield* Effect.gen(function* () {
          const motor = yield* Motor.Motor;
          const estado = yield* motor.detectar("antigravity");
          assert.isTrue(estado.autenticado, `${estado.mensagem}: rode pnpm motor:poc --entrar antigravity`);
          assert.strictEqual(estado.origem, "gerenciada");
          const pasta = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-motor-" }));
          const sessao = yield* motor.iniciarSessao({
            provider: "antigravity",
            pastaTrabalho: pasta,
            servidoresMcp: [
              {
                tipo: "stdio",
                nome: "ifpr",
                comando: process.execPath,
                argumentos: [path.join(RAIZ, "packages/mcp/src/cli.ts"), "--banco", path.join(RAIZ, "tmp/kb.sqlite")],
                preAprovado: true,
              },
            ],
          });
          const coletados = yield* Stream.runCollect(
            motor.enviarMensagem(
              sessao,
              "Chame a ferramenta sobre_a_base do servidor ifpr e diga a data de referência da base. " +
                "Depois liste o nome de cada servidor MCP que você tem disponível.",
            ),
          );
          yield* motor.encerrar(sessao);
          return coletados;
        }).pipe(Effect.provide(camadaIsolada));

        const ferramentas = eventos.flatMap((e) => (e._tag === "FerramentaIniciada" ? [e.nome] : []));
        assert.include(ferramentas, "ifpr.sobre_a_base");
        // Ferramenta MCP de outro servidor apareceria como `mcp_<servidor>_…` (sem tradução) ou `<servidor>.…`.
        const outrasMcp = ferramentas.filter(
          (nome) => nome.startsWith("mcp_") || (nome.includes(".") && !nome.startsWith("ifpr.")),
        );
        assert.deepStrictEqual(outrasMcp, [], ferramentas.join(", "));
        assert.strictEqual(eventos.at(-1)?._tag, "FimTurno");
      }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
    300_000,
  );
});

/** Abre uma sessão real com o `ifpr` por HTTP local numa pasta temporária e roda um turno. */
const turnoReal = Effect.fn("teste.turnoReal")(function* (
  provider: Motor.Provider,
  texto: string,
  extra: Partial<Motor.ConfigSessao> = {},
  pastaDada?: string,
) {
  const motor = yield* Motor.Motor;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  assert.isTrue(yield* fs.exists(path.join(RAIZ, "tmp/kb.sqlite")), "falta tmp/kb.sqlite: rode pnpm kb:compilar");
  const pasta = pastaDada ?? (yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-motor-" })));
  const servidor = yield* servidorIfprHttp({ banco: path.join(RAIZ, "tmp/kb.sqlite"), pastaTrabalho: pasta });
  const inicio = yield* Clock.currentTimeMillis;
  const sessao = yield* motor.iniciarSessao({ provider, pastaTrabalho: pasta, servidoresMcp: [servidor], ...extra });
  const pedidos: Array<Motor.Evento> = [];
  const eventos: Array<{ readonly ms: number; readonly evento: Motor.Evento }> = [];
  yield* motor.enviarMensagem(sessao, texto).pipe(
    Stream.runForEach((evento) =>
      Effect.gen(function* () {
        eventos.push({ ms: (yield* Clock.currentTimeMillis) - inicio, evento });
        // Nada chega a perguntar nestes testes: se chegar, nega (e o teste confere).
        if (evento._tag === "PedidoAprovacao") {
          pedidos.push(evento);
          yield* motor.responderAprovacao(sessao, evento.id, "negar");
        }
      }),
    ),
  );
  yield* motor.encerrar(sessao);
  return {
    pasta,
    pedidos,
    eventos,
    texto: eventos.flatMap(({ evento }) => (evento._tag === "TextoFinal" ? [evento.texto] : [])).join("\n"),
  };
});

describe.skipIf(!REAL)("M1.2: política, texto parcial, contexto e skills", () => {
  it.live(
    "claude: texto parcial pelos stream_event, sem duplicar o TextoFinal",
    () =>
      Effect.gen(function* () {
        const { eventos, texto } = yield* turnoReal("claude", PERGUNTA);
        const parciais = eventos.filter(({ evento }) => evento._tag === "TextoParcial");
        const finais = eventos.filter(({ evento }) => evento._tag === "TextoFinal");
        assert.isAbove(parciais.length, 1);
        assert.match(texto, /1\.200/);
        // O texto dos pedaços é o dos TextoFinal, uma vez só.
        const juntos = parciais.map(({ evento }) => (evento._tag === "TextoParcial" ? evento.texto : "")).join("");
        assert.strictEqual(
          juntos,
          finais.map(({ evento }) => (evento._tag === "TextoFinal" ? evento.texto : "")).join(""),
        );
        yield* relatar(
          `[claude] primeiro TextoParcial em ${parciais[0]?.ms} ms; TextoFinal em ${finais.at(-1)?.ms} ms; ${parciais.length} pedaços`,
        );
      }).pipe(Effect.scoped, Effect.provide(camada)),
    300_000,
  );

  it.live(
    "codex: contexto da sessão (tokens de entrada de um turno sem ferramenta)",
    () =>
      Effect.gen(function* () {
        const { eventos } = yield* turnoReal("codex", "Responda apenas: ok");
        const uso = eventos.flatMap(({ evento }) => (evento._tag === "UsoTokens" ? [evento] : []));
        const entrada = uso.reduce((soma, evento) => soma + evento.entrada, 0);
        yield* relatar(`[codex] tokens de entrada de um turno sem ferramenta: ${entrada}`);
        // Antes do corte (só o isolamento do M1.4), 14 mil sem web; com web_search "live" + INSTRUCOES_WEB
        // (codex-cli 0.171.0, 21/11/2026), medido em 12.935 tokens.
        assert.isBelow(entrada, 14_000);
      }).pipe(Effect.scoped, Effect.provide(camada)),
    300_000,
  );

  const SKILL: Motor.Skill = {
    nome: "senha-do-dia",
    descricao: "Use quando o usuário perguntar qual é a senha do dia.",
    instrucoes:
      "Leia o arquivo senha.txt desta pasta (ao lado deste SKILL.md) e responda só com o conteúdo dele, sem explicação.",
    arquivos: [{ caminho: "senha.txt", conteudo: "girassol-azul-42\n" }],
  };

  for (const provider of ["claude", "codex", "antigravity"] as const) {
    it.live(
      `${provider}: skill do app pelas instruções da sessão e arquivos na pasta`,
      () =>
        Effect.gen(function* () {
          const inicio = yield* Clock.currentTimeMillis;
          const { texto, pedidos } = yield* turnoReal(provider, "Qual é a senha do dia?", { skills: [SKILL] });
          yield* relatar(
            `[${provider}] skill: ${(yield* Clock.currentTimeMillis) - inicio} ms; pedidos: ${pedidos.length}`,
          );
          assert.include(texto, "girassol-azul-42");
          // Ler dentro da pasta passa pela política sem perguntar.
          assert.deepStrictEqual(pedidos, []);
        }).pipe(Effect.scoped, Effect.provide(camada)),
      300_000,
    );

    it.live(
      `${provider}: a política nega sem perguntar a escrita fora da pasta de trabalho`,
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const fora = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-fora-" }));
          const alvo = path.join(fora, "fora.txt");
          const { texto, pedidos, eventos } = yield* turnoReal(
            provider,
            `Crie o arquivo ${alvo} com o conteúdo ok, usando a sua ferramenta de escrever arquivos. ` +
              "Se não for possível, diga por quê, sem tentar outro caminho.",
          );
          const ferramentas = eventos.flatMap(({ evento }) =>
            evento._tag === "FerramentaConcluida"
              ? [`${evento.nome}${evento.falhou ? " (falhou)" : ""}: ${evento.resumo}`]
              : [],
          );
          yield* relatar(`[${provider}] escrita fora: ${ferramentas.join(" | ")}\n${texto.slice(0, 300)}`);
          assert.isFalse(yield* fs.exists(alvo), "o arquivo fora da pasta não pode existir");
          assert.deepStrictEqual(
            pedidos.map((pedido) => (pedido._tag === "PedidoAprovacao" ? pedido.ferramenta : "")),
            [],
          );
        }).pipe(Effect.scoped, Effect.provide(camada)),
      300_000,
    );
  }
});
