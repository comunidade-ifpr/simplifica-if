// @effect-diagnostics nodeBuiltinImport:off -- teste: servidor HTTP local (302) para conferir redirecionamentos do undici
/**
 * Atualização silenciosa em segundo plano e limpeza de versões antigas dos harnesses gerenciados
 * (Antigravity e Codex), incluindo redirecionamento HTTP (302 do GitHub), faixa de compatibilidade
 * e trava do `Motor` que impede limpeza com sessão ou operação em andamento.
 */
import * as NodeHttp from "node:http";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import * as AtualizacaoHarnesses from "../src/atualizacao-harnesses.ts";
import { layerHttpComRedirecionamento } from "../src/drivers/index.ts";
import * as Motor from "../src/Motor.ts";
import { AntigravityInstallationError, type AntigravityExecutable } from "../src/t3/AntigravityInstallation.ts";
import { CodexInstallationError, type CodexExecutable } from "../src/t3/CodexInstallation.ts";
import { ProviderDriverKind, type ProviderInstallState } from "../src/t3/contracts.ts";

const hash64 = (caractere: string) => caractere.repeat(64);

const estadoBase = (
  driver: "antigravity" | "codex",
  parcial: Partial<ProviderInstallState> = {},
): ProviderInstallState => ({
  driver: ProviderDriverKind.make(driver),
  operationId: null,
  phase: "idle",
  downloadedBytes: 0,
  totalBytes: null,
  version: null,
  installedVersion: null,
  canRemove: true,
  message: null,
  ...parcial,
});

const criarAntigravityFalso = Effect.fn("teste.criarAntigravityFalso")(function* (opcoes: {
  readonly resolvida?: AntigravityExecutable | null;
  readonly estadoInicial?: Partial<ProviderInstallState>;
  readonly versaoRemota?: string | null;
  readonly resultadoStart?: "succeeded" | "failed" | "erroStart";
  readonly mensagemFalha?: string;
}) {
  const ref = yield* SubscriptionRef.make(estadoBase("antigravity", opcoes.estadoInicial));
  let checagens = 0;
  let inicios = 0;
  const executavel = opcoes.resolvida;
  const instalacao = {
    resolve: () =>
      executavel === undefined || executavel === null
        ? Effect.fail(new AntigravityInstallationError({ operation: "resolve", detail: "não instalado" }))
        : Effect.succeed(executavel),
    state: SubscriptionRef.get(ref),
    changes: SubscriptionRef.changes(ref),
    checkForUpdate: Effect.gen(function* () {
      checagens += 1;
      if (opcoes.versaoRemota !== undefined) {
        yield* SubscriptionRef.update(ref, (atual) => ({ ...atual, version: opcoes.versaoRemota ?? null }));
      }
    }),
    start: Effect.gen(function* () {
      inicios += 1;
      if (opcoes.resultadoStart === "erroStart") {
        return yield* new AntigravityInstallationError({
          operation: "start",
          detail: opcoes.mensagemFalha ?? "sem rede",
        });
      }
      const alvo = opcoes.versaoRemota ?? (yield* SubscriptionRef.get(ref)).version;
      const iniciando = yield* SubscriptionRef.updateAndGet(ref, (atual) => ({
        ...atual,
        operationId: "op-1",
        phase: "downloading" as const,
        version: alvo,
      }));
      yield* Effect.forkChild(
        Effect.yieldNow.pipe(
          Effect.andThen(
            SubscriptionRef.update(ref, (atual) =>
              opcoes.resultadoStart === "failed"
                ? { ...atual, phase: "failed" as const, message: opcoes.mensagemFalha ?? "checksum inválido" }
                : { ...atual, phase: "succeeded" as const, installedVersion: alvo, message: null },
            ),
          ),
        ),
      );
      return iniciando;
    }),
  };
  return {
    instalacao,
    estatisticas: () => ({ checagens, inicios }),
  };
});

const criarCodexFalso = Effect.fn("teste.criarCodexFalso")(function* (opcoes: {
  readonly resolvida?: CodexExecutable | null;
  readonly estadoInicial?: Partial<ProviderInstallState>;
  readonly versaoRemota?: string | null;
  readonly sourceAposCheck?: "managed" | "local";
  readonly resultadoStart?: "succeeded" | "failed" | "local" | "erroStart";
  readonly mensagemFalha?: string;
}) {
  const ref = yield* SubscriptionRef.make(estadoBase("codex", opcoes.estadoInicial));
  let checagens = 0;
  let inicios = 0;
  const executavel = opcoes.resolvida;
  const instalacao = {
    resolve: () =>
      executavel === undefined || executavel === null
        ? Effect.fail(new CodexInstallationError({ operation: "resolve", detail: "não instalado" }))
        : Effect.succeed(executavel),
    state: SubscriptionRef.get(ref),
    changes: SubscriptionRef.changes(ref),
    checkForUpdate: Effect.gen(function* () {
      checagens += 1;
      yield* SubscriptionRef.update(ref, (atual) => ({
        ...atual,
        ...(opcoes.versaoRemota === undefined ? {} : { version: opcoes.versaoRemota }),
        ...(opcoes.sourceAposCheck === undefined ? {} : { source: opcoes.sourceAposCheck }),
      }));
    }),
    start: Effect.gen(function* () {
      inicios += 1;
      if (opcoes.resultadoStart === "erroStart") {
        return yield* new CodexInstallationError({
          operation: "start",
          detail: opcoes.mensagemFalha ?? "erro ao iniciar",
        });
      }
      if (opcoes.resultadoStart === "local") {
        return yield* SubscriptionRef.updateAndGet(ref, (atual) => ({
          ...atual,
          phase: "succeeded" as const,
          source: "local" as const,
          installedVersion: "0.170.0",
        }));
      }
      const alvo = opcoes.versaoRemota ?? (yield* SubscriptionRef.get(ref)).version;
      const iniciando = yield* SubscriptionRef.updateAndGet(ref, (atual) => ({
        ...atual,
        operationId: "op-codex",
        phase: "downloading" as const,
        version: alvo,
      }));
      yield* Effect.forkChild(
        Effect.yieldNow.pipe(
          Effect.andThen(
            SubscriptionRef.update(ref, (atual) =>
              opcoes.resultadoStart === "failed"
                ? { ...atual, phase: "failed" as const, message: opcoes.mensagemFalha ?? "HTTP 503" }
                : {
                    ...atual,
                    phase: "succeeded" as const,
                    source: "managed" as const,
                    installedVersion: alvo,
                    message: null,
                  },
            ),
          ),
        ),
      );
      return iniciando;
    }),
  };
  return {
    instalacao,
    estatisticas: () => ({ checagens, inicios }),
  };
});

describe("Atualização silenciosa do Antigravity", () => {
  const gerenciada = (version: string): AntigravityExecutable => ({
    executablePath: `/tmp/agy/${version}/antigravity`,
    harnessPath: null,
    source: "managed",
    version,
    managedVersionDirectory: `/tmp/agy/${version}`,
  });

  it.effect("atualiza automaticamente quando há versão mais nova dentro da faixa", () =>
    Effect.gen(function* () {
      const falso = yield* criarAntigravityFalso({
        resolvida: gerenciada("1.5.12"),
        estadoInicial: { installedVersion: "1.5.12" },
        versaoRemota: "1.5.14",
      });
      const resultado = yield* AtualizacaoHarnesses.atualizarAntigravity(falso.instalacao);
      assert.deepStrictEqual(resultado, { status: "atualizado", de: "1.5.12", para: "1.5.14" });
      assert.deepStrictEqual(falso.estatisticas(), { checagens: 1, inicios: 1 });
    }),
  );

  it.effect("recusa atualização silenciosa para versão fora da faixa suportada (ex.: 2.0.0)", () =>
    Effect.gen(function* () {
      const falso = yield* criarAntigravityFalso({
        resolvida: gerenciada("1.5.14"),
        estadoInicial: { installedVersion: "1.5.14" },
        versaoRemota: "2.0.0",
      });
      const resultado = yield* AtualizacaoHarnesses.atualizarAntigravity(falso.instalacao);
      assert.deepStrictEqual(resultado, { status: "ignorado", motivo: "fora-da-faixa" });
      assert.deepStrictEqual(falso.estatisticas(), { checagens: 1, inicios: 0 });
    }),
  );

  it.effect("não inicia download quando já está na mesma versão ou mais nova", () =>
    Effect.gen(function* () {
      const falso = yield* criarAntigravityFalso({
        resolvida: gerenciada("1.5.14"),
        estadoInicial: { installedVersion: "1.5.14" },
        versaoRemota: "1.5.14",
      });
      const resultado = yield* AtualizacaoHarnesses.atualizarAntigravity(falso.instalacao);
      assert.deepStrictEqual(resultado, { status: "em-dia", versao: "1.5.14" });
      assert.deepStrictEqual(falso.estatisticas(), { checagens: 1, inicios: 0 });
    }),
  );

  it.effect("ignora quando não instalado ou já em andamento", () =>
    Effect.gen(function* () {
      const naoInstalado = yield* criarAntigravityFalso({ resolvida: null, versaoRemota: "1.5.14" });
      assert.deepStrictEqual(yield* AtualizacaoHarnesses.atualizarAntigravity(naoInstalado.instalacao), {
        status: "ignorado",
        motivo: "nao-gerenciada",
      });
      assert.deepStrictEqual(naoInstalado.estatisticas(), { checagens: 0, inicios: 0 });

      const emCurso = yield* criarAntigravityFalso({
        resolvida: gerenciada("1.5.12"),
        estadoInicial: { installedVersion: "1.5.12", phase: "downloading" },
        versaoRemota: "1.5.14",
      });
      assert.deepStrictEqual(yield* AtualizacaoHarnesses.atualizarAntigravity(emCurso.instalacao), {
        status: "em-andamento",
      });
      assert.deepStrictEqual(emCurso.estatisticas(), { checagens: 0, inicios: 0 });
    }),
  );

  it.effect("recupera versão gerenciada retirada e reporta falha quando não há substituta", () =>
    Effect.gen(function* () {
      const recuperavel = yield* criarAntigravityFalso({
        resolvida: null,
        estadoInicial: { installedVersion: "1.5.12" },
        versaoRemota: "1.5.14",
      });
      assert.deepStrictEqual(yield* AtualizacaoHarnesses.atualizarAntigravity(recuperavel.instalacao), {
        status: "atualizado",
        de: "1.5.12",
        para: "1.5.14",
      });

      const semSubstituta = yield* criarAntigravityFalso({
        resolvida: null,
        estadoInicial: { installedVersion: "1.5.12" },
        versaoRemota: null,
      });
      const falha = yield* AtualizacaoHarnesses.atualizarAntigravity(semSubstituta.instalacao);
      assert.strictEqual(falha.status, "falhou");
    }),
  );

  it.effect("devolve falha estruturada sem quebrar o chamador quando o download falha", () =>
    Effect.gen(function* () {
      const falso = yield* criarAntigravityFalso({
        resolvida: gerenciada("1.5.12"),
        estadoInicial: { installedVersion: "1.5.12" },
        versaoRemota: "1.5.14",
        resultadoStart: "failed",
        mensagemFalha: "checksum inválido",
      });
      const resultado = yield* AtualizacaoHarnesses.atualizarAntigravity(falso.instalacao);
      assert.deepStrictEqual(resultado, { status: "falhou", detalhe: "checksum inválido" });

      const erroStart = yield* criarAntigravityFalso({
        resolvida: gerenciada("1.5.12"),
        estadoInicial: { installedVersion: "1.5.12" },
        versaoRemota: "1.5.14",
        resultadoStart: "erroStart",
        mensagemFalha: "rede bloqueada",
      });
      assert.deepStrictEqual(yield* AtualizacaoHarnesses.atualizarAntigravity(erroStart.instalacao), {
        status: "falhou",
        detalhe: "rede bloqueada",
      });
    }),
  );
});

describe("Atualização silenciosa do Codex", () => {
  const gerenciado = (version: string): CodexExecutable => ({
    executablePath: `/tmp/codex/${version}/bin/codex`,
    source: "managed",
    version,
    managedVersionDirectory: `/tmp/codex/${version}`,
  });

  const local = (version: string): CodexExecutable => ({
    executablePath: "/opt/homebrew/bin/codex",
    source: "local",
    version,
    managedVersionDirectory: null,
  });

  it.effect("atualiza cópia gerenciada quando há versão mais nova dentro da faixa (<1)", () =>
    Effect.gen(function* () {
      const falso = yield* criarCodexFalso({
        resolvida: gerenciado("0.166.0"),
        estadoInicial: { source: "managed", installedVersion: "0.166.0", version: "0.166.0" },
        versaoRemota: "0.169.0",
      });
      const resultado = yield* AtualizacaoHarnesses.atualizarCodex(falso.instalacao);
      assert.deepStrictEqual(resultado, { status: "atualizado", de: "0.166.0", para: "0.169.0" });
      assert.deepStrictEqual(falso.estatisticas(), { checagens: 1, inicios: 1 });
    }),
  );

  it.effect("recusa salto silencioso de major do Codex (1.0.0) e recupera versão retirada", () =>
    Effect.gen(function* () {
      const majorNovo = yield* criarCodexFalso({
        resolvida: gerenciado("0.169.0"),
        estadoInicial: { source: "managed", installedVersion: "0.169.0", version: "0.169.0" },
        versaoRemota: "1.0.0",
      });
      assert.deepStrictEqual(yield* AtualizacaoHarnesses.atualizarCodex(majorNovo.instalacao), {
        status: "ignorado",
        motivo: "fora-da-faixa",
      });
      assert.deepStrictEqual(majorNovo.estatisticas(), { checagens: 1, inicios: 0 });

      const retirada = yield* criarCodexFalso({
        resolvida: null,
        estadoInicial: { source: "managed", installedVersion: "0.155.0", version: "0.155.0" },
        versaoRemota: "0.169.0",
      });
      assert.deepStrictEqual(yield* AtualizacaoHarnesses.atualizarCodex(retirada.instalacao), {
        status: "atualizado",
        de: "0.155.0",
        para: "0.169.0",
      });
    }),
  );

  it.effect("ignora instalação local no PATH e máquina sem Codex", () =>
    Effect.gen(function* () {
      const comLocal = yield* criarCodexFalso({
        resolvida: local("0.166.0"),
        estadoInicial: { source: "local", installedVersion: "0.166.0" },
        versaoRemota: "0.169.0",
      });
      assert.deepStrictEqual(yield* AtualizacaoHarnesses.atualizarCodex(comLocal.instalacao), {
        status: "ignorado",
        motivo: "nao-gerenciada",
      });
      assert.deepStrictEqual(comLocal.estatisticas(), { checagens: 0, inicios: 0 });

      const ausente = yield* criarCodexFalso({ resolvida: null, versaoRemota: "0.169.0" });
      assert.deepStrictEqual(yield* AtualizacaoHarnesses.atualizarCodex(ausente.instalacao), {
        status: "ignorado",
        motivo: "nao-gerenciada",
      });
      assert.deepStrictEqual(ausente.estatisticas(), { checagens: 0, inicios: 0 });
    }),
  );

  it.effect("trata mudança para Codex local durante start como ignorada", () =>
    Effect.gen(function* () {
      const falso = yield* criarCodexFalso({
        resolvida: gerenciado("0.166.0"),
        estadoInicial: { source: "managed", installedVersion: "0.166.0", version: "0.166.0" },
        versaoRemota: "0.169.0",
        resultadoStart: "local",
      });
      assert.deepStrictEqual(yield* AtualizacaoHarnesses.atualizarCodex(falso.instalacao), {
        status: "ignorado",
        motivo: "nao-gerenciada",
      });
    }),
  );
});

describe("HTTP com redirecionamento para instalações gerenciadas", () => {
  it.live("layerHttpComRedirecionamento segue 302 (GitHub Releases para CDN)", () =>
    Effect.gen(function* () {
      const servidor = yield* Effect.acquireRelease(
        Effect.promise(
          () =>
            new Promise<{ readonly server: NodeHttp.Server; readonly porta: number }>((resolver) => {
              const server = NodeHttp.createServer((req, res) => {
                if (req.url === "/codex-checksums") {
                  res.writeHead(302, { location: "/cdn/codex-checksums" });
                  res.end();
                  return;
                }
                res.writeHead(200, { "content-type": "text/plain" });
                res.end("ok-cdn");
              });
              server.listen(0, "127.0.0.1", () => {
                const endereco = server.address();
                resolver({ server, porta: typeof endereco === "object" && endereco !== null ? endereco.port : 0 });
              });
            }),
        ),
        ({ server }) => Effect.promise(() => new Promise<void>((resolver) => server.close(() => resolver()))),
      );
      const http = yield* HttpClient.HttpClient;
      const corpo = yield* http.get(`http://127.0.0.1:${servidor.porta}/codex-checksums`).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((res) => res.text),
      );
      assert.strictEqual(corpo, "ok-cdn");
    }).pipe(Effect.scoped, Effect.provide(layerHttpComRedirecionamento())),
  );
});

describe("Limpeza de versões antigas em disco", () => {
  it.effect("Antigravity: mantém ativa + 1 anterior semver, ignora symlinks e legado, limpa staging (>24h)", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const raiz = yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-limpar-agy-" });
      const versoes = path.join(raiz, "versions");
      yield* fs.makeDirectory(versoes, { recursive: true });

      const criarVersao = (id: string, version: string, releaseIdNoArquivo = id) =>
        Effect.gen(function* () {
          const pasta = path.join(versoes, id);
          yield* fs.makeDirectory(pasta, { recursive: true });
          yield* fs.writeFileString(
            path.join(pasta, ".install-complete.json"),
            JSON.stringify({ releaseId: releaseIdNoArquivo, version }),
          );
        });

      const idLegado = hash64("0");
      const id11 = hash64("2");
      const id12 = hash64("3");
      const id14 = hash64("4");
      const idDivergente = hash64("5");
      const idSymlink = hash64("6");
      yield* criarVersao(idLegado, "agy_acp_server_1.1.1");
      yield* criarVersao(id11, "1.5.11");
      yield* criarVersao(id12, "1.5.12");
      yield* criarVersao(id14, "1.5.14");
      // Registro com releaseId diferente do nome da pasta: não entra na limpeza.
      yield* criarVersao(idDivergente, "1.5.8", hash64("f"));
      // Symlink para a versão ativa: não deve ser seguido nem contado nem apagado.
      yield* fs.symlink(path.join(versoes, id14), path.join(versoes, idSymlink));
      yield* fs.writeFileString(path.join(raiz, "active.json"), JSON.stringify({ releaseId: id14 }));

      // Staging vencido (>24h) e `.remover-*` órfão são removidos; arquivo comum `active.json.bak` fica intacto.
      const stagingVelho = path.join(versoes, ".install-velho");
      const stagingNovo = path.join(versoes, ".install-novo");
      const activeStagingVelho = path.join(raiz, "active.json.velho");
      const arquivoActiveBak = path.join(raiz, "active.json.bak");
      const remocaoOrfa = path.join(versoes, `.remover-${hash64("9")}`);
      const outro = path.join(versoes, "nota.txt");
      yield* fs.makeDirectory(stagingVelho, { recursive: true });
      yield* fs.makeDirectory(stagingNovo, { recursive: true });
      yield* fs.makeDirectory(activeStagingVelho, { recursive: true });
      yield* fs.makeDirectory(remocaoOrfa, { recursive: true });
      yield* fs.writeFileString(arquivoActiveBak, "backup");
      yield* fs.writeFileString(outro, "manter");
      const agora = 48 * 60 * 60 * 1000;
      yield* TestClock.setTime(agora);
      const dataVelha = DateTime.toDateUtc(DateTime.makeUnsafe(0));
      const dataNova = DateTime.toDateUtc(DateTime.makeUnsafe(agora - 60_000));
      yield* fs.utimes(stagingVelho, dataVelha, dataVelha);
      yield* fs.utimes(activeStagingVelho, dataVelha, dataVelha);
      yield* fs.utimes(arquivoActiveBak, dataVelha, dataVelha);
      yield* fs.utimes(stagingNovo, dataNova, dataNova);

      const removidas = yield* AtualizacaoHarnesses.limparVersoesAntigasAntigravity(raiz);
      assert.strictEqual(removidas, 2);
      // Mantém ativa (1.5.14) e a semver imediatamente anterior (1.5.12); remove 1.5.11 e a legada agy_acp_server_1.1.1.
      assert.isTrue(yield* fs.exists(path.join(versoes, id14)));
      assert.isTrue(yield* fs.exists(path.join(versoes, id12)));
      assert.isFalse(yield* fs.exists(path.join(versoes, id11)));
      assert.isFalse(yield* fs.exists(path.join(versoes, idLegado)));
      // Protegidos: divergente, symlink, staging recente, arquivo comum `active.json.bak` e nota.
      assert.isTrue(yield* fs.exists(path.join(versoes, idDivergente)));
      assert.isTrue(yield* fs.exists(path.join(versoes, idSymlink)));
      assert.isFalse(yield* fs.exists(stagingVelho));
      assert.isFalse(yield* fs.exists(activeStagingVelho));
      assert.isFalse(yield* fs.exists(remocaoOrfa));
      assert.isTrue(yield* fs.exists(stagingNovo));
      assert.isTrue(yield* fs.exists(arquivoActiveBak));
      assert.isTrue(yield* fs.exists(outro));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("Antigravity: não apaga versões se active.json está corrompido ou aponta para pasta ausente", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const raiz = yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-limpar-agy-invalido-" });
      const versoes = path.join(raiz, "versions");
      const id12 = hash64("3");
      const id11 = hash64("2");
      for (const [id, version] of [
        [id11, "1.5.11"],
        [id12, "1.5.12"],
      ] as const) {
        const pasta = path.join(versoes, id);
        yield* fs.makeDirectory(pasta, { recursive: true });
        yield* fs.writeFileString(
          path.join(pasta, ".install-complete.json"),
          JSON.stringify({ releaseId: id, version }),
        );
      }
      // JSON corrompido
      yield* fs.writeFileString(path.join(raiz, "active.json"), "{invalido");
      assert.strictEqual(yield* AtualizacaoHarnesses.limparVersoesAntigasAntigravity(raiz), 0);
      // Aponta para release inexistente em disco
      yield* fs.writeFileString(path.join(raiz, "active.json"), JSON.stringify({ releaseId: hash64("a") }));
      assert.strictEqual(yield* AtualizacaoHarnesses.limparVersoesAntigasAntigravity(raiz), 0);
      assert.isTrue(yield* fs.exists(path.join(versoes, id11)));
      assert.isTrue(yield* fs.exists(path.join(versoes, id12)));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("Codex: mantém ativa + 1 anterior, ignora symlinks e não apaga sem active.json ou em andamento", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const raiz = yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-limpar-codex-" });

      const criarVersao = (version: string) =>
        Effect.gen(function* () {
          const pasta = path.join(raiz, version);
          yield* fs.makeDirectory(pasta, { recursive: true });
          yield* fs.writeFileString(path.join(pasta, ".install-complete.json"), JSON.stringify({ version }));
        });

      yield* criarVersao("0.160.0");
      yield* criarVersao("0.166.0");
      yield* criarVersao("0.169.0");
      yield* fs.symlink(path.join(raiz, "0.169.0"), path.join(raiz, "0.168.0"));
      yield* fs.makeDirectory(path.join(raiz, ".install-em-curso"), { recursive: true });

      // Sem active.json: não apaga versões.
      assert.strictEqual(yield* AtualizacaoHarnesses.limparVersoesAntigasCodex(raiz), 0);

      yield* fs.writeFileString(path.join(raiz, "active.json"), JSON.stringify({ version: "0.169.0" }));

      // Com instalação em andamento: não apaga nada.
      assert.strictEqual(
        yield* AtualizacaoHarnesses.limparVersoesAntigasCodex(raiz, { emAndamento: Effect.succeed(true) }),
        0,
      );

      // Agora limpa: mantém 0.169.0 (ativa) e 0.166.0 (anterior), remove 0.160.0, preserva symlink 0.168.0.
      assert.strictEqual(yield* AtualizacaoHarnesses.limparVersoesAntigasCodex(raiz), 1);
      assert.isTrue(yield* fs.exists(path.join(raiz, "0.169.0")));
      assert.isTrue(yield* fs.exists(path.join(raiz, "0.166.0")));
      assert.isTrue(yield* fs.exists(path.join(raiz, "0.168.0")));
      assert.isFalse(yield* fs.exists(path.join(raiz, "0.160.0")));
      assert.isTrue(yield* fs.exists(path.join(raiz, ".install-em-curso")));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("Motor: atualização e trava de limpeza com sessão ou operação ativa", () => {
  it.effect("bloqueia limpeza durante detectar e sessão aberta, e respeita política de providers", () =>
    Effect.gen(function* () {
      let limpezasAgy = 0;
      let limpezasCodex = 0;
      const detectarEntrou = yield* Deferred.make<void>();
      const liberarDetectar = yield* Deferred.make<void>();
      const criarDriver = (
        aoLimpar: () => void,
        atualizacao: Motor.ResultadoAtualizacaoHarness,
        bloquearDetectar = false,
      ): Motor.Driver => ({
        detectar: bloquearDetectar
          ? Effect.gen(function* () {
              yield* Deferred.succeed(detectarEntrou, undefined);
              yield* Deferred.await(liberarDetectar);
              return { provider: "antigravity" as const, instalado: true, autenticado: true };
            })
          : Effect.succeed({ provider: "codex", instalado: true, autenticado: true }),
        iniciar: () =>
          Effect.succeed({
            enviar: () => Stream.empty,
            responder: () => Effect.void,
            interromper: Effect.void,
          }),
        atualizarHarness: Effect.succeed(atualizacao),
        limparVersoesAntigas: Effect.sync(() => {
          aoLimpar();
          return 1;
        }),
      });
      const semAtualizacao: Motor.Driver = {
        detectar: Effect.succeed({ provider: "claude", instalado: true, autenticado: true }),
        iniciar: () =>
          Effect.succeed({
            enviar: () => Stream.empty,
            responder: () => Effect.void,
            interromper: Effect.void,
          }),
      };
      const drivers = Motor.Drivers.of({
        claude: semAtualizacao,
        codex: criarDriver(
          () => {
            limpezasCodex += 1;
          },
          { status: "em-dia", versao: "0.169.0" },
        ),
        antigravity: criarDriver(
          () => {
            limpezasAgy += 1;
          },
          { status: "atualizado", de: "1.5.12", para: "1.5.14" },
          true,
        ),
      });
      const camada = Motor.layer.pipe(
        Layer.provide(Layer.succeed(Motor.Drivers, drivers)),
        Layer.provide(NodeServices.layer),
      );
      yield* Effect.gen(function* () {
        const motor = yield* Motor.Motor;
        assert.deepStrictEqual(yield* motor.atualizarHarness("claude"), {
          status: "ignorado",
          motivo: "nao-suportado",
        });
        assert.deepStrictEqual(yield* motor.atualizarHarness("antigravity"), {
          status: "atualizado",
          de: "1.5.12",
          para: "1.5.14",
        });

        // Durante `detectar`, a limpeza do mesmo provider espera.
        const fibraDetectar = yield* motor.detectar("antigravity").pipe(Effect.forkChild);
        yield* Deferred.await(detectarEntrou);
        assert.strictEqual(yield* motor.limparVersoesAntigasHarness("antigravity"), 0);
        yield* Deferred.succeed(liberarDetectar, undefined);
        yield* Fiber.join(fibraDetectar);

        // Com sessão aberta do Antigravity, só o Codex pode limpar; Antigravity espera.
        const sessao = yield* motor.iniciarSessao({
          provider: "antigravity",
          pastaTrabalho: "/tmp",
          servidoresMcp: [],
        });
        assert.strictEqual(yield* motor.limparVersoesAntigasHarness("antigravity"), 0);
        assert.strictEqual(yield* motor.limparVersoesAntigasHarness("codex"), 1);
        assert.strictEqual(limpezasAgy, 0);
        assert.strictEqual(limpezasCodex, 1);

        // Encerrada a sessão, o Antigravity limpa normalmente.
        yield* motor.encerrar(sessao);
        assert.strictEqual(yield* motor.limparVersoesAntigasHarness("antigravity"), 1);
        assert.strictEqual(limpezasAgy, 1);
      }).pipe(Effect.provide(camada));

      // Provider fora da política retorna `desligada`.
      const soClaude = { ...Motor.POLITICA_FABRICA, providers: ["claude" as const] };
      const camadaRestrita = Motor.layerComPolitica(soClaude).pipe(
        Layer.provide(Layer.succeed(Motor.Drivers, drivers)),
        Layer.provide(NodeServices.layer),
      );
      yield* Effect.gen(function* () {
        const motor = yield* Motor.Motor;
        assert.deepStrictEqual(yield* motor.atualizarHarness("antigravity"), {
          status: "ignorado",
          motivo: "desligada",
        });
      }).pipe(Effect.provide(camadaRestrita));
    }),
  );

  it.effect("aguardarConclusao acompanha transição assíncrona via SubscriptionRef até o fim", () =>
    Effect.gen(function* () {
      const iniciou = yield* Deferred.make<void>();
      const liberar = yield* Deferred.make<void>();
      const ref = yield* SubscriptionRef.make(
        estadoBase("antigravity", { installedVersion: "1.5.12", version: "1.5.12" }),
      );
      const instalacao = {
        resolve: () =>
          Effect.succeed({
            executablePath: "/tmp/agy",
            harnessPath: null,
            source: "managed" as const,
            version: "1.5.12",
            managedVersionDirectory: "/tmp/agy",
          }),
        state: SubscriptionRef.get(ref),
        changes: SubscriptionRef.changes(ref),
        checkForUpdate: SubscriptionRef.update(ref, (atual) => ({ ...atual, version: "1.5.14" })),
        start: Effect.gen(function* () {
          const iniciando = yield* SubscriptionRef.updateAndGet(ref, (atual) => ({
            ...atual,
            operationId: "op-async",
            phase: "downloading" as const,
            version: "1.5.14",
          }));
          yield* Deferred.succeed(iniciou, undefined);
          yield* Effect.forkChild(
            Deferred.await(liberar).pipe(
              Effect.andThen(
                SubscriptionRef.update(ref, (atual) => ({
                  ...atual,
                  phase: "succeeded" as const,
                  installedVersion: "1.5.14",
                })),
              ),
            ),
          );
          return iniciando;
        }),
      };
      const fibra = yield* AtualizacaoHarnesses.atualizarAntigravity(instalacao).pipe(Effect.forkChild);
      yield* Deferred.await(iniciou);
      yield* Deferred.succeed(liberar, undefined);
      const resultado = yield* Fiber.join(fibra);
      assert.deepStrictEqual(resultado, { status: "atualizado", de: "1.5.12", para: "1.5.14" });
    }),
  );
});
