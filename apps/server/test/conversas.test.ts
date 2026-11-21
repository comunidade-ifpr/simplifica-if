// @effect-diagnostics nodeBuiltinImport:off -- teste: o caminho real da pasta temporária
/**
 * As `Conversas` de verdade, sobre o motor com o driver falso (`apoio.ts`), o MCP HTTP do banco de
 * fixture e o banco das conversas num arquivo temporário, com o `TestClock`: a gravação e a lista, as
 * migrações, a retomada depois de fechar (outra layer com o mesmo banco), a conversa que uma execução
 * anterior deixou aberta, a retomada recusada (o histórico como contexto), a queda do processo do
 * provider no meio do turno e fora dele, a ociosidade, a interrupção, o acompanhar de um turno em
 * andamento e as skills do catálogo em toda sessão aberta (nova, retomada, recomeçada).
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import type * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import { type EventoConversa, type ItemConversa, MOTIVO_PARADO_ANTES_DO_ENVIO } from "@simplifica-if/contratos-app";
import * as McpHttp from "@simplifica-if/mcp/http";
import * as Motor from "@simplifica-if/motor";
import type { SkillDoApp } from "@simplifica-if/mcp/skills";
import * as CatalogoSkills from "../src/CatalogoSkills.ts";
import * as ArquivosLiberados from "../src/ArquivosLiberados.ts";
import * as PastasTrabalho from "../src/PastasTrabalho.ts";
import * as TextosAnexos from "../src/textos-anexos/TextosAnexos.ts";
import * as Conversas from "../src/Conversas.ts";
import * as Banco from "../src/persistencia/Banco.ts";
import * as Historico from "../src/persistencia/Historico.ts";
import * as Preferencias from "../src/persistencia/Preferencias.ts";
import {
  bancoFixture,
  diretorioTemporario,
  layerDriversFalsos,
  limparTemporarios,
  novoRegistro,
  type Registro,
} from "./apoio.ts";

afterAll(limparTemporarios);

const pasta = diretorioTemporario("simplifica-conversas-");
const kb = bancoFixture();
const PRAZO = Duration.seconds(15);

/** Um arquivo de banco novo por teste. */
let contador = 0;
const novoBanco = () => `${diretorioTemporario("simplifica-banco-")}/conversas-${++contador}.sqlite`;

/** Uma skill do catálogo de teste, já lida (o `CatalogoSkills` a passa ao motor sem o manifesto). */
const SKILL: SkillDoApp = {
  nome: "skill-de-teste",
  descricao: "Use para testar a entrega das skills.",
  instrucoes: "# Skill de teste\n\nLeia `referencia.md`.",
  arquivos: [{ caminho: "referencia.md", conteudo: "referência" }],
  manifesto: {
    titulo: "Teste",
    resumo: "Uma skill de teste.",
    area: "ensino",
    ferramentas: [],
    arquivos: ["referencia.md"],
  },
  pasta: "/nao/usada",
};

/** As pastas sem pastas de tarefa, com o retrato do fim do turno que lança um defeito. */
const layerRetratoComDefeito = Layer.effect(
  PastasTrabalho.PastasTrabalho,
  Effect.gen(function* () {
    const pastas = yield* PastasTrabalho.PastasTrabalho;
    return PastasTrabalho.PastasTrabalho.of({
      ...pastas,
      fecharTurno: () => Effect.die(new Error("retrato com defeito")),
    });
  }),
).pipe(Layer.provide(PastasTrabalho.layerSemPastas));

/** As pastas do turno; as de verdade pedem o histórico e o sistema de arquivos, que a camada dá. */
type CamadaPastas = Layer.Layer<
  PastasTrabalho.PastasTrabalho,
  never,
  Historico.Historico | FileSystem.FileSystem | Path.Path
>;

const camada = (
  arquivo: string,
  registro: Registro,
  pastas: CamadaPastas = PastasTrabalho.layerSemPastas,
  preferencias: typeof Preferencias.layer = Preferencias.layerPrimeiroUsoFeito,
) =>
  Conversas.layer({ prazoInterrupcao: PRAZO }).pipe(
    Layer.provideMerge(Motor.layer),
    Layer.provideMerge(CatalogoSkills.layerFixo([SKILL])),
    Layer.provide(pastas),
    Layer.provideMerge(Historico.layer),
    Layer.provideMerge(preferencias),
    Layer.provideMerge(Banco.layerArquivo(arquivo)),
    Layer.provide(McpHttp.layer({ banco: kb })),
    Layer.provide(layerDriversFalsos(registro)),
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layerSecureRandom)),
  );

/**
 * Abre o servidor de conversas (como o app que abre) num escopo próprio; `fechar` o encerra como o
 * app que fecha.
 */
const abrir = (arquivo: string, registro: Registro, pastas?: CamadaPastas, preferencias?: typeof Preferencias.layer) =>
  Effect.gen(function* () {
    const escopo = yield* Scope.make();
    const contexto = yield* Layer.buildWithScope(camada(arquivo, registro, pastas, preferencias), escopo);
    return {
      conversas: Context.get(contexto, Conversas.Conversas),
      preferencias: Context.get(contexto, Preferencias.Preferencias),
      historico: Context.get(contexto, Historico.Historico),
      sql: Context.get(contexto, SqlClient.SqlClient),
      fechar: Scope.close(escopo, Exit.void),
    };
  });

/** Deixa rodar o que está pronto (fibers forkados, o vigia da queda). */
const rodar = Effect.gen(function* () {
  for (let i = 0; i < 20; i++) yield* Effect.yieldNow;
});

/** Avança o relógio e deixa rodar o que acordou. */
const avancar = (duracao: Duration.Input) => Effect.andThen(TestClock.adjust(duracao), rodar);

const tags = (eventos: Iterable<EventoConversa>) => [...eventos].map((evento) => evento._tag);

const eventosDe = (itens: ReadonlyArray<ItemConversa>) =>
  itens.flatMap((item) => (item._tag === "EventoTurno" ? [item.evento] : []));

const resumo = (conversas: Conversas.Conversas["Service"], id: string) =>
  Effect.map(conversas.listar, (lista) => lista.find((conversa) => conversa.id === id));

describe("conversas gravadas", () => {
  it.effect("sem o aviso de uso aceito, iniciar e enviar recusam antes de abrir a sessão", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const { conversas, preferencias, fechar } = yield* abrir(novoBanco(), registro, undefined, Preferencias.layer);
      const iniciar = yield* Effect.flip(conversas.iniciar({ provider: "claude", pastaTrabalho: pasta }));
      assert.strictEqual(iniciar._tag, "AvisoNaoAceito");
      const enviar = yield* Effect.flip(Stream.runDrain(conversas.enviar("qualquer", "oi")));
      assert.strictEqual(enviar._tag, "AvisoNaoAceito");
      assert.deepStrictEqual(registro.configs, []);
      assert.deepStrictEqual(yield* conversas.listar, []);

      yield* preferencias.aceitarAviso;
      const id = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta });
      assert.strictEqual(tags(yield* Stream.runCollect(conversas.enviar(id, "olá"))).at(-1), "FimTurno");
      yield* fechar;
    }),
  );

  it.effect("grava a conversa e os eventos, sem o texto parcial; lista e carrega", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const { conversas, fechar } = yield* abrir(novoBanco(), registro);
      const id = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta });

      const primeiro = yield* Stream.runCollect(conversas.enviar(id, "Qual a carga horária?\nsegunda linha"));
      assert.deepStrictEqual(tags(primeiro), ["TextoParcial", "TextoParcial", "TextoFinal", "FimTurno"]);
      yield* Stream.runCollect(conversas.enviar(id, "E o estágio?"));

      const conversa = yield* resumo(conversas, id);
      assert.strictEqual(conversa?.titulo, "Qual a carga horária?");
      assert.strictEqual(conversa?.estado, "pronta");
      assert.strictEqual(conversa?.turnos, 2);
      assert.strictEqual(conversa?.pastaTrabalho, NodeFS.realpathSync(pasta));

      const { itens } = yield* conversas.carregar(id);
      assert.deepStrictEqual(
        itens.map((item) => [item._tag, item.turno, item.ordem]),
        [
          ["Mensagem", 1, 1],
          ["EventoTurno", 1, 2],
          ["EventoTurno", 1, 3],
          ["Mensagem", 2, 4],
          ["EventoTurno", 2, 5],
          ["EventoTurno", 2, 6],
        ],
      );
      assert.deepStrictEqual(itens[0], {
        _tag: "Mensagem",
        turno: 1,
        ordem: 1,
        texto: "Qual a carga horária?\nsegunda linha",
      });
      assert.deepStrictEqual(tags(eventosDe(itens)), ["TextoFinal", "FimTurno", "TextoFinal", "FimTurno"]);

      const desconhecida = yield* Effect.flip(conversas.carregar("nao-existe"));
      assert.strictEqual(desconhecida._tag, "SessaoDesconhecida");
      yield* fechar;
    }),
  );

  it.effect("migrações: o banco novo fica na versão 1, e reabrir não roda de novo", () =>
    Effect.gen(function* () {
      const arquivo = novoBanco();
      for (let vez = 0; vez < 2; vez++) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const contexto = yield* Layer.build(Banco.layerArquivo(arquivo).pipe(Layer.provide(NodeServices.layer)));
            const sql = Context.get(contexto, SqlClient.SqlClient);
            const tabelas = yield* sql<{ readonly name: string }>`
              SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
            `;
            assert.deepStrictEqual(
              tabelas.map((tabela) => tabela.name),
              [
                "acoes_ia",
                "anexos_pasta",
                "avaliacoes",
                "blocos_ia",
                "conversas",
                "effect_sql_migrations",
                "eventos",
                "eventos_pendencia",
                "listas_pendencias",
                "pendencias_vivas",
                "preferencias",
                "relatos",
                "revisoes_ia",
                "tentativas_ia",
              ],
            );
            const migracoes = yield* sql<{ readonly migration_id: number; readonly name: string }>`
              SELECT migration_id, name FROM effect_sql_migrations
            `;
            assert.deepStrictEqual(
              migracoes.map((linha) => [linha.migration_id, linha.name]),
              [[1, "Inicial"]],
            );
            // A layer já migrou: rodar de novo não executa nada.
            const executadas = yield* Banco.rodarMigracoes().pipe(Effect.provideService(SqlClient.SqlClient, sql));
            assert.deepStrictEqual(executadas, []);
          }),
        );
      }
    }),
  );

  it.effect("retomada depois de fechar: outra layer com o mesmo banco reabre pelo id nativo do provider", () =>
    Effect.gen(function* () {
      const arquivo = novoBanco();
      const registro = novoRegistro();
      const primeiro = yield* abrir(arquivo, registro);
      const id = yield* primeiro.conversas.iniciar({ provider: "claude", pastaTrabalho: pasta });
      yield* Stream.runCollect(primeiro.conversas.enviar(id, "olá"));
      yield* primeiro.fechar;
      assert.strictEqual(registro.encerradas, 1);

      const segundo = yield* abrir(arquivo, registro);
      const antes = yield* resumo(segundo.conversas, id);
      assert.strictEqual(antes?.estado, "liberada");
      const eventos = yield* Stream.runCollect(segundo.conversas.enviar(id, "de novo"));
      assert.strictEqual(tags(eventos).at(-1), "FimTurno");
      assert.strictEqual(registro.configs.at(-1)?.retomar, "nativo-1");
      // A retomada nativa não leva o histórico como contexto.
      assert.strictEqual(registro.textos.at(-1), "de novo");
      const depois = yield* resumo(segundo.conversas, id);
      assert.strictEqual(depois?.estado, "pronta");
      assert.strictEqual(depois?.turnos, 2);
      yield* segundo.fechar;
    }),
  );

  it.effect("fechar no meio do turno: o turno fica interrompido no banco, e a conversa liberada", () =>
    Effect.gen(function* () {
      const arquivo = novoBanco();
      const registro = novoRegistro();
      const primeiro = yield* abrir(arquivo, registro);
      const id = yield* primeiro.conversas.iniciar({ provider: "claude", pastaTrabalho: pasta });
      const turno = yield* Stream.runCollect(primeiro.conversas.enviar(id, "uma resposta demorada")).pipe(
        Effect.forkChild,
      );
      yield* rodar;
      assert.strictEqual((yield* resumo(primeiro.conversas, id))?.estado, "respondendo");
      yield* primeiro.fechar;
      yield* Fiber.await(turno);

      const segundo = yield* abrir(arquivo, registro);
      const { conversa, itens } = yield* segundo.conversas.carregar(id);
      assert.strictEqual(conversa.estado, "liberada");
      const eventos = eventosDe(itens);
      // O parcial que não ganhou `TextoFinal` fica gravado como final, antes do `FimTurno`.
      assert.deepStrictEqual(eventos, [
        { _tag: "TextoFinal", texto: "Pensando " },
        { _tag: "FimTurno", motivo: "interrompido" },
      ]);
      yield* segundo.fechar;
    }),
  );

  it.effect("conversa aberta numa execução que morreu sem fechar: fica liberada, com o turno fechado", () =>
    Effect.gen(function* () {
      const arquivo = novoBanco();
      const registro = novoRegistro();
      // A execução anterior: gravou a conversa em andamento e morreu.
      const anterior = yield* abrir(arquivo, registro);
      yield* anterior.historico.criar({
        id: "orfa",
        provider: "claude",
        pastaTrabalho: pasta,
        idNativo: "nativo-orfa",
        estado: "respondendo",
      });
      yield* anterior.historico.gravar("orfa", { _tag: "Mensagem", turno: 1, ordem: 1, texto: "olá" });
      // (sem fechar a layer de antes: o processo morreu; a de agora lê o mesmo arquivo)

      const atual = yield* abrir(arquivo, registro);
      const { conversa, itens } = yield* atual.conversas.carregar("orfa");
      assert.strictEqual(conversa.estado, "liberada");
      assert.deepStrictEqual(itens.at(-1), {
        _tag: "EventoTurno",
        turno: 1,
        ordem: 2,
        evento: { _tag: "FimTurno", motivo: "interrompido" },
      });
      // A próxima mensagem retoma pelo id nativo gravado.
      yield* Stream.runCollect(atual.conversas.enviar("orfa", "continua"));
      assert.strictEqual(registro.configs.at(-1)?.retomar, "nativo-orfa");
      yield* atual.fechar;
      yield* anterior.fechar;
    }),
  );

  it.effect("retomada recusada pelo provider: sessão nova, com o histórico como contexto", () =>
    Effect.gen(function* () {
      const arquivo = novoBanco();
      const registro = novoRegistro();
      const primeiro = yield* abrir(arquivo, registro);
      const id = yield* primeiro.conversas.iniciar({ provider: "antigravity", pastaTrabalho: pasta });
      yield* Stream.runCollect(primeiro.conversas.enviar(id, "Qual a carga horária?"));
      yield* primeiro.fechar;

      registro.recusarRetomada = true;
      const segundo = yield* abrir(arquivo, registro);
      yield* Stream.runCollect(segundo.conversas.enviar(id, "E o estágio?"));
      assert.isUndefined(registro.configs.at(-1)?.retomar);
      const enviado = registro.textos.at(-1) ?? "";
      assert.match(enviado, /não pôde ser retomada/);
      assert.include(enviado, "Pessoa: Qual a carga horária?");
      assert.include(enviado, "IA: Resposta a: Qual a carga horária?");
      assert.isTrue(enviado.endsWith("E o estágio?"));
      // Gravada fica só a mensagem da pessoa; e o id nativo novo vale para a próxima retomada.
      const { itens } = yield* segundo.conversas.carregar(id);
      assert.deepInclude(itens, { _tag: "Mensagem", turno: 2, ordem: 4, texto: "E o estágio?" });
      yield* Stream.runCollect(segundo.conversas.enviar(id, "Obrigado"));
      assert.strictEqual(registro.textos.at(-1), "Obrigado");
      yield* segundo.fechar;
      registro.recusarRetomada = false;
    }),
  );
});

describe("ciclo de vida da sessão do provider", () => {
  it.effect("queda no meio do turno: Erro e FimTurno, conversa caída, e a próxima mensagem retoma", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const { conversas, fechar } = yield* abrir(novoBanco(), registro);
      const id = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta });
      const turno = yield* Stream.runCollect(conversas.enviar(id, "uma resposta demorada")).pipe(Effect.forkChild);
      yield* rodar;
      yield* registro.derrubar!();
      const eventos = [...(yield* Fiber.join(turno))];
      yield* rodar;
      assert.deepStrictEqual(tags(eventos), ["TextoParcial", "Erro", "FimTurno"]);
      assert.deepStrictEqual(eventos[1], { _tag: "Erro", tipo: "queda", mensagem: "claude: falha em sessão (queda)" });
      assert.deepStrictEqual(eventos[2], { _tag: "FimTurno", motivo: "falha" });
      assert.strictEqual((yield* resumo(conversas, id))?.estado, "caiu");
      assert.strictEqual(registro.encerradas, 1);

      const depois = yield* Stream.runCollect(conversas.enviar(id, "olá de novo"));
      assert.strictEqual(tags(depois).at(-1), "FimTurno");
      assert.strictEqual(registro.configs.at(-1)?.retomar, "nativo-1");
      assert.strictEqual((yield* resumo(conversas, id))?.estado, "pronta");
      yield* fechar;
    }),
  );

  it.effect("queda fora do turno: o Erro fica no histórico e a conversa caída", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const { conversas, fechar } = yield* abrir(novoBanco(), registro);
      const id = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta });
      yield* Stream.runCollect(conversas.enviar(id, "olá"));
      yield* registro.derrubar!();
      yield* rodar;
      const { conversa, itens } = yield* conversas.carregar(id);
      assert.strictEqual(conversa.estado, "caiu");
      assert.strictEqual(eventosDe(itens).at(-1)?._tag, "Erro");
      yield* Stream.runCollect(conversas.enviar(id, "de novo"));
      assert.strictEqual(registro.configs.at(-1)?.retomar, "nativo-1");
      yield* fechar;
    }),
  );

  it.effect("a queda com causa grava no Erro o diagnóstico saneado, dentro e fora do turno", () =>
    Effect.gen(function* () {
      const causa = new Error("processo do claude encerrou\nproxy http://joao:s3nh4@10.0.0.1:3128 caiu");
      const saneado = "processo do claude encerrou proxy http://<credencial>@10.0.0.1:3128 caiu";
      const registro = novoRegistro();
      const { conversas, fechar } = yield* abrir(novoBanco(), registro);
      const id = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta });
      const turno = yield* Stream.runCollect(conversas.enviar(id, "uma resposta demorada")).pipe(Effect.forkChild);
      yield* rodar;
      yield* registro.derrubar!(causa);
      const eventos = [...(yield* Fiber.join(turno))];
      assert.deepStrictEqual(eventos[1], { _tag: "Erro", tipo: "queda", mensagem: saneado });

      yield* Stream.runCollect(conversas.enviar(id, "olá"));
      yield* registro.derrubar!(causa);
      yield* rodar;
      // Recarregada, a conversa mantém o diagnóstico dos dois `Erro`.
      const { itens } = yield* conversas.carregar(id);
      const erros = eventosDe(itens).filter((e) => e._tag === "Erro");
      assert.deepStrictEqual(
        erros.map((e) => e._tag === "Erro" && e.mensagem),
        [saneado, saneado],
      );
      yield* fechar;
    }),
  );

  it.effect("ociosidade: sem turno por 30 minutos, a sessão se libera; a próxima mensagem retoma", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const { conversas, fechar } = yield* abrir(novoBanco(), registro);
      const id = yield* conversas.iniciar({
        provider: "claude",
        pastaTrabalho: pasta,
        modelo: "opus",
        esforco: "xhigh",
      });
      assert.deepInclude(registro.configs.at(-1), { modelo: "opus", esforco: "xhigh" });
      yield* Stream.runCollect(conversas.enviar(id, "olá"));
      yield* avancar(Duration.subtract(Conversas.OCIOSIDADE, Duration.seconds(1)));
      assert.strictEqual(registro.encerradas, 0);
      yield* avancar(Duration.seconds(1));
      assert.strictEqual(registro.encerradas, 1);
      assert.strictEqual((yield* resumo(conversas, id))?.estado, "liberada");

      // A interface que recarrega não muda nada: a conversa continua e se retoma.
      yield* Stream.runCollect(conversas.enviar(id, "voltei"));
      assert.strictEqual(registro.configs.length, 2);
      assert.strictEqual(registro.configs.at(-1)?.retomar, "nativo-1");
      // A retomada reabre com o modelo e o esforço escolhidos no começo.
      assert.deepInclude(registro.configs.at(-1), { modelo: "opus", esforco: "xhigh" });
      // `encerrar` libera a sessão, e a próxima mensagem a reabre.
      yield* conversas.encerrar(id);
      assert.strictEqual((yield* resumo(conversas, id))?.estado, "liberada");
      yield* Stream.runCollect(conversas.enviar(id, "de novo"));
      assert.strictEqual((yield* resumo(conversas, id))?.estado, "pronta");
      assert.strictEqual(registro.configs.length, 3);
      yield* fechar;
    }),
  );

  it.effect("skills do catálogo: a sessão nova, a retomada e a recomeçada recebem todas", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const { conversas, fechar } = yield* abrir(novoBanco(), registro);
      const id = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta });
      const esperadas: ReadonlyArray<Motor.Skill> = [
        { nome: SKILL.nome, descricao: SKILL.descricao, instrucoes: SKILL.instrucoes, arquivos: SKILL.arquivos },
      ];
      assert.deepStrictEqual(registro.configs[0]?.skills, esperadas);
      // O motor gravou o SKILL.md e o arquivo listado na pasta de trabalho, e as instruções as listam.
      const pastaSkill = `${NodeFS.realpathSync(pasta)}/.simplifica/skills/${SKILL.nome}`;
      assert.include(NodeFS.readFileSync(`${pastaSkill}/SKILL.md`, "utf8"), "Leia `referencia.md`.");
      assert.strictEqual(NodeFS.readFileSync(`${pastaSkill}/referencia.md`, "utf8"), "referência");
      assert.include(registro.configs[0]?.instrucoes ?? "", `\`${SKILL.nome}\``);

      // Retomada pelo provider.
      yield* conversas.encerrar(id);
      yield* Stream.runCollect(conversas.enviar(id, "voltei"));
      assert.strictEqual(registro.configs.at(-1)?.retomar, "nativo-1");
      assert.deepStrictEqual(registro.configs.at(-1)?.skills, esperadas);

      // Retomada recusada: a sessão recomeçada também as recebe.
      yield* conversas.encerrar(id);
      registro.recusarRetomada = true;
      yield* Stream.runCollect(conversas.enviar(id, "de novo"));
      assert.isUndefined(registro.configs.at(-1)?.retomar);
      assert.deepStrictEqual(registro.configs.at(-1)?.skills, esperadas);
      yield* fechar;
    }),
  );

  it.effect(
    "o FimTurno chega com o turno fechado: a conversa em repouso aceita outra mensagem antes de o stream acabar",
    () =>
      Effect.gen(function* () {
        const registro = novoRegistro();
        const segurar = yield* Deferred.make<void>();
        registro.segurarFim = segurar;
        const { conversas, fechar } = yield* abrir(novoBanco(), registro);
        const id = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta });
        // Como a interface: o turno acabou quando chega o `FimTurno`; o stream do provider segue aberto.
        const eventos = yield* conversas.enviar(id, "olá").pipe(
          Stream.takeUntil((evento) => evento._tag === "FimTurno"),
          Stream.runCollect,
        );
        assert.strictEqual(tags(eventos).at(-1), "FimTurno");
        assert.strictEqual((yield* conversas.carregar(id)).conversa.estado, "pronta");
        registro.segurarFim = undefined;
        const outra = yield* Stream.runCollect(conversas.enviar(id, "outra"));
        assert.deepStrictEqual([...outra].at(-1), { _tag: "FimTurno", motivo: "end_turn" });
        yield* Deferred.succeed(segurar, undefined);
        yield* rodar;
        // O fim tardio do primeiro stream não toca o histórico: cada turno tem um só `FimTurno`.
        const fins = eventosDe((yield* conversas.carregar(id)).itens).filter((evento) => evento._tag === "FimTurno");
        assert.strictEqual(fins.length, 2);
        yield* fechar;
      }),
  );

  it.effect("um retrato da pasta que lança defeito não deixa o turno aberto", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const { conversas, fechar } = yield* abrir(novoBanco(), registro, layerRetratoComDefeito);
      const id = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta });
      const eventos = yield* Stream.runCollect(conversas.enviar(id, "olá"));
      assert.deepStrictEqual([...eventos].at(-1), { _tag: "FimTurno", motivo: "end_turn" });
      assert.strictEqual((yield* conversas.carregar(id)).conversa.estado, "pronta");
      const outra = yield* Stream.runCollect(conversas.enviar(id, "outra"));
      assert.strictEqual(tags(outra).at(-1), "FimTurno");
      yield* fechar;
    }),
  );

  it.effect("interromper: o turno termina interrompido e a conversa aceita outro turno", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const { conversas, fechar } = yield* abrir(novoBanco(), registro);
      const id = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta });
      const turno = yield* Stream.runCollect(conversas.enviar(id, "uma resposta demorada")).pipe(Effect.forkChild);
      yield* rodar;
      const emAndamento = yield* Effect.flip(Stream.runCollect(conversas.enviar(id, "outra")));
      assert.strictEqual(emAndamento._tag, "TurnoEmAndamento");
      yield* conversas.interromper(id);
      const eventos = yield* Fiber.join(turno);
      assert.deepStrictEqual([...eventos].at(-1), { _tag: "FimTurno", motivo: "interrupted" });
      const depois = yield* Stream.runCollect(conversas.enviar(id, "olá"));
      assert.strictEqual(tags(depois).at(-1), "FimTurno");
      assert.strictEqual(registro.configs.length, 1);
      yield* fechar;
    }),
  );

  it.effect("interromper no preparo: a mensagem não vai à IA, a cópia do turno sai e a conversa segue", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      // O preparo do turno 2 avisa que começou e fica parado na cópia da pasta (como numa conversão longa).
      const comecou = yield* Deferred.make<void>();
      const descartadas: Array<number> = [];
      const pastasLentas = Layer.effect(
        PastasTrabalho.PastasTrabalho,
        Effect.gen(function* () {
          const pastas = yield* PastasTrabalho.PastasTrabalho;
          return PastasTrabalho.PastasTrabalho.of({
            ...pastas,
            guardarCopia: (_conversa, turno) =>
              turno === 2 ? Deferred.succeed(comecou, undefined).pipe(Effect.andThen(Effect.never)) : Effect.undefined,
            descartarCopia: (_conversa, turno) => Effect.sync(() => void descartadas.push(turno)),
          });
        }),
      ).pipe(Layer.provide(PastasTrabalho.layerSemPastas));
      const { conversas, fechar } = yield* abrir(novoBanco(), registro, pastasLentas);
      const id = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta });
      yield* Stream.runCollect(conversas.enviar(id, "olá"));
      const enviados = registro.textos.length;

      const turno = yield* Stream.runCollect(conversas.enviar(id, "confira a pasta")).pipe(Effect.forkChild);
      yield* Deferred.await(comecou);
      // No preparo, o turno já existe: outra mensagem espera, e o "Parar" tem o que interromper.
      const emAndamento = yield* Effect.flip(Stream.runCollect(conversas.enviar(id, "outra")));
      assert.strictEqual(emAndamento._tag, "TurnoEmAndamento");
      yield* conversas.interromper(id);
      const eventos = yield* Fiber.join(turno);
      assert.deepStrictEqual([...eventos], [{ _tag: "FimTurno", motivo: MOTIVO_PARADO_ANTES_DO_ENVIO }]);
      // A IA não recebeu a mensagem; o histórico a guarda, e a cópia do turno parado sai.
      assert.strictEqual(registro.textos.length, enviados);
      assert.deepStrictEqual(descartadas, [2]);
      const gravada = yield* conversas.carregar(id);
      assert.strictEqual(gravada.conversa.estado, "pronta");
      assert.deepInclude(
        gravada.itens.find((item) => item.turno === 2 && item._tag === "Mensagem"),
        { texto: "confira a pasta" },
      );
      // A conversa aceita a próxima mensagem, e ela vai à IA.
      const depois = yield* Stream.runCollect(conversas.enviar(id, "de novo"));
      assert.strictEqual(tags(depois).at(-1), "FimTurno");
      assert.strictEqual(registro.textos.at(-1), "de novo");
      yield* fechar;
    }),
  );

  it.effect("parar no meio das conversões: o próximo turno avisa do que a pessoa mexeu antes do Parar", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const raiz = NodeFS.realpathSync(diretorioTemporario("simplifica-raiz-"));
      const tarefa = NodePath.join(raiz, "Tarefa");
      NodeFS.mkdirSync(tarefa);
      NodeFS.writeFileSync(NodePath.join(tarefa, "entrada.md"), "original\n");
      // A primeira conversão avisa que começou e fica presa (como um Worker lento); as outras respondem.
      const comecou = yield* Deferred.make<void>();
      let conversoes = 0;
      const textosLentos = Layer.succeed(TextosAnexos.TextosAnexos, {
        bytesDoArquivo: TextosAnexos.LIMITES.bytesDoArquivo,
        converter: (_bytes, nome) =>
          ++conversoes === 1
            ? Deferred.succeed(comecou, undefined).pipe(Effect.andThen(Effect.never))
            : Effect.succeed({ tipo: "texto", markdown: `texto de ${nome}` } as const),
      });
      const pastas = PastasTrabalho.layer({ raiz, copias: diretorioTemporario("simplifica-copias-") }).pipe(
        Layer.provide(textosLentos),
        Layer.provide(ArquivosLiberados.layer({ exigirLiberacao: false })),
      );
      const { conversas, fechar } = yield* abrir(novoBanco(), registro, pastas);
      const id = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: tarefa });
      yield* Stream.runCollect(conversas.enviar(id, "olá"));

      // Entre os turnos, a pessoa põe um .docx e uma nota; a conversão do .docx trava, e ela para.
      NodeFS.writeFileSync(NodePath.join(tarefa, "Minuta.docx"), "conteúdo da minuta");
      NodeFS.writeFileSync(NodePath.join(tarefa, "nota.md"), "nota\n");
      const parado = yield* Stream.runCollect(conversas.enviar(id, "confira")).pipe(Effect.forkChild);
      yield* Deferred.await(comecou);
      yield* conversas.interromper(id);
      assert.deepStrictEqual(
        [...(yield* Fiber.join(parado))],
        [{ _tag: "FimTurno", motivo: MOTIVO_PARADO_ANTES_DO_ENVIO }],
      );

      // No turno seguinte, o aviso traz as duas mudanças (a comparação é com o turno 1, o último que
      // chegou à IA), e a minuta ganha o texto.
      const seguinte = yield* Stream.runCollect(conversas.enviar(id, "de novo"));
      assert.deepStrictEqual(
        [...seguinte].find((evento) => evento._tag === "MudancasPasta"),
        {
          _tag: "MudancasPasta",
          novos: [{ nome: "Minuta.docx", texto: ".simplifica/textos/Minuta.docx.md" }, { nome: "nota.md" }],
          mudados: [],
          removidos: [],
        },
      );
      assert.match(registro.textos.at(-1) ?? "", /^de novo\n\nDesde a sua última resposta/);
      yield* fechar;
    }),
  );

  /** As pastas com o preparo do turno `n` preso: avisa em `comecou` e espera `solta` (ou para sempre). */
  const pastasPresas = (n: number, comecou: Deferred.Deferred<void>, solta?: Deferred.Deferred<void>) =>
    Layer.effect(
      PastasTrabalho.PastasTrabalho,
      Effect.gen(function* () {
        const pastas = yield* PastasTrabalho.PastasTrabalho;
        return PastasTrabalho.PastasTrabalho.of({
          ...pastas,
          guardarCopia: (_conversa, turno) =>
            turno === n
              ? Deferred.succeed(comecou, undefined).pipe(
                  Effect.andThen(solta === undefined ? Effect.never : Deferred.await(solta)),
                  Effect.as(undefined),
                )
              : Effect.undefined,
        });
      }),
    ).pipe(Layer.provide(PastasTrabalho.layerSemPastas));

  it.effect("o turno 1 de uma tarefa parado no preparo: a skill é indicada no primeiro que chega à IA", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const comecou = yield* Deferred.make<void>();
      const { conversas, fechar } = yield* abrir(novoBanco(), registro, pastasPresas(1, comecou));
      const id = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta, tarefa: "skill-de-teste" });
      const parado = yield* Stream.runCollect(conversas.enviar(id, "primeiro")).pipe(Effect.forkChild);
      yield* Deferred.await(comecou);
      yield* conversas.interromper(id);
      yield* Fiber.join(parado);
      yield* Stream.runCollect(conversas.enviar(id, "de novo"));
      assert.match(registro.textos.at(-1) ?? "", /^Siga a skill `skill-de-teste`[\s\S]*\n\nde novo$/);
      yield* fechar;
    }),
  );

  it.effect("a sessão que cai no preparo: o Parar ainda para, e sem Parar o turno fecha com a queda", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const comecou = yield* Deferred.make<void>();
      const solta = yield* Deferred.make<void>();
      const { conversas, fechar } = yield* abrir(novoBanco(), registro, pastasPresas(2, comecou, solta));
      const id = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta });
      yield* Stream.runCollect(conversas.enviar(id, "olá"));
      const enviados = registro.textos.length;
      const parado = yield* Stream.runCollect(conversas.enviar(id, "segundo")).pipe(Effect.forkChild);
      yield* Deferred.await(comecou);
      yield* registro.derrubar!(new Error("o processo morreu"));
      yield* rodar;
      yield* conversas.interromper(id);
      assert.deepStrictEqual(
        [...(yield* Fiber.join(parado))],
        [{ _tag: "FimTurno", motivo: MOTIVO_PARADO_ANTES_DO_ENVIO }],
      );
      assert.strictEqual(registro.textos.length, enviados);
      yield* fechar;
    }),
  );

  it.effect("a sessão que cai no preparo, sem Parar: a mensagem não vai a uma sessão encerrada", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const comecou = yield* Deferred.make<void>();
      const solta = yield* Deferred.make<void>();
      const { conversas, fechar } = yield* abrir(novoBanco(), registro, pastasPresas(2, comecou, solta));
      const id = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta });
      yield* Stream.runCollect(conversas.enviar(id, "olá"));
      const enviados = registro.textos.length;
      const turno = yield* Stream.runCollect(conversas.enviar(id, "segundo")).pipe(Effect.forkChild);
      yield* Deferred.await(comecou);
      yield* registro.derrubar!(new Error("o processo morreu"));
      yield* rodar;
      yield* Deferred.succeed(solta, undefined);
      const eventos = [...(yield* Fiber.join(turno))];
      assert.deepStrictEqual(tags(eventos), ["Erro", "FimTurno"]);
      assert.deepInclude(eventos[0], { tipo: "queda" });
      assert.deepStrictEqual(eventos[1], { _tag: "FimTurno", motivo: "falha" });
      assert.strictEqual(registro.textos.length, enviados);
      // A próxima mensagem reabre a sessão e vai à IA.
      yield* Stream.runCollect(conversas.enviar(id, "de novo"));
      assert.strictEqual(registro.textos.at(-1), "de novo");
      yield* fechar;
    }),
  );

  it.effect("encerrar a conversa no preparo fecha o turno como parado, não como resposta interrompida", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const comecou = yield* Deferred.make<void>();
      const { conversas, fechar } = yield* abrir(novoBanco(), registro, pastasPresas(1, comecou));
      const id = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta });
      const turno = yield* Stream.runCollect(conversas.enviar(id, "olá")).pipe(Effect.forkChild);
      yield* Deferred.await(comecou);
      yield* conversas.encerrar(id);
      assert.deepStrictEqual(
        [...(yield* Fiber.join(turno))],
        [{ _tag: "FimTurno", motivo: MOTIVO_PARADO_ANTES_DO_ENVIO }],
      );
      yield* fechar;
    }),
  );

  it.effect("o .docx convertido antes do Parar vai no aviso seguinte com o caminho do texto", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const raiz = NodeFS.realpathSync(diretorioTemporario("simplifica-raiz-"));
      const tarefa = NodePath.join(raiz, "Tarefa");
      NodeFS.mkdirSync(tarefa);
      const comecou = yield* Deferred.make<void>();
      let travou = false;
      const textosLentos = Layer.succeed(TextosAnexos.TextosAnexos, {
        bytesDoArquivo: TextosAnexos.LIMITES.bytesDoArquivo,
        // O A.docx converte; o B.docx trava na primeira vez (a pessoa para), e converte na seguinte.
        converter: (_bytes, nome) =>
          nome === "B.docx" && !travou
            ? Effect.sync(() => (travou = true)).pipe(
                Effect.andThen(Deferred.succeed(comecou, undefined)),
                Effect.andThen(Effect.never),
              )
            : Effect.succeed({ tipo: "texto", markdown: `texto de ${nome}` } as const),
      });
      const pastas = PastasTrabalho.layer({ raiz, copias: diretorioTemporario("simplifica-copias-") }).pipe(
        Layer.provide(textosLentos),
        Layer.provide(ArquivosLiberados.layer({ exigirLiberacao: false })),
      );
      const { conversas, fechar } = yield* abrir(novoBanco(), registro, pastas);
      const id = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: tarefa });
      yield* Stream.runCollect(conversas.enviar(id, "olá"));
      NodeFS.writeFileSync(NodePath.join(tarefa, "A.docx"), "a");
      NodeFS.writeFileSync(NodePath.join(tarefa, "B.docx"), "b");
      const parado = yield* Stream.runCollect(conversas.enviar(id, "confira")).pipe(Effect.forkChild);
      yield* Deferred.await(comecou);
      yield* conversas.interromper(id);
      yield* Fiber.join(parado);
      const seguinte = yield* Stream.runCollect(conversas.enviar(id, "de novo"));
      assert.deepStrictEqual(
        [...seguinte].find((evento) => evento._tag === "MudancasPasta"),
        {
          _tag: "MudancasPasta",
          novos: [
            { nome: "A.docx", texto: ".simplifica/textos/A.docx.md" },
            { nome: "B.docx", texto: ".simplifica/textos/B.docx.md" },
          ],
          mudados: [],
          removidos: [],
        },
      );
      // Avisado, o A.docx não volta no turno seguinte.
      const depois = yield* Stream.runCollect(conversas.enviar(id, "e agora?"));
      assert.isUndefined([...depois].find((evento) => evento._tag === "MudancasPasta"));
      yield* fechar;
    }),
  );

  it.effect("interromper sem resposta do provider: no fim do prazo, a sessão se libera e o turno fecha", () =>
    Effect.gen(function* () {
      const registro = { ...novoRegistro(), ignorarInterrupcao: true };
      const { conversas, fechar } = yield* abrir(novoBanco(), registro);
      const id = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta });
      const turno = yield* Stream.runCollect(conversas.enviar(id, "uma resposta demorada")).pipe(Effect.forkChild);
      yield* rodar;
      yield* conversas.interromper(id);
      yield* avancar(PRAZO);
      const eventos = yield* Fiber.join(turno);
      assert.deepStrictEqual([...eventos].at(-1), { _tag: "FimTurno", motivo: "interrompido" });
      assert.strictEqual(registro.encerradas, 1);
      assert.strictEqual((yield* resumo(conversas, id))?.estado, "liberada");
      registro.ignorarInterrupcao = false;
      yield* Stream.runCollect(conversas.enviar(id, "olá"));
      assert.strictEqual(registro.configs.at(-1)?.retomar, "nativo-1");
      yield* fechar;
    }),
  );

  it.effect("acompanhar: quem chega no meio do turno recebe o gravado, o parcial e o resto", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const { conversas, fechar } = yield* abrir(novoBanco(), registro);
      const id = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta });
      yield* Stream.runCollect(conversas.enviar(id, "olá"));
      // A interface que enviou caiu no meio do turno (o stream dela foi interrompido).
      const primeiro = yield* Stream.runCollect(conversas.enviar(id, "pode escrever?")).pipe(Effect.forkChild);
      yield* rodar;
      yield* Fiber.interrupt(primeiro);
      const { conversa, itens } = yield* conversas.carregar(id);
      assert.strictEqual(conversa.estado, "respondendo");
      const visto = itens.at(-1)?.ordem ?? 0;

      // A que recarregou acompanha a partir do que já viu, e responde à aprovação.
      const acompanhamento = yield* Stream.runCollect(conversas.acompanhar(id, visto - 2)).pipe(Effect.forkChild);
      yield* rodar;
      yield* conversas.responderAprovacao(id, "f1", "permitir");
      const recebidos = [...(yield* Fiber.join(acompanhamento))];
      assert.deepStrictEqual(
        recebidos.map((item) => (item._tag === "EventoTurno" ? item.evento._tag : item._tag)),
        [
          "FerramentaIniciada",
          "PedidoAprovacao",
          "TextoParcial",
          "DecisaoAprovacao",
          "FerramentaConcluida",
          "TextoFinal",
          "FimTurno",
        ],
      );
      assert.deepInclude(recebidos[2], { evento: { _tag: "TextoParcial", texto: "Vou " } });
      // Sem turno em andamento, acompanhar só devolve o gravado.
      const resto = yield* Stream.runCollect(conversas.acompanhar(id, 0));
      assert.deepStrictEqual([...resto], (yield* conversas.carregar(id)).itens);
      yield* fechar;
    }),
  );
});
