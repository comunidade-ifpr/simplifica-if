// @effect-diagnostics nodeBuiltinImport:off -- monta o diretório temporário com os .env* de teste pelo node:fs síncrono
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath_ from "@effect/platform-node/NodePath";
import { afterAll, describe, expect, it, test } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Schema from "effect/Schema";
import { ESTRITO } from "../esquema.ts";
import { carregarConfig } from "./carregar.ts";
import { esquemaConfig } from "./esquema.ts";
import {
  ambienteClaude,
  argumentosClaude,
  chavesArquivosEnv,
  ehFalhaAoExecutarClaude,
  executarPergunta,
  REGRAS_NEGADAS,
  VARIAVEIS_AMBIENTE_CLAUDE,
} from "./executor.ts";

const diretorio = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "avaliacao-env-"));
afterAll(() => NodeFS.rmSync(diretorio, { recursive: true, force: true }));

/** Sistema de arquivos e caminhos reais: o executor lê os `.env*` do diretório temporário. */
const arquivos = Layer.mergeAll(NodeFileSystem.layer, NodePath_.layer);

/** Ambiente de um runtime que carrega o `.env.local` sozinho: shell do usuário + o que veio do arquivo. */
const ENV_LOCAL =
  "TOKEN_EXEMPLO=secret_x\nUSUARIO_EXEMPLO=fulano\nSENHA_EXEMPLO=senha\nANTHROPIC_API_KEY=da-env-local\n";
const PROCESSO = {
  PATH: "/usr/bin:/bin",
  HOME: "/Users/alguem",
  USER: "alguem",
  LANG: "pt_BR.UTF-8",
  TOKEN_EXEMPLO: "secret_x",
  USUARIO_EXEMPLO: "fulano",
  SENHA_EXEMPLO: "senha",
  ANTHROPIC_API_KEY: "da-env-local",
  GITHUB_TOKEN: "ghp_x",
  AWS_SECRET_ACCESS_KEY: "aws",
  SSH_AUTH_SOCK: "/tmp/agent",
  CLAUDE_BIN: "/opt/claude",
};

NodeFS.writeFileSync(NodePath.join(diretorio, ".env.local"), ENV_LOCAL);
NodeFS.writeFileSync(NodePath.join(diretorio, ".env"), "OUTRA=1\n");

describe("ambiente do claude -p", () => {
  it.effect("lê as chaves de todos os .env* do diretório", () =>
    Effect.gen(function* () {
      expect([...(yield* chavesArquivosEnv(diretorio))].sort()).toEqual([
        "ANTHROPIC_API_KEY",
        "OUTRA",
        "SENHA_EXEMPLO",
        "TOKEN_EXEMPLO",
        "USUARIO_EXEMPLO",
      ]);
      expect((yield* chavesArquivosEnv(NodePath.join(diretorio, "inexistente"))).size).toBe(0);
    }).pipe(Effect.provide(arquivos)),
  );

  it.effect("só passa a lista explícita e nada que venha de .env*", () =>
    Effect.gen(function* () {
      const ambiente = ambienteClaude(PROCESSO, yield* chavesArquivosEnv(diretorio));
      expect(ambiente).toEqual({ PATH: "/usr/bin:/bin", HOME: "/Users/alguem", USER: "alguem", LANG: "pt_BR.UTF-8" });
      for (const chave of Object.keys(ambiente)) {
        expect(VARIAVEIS_AMBIENTE_CLAUDE as readonly string[]).toContain(chave);
      }
    }).pipe(Effect.provide(arquivos)),
  );

  test("a credencial do claude só passa quando vem do shell", () => {
    expect(ambienteClaude(PROCESSO).ANTHROPIC_API_KEY).toBe("da-env-local");
    expect(ambienteClaude(PROCESSO, new Set(["ANTHROPIC_API_KEY"])).ANTHROPIC_API_KEY).toBeUndefined();
  });

  test("a lista não inclui segredos do projeto nem de outros serviços", () => {
    for (const nome of VARIAVEIS_AMBIENTE_CLAUDE) {
      if (nome === "ANTHROPIC_API_KEY" || nome === "CLAUDE_CODE_OAUTH_TOKEN") continue;
      expect(nome).not.toMatch(/TOKEN|SENHA|SECRET|PASSWORD|KEY|USUARIO|SSH|AWS|GITHUB/u);
    }
  });
});

describe("regras de permissão do claude -p", () => {
  const config = carregarConfig();
  const argumentos = argumentosClaude("Pergunta?", { config });
  const lista = (flag: string) => {
    const inicio = argumentos.indexOf(flag) + 1;
    const fim = argumentos.findIndex((valor, indice) => indice >= inicio && valor.startsWith("--"));
    return argumentos.slice(inicio, fim);
  };

  test("pré-aprova só leitura dentro do repositório e não oferece Bash", () => {
    expect(lista("--allowedTools")).toEqual(["Read(./**)", "Grep", "Glob"]);
    expect(argumentos[argumentos.indexOf("--tools") + 1]).toBe("Read,Grep,Glob");
    expect(argumentos[argumentos.indexOf("--permission-mode") + 1]).toBe("dontAsk");
  });

  test("nega sempre Bash, escrita, web e a leitura de segredos", () => {
    const negadas = lista("--disallowedTools");
    expect(negadas).toEqual([...REGRAS_NEGADAS]);
    for (const regra of ["Bash", "Edit", "Write", "WebFetch", "Read(./.env*)", "Read(./**/.env*)", "Read(~/.ssh/**)"]) {
      expect(negadas).toContain(regra);
    }
  });

  test("o esquema recusa Bash em ferramentas e regras", () => {
    const base = {
      modelo: "sonnet",
      execucoes: 1,
      max_turns: 5,
      ferramentas: ["Read"],
      ferramentas_permitidas: ["Read"],
    };
    const valida = (valor: unknown) => Exit.isSuccess(Schema.decodeUnknownExit(esquemaConfig)(valor, ESTRITO));
    expect(valida(base)).toBe(true);
    expect(valida({ ...base, ferramentas: ["Read", "Bash"] })).toBe(false);
    expect(valida({ ...base, ferramentas_permitidas: ["Bash(jq *)"] })).toBe(false);
  });
});

/* ------------------------------------------------- processo filho (dublê) */

const codificar = (texto: string) => new TextEncoder().encode(texto);

const STREAM_OK = [
  { type: "system", subtype: "init", model: "claude-teste" },
  { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] } },
  { type: "result", subtype: "success", is_error: false, result: "Resposta.", num_turns: 2 },
]
  .map((evento) => JSON.stringify(evento))
  .join("\n");

interface Roteiro {
  /** Saída já escrita pelo processo. */
  readonly stdout: string;
  readonly stderr?: string;
  /** Código de saída; sem ele, o processo só termina quando é morto. */
  readonly codigo?: number;
  /** Falha ao subir (binário ausente). */
  readonly falhaAoSubir?: boolean;
}

interface Registro {
  readonly comandos: ChildProcess.StandardCommand[];
  /** Concluído quando o processo sobe (a leitura dos `.env*`, antes, usa o sistema de arquivos real). */
  readonly subiu: Deferred.Deferred<void>;
  /** Mortes pelo `kill` do executor (prazo esgotado). */
  mortos: number;
  /** Processos ainda vivos quando o escopo fechou (o spawner real os mata). */
  encerradosPeloEscopo: number;
}

/**
 * `ChildProcessSpawner` de teste: registra o comando e devolve um processo que escreve `stdout`
 * e `stderr` e sai com `codigo`. Sem `codigo`, a saída fica aberta até o `kill`, como um `claude`
 * que não termina.
 */
function spawnerDeTeste(roteiro: Roteiro): {
  readonly layer: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner>;
  readonly registro: Registro;
} {
  const registro: Registro = { comandos: [], subiu: Deferred.makeUnsafe<void>(), mortos: 0, encerradosPeloEscopo: 0 };
  const servico = ChildProcessSpawner.make((comando) =>
    Effect.gen(function* () {
      if (ChildProcess.isStandardCommand(comando)) registro.comandos.push(comando);
      if (roteiro.falhaAoSubir) {
        return yield* PlatformError.systemError({ _tag: "NotFound", module: "ChildProcess", method: "spawn" });
      }
      const saiu = yield* Deferred.make<ChildProcessSpawner.ExitCode>();
      const morto = yield* Deferred.make<void>();
      if (roteiro.codigo !== undefined) yield* Deferred.succeed(saiu, ChildProcessSpawner.ExitCode(roteiro.codigo));
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          if (!(yield* Deferred.isDone(saiu)) && !(yield* Deferred.isDone(morto))) registro.encerradosPeloEscopo += 1;
        }),
      );
      const aberto =
        roteiro.codigo === undefined ? Stream.drain(Stream.fromEffect(Deferred.await(morto))) : Stream.empty;
      const stdout = Stream.concat(Stream.make(codificar(roteiro.stdout)), aberto);
      const stderr = Stream.concat(Stream.make(codificar(roteiro.stderr ?? "")), aberto);
      yield* Deferred.succeed(registro.subiu, undefined);
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(4242),
        exitCode: Deferred.await(saiu),
        isRunning: Effect.map(Deferred.isDone(saiu), (feito) => !feito),
        kill: () =>
          Effect.gen(function* () {
            registro.mortos += 1;
            yield* Deferred.succeed(morto, undefined);
          }),
        stdin: Sink.drain,
        stdout,
        stderr,
        all: Stream.merge(stdout, stderr),
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      });
    }),
  );
  return { layer: Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, servico), registro };
}

const CONFIG = carregarConfig();

describe("execução do claude -p", () => {
  it.effect("roda o binário com os argumentos, o cwd e o ambiente mínimo e lê o stream-json", () => {
    const { layer, registro } = spawnerDeTeste({ stdout: STREAM_OK, stderr: "aviso\n", codigo: 0 });
    return Effect.gen(function* () {
      const bruta = yield* executarPergunta("Pergunta?", diretorio, { config: CONFIG, ambiente: PROCESSO });
      expect(bruta).toMatchObject({ saida: STREAM_OK, stderr: "aviso\n", codigo: 0 });
      expect(bruta.execucao).toMatchObject({ resposta: "Resposta.", modelo: "claude-teste", chamadas_ferramenta: 1 });
      const [comando] = registro.comandos;
      expect(comando?.command).toBe("/opt/claude");
      expect(comando?.args).toEqual(argumentosClaude("Pergunta?", { config: CONFIG }));
      expect(comando?.options).toMatchObject({ cwd: diretorio, extendEnv: false, stdin: "ignore" });
      expect(comando?.options.env).toEqual({
        PATH: "/usr/bin:/bin",
        HOME: "/Users/alguem",
        USER: "alguem",
        LANG: "pt_BR.UTF-8",
      });
      expect(registro.mortos).toBe(0);
    }).pipe(Effect.provide(Layer.merge(layer, arquivos)));
  });

  it.effect("saída diferente de zero não é falha: o código fica no registro", () => {
    const { layer } = spawnerDeTeste({ stdout: "", codigo: 2 });
    return Effect.gen(function* () {
      const bruta = yield* executarPergunta("Pergunta?", diretorio, {
        config: CONFIG,
        ambiente: PROCESSO,
        binario: "claude",
      });
      expect(bruta.codigo).toBe(2);
      expect(bruta.execucao).toMatchObject({ desfecho: "sem_resultado", erro: true });
    }).pipe(Effect.provide(Layer.merge(layer, arquivos)));
  });

  it.effect("esgotado o prazo, mata o processo e guarda a saída parcial", () => {
    const parcial = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "parcial" }] } });
    const { layer, registro } = spawnerDeTeste({ stdout: parcial });
    return Effect.gen(function* () {
      const fibra = yield* Effect.forkChild(
        executarPergunta("Pergunta?", diretorio, { config: CONFIG, ambiente: PROCESSO }),
      );
      yield* Deferred.await(registro.subiu);
      yield* TestClock.adjust(`${CONFIG.timeout_s - 1} seconds`);
      expect(registro.mortos).toBe(0);
      yield* TestClock.adjust("1 second");
      const bruta = yield* Fiber.join(fibra);
      expect(registro.mortos).toBe(1);
      expect(bruta.codigo).toBeNull();
      expect(bruta.saida).toBe(parcial);
      expect(bruta.execucao).toMatchObject({ resposta: "parcial", desfecho: "sem_resultado", erro: true });
    }).pipe(Effect.provide(Layer.merge(layer, arquivos)));
  });

  it.effect("interrompida a execução, o escopo encerra o processo filho", () => {
    const { layer, registro } = spawnerDeTeste({ stdout: "" });
    return Effect.gen(function* () {
      const fibra = yield* Effect.forkChild(
        executarPergunta("Pergunta?", diretorio, { config: CONFIG, ambiente: PROCESSO }),
      );
      yield* Deferred.await(registro.subiu);
      expect(registro.comandos).toHaveLength(1);
      yield* Fiber.interrupt(fibra);
      expect(registro.encerradosPeloEscopo).toBe(1);
    }).pipe(Effect.provide(Layer.merge(layer, arquivos)));
  });

  it.effect("binário ausente vira FalhaAoExecutarClaude", () => {
    const { layer } = spawnerDeTeste({ stdout: "", falhaAoSubir: true });
    return Effect.gen(function* () {
      const saida = yield* Effect.exit(
        executarPergunta("Pergunta?", diretorio, { config: CONFIG, ambiente: PROCESSO, binario: "claude-inexistente" }),
      );
      expect(Exit.isFailure(saida)).toBe(true);
      const erro = Exit.isFailure(saida) ? Exit.findErrorOption(saida) : undefined;
      expect(erro?._tag === "Some" && ehFalhaAoExecutarClaude(erro.value)).toBe(true);
      if (erro?._tag === "Some")
        expect(erro.value.message).toBe("não foi possível executar claude-inexistente (NotFound)");
    }).pipe(Effect.provide(Layer.merge(layer, arquivos)));
  });
});
