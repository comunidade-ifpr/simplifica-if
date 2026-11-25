/**
 * O `Motor` sobre um driver falso feito com o mesmo `Canal` dos drivers reais: o turno, a ida e
 * volta da aprovação, o turno concorrente, a interrupção e o encerramento.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as Canal from "../src/Canal.ts";
import * as Motor from "../src/Motor.ts";

interface Registro {
  encerradas: number;
  interrompidas: number;
}

/** Driver falso: pede aprovação para "escrever" e conclui conforme a decisão. */
const driverFalso = (registro: Registro): Motor.Driver => ({
  detectar: Effect.succeed({ provider: "claude", instalado: true, autenticado: true, plano: "teste" }),
  iniciar: () =>
    Effect.gen(function* () {
      const canal = yield* Canal.make;
      const escopo = yield* Effect.scope;
      yield* Effect.addFinalizer(() => Effect.sync(() => registro.encerradas++));
      const responder = (texto: string) =>
        Effect.gen(function* () {
          yield* canal.emitir({ _tag: "TextoParcial", texto: "Vou " });
          yield* canal.emitir({
            _tag: "FerramentaIniciada",
            id: "f1",
            nome: "escrever",
            tipo: "escrita",
            entrada: { texto },
          });
          const decisao = yield* canal.pedirAprovacao({
            id: "f1",
            ferramenta: "escrever",
            tipo: "escrita",
            descricao: "escrever um arquivo",
            entrada: { texto },
          });
          yield* canal.emitir({
            _tag: "FerramentaConcluida",
            id: "f1",
            nome: "escrever",
            resumo: decisao,
            falhou: decisao === "negar",
          });
          yield* canal.emitir({ _tag: "TextoFinal", texto: `Vou ${decisao}` });
          yield* canal.emitir({ _tag: "FimTurno", motivo: "concluido" });
        });
      return {
        enviar: (texto) => canal.turno(Effect.asVoid(Effect.forkIn(responder(texto), escopo))),
        responder: canal.responder,
        interromper: Effect.sync(() => registro.interrompidas++),
      } satisfies Motor.SessaoDriver;
    }),
});

const camada = (registro: Registro) => {
  const driver = driverFalso(registro);
  return Motor.layer.pipe(
    Layer.provide(
      Layer.succeed(Motor.Drivers, Motor.Drivers.of({ claude: driver, codex: driver, antigravity: driver })),
    ),
    Layer.provide(NodeServices.layer),
  );
};

const CONFIG = { provider: "claude", pastaTrabalho: "/tmp", servidoresMcp: [] } satisfies Motor.ConfigSessao;

/** Consome o turno respondendo ao pedido de aprovação com `decisao`. */
const turnoRespondendo = (sessao: string, decisao: Motor.Decisao) =>
  Effect.gen(function* () {
    const motor = yield* Motor.Motor;
    return yield* motor.enviarMensagem(sessao, "olá").pipe(
      Stream.tap((evento) =>
        evento._tag === "PedidoAprovacao" ? motor.responderAprovacao(sessao, evento.id, decisao) : Effect.void,
      ),
      Stream.runCollect,
    );
  });

describe("Motor", () => {
  it.effect("ida e volta da aprovação: negar e depois permitir", () => {
    const registro = { encerradas: 0, interrompidas: 0 };
    return Effect.gen(function* () {
      const motor = yield* Motor.Motor;
      const sessao = yield* motor.iniciarSessao(CONFIG);
      assert.strictEqual(sessao, "claude-1");

      const negado = yield* turnoRespondendo(sessao, "negar");
      assert.deepStrictEqual(
        negado.map((evento) => evento._tag),
        ["TextoParcial", "FerramentaIniciada", "PedidoAprovacao", "FerramentaConcluida", "TextoFinal", "FimTurno"],
      );
      assert.deepInclude(negado[3], { falhou: true, resumo: "negar" });

      const permitido = yield* turnoRespondendo(sessao, "permitir");
      assert.deepInclude(permitido[3], { falhou: false, resumo: "permitir" });

      yield* motor.encerrar(sessao);
      assert.strictEqual(registro.encerradas, 1);
    }).pipe(Effect.provide(camada(registro)));
  });

  it.effect("erros tipados: aprovação desconhecida, turno em andamento, sessão encerrada", () => {
    const registro = { encerradas: 0, interrompidas: 0 };
    return Effect.gen(function* () {
      const motor = yield* Motor.Motor;
      const sessao = yield* motor.iniciarSessao(CONFIG);

      const desconhecida = yield* Effect.exit(motor.responderAprovacao(sessao, "nada", "permitir"));
      assert.isTrue(Exit.hasFails(desconhecida));

      // Um turno parado no pedido de aprovação; um segundo envio na mesma sessão é recusado.
      const primeiro = yield* motor.enviarMensagem(sessao, "um").pipe(
        Stream.takeUntil((evento) => evento._tag === "PedidoAprovacao"),
        Stream.runCollect,
        Effect.forkChild,
      );
      const eventos = yield* Fiber.join(primeiro);
      assert.strictEqual(eventos.at(-1)?._tag, "PedidoAprovacao");
      const segundo = yield* Effect.exit(Stream.runDrain(motor.enviarMensagem(sessao, "dois")));
      assert.isTrue(Exit.hasFails(segundo));
      // Respondido o pedido, o provider termina o turno, e a sessão aceita um novo envio.
      yield* motor.responderAprovacao(sessao, "f1", "negar");
      const terceiro = yield* turnoRespondendo(sessao, "permitir");
      assert.strictEqual(terceiro.at(-1)?._tag, "FimTurno");

      yield* motor.interromper(sessao);
      assert.strictEqual(registro.interrompidas, 1);

      yield* motor.encerrar(sessao);
      const depois = yield* Effect.exit(motor.encerrar(sessao));
      assert.isTrue(Exit.hasFails(depois));
    }).pipe(Effect.provide(camada(registro)));
  });

  it.effect("encerrar a layer encerra as sessões abertas", () => {
    const registro = { encerradas: 0, interrompidas: 0 };
    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const motor = yield* Motor.Motor;
        yield* motor.iniciarSessao(CONFIG);
        yield* motor.iniciarSessao({ ...CONFIG, provider: "codex" });
        assert.strictEqual(registro.encerradas, 0);
      }).pipe(Effect.provide(camada(registro)));
      assert.strictEqual(registro.encerradas, 2);
    });
  });

  it.effect("detectar repassa o estado do driver e diz o que o app oferece", () => {
    const registro = { encerradas: 0, interrompidas: 0 };
    return Effect.gen(function* () {
      const motor = yield* Motor.Motor;
      const estado = yield* motor.detectar("codex");
      assert.deepStrictEqual(estado, {
        provider: "claude",
        instalado: true,
        autenticado: true,
        plano: "teste",
        podeInstalar: false,
        podeEntrar: false,
      });
    }).pipe(Effect.provide(camada(registro)));
  });

  it.effect("podeInstalar e podeEntrar seguem o driver ter instalar e entrar", () => {
    const registro = { encerradas: 0, interrompidas: 0 };
    const base = driverFalso(registro);
    const drivers = Motor.Drivers.of({
      claude: base,
      codex: { ...base, instalar: Stream.empty },
      antigravity: { ...base, instalar: Stream.empty, entrar: Stream.empty },
    });
    return Effect.gen(function* () {
      const motor = yield* Motor.Motor;
      const capacidades = yield* Effect.forEach(["claude", "codex", "antigravity"] as const, (provider) =>
        Effect.map(motor.detectar(provider), ({ podeInstalar, podeEntrar }) => ({ podeInstalar, podeEntrar })),
      );
      assert.deepStrictEqual(capacidades, [
        { podeInstalar: false, podeEntrar: false },
        { podeInstalar: true, podeEntrar: false },
        { podeInstalar: true, podeEntrar: true },
      ]);
    }).pipe(
      Effect.provide(
        Motor.layer.pipe(Layer.provide(Layer.succeed(Motor.Drivers, drivers)), Layer.provide(NodeServices.layer)),
      ),
    );
  });

  it.effect("queda: o turno corrente falha, os próximos são recusados, e o motor informa o id nativo e a queda", () =>
    Effect.gen(function* () {
      const canal = yield* Canal.make;
      const queda = yield* Deferred.make<Motor.FalhaProvider>();
      const driver: Motor.Driver = {
        detectar: Effect.succeed({ provider: "claude", instalado: true, autenticado: true }),
        iniciar: (config) =>
          Effect.succeed({
            idNativo: config.retomar ?? "nativo-1",
            queda: Deferred.await(queda),
            enviar: () => canal.turno(Effect.void),
            responder: canal.responder,
            interromper: Effect.void,
          } satisfies Motor.SessaoDriver),
      };
      const camadaQueda = Motor.layer.pipe(
        Layer.provide(
          Layer.succeed(Motor.Drivers, Motor.Drivers.of({ claude: driver, codex: driver, antigravity: driver })),
        ),
        Layer.provide(NodeServices.layer),
      );
      yield* Effect.gen(function* () {
        const motor = yield* Motor.Motor;
        const sessao = yield* motor.iniciarSessao(CONFIG);
        const info = yield* motor.infoSessao(sessao);
        assert.strictEqual(info.idNativo, "nativo-1");
        const retomada = yield* motor.infoSessao(yield* motor.iniciarSessao({ ...CONFIG, retomar: "nativo-9" }));
        assert.strictEqual(retomada.idNativo, "nativo-9");

        const turno = yield* Stream.runCollect(motor.enviarMensagem(sessao, "olá")).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        const falha = new Motor.FalhaProvider({ provider: "claude", operacao: "sessão", tipo: "queda" });
        yield* canal.morrer(falha);
        yield* Deferred.succeed(queda, falha);
        const saida = yield* Fiber.await(turno);
        assert.isTrue(Exit.hasFails(saida));
        assert.strictEqual(yield* info.queda, falha);
        const depois = yield* Effect.flip(Stream.runDrain(motor.enviarMensagem(sessao, "de novo")));
        assert.strictEqual(depois, falha);
      }).pipe(Effect.provide(camadaQueda));
    }),
  );
});

/**
 * Driver falso que aplica a política pelo `Canal`, como os reais: três pedidos por turno (uma
 * ferramenta do `ifpr`, uma escrita fora da pasta e uma dentro), com a resposta de cada um.
 */
const driverComPolitica = (configs: Array<{ config: Motor.ConfigSessao; politica: Motor.Politica }>): Motor.Driver => ({
  detectar: Effect.succeed({ provider: "claude", instalado: true, autenticado: true }),
  iniciar: (config, politica) =>
    Effect.gen(function* () {
      configs.push({ config, politica });
      const canal = yield* Canal.comPolitica(politica, config.pastaTrabalho);
      const escopo = yield* Effect.scope;
      const pedidos = [
        { id: "a", ferramenta: "ifpr.buscar_norma", classe: { tipo: "mcp-app", caminhos: [] } },
        { id: "b", ferramenta: "Write", classe: { tipo: "escrita", caminhos: ["/etc/fora.txt"] } },
        { id: "c", ferramenta: "Write", classe: { tipo: "escrita", caminhos: ["dentro.txt"] } },
      ] as const;
      const responder = Effect.gen(function* () {
        for (const pedido of pedidos) {
          const resposta = yield* canal.aprovar({ ...pedido, descricao: "teste", entrada: {} });
          yield* canal.emitir({
            _tag: "FerramentaConcluida",
            id: pedido.id,
            nome: pedido.ferramenta,
            resumo: resposta.motivo ?? resposta.decisao,
            falhou: resposta.decisao === "negar",
          });
        }
        yield* canal.emitir({ _tag: "FimTurno", motivo: "concluido" });
      });
      return {
        enviar: () => canal.turno(Effect.asVoid(Effect.forkIn(responder, escopo))),
        responder: canal.responder,
        interromper: Effect.void,
      } satisfies Motor.SessaoDriver;
    }),
});

const camadaComPolitica = (
  configs: Array<{ config: Motor.ConfigSessao; politica: Motor.Politica }>,
  politica: Motor.Politica = Motor.POLITICA_FABRICA,
) => {
  const driver = driverComPolitica(configs);
  return Motor.layerComPolitica(politica).pipe(
    Layer.provide(
      Layer.succeed(Motor.Drivers, Motor.Drivers.of({ claude: driver, codex: driver, antigravity: driver })),
    ),
    Layer.provide(NodeServices.layer),
  );
};

describe("Motor: política e skills", () => {
  it.effect("aprovações pela política: ifpr passa, fora da pasta se nega sem perguntar, dentro pergunta", () =>
    Effect.gen(function* () {
      const motor = yield* Motor.Motor;
      const sessao = yield* motor.iniciarSessao({ ...CONFIG, pastaTrabalho: "/Users/servidor/tarefa" });
      const eventos = yield* turnoRespondendo(sessao, "permitir");
      const pedidos = eventos.filter((evento) => evento._tag === "PedidoAprovacao");
      assert.deepStrictEqual(
        pedidos.map((evento) => evento.id),
        ["c"],
      );
      const concluidas = eventos.flatMap((evento) =>
        evento._tag === "FerramentaConcluida" ? [[evento.id, evento.falhou, evento.resumo]] : [],
      );
      assert.deepStrictEqual(concluidas, [
        ["a", false, "A política do app permite usar as ferramentas do app."],
        ["b", true, "A política do app não permite alterar arquivos fora da pasta de trabalho."],
        ["c", false, "permitir"],
      ]);
    }).pipe(Effect.provide(camadaComPolitica([]))),
  );

  it.effect("sessão de julgamento: política que nega tudo sem perguntar, e nunca com MCP ou skills", () => {
    const configs: Array<{ config: Motor.ConfigSessao; politica: Motor.Politica }> = [];
    return Effect.gen(function* () {
      const motor = yield* Motor.Motor;
      const sessao = yield* motor.iniciarSessao({
        ...CONFIG,
        pastaTrabalho: "/Users/servidor/tarefa",
        semFerramentas: true,
      });
      assert.strictEqual(configs[0]?.politica, Motor.POLITICA_JULGAMENTO);
      const eventos = yield* turnoRespondendo(sessao, "permitir");
      // Nenhum pedido chega à interface: o ifpr, a escrita fora e a escrita dentro se negam sozinhos.
      assert.isFalse(eventos.some((evento) => evento._tag === "PedidoAprovacao"));
      assert.deepStrictEqual(
        eventos.flatMap((evento) => (evento._tag === "FerramentaConcluida" ? [evento.falhou] : [])),
        [true, true, true],
      );
      const comMcp = yield* Effect.exit(
        motor.iniciarSessao({
          ...CONFIG,
          semFerramentas: true,
          servidoresMcp: [{ nome: "ifpr", url: "http://127.0.0.1:1/mcp", preAprovado: true }],
        }),
      );
      assert.isTrue(Exit.hasFails(comMcp));
    }).pipe(Effect.provide(camadaComPolitica(configs)));
  });

  it.effect(
    "provider fora da política não abre sessão; instruções de web entram na conversa normal e nunca no julgamento",
    () => {
      const configs: Array<{ config: Motor.ConfigSessao; politica: Motor.Politica }> = [];
      const soClaude = { ...Motor.POLITICA_FABRICA, providers: ["claude" as const] };
      return Effect.gen(function* () {
        const motor = yield* Motor.Motor;
        const recusada = yield* Effect.exit(motor.iniciarSessao({ ...CONFIG, provider: "codex" }));
        assert.isTrue(Exit.hasFails(recusada));
        yield* motor.iniciarSessao({ ...CONFIG });
        yield* motor.iniciarSessao({ ...CONFIG, semFerramentas: true, instrucoes: "só julgamento" });
        assert.strictEqual(configs.length, 2);
        assert.strictEqual(configs[0]?.politica, soClaude);
        assert.match(configs[0]?.config.instrucoes ?? "", /Base primeiro/);
        assert.strictEqual(configs[1]?.politica, Motor.POLITICA_JULGAMENTO);
        assert.strictEqual(configs[1]?.config.instrucoes, "só julgamento");
      }).pipe(Effect.provide(camadaComPolitica(configs, soClaude)));
    },
  );

  it.effect("skills: grava SKILL.md e arquivos na pasta de trabalho e passa as instruções ao driver", () => {
    const configs: Array<{ config: Motor.ConfigSessao; politica: Motor.Politica }> = [];
    return Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const pasta = yield* fs.makeTempDirectoryScoped({ prefix: "simplifica-skills-" });
      const motor = yield* Motor.Motor;
      yield* motor.iniciarSessao({
        ...CONFIG,
        pastaTrabalho: pasta,
        instrucoes: "Responda em português.",
        skills: [
          {
            nome: "saudacao-ifpr",
            descricao: "Use quando o usuário pedir a saudação do IFPR.",
            instrucoes: "Responda com a frase do arquivo frase.txt.",
            arquivos: [{ caminho: "frase.txt", conteudo: "Olá do IFPR" }],
          },
        ],
      });
      const raiz = path.join(pasta, ".simplifica", "skills", "saudacao-ifpr");
      const skillMd = yield* fs.readFileString(path.join(raiz, "SKILL.md"));
      assert.match(skillMd, /^---\nname: saudacao-ifpr\ndescription: "Use quando/);
      assert.match(skillMd, /Responda com a frase do arquivo frase.txt./);
      assert.strictEqual(yield* fs.readFileString(path.join(raiz, "frase.txt")), "Olá do IFPR");
      const instrucoes = configs[0]?.config.instrucoes ?? "";
      assert.match(
        instrucoes,
        /^Responda em português\.\n\n## Uso da base do IFPR[\s\S]+\n\n## Skills do Simplifica IF/,
      );
      assert.include(instrucoes, `\`saudacao-ifpr\`: Use quando o usuário pedir a saudação do IFPR.`);
      assert.include(instrucoes, path.join(raiz, "SKILL.md"));

      const invalida = yield* Effect.exit(
        motor.iniciarSessao({
          ...CONFIG,
          pastaTrabalho: pasta,
          skills: [
            { nome: "x", descricao: "x", instrucoes: "x", arquivos: [{ caminho: "../fora.txt", conteudo: "" }] },
          ],
        }),
      );
      assert.isTrue(Exit.hasFails(invalida));
      assert.isFalse(yield* fs.exists(path.join(pasta, ".simplifica", "skills", "fora.txt")));
    }).pipe(Effect.scoped, Effect.provide(camadaComPolitica(configs).pipe(Layer.provideMerge(NodeServices.layer))));
  });
});
