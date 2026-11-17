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
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import type { ItemConversa } from "@simplifica-if/contratos-app";
import * as McpHttp from "@simplifica-if/mcp/http";
import * as Motor from "@simplifica-if/motor";
import type { SkillDoApp } from "@simplifica-if/mcp/skills";
import * as CatalogoSkills from "../src/CatalogoSkills.ts";
import * as PastasTrabalho from "../src/PastasTrabalho.ts";
import * as Conversas from "../src/Conversas.ts";
import * as Banco from "../src/persistencia/Banco.ts";
import * as Historico from "../src/persistencia/Historico.ts";
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

const camada = (arquivo: string, registro: Registro) =>
  Conversas.layer({ prazoInterrupcao: PRAZO }).pipe(
    Layer.provideMerge(Motor.layer),
    Layer.provideMerge(CatalogoSkills.layerFixo([SKILL])),
    Layer.provide(PastasTrabalho.layerSemPastas),
    Layer.provideMerge(Historico.layer),
    Layer.provideMerge(Banco.layerArquivo(arquivo)),
    Layer.provide(McpHttp.layer({ banco: kb })),
    Layer.provide(layerDriversFalsos(registro)),
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layerSecureRandom)),
  );

/**
 * Abre o servidor de conversas (como o app que abre) num escopo próprio; `fechar` o encerra como o
 * app que fecha.
 */
const abrir = (arquivo: string, registro: Registro) =>
  Effect.gen(function* () {
    const escopo = yield* Scope.make();
    const contexto = yield* Layer.buildWithScope(camada(arquivo, registro), escopo);
    return {
      conversas: Context.get(contexto, Conversas.Conversas),
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

const tags = (eventos: Iterable<Motor.Evento>) => [...eventos].map((evento) => evento._tag);

const eventosDe = (itens: ReadonlyArray<ItemConversa>) =>
  itens.flatMap((item) => (item._tag === "EventoTurno" ? [item.evento] : []));

const resumo = (conversas: Conversas.Conversas["Service"], id: string) =>
  Effect.map(conversas.listar, (lista) => lista.find((conversa) => conversa.id === id));

describe("conversas gravadas", () => {
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

  it.effect("migrações: o banco novo fica na versão 5, e reabrir não roda de novo", () =>
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
                "revisoes_ia",
                "tentativas_ia",
              ],
            );
            const migracoes = yield* sql<{ readonly migration_id: number; readonly name: string }>`
              SELECT migration_id, name FROM effect_sql_migrations
            `;
            assert.deepStrictEqual(
              migracoes.map((linha) => [linha.migration_id, linha.name]),
              [
                [1, "Conversas"],
                [2, "RevisoesIa"],
                [3, "TentativasIa"],
                [4, "ListasPendencias"],
                [5, "ModoServidor"],
              ],
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
      assert.match(eventos[1]?._tag === "Erro" ? eventos[1].mensagem : "", /o processo encerrou/);
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

  it.effect("ociosidade: sem turno por 30 minutos, a sessão se libera; a próxima mensagem retoma", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const { conversas, fechar } = yield* abrir(novoBanco(), registro);
      const id = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta });
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
      // `retomar` com a sessão aberta não abre outra.
      yield* conversas.retomar(id);
      assert.strictEqual(registro.configs.length, 2);
      // `encerrar` libera a sessão, e `retomar` a reabre sem mensagem.
      yield* conversas.encerrar(id);
      assert.strictEqual((yield* resumo(conversas, id))?.estado, "liberada");
      const retomada = yield* conversas.retomar(id);
      assert.strictEqual(retomada.estado, "pronta");
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
      yield* conversas.retomar(id);
      assert.strictEqual(registro.configs.at(-1)?.retomar, "nativo-1");
      assert.deepStrictEqual(registro.configs.at(-1)?.skills, esperadas);

      // Retomada recusada: a sessão recomeçada também as recebe.
      yield* conversas.encerrar(id);
      registro.recusarRetomada = true;
      yield* conversas.retomar(id);
      assert.isUndefined(registro.configs.at(-1)?.retomar);
      assert.deepStrictEqual(registro.configs.at(-1)?.skills, esperadas);
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
