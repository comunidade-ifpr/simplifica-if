// @effect-diagnostics nodeBuiltinImport:off -- teste: o caminho real da pasta temporária
/**
 * As `Conversas` de verdade, sobre o motor com o driver falso (`apoio.ts`), o MCP HTTP do banco de
 * fixture e o banco das conversas num arquivo temporário, com o `TestClock`: a gravação e a lista, as
 * migrações, a retomada depois de fechar (outra layer com o mesmo banco), a conversa que uma execução
 * anterior deixou aberta, a retomada recusada (o histórico como contexto), a queda do processo do
 * provider no meio do turno e fora dele, a ociosidade, a interrupção, o acompanhar de um turno em
 * andamento, as skills do catálogo em toda sessão aberta (nova, retomada, recomeçada) e o que a tarefa
 * restringe na sessão (a skill, a web, a experimental fora do beta), e as atividades que a conversa
 * publica (respondendo, a aprovação pendente, a resposta pronta até ser vista, o limite) e a continuação
 * com outra IA.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Queue from "effect/Queue";
import type * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import type { EventoAtividades, EventoConversa, ItemAoVivo, ItemConversa } from "@simplifica-if/contratos-app";
import * as McpHttp from "@simplifica-if/mcp/http";
import * as Motor from "@simplifica-if/motor";
import type { SkillDoApp } from "@simplifica-if/mcp/skills";
import type { ManifestoTarefa } from "@simplifica-if/mcp/tarefas";
import * as CatalogoSkills from "../src/CatalogoSkills.ts";
import * as CatalogoTarefas from "../src/CatalogoTarefas.ts";
import * as ArquivosLiberados from "../src/ArquivosLiberados.ts";
import * as Atividades from "../src/Atividades.ts";
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
  turnoAoVivo,
  turnoCompleto,
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
  manifesto: { ferramentas: [], arquivos: ["referencia.md"] },
  pasta: "/nao/usada",
};

/** Outra skill do catálogo, que nenhuma tarefa cita: só a conversa livre a leva. */
const OUTRA_SKILL: SkillDoApp = {
  nome: "outra-skill",
  descricao: "Use para testar o que a conversa de tarefa não leva.",
  instrucoes: "# Outra skill",
  arquivos: [],
  manifesto: { ferramentas: [], arquivos: [] },
  pasta: "/nao/usada",
};

const paraMotor = (skill: SkillDoApp): Motor.Skill => ({
  nome: skill.nome,
  descricao: skill.descricao,
  instrucoes: skill.instrucoes,
  arquivos: skill.arquivos,
});

const tarefaDeConversa = (
  id: string,
  conversa: { readonly skill?: string; readonly pedido: string; readonly web?: boolean },
  situacao: ManifestoTarefa["situacao"] = "estavel",
): ManifestoTarefa => ({
  id,
  titulo: "Tarefa de teste",
  resumo: "Uma tarefa de teste.",
  area: "ensino",
  situacao,
  mantenedor: { nome: "Pessoa de Teste", github: "pessoa-de-teste" },
  abre: { conversa },
});

/**
 * As tarefas do catálogo de teste: uma que cita a skill, uma de conversa sem skill, duas que desligam a
 * web (com skill e sem) e uma experimental.
 */
const TAREFAS = [
  tarefaDeConversa("tarefa-com-skill", { skill: SKILL.nome, pedido: "Faça o teste." }),
  tarefaDeConversa("tarefa-sem-skill", { pedido: "Responda." }),
  tarefaDeConversa("tarefa-sem-web", { skill: SKILL.nome, pedido: "Faça sem a web.", web: false }),
  tarefaDeConversa("tarefa-sem-web-nem-skill", { pedido: "Responda sem a web.", web: false }),
  tarefaDeConversa("tarefa-experimental", { pedido: "Experimente." }, "experimental"),
];

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
  tarefas: ReadonlyArray<ManifestoTarefa> = TAREFAS,
  retiradas: ReadonlySet<string> = new Set(),
) =>
  Conversas.layer({ prazoInterrupcao: PRAZO }).pipe(
    Layer.provideMerge(Motor.layer),
    Layer.provideMerge(Atividades.layer),
    Layer.provideMerge(CatalogoTarefas.layerFixo(tarefas)),
    Layer.provideMerge(CatalogoSkills.layerFixo([OUTRA_SKILL, SKILL], retiradas)),
    Layer.provideMerge(pastas),
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
const abrir = (
  arquivo: string,
  registro: Registro,
  pastas?: CamadaPastas,
  preferencias?: typeof Preferencias.layer,
  tarefas?: ReadonlyArray<ManifestoTarefa>,
  retiradas?: ReadonlySet<string>,
) =>
  Effect.gen(function* () {
    const escopo = yield* Scope.make();
    const contexto = yield* Layer.buildWithScope(
      camada(arquivo, registro, pastas, preferencias, tarefas, retiradas),
      escopo,
    );
    return {
      conversas: Context.get(contexto, Conversas.Conversas),
      atividades: Context.get(contexto, Atividades.Atividades),
      preferencias: Context.get(contexto, Preferencias.Preferencias),
      historico: Context.get(contexto, Historico.Historico),
      pastas: Context.get(contexto, PastasTrabalho.PastasTrabalho),
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
      const iniciar = yield* Effect.flip(conversas.iniciar({ provider: "claude", pastaTrabalho: pasta }, "estavel"));
      assert.strictEqual(iniciar._tag, "AvisoNaoAceito");
      const enviar = yield* Effect.flip(conversas.enviar("qualquer", "oi"));
      assert.strictEqual(enviar._tag, "AvisoNaoAceito");
      assert.deepStrictEqual(registro.configs, []);
      assert.deepStrictEqual(yield* conversas.listar, []);

      yield* preferencias.aceitarAviso;
      const { sessao: id } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta }, "estavel");
      assert.strictEqual(tags(yield* turnoCompleto(conversas, id, "olá")).at(-1), "FimTurno");
      yield* fechar;
    }),
  );

  it.effect("grava a conversa e os eventos, sem o texto parcial; lista e carrega", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const { conversas, fechar } = yield* abrir(novoBanco(), registro);
      const { sessao: id } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta }, "estavel");

      const primeiro = yield* turnoCompleto(conversas, id, "Qual a carga horária?\nsegunda linha");
      assert.deepStrictEqual(tags(primeiro), ["TextoParcial", "TextoParcial", "TextoFinal", "FimTurno"]);
      yield* turnoCompleto(conversas, id, "E o estágio?");

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

  it.effect("migrações: o banco novo fica na última versão, e reabrir não roda de novo", () =>
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
            // As tabelas do núcleo; as dos módulos têm o prefixo do módulo e o teste de cada um.
            assert.includeMembers(
              tabelas.map((tabela) => tabela.name),
              [
                "anexos_pasta",
                "apagamentos_pendentes",
                "avaliacoes",
                "conversas",
                "effect_sql_migrations",
                "eventos",
                "preferencias",
                "relatos",
              ],
            );
            const migracoes = yield* sql<{ readonly migration_id: number; readonly name: string }>`
              SELECT migration_id, name FROM effect_sql_migrations
            `;
            assert.deepStrictEqual(
              migracoes.map((linha) => [linha.migration_id, linha.name]),
              Banco.MIGRACOES.map(([id, nome]) => [id, nome]),
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
      const { sessao: id } = yield* primeiro.conversas.iniciar({ provider: "claude", pastaTrabalho: pasta }, "estavel");
      yield* turnoCompleto(primeiro.conversas, id, "olá");
      yield* primeiro.fechar;
      assert.strictEqual(registro.encerradas, 1);

      const segundo = yield* abrir(arquivo, registro);
      const antes = yield* resumo(segundo.conversas, id);
      assert.strictEqual(antes?.estado, "liberada");
      const eventos = yield* turnoCompleto(segundo.conversas, id, "de novo");
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
      const { sessao: id } = yield* primeiro.conversas.iniciar({ provider: "claude", pastaTrabalho: pasta }, "estavel");
      const turno = yield* turnoCompleto(primeiro.conversas, id, "uma resposta demorada").pipe(Effect.forkChild);
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
      yield* turnoCompleto(atual.conversas, "orfa", "continua");
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
      const { sessao: id } = yield* primeiro.conversas.iniciar(
        { provider: "antigravity", pastaTrabalho: pasta },
        "estavel",
      );
      yield* turnoCompleto(primeiro.conversas, id, "Qual a carga horária?");
      yield* primeiro.fechar;

      registro.recusarRetomada = true;
      const segundo = yield* abrir(arquivo, registro);
      yield* turnoCompleto(segundo.conversas, id, "E o estágio?");
      assert.isUndefined(registro.configs.at(-1)?.retomar);
      const enviado = registro.textos.at(-1) ?? "";
      assert.match(enviado, /não pôde ser retomada/);
      assert.include(enviado, "Pessoa: Qual a carga horária?");
      assert.include(enviado, "IA: Resposta a: Qual a carga horária?");
      assert.isTrue(enviado.endsWith("E o estágio?"));
      // Gravada fica só a mensagem da pessoa; e o id nativo novo vale para a próxima retomada.
      const { itens } = yield* segundo.conversas.carregar(id);
      assert.deepInclude(itens, { _tag: "Mensagem", turno: 2, ordem: 4, texto: "E o estágio?" });
      yield* turnoCompleto(segundo.conversas, id, "Obrigado");
      assert.strictEqual(registro.textos.at(-1), "Obrigado");

      // As fichas de contexto vão à IA depois do texto e ficam gravadas com a mensagem.
      const fichas = [
        { _tag: "link", rotulo: "Res. CNE/CP nº 2/2026, art. 28", link: "ifpr://norma/br/cne-cp/res/2026/2#art28" },
        { _tag: "texto", rotulo: "Trecho selecionado", texto: "O estágio terá 160 horas." },
      ] as const;
      yield* turnoAoVivo(
        (depois) => segundo.conversas.acompanhar(id, depois),
        segundo.conversas.enviar(id, "E isto?", fichas),
      );
      const comFichas = registro.textos.at(-1) ?? "";
      assert.isTrue(comFichas.startsWith("E isto?\n\nO que a pessoa deixou junto desta mensagem"));
      assert.include(comFichas, "ifpr://norma/br/cne-cp/res/2026/2#art28");
      assert.include(comFichas, "  > O estágio terá 160 horas.");
      assert.deepInclude(
        (yield* segundo.conversas.carregar(id)).itens.find(
          (item) => item._tag === "Mensagem" && item.texto === "E isto?",
        ),
        { fichas },
      );
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
      const { sessao: id } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta }, "estavel");
      const turno = yield* turnoCompleto(conversas, id, "uma resposta demorada").pipe(Effect.forkChild);
      yield* rodar;
      yield* registro.derrubar!();
      const eventos = [...(yield* Fiber.join(turno))];
      yield* rodar;
      assert.deepStrictEqual(tags(eventos), ["TextoParcial", "Erro", "FimTurno"]);
      assert.deepStrictEqual(eventos[1], { _tag: "Erro", tipo: "queda", mensagem: "claude: falha em sessão (queda)" });
      assert.deepStrictEqual(eventos[2], { _tag: "FimTurno", motivo: "falha" });
      assert.strictEqual((yield* resumo(conversas, id))?.estado, "caiu");
      assert.strictEqual(registro.encerradas, 1);

      const depois = yield* turnoCompleto(conversas, id, "olá de novo");
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
      const { sessao: id } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta }, "estavel");
      yield* turnoCompleto(conversas, id, "olá");
      yield* registro.derrubar!();
      yield* rodar;
      const { conversa, itens } = yield* conversas.carregar(id);
      assert.strictEqual(conversa.estado, "caiu");
      assert.strictEqual(eventosDe(itens).at(-1)?._tag, "Erro");
      yield* turnoCompleto(conversas, id, "de novo");
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
      const { sessao: id } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta }, "estavel");
      const turno = yield* turnoCompleto(conversas, id, "uma resposta demorada").pipe(Effect.forkChild);
      yield* rodar;
      yield* registro.derrubar!(causa);
      const eventos = [...(yield* Fiber.join(turno))];
      assert.deepStrictEqual(eventos[1], { _tag: "Erro", tipo: "queda", mensagem: saneado });

      yield* turnoCompleto(conversas, id, "olá");
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

  it.effect("os logs registram o id da conversa, sem a pasta da tarefa, o anexo nem o texto do pedido", () =>
    Effect.gen(function* () {
      const registros: Array<string> = [];
      const capturar = Logger.make((opcoes) => {
        registros.push(`${String(opcoes.message)} ${Cause.pretty(opcoes.cause)}`);
      });
      const tarefa = NodePath.join(diretorioTemporario("simplifica-tarefas-"), "Parecer sobre o PAD do servidor João");
      NodeFS.mkdirSync(tarefa);
      const causa = new Error(`ENOENT: no such file or directory, open '${tarefa}/anexo sigiloso.pdf'`);
      yield* Effect.gen(function* () {
        const registro = novoRegistro();
        const { conversas, fechar } = yield* abrir(novoBanco(), registro);
        const { sessao: id } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: tarefa }, "estavel");
        const turno = yield* turnoCompleto(conversas, id, "pedido sigiloso demorado").pipe(Effect.forkChild);
        yield* rodar;
        yield* registro.derrubar!(causa);
        yield* Fiber.join(turno);
        assert.isTrue(registros.some((linha) => linha.includes(`conversa ${id}`) && linha.includes("sessão aberta")));
        assert.isTrue(registros.some((linha) => linha.includes(`conversa ${id}: o turno falhou`)));
        yield* fechar;
      }).pipe(Effect.provide(Logger.layer([capturar])));
      for (const linha of registros) {
        assert.notInclude(linha, "Parecer sobre o PAD", linha);
        assert.notInclude(linha, "anexo sigiloso", linha);
        assert.notInclude(linha, "pedido sigiloso", linha);
      }
    }),
  );

  it.effect("ociosidade: sem turno por 30 minutos, a sessão se libera; a próxima mensagem retoma", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const { conversas, fechar } = yield* abrir(novoBanco(), registro);
      const { sessao: id } = yield* conversas.iniciar(
        {
          provider: "claude",
          pastaTrabalho: pasta,
          modelo: "opus",
          esforco: "xhigh",
        },
        "estavel",
      );
      assert.deepInclude(registro.configs.at(-1), { modelo: "opus", esforco: "xhigh" });
      yield* turnoCompleto(conversas, id, "olá");
      yield* avancar(Duration.subtract(Conversas.OCIOSIDADE, Duration.seconds(1)));
      assert.strictEqual(registro.encerradas, 0);
      yield* avancar(Duration.seconds(1));
      assert.strictEqual(registro.encerradas, 1);
      assert.strictEqual((yield* resumo(conversas, id))?.estado, "liberada");

      // A interface que recarrega não muda nada: a conversa continua e se retoma.
      yield* turnoCompleto(conversas, id, "voltei");
      assert.strictEqual(registro.configs.length, 2);
      assert.strictEqual(registro.configs.at(-1)?.retomar, "nativo-1");
      // A retomada reabre com o modelo e o esforço escolhidos no começo.
      assert.deepInclude(registro.configs.at(-1), { modelo: "opus", esforco: "xhigh" });
      // `encerrar` libera a sessão, e a próxima mensagem a reabre.
      yield* conversas.encerrar(id);
      assert.strictEqual((yield* resumo(conversas, id))?.estado, "liberada");
      yield* turnoCompleto(conversas, id, "de novo");
      assert.strictEqual((yield* resumo(conversas, id))?.estado, "pronta");
      assert.strictEqual(registro.configs.length, 3);
      yield* fechar;
    }),
  );

  it.effect("skills do catálogo: na conversa livre, a sessão nova, a retomada e a recomeçada recebem todas", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const { conversas, fechar } = yield* abrir(novoBanco(), registro);
      const { sessao: id } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta }, "estavel");
      const esperadas = [paraMotor(OUTRA_SKILL), paraMotor(SKILL)];
      assert.deepStrictEqual(registro.configs[0]?.skills, esperadas);
      // O motor gravou o SKILL.md e o arquivo listado na pasta de trabalho, e as instruções as listam.
      const pastaSkill = `${NodeFS.realpathSync(pasta)}/.simplifica/skills/${SKILL.nome}`;
      assert.include(NodeFS.readFileSync(`${pastaSkill}/SKILL.md`, "utf8"), "Leia `referencia.md`.");
      assert.strictEqual(NodeFS.readFileSync(`${pastaSkill}/referencia.md`, "utf8"), "referência");
      assert.include(registro.configs[0]?.instrucoes ?? "", `\`${SKILL.nome}\``);

      // Retomada pelo provider.
      yield* conversas.encerrar(id);
      yield* turnoCompleto(conversas, id, "voltei");
      assert.strictEqual(registro.configs.at(-1)?.retomar, "nativo-1");
      assert.deepStrictEqual(registro.configs.at(-1)?.skills, esperadas);

      // Retomada recusada: a sessão recomeçada também as recebe.
      yield* conversas.encerrar(id);
      registro.recusarRetomada = true;
      yield* turnoCompleto(conversas, id, "de novo");
      assert.isUndefined(registro.configs.at(-1)?.retomar);
      assert.deepStrictEqual(registro.configs.at(-1)?.skills, esperadas);
      yield* fechar;
    }),
  );

  it.effect("skill retirada: a sessão nova e a retomada apagam a pasta dela, e só a dela, da pasta de trabalho", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const { conversas, fechar } = yield* abrir(
        novoBanco(),
        registro,
        undefined,
        undefined,
        undefined,
        new Set(["velha"]),
      );
      const daPasta = NodeFS.realpathSync(diretorioTemporario("simplifica-retirada-"));
      const skills = `${daPasta}/.simplifica/skills`;
      const gravadaAntes = (nome: string) => {
        NodeFS.mkdirSync(`${skills}/${nome}`, { recursive: true });
        NodeFS.writeFileSync(`${skills}/${nome}/SKILL.md`, "---\nname: x\n---\n");
      };
      // Uma sessão de antes da retirada gravou a "velha"; outra conversa na mesma pasta, a "de-outra-conversa".
      gravadaAntes("velha");
      gravadaAntes("de-outra-conversa");
      const { sessao: id } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: daPasta }, "estavel");
      assert.deepStrictEqual(registro.configs.at(-1)?.skillsRetiradas, ["velha"]);
      assert.deepStrictEqual(
        NodeFS.readdirSync(skills).sort(),
        ["de-outra-conversa", OUTRA_SKILL.nome, SKILL.nome].sort(),
      );

      gravadaAntes("velha");
      yield* conversas.encerrar(id);
      yield* turnoCompleto(conversas, id, "voltei");
      assert.strictEqual(registro.configs.at(-1)?.retomar, "nativo-1");
      assert.isFalse(NodeFS.existsSync(`${skills}/velha`));
      assert.isTrue(NodeFS.existsSync(`${skills}/de-outra-conversa/SKILL.md`));
      yield* fechar;
    }),
  );

  it.effect("conversa de tarefa: só a skill da tarefa, na sessão nova, na retomada e na recomeçada", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const { conversas, fechar } = yield* abrir(novoBanco(), registro);
      const daTarefa = NodeFS.realpathSync(diretorioTemporario("simplifica-tarefa-com-skill-"));
      const { sessao: id } = yield* conversas.iniciar(
        { provider: "claude", pastaTrabalho: daTarefa, tarefa: "tarefa-com-skill" },
        "estavel",
      );
      const soADaTarefa = () => {
        const config = registro.configs.at(-1);
        assert.deepStrictEqual(config?.skills, [paraMotor(SKILL)]);
        // Nos dois lugares em que a skill chega ao provider: as instruções da sessão e a pasta.
        assert.include(config?.instrucoes ?? "", `\`${SKILL.nome}\``);
        assert.notInclude(config?.instrucoes ?? "", OUTRA_SKILL.nome);
        assert.deepStrictEqual(NodeFS.readdirSync(`${daTarefa}/.simplifica/skills`), [SKILL.nome]);
      };
      soADaTarefa();

      yield* conversas.encerrar(id);
      yield* turnoCompleto(conversas, id, "voltei");
      assert.strictEqual(registro.configs.at(-1)?.retomar, "nativo-1");
      soADaTarefa();

      yield* conversas.encerrar(id);
      registro.recusarRetomada = true;
      yield* turnoCompleto(conversas, id, "de novo");
      assert.isUndefined(registro.configs.at(-1)?.retomar);
      soADaTarefa();
      yield* fechar;
    }),
  );

  it.effect("conversa de tarefa sem skill: a sessão não leva skill nenhuma, nem depois de outro app abrir", () =>
    Effect.gen(function* () {
      const arquivo = novoBanco();
      const registro = novoRegistro();
      const primeiro = yield* abrir(arquivo, registro);
      const daTarefa = NodeFS.realpathSync(diretorioTemporario("simplifica-tarefa-sem-skill-"));
      const { sessao: id } = yield* primeiro.conversas.iniciar(
        { provider: "claude", pastaTrabalho: daTarefa, tarefa: "tarefa-sem-skill" },
        "estavel",
      );
      const semSkill = () => {
        const config = registro.configs.at(-1);
        assert.isUndefined(config?.skills);
        assert.notInclude(config?.instrucoes ?? "", "Skills do Simplifica IF");
        assert.isFalse(NodeFS.existsSync(`${daTarefa}/.simplifica/skills`));
      };
      semSkill();
      yield* primeiro.fechar;

      // O app que abre depois lê a regra da tarefa gravada na conversa.
      const segundo = yield* abrir(arquivo, registro);
      yield* turnoCompleto(segundo.conversas, id, "voltei");
      assert.strictEqual(registro.configs.length, 2);
      semSkill();
      yield* segundo.fechar;
    }),
  );

  /** A última sessão aberta ficou sem web, e só sem ela: as ferramentas `ifpr` seguem todas, sem perguntar. */
  const webDesligada = (registro: Registro) => {
    assert.isTrue(registro.configs.at(-1)?.semWeb);
    assert.isFalse(Motor.buscaWebLigada(registro.politicas.at(-1)!));
    assert.notInclude(registro.configs.at(-1)?.instrucoes ?? "", "busca na web");
    assert.strictEqual(registro.configs.at(-1)?.servidoresMcp[0]?.nome, Conversas.NOME_MCP);
    assert.strictEqual(registro.politicas.at(-1)?.ferramentas.mcpApp, "permitir");
  };

  it.effect(
    "web: false na tarefa desliga a web da sessão, nova, retomada e recomeçada; as outras seguem a política",
    () =>
      Effect.gen(function* () {
        const registro = novoRegistro();
        const { conversas, fechar } = yield* abrir(novoBanco(), registro);
        for (const tarefa of ["tarefa-sem-web", "tarefa-sem-web-nem-skill"]) {
          registro.recusarRetomada = false;
          const { sessao: id } = yield* conversas.iniciar(
            { provider: "claude", pastaTrabalho: pasta, tarefa },
            "estavel",
          );
          const nativo = registro.configs.length;
          webDesligada(registro);
          assert.strictEqual(registro.configs.at(-1)?.skills?.length, tarefa === "tarefa-sem-web" ? 1 : undefined);
          yield* conversas.encerrar(id);
          yield* turnoCompleto(conversas, id, "voltei");
          assert.strictEqual(registro.configs.at(-1)?.retomar, `nativo-${nativo}`);
          webDesligada(registro);

          // Retomada recusada: a sessão recomeça com o histórico como contexto, ainda sem web.
          yield* conversas.encerrar(id);
          registro.recusarRetomada = true;
          yield* turnoCompleto(conversas, id, "de novo");
          assert.isUndefined(registro.configs.at(-1)?.retomar);
          webDesligada(registro);
        }
        registro.recusarRetomada = false;

        // A tarefa que não desliga e a conversa livre ficam com a política de fábrica.
        for (const tarefa of ["tarefa-com-skill", undefined]) {
          yield* conversas.iniciar(
            { provider: "claude", pastaTrabalho: pasta, ...(tarefa === undefined ? {} : { tarefa }) },
            "estavel",
          );
          assert.isUndefined(registro.configs.at(-1)?.semWeb);
          assert.strictEqual(registro.politicas.at(-1), Motor.POLITICA_FABRICA);
          assert.include(registro.configs.at(-1)?.instrucoes ?? "", "busca na web");
        }
        yield* fechar;
      }),
  );

  it.effect("web: false fica gravado na conversa: o manifesto que some do catálogo não religa a web", () =>
    Effect.gen(function* () {
      const arquivo = novoBanco();
      const registro = novoRegistro();
      const primeiro = yield* abrir(arquivo, registro);
      const { sessao: id } = yield* primeiro.conversas.iniciar(
        { provider: "claude", pastaTrabalho: pasta, tarefa: "tarefa-sem-web" },
        "estavel",
      );
      webDesligada(registro);
      yield* primeiro.fechar;

      // O app abre com um catálogo sem a tarefa (saiu do repositório, ou o manifesto chegou inválido).
      const segundo = yield* abrir(
        arquivo,
        registro,
        undefined,
        undefined,
        TAREFAS.filter((tarefa) => tarefa.id !== "tarefa-sem-web"),
      );
      yield* turnoCompleto(segundo.conversas, id, "voltei");
      assert.strictEqual(registro.configs.length, 2);
      webDesligada(registro);
      // Sem o manifesto, a sessão também não leva skill.
      assert.isUndefined(registro.configs.at(-1)?.skills);
      yield* segundo.fechar;
    }),
  );

  it.effect("tarefa experimental: só abre conversa no canal beta", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const { conversas, fechar } = yield* abrir(novoBanco(), registro);
      const entrada = { provider: "claude", pastaTrabalho: pasta, tarefa: "tarefa-experimental" } as const;
      const recusa = yield* Effect.flip(conversas.iniciar(entrada, "estavel"));
      assert.strictEqual(recusa._tag, "TarefaDesconhecida");
      assert.strictEqual(recusa.message, "Esta tarefa é experimental: só abre no canal beta das atualizações.");
      assert.strictEqual(registro.configs.length, 0);
      assert.deepStrictEqual(yield* conversas.listar, []);
      const { sessao: id } = yield* conversas.iniciar(entrada, "beta");
      assert.strictEqual((yield* conversas.carregar(id)).conversa.tarefa, "tarefa-experimental");
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
        const { sessao: id } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta }, "estavel");
        // Como a interface: o turno acabou quando chega o `FimTurno`; o stream do provider segue aberto.
        const eventos = yield* turnoCompleto(conversas, id, "olá");
        assert.strictEqual(tags(eventos).at(-1), "FimTurno");
        assert.strictEqual((yield* conversas.carregar(id)).conversa.estado, "pronta");
        registro.segurarFim = undefined;
        const outra = yield* turnoCompleto(conversas, id, "outra");
        assert.deepStrictEqual([...outra].at(-1), { _tag: "FimTurno", motivo: "concluido" });
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
      const { sessao: id } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta }, "estavel");
      const eventos = yield* turnoCompleto(conversas, id, "olá");
      assert.deepStrictEqual([...eventos].at(-1), { _tag: "FimTurno", motivo: "concluido" });
      assert.strictEqual((yield* conversas.carregar(id)).conversa.estado, "pronta");
      const outra = yield* turnoCompleto(conversas, id, "outra");
      assert.strictEqual(tags(outra).at(-1), "FimTurno");
      yield* fechar;
    }),
  );

  it.effect("interromper: o turno termina interrompido e a conversa aceita outro turno", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const { conversas, fechar } = yield* abrir(novoBanco(), registro);
      const { sessao: id } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta }, "estavel");
      const turno = yield* turnoCompleto(conversas, id, "uma resposta demorada").pipe(Effect.forkChild);
      yield* rodar;
      const emAndamento = yield* Effect.flip(turnoCompleto(conversas, id, "outra"));
      assert.strictEqual(emAndamento._tag, "TurnoEmAndamento");
      yield* conversas.interromper(id);
      const eventos = yield* Fiber.join(turno);
      assert.deepStrictEqual([...eventos].at(-1), { _tag: "FimTurno", motivo: "interrompido" });
      const depois = yield* turnoCompleto(conversas, id, "olá");
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
            abrirTurno: (_conversa, turno) =>
              turno === 2 ? Deferred.succeed(comecou, undefined).pipe(Effect.andThen(Effect.never)) : Effect.undefined,
            fecharTurno: (_conversa, turno, _pasta, { chegouAIA }) =>
              Effect.sync(() => void (chegouAIA ? undefined : descartadas.push(turno))),
          });
        }),
      ).pipe(Layer.provide(PastasTrabalho.layerSemPastas));
      const { conversas, fechar } = yield* abrir(novoBanco(), registro, pastasLentas);
      const { sessao: id } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta }, "estavel");
      yield* turnoCompleto(conversas, id, "olá");
      const enviados = registro.textos.length;

      const turno = yield* turnoCompleto(conversas, id, "confira a pasta").pipe(Effect.forkChild);
      yield* Deferred.await(comecou);
      // No preparo, o turno já existe: outra mensagem espera, e o "Parar" tem o que interromper.
      const emAndamento = yield* Effect.flip(turnoCompleto(conversas, id, "outra"));
      assert.strictEqual(emAndamento._tag, "TurnoEmAndamento");
      yield* conversas.interromper(id);
      const eventos = yield* Fiber.join(turno);
      assert.deepStrictEqual([...eventos], [{ _tag: "FimTurno", motivo: "parado_antes_do_envio" }]);
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
      const depois = yield* turnoCompleto(conversas, id, "de novo");
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
      const { sessao: id } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: tarefa }, "estavel");
      yield* turnoCompleto(conversas, id, "olá");

      // Entre os turnos, a pessoa põe um .docx e uma nota; a conversão do .docx trava, e ela para.
      NodeFS.writeFileSync(NodePath.join(tarefa, "Minuta.docx"), "conteúdo da minuta");
      NodeFS.writeFileSync(NodePath.join(tarefa, "nota.md"), "nota\n");
      const parado = yield* turnoCompleto(conversas, id, "confira").pipe(Effect.forkChild);
      yield* Deferred.await(comecou);
      yield* conversas.interromper(id);
      assert.deepStrictEqual([...(yield* Fiber.join(parado))], [{ _tag: "FimTurno", motivo: "parado_antes_do_envio" }]);

      // No turno seguinte, o aviso traz as duas mudanças (a comparação é com o turno 1, o último que
      // chegou à IA), e a minuta ganha o texto.
      const seguinte = yield* turnoCompleto(conversas, id, "de novo");
      assert.deepStrictEqual(
        [...seguinte].find((evento) => evento._tag === "MudancasPasta"),
        {
          _tag: "MudancasPasta",
          anexados: [],
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
          abrirTurno: (_conversa, turno) =>
            turno === n
              ? Deferred.succeed(comecou, undefined).pipe(
                  Effect.andThen(solta === undefined ? Effect.never : Deferred.await(solta)),
                  Effect.as(undefined),
                )
              : Effect.undefined,
        });
      }),
    ).pipe(Layer.provide(PastasTrabalho.layerSemPastas));

  it.effect("a tarefa sem skill não indica skill; a conversa livre não guarda tarefa", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const { conversas, fechar } = yield* abrir(novoBanco(), registro);
      const { sessao: semSkill } = yield* conversas.iniciar(
        {
          provider: "claude",
          pastaTrabalho: pasta,
          tarefa: "tarefa-sem-skill",
        },
        "estavel",
      );
      yield* turnoCompleto(conversas, semSkill, "olá");
      assert.strictEqual(registro.textos.at(-1), "olá");
      assert.strictEqual((yield* conversas.carregar(semSkill)).conversa.tarefa, "tarefa-sem-skill");
      const { sessao: livre } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta }, "estavel");
      yield* turnoCompleto(conversas, livre, "oi");
      assert.strictEqual(registro.textos.at(-1), "oi");
      assert.isUndefined((yield* conversas.carregar(livre)).conversa.tarefa);
      // O nome da skill não é id de tarefa.
      const recusa = yield* Effect.flip(
        conversas.iniciar({ provider: "claude", pastaTrabalho: pasta, tarefa: SKILL.nome }, "estavel"),
      );
      assert.strictEqual(recusa._tag, "TarefaDesconhecida");
      yield* fechar;
    }),
  );

  it.effect("o turno 1 de uma tarefa parado no preparo: a skill é indicada no primeiro que chega à IA", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const comecou = yield* Deferred.make<void>();
      const { conversas, fechar } = yield* abrir(novoBanco(), registro, pastasPresas(1, comecou));
      const { sessao: id } = yield* conversas.iniciar(
        { provider: "claude", pastaTrabalho: pasta, tarefa: "tarefa-com-skill" },
        "estavel",
      );
      const parado = yield* turnoCompleto(conversas, id, "primeiro").pipe(Effect.forkChild);
      yield* Deferred.await(comecou);
      yield* conversas.interromper(id);
      yield* Fiber.join(parado);
      yield* turnoCompleto(conversas, id, "de novo");
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
      const { sessao: id } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta }, "estavel");
      yield* turnoCompleto(conversas, id, "olá");
      const enviados = registro.textos.length;
      const parado = yield* turnoCompleto(conversas, id, "segundo").pipe(Effect.forkChild);
      yield* Deferred.await(comecou);
      yield* registro.derrubar!(new Error("o processo morreu"));
      yield* rodar;
      yield* conversas.interromper(id);
      assert.deepStrictEqual([...(yield* Fiber.join(parado))], [{ _tag: "FimTurno", motivo: "parado_antes_do_envio" }]);
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
      const { sessao: id } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta }, "estavel");
      yield* turnoCompleto(conversas, id, "olá");
      const enviados = registro.textos.length;
      const turno = yield* turnoCompleto(conversas, id, "segundo").pipe(Effect.forkChild);
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
      yield* turnoCompleto(conversas, id, "de novo");
      assert.strictEqual(registro.textos.at(-1), "de novo");
      yield* fechar;
    }),
  );

  it.effect("encerrar a conversa no preparo fecha o turno como parado, não como resposta interrompida", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const comecou = yield* Deferred.make<void>();
      const { conversas, fechar } = yield* abrir(novoBanco(), registro, pastasPresas(1, comecou));
      const { sessao: id } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta }, "estavel");
      const turno = yield* turnoCompleto(conversas, id, "olá").pipe(Effect.forkChild);
      yield* Deferred.await(comecou);
      yield* conversas.encerrar(id);
      assert.deepStrictEqual([...(yield* Fiber.join(turno))], [{ _tag: "FimTurno", motivo: "parado_antes_do_envio" }]);
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
      const { sessao: id } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: tarefa }, "estavel");
      yield* turnoCompleto(conversas, id, "olá");
      NodeFS.writeFileSync(NodePath.join(tarefa, "A.docx"), "a");
      NodeFS.writeFileSync(NodePath.join(tarefa, "B.docx"), "b");
      const parado = yield* turnoCompleto(conversas, id, "confira").pipe(Effect.forkChild);
      yield* Deferred.await(comecou);
      yield* conversas.interromper(id);
      yield* Fiber.join(parado);
      const seguinte = yield* turnoCompleto(conversas, id, "de novo");
      assert.deepStrictEqual(
        [...seguinte].find((evento) => evento._tag === "MudancasPasta"),
        {
          _tag: "MudancasPasta",
          anexados: [],
          novos: [
            { nome: "A.docx", texto: ".simplifica/textos/A.docx.md" },
            { nome: "B.docx", texto: ".simplifica/textos/B.docx.md" },
          ],
          mudados: [],
          removidos: [],
        },
      );
      // Avisado, o A.docx não volta no turno seguinte.
      const depois = yield* turnoCompleto(conversas, id, "e agora?");
      assert.isUndefined([...depois].find((evento) => evento._tag === "MudancasPasta"));
      yield* fechar;
    }),
  );

  /** As pastas de verdade numa raiz nova, com a pasta `Tarefa` e os textos que convertem na hora. */
  const pastasReais = () => {
    const raiz = NodeFS.realpathSync(diretorioTemporario("simplifica-raiz-"));
    const tarefa = NodePath.join(raiz, "Tarefa");
    NodeFS.mkdirSync(tarefa);
    const textos = Layer.succeed(TextosAnexos.TextosAnexos, {
      bytesDoArquivo: TextosAnexos.LIMITES.bytesDoArquivo,
      converter: (_bytes, nome) => Effect.succeed({ tipo: "texto", markdown: `texto de ${nome}` } as const),
    });
    const camada = PastasTrabalho.layer({ raiz, copias: diretorioTemporario("simplifica-copias-") }).pipe(
      Layer.provide(textos),
      Layer.provide(ArquivosLiberados.layer({ exigirLiberacao: false })),
    );
    return { tarefa, camada };
  };

  /** Um arquivo fora da raiz, para anexar. */
  const arquivoParaAnexar = (nome: string, conteudo: string) => {
    const caminho = NodePath.join(diretorioTemporario("simplifica-anexo-"), nome);
    NodeFS.writeFileSync(caminho, conteudo);
    return caminho;
  };

  it.effect("gravar: só os bytes novos, sem seguir o link no lugar do arquivo, e só na pasta de uma tarefa", () =>
    Effect.gen(function* () {
      const { tarefa, camada } = pastasReais();
      const { pastas, fechar } = yield* abrir(novoBanco(), novoRegistro(), camada);
      const bytes = (texto: string) => new TextEncoder().encode(texto);
      assert.strictEqual(yield* pastas.gravar(tarefa, "PPC.md", bytes("um")), "novo");
      assert.strictEqual(yield* pastas.gravar(tarefa, "PPC.md", bytes("um")), "igual");
      assert.strictEqual(yield* pastas.gravar(tarefa, "PPC.md", bytes("dois")), "regravado");
      assert.strictEqual(NodeFS.readFileSync(NodePath.join(tarefa, "PPC.md"), "utf8"), "dois");
      // O link no lugar do arquivo, para um de fora com os mesmos bytes: o link sai, e o de fora fica.
      const alvo = arquivoParaAnexar("alvo.md", "três");
      NodeFS.rmSync(NodePath.join(tarefa, "PPC.md"));
      NodeFS.symlinkSync(alvo, NodePath.join(tarefa, "PPC.md"));
      assert.strictEqual(yield* pastas.gravar(tarefa, "PPC.md", bytes("três")), "regravado");
      assert.isFalse(NodeFS.lstatSync(NodePath.join(tarefa, "PPC.md")).isSymbolicLink());
      assert.strictEqual(NodeFS.readFileSync(alvo, "utf8"), "três");
      // As pastas do app, as ocultas e as de fora da raiz não recebem nada.
      const raiz = NodePath.dirname(tarefa);
      const relatos = NodePath.join(raiz, "Relatos de erro");
      const oculta = NodePath.join(raiz, ".oculta");
      for (const nova of [relatos, oculta]) NodeFS.mkdirSync(nova);
      for (const recusada of [relatos, oculta, NodePath.dirname(alvo)]) {
        const recusa = yield* Effect.exit(pastas.gravar(recusada, "PPC.md", bytes("um")));
        assert.isTrue(Exit.isFailure(recusa));
      }
      assert.isFalse(NodeFS.existsSync(NodePath.join(relatos, "PPC.md")));
      yield* fechar;
    }),
  );

  it.effect("o anexo chega à IA pelo aviso do servidor: antes da primeira mensagem e entre os turnos", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const { tarefa, camada } = pastasReais();
      const { conversas, pastas, fechar } = yield* abrir(novoBanco(), registro, camada);
      const { sessao: id } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: tarefa }, "estavel");
      // Como a tarefa do Início: o anexo entra na pasta antes da primeira mensagem.
      yield* pastas.anexar(tarefa, arquivoParaAnexar("Minuta.docx", "minuta"));
      yield* turnoCompleto(conversas, id, "confira a minuta");
      assert.match(registro.textos.at(-1) ?? "", /^confira a minuta\n\n[\s\S]*`Minuta\.docx`/);
      // Como o "Anexar" do painel da pasta, sem nota nenhuma: o turno seguinte o avisa.
      yield* pastas.anexar(tarefa, arquivoParaAnexar("Foto.png", "png"));
      yield* turnoCompleto(conversas, id, "e a foto?");
      assert.match(registro.textos.at(-1) ?? "", /^e a foto\?\n\n[\s\S]*`Foto\.png`/);
      // Avisado uma vez, não volta; e o histórico guarda a mensagem como a pessoa a escreveu.
      yield* turnoCompleto(conversas, id, "obrigado");
      assert.strictEqual(registro.textos.at(-1), "obrigado");
      const mensagens = (yield* conversas.carregar(id)).itens.flatMap((item) =>
        item._tag === "Mensagem" ? [item.texto] : [],
      );
      assert.deepStrictEqual(mensagens, ["confira a minuta", "e a foto?", "obrigado"]);
      yield* fechar;
    }),
  );

  it.effect("o anexo que chega durante um turno fica para o aviso do turno seguinte", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const { tarefa, camada } = pastasReais();
      const { conversas, pastas, fechar } = yield* abrir(novoBanco(), registro, camada);
      const { sessao: id } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: tarefa }, "estavel");
      yield* pastas.anexar(tarefa, arquivoParaAnexar("A.md", "a"));
      const turno = yield* turnoCompleto(conversas, id, "uma resposta demorada").pipe(Effect.forkChild);
      // A IA já está respondendo: o texto parcial chegou.
      yield* conversas.acompanhar(id, Number.MAX_SAFE_INTEGER).pipe(
        Stream.filter((item) => item._tag === "EventoTurno" && item.evento._tag === "TextoParcial"),
        Stream.runHead,
      );
      // O turno já avisou o A.md; o B.md chega com a IA respondendo, e o fim do turno não o dá por avisado.
      yield* pastas.anexar(tarefa, arquivoParaAnexar("B.md", "b"));
      yield* conversas.interromper(id);
      yield* Fiber.join(turno);
      assert.match(registro.textos.at(-1) ?? "", /`A\.md`/);
      yield* turnoCompleto(conversas, id, "e agora?");
      const pedido = registro.textos.at(-1) ?? "";
      assert.match(pedido, /^e agora\?\n\nA pessoa anexou à pasta da tarefa:\n- `B\.md`$/);
      yield* fechar;
    }),
  );

  it.effect("interromper sem resposta do provider: no fim do prazo, a sessão se libera e o turno fecha", () =>
    Effect.gen(function* () {
      const registro = { ...novoRegistro(), ignorarInterrupcao: true };
      const { conversas, fechar } = yield* abrir(novoBanco(), registro);
      const { sessao: id } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta }, "estavel");
      const turno = yield* turnoCompleto(conversas, id, "uma resposta demorada").pipe(Effect.forkChild);
      yield* rodar;
      yield* conversas.interromper(id);
      yield* avancar(PRAZO);
      const eventos = yield* Fiber.join(turno);
      assert.deepStrictEqual([...eventos].at(-1), { _tag: "FimTurno", motivo: "interrompido" });
      assert.strictEqual(registro.encerradas, 1);
      assert.strictEqual((yield* resumo(conversas, id))?.estado, "liberada");
      registro.ignorarInterrupcao = false;
      yield* turnoCompleto(conversas, id, "olá");
      assert.strictEqual(registro.configs.at(-1)?.retomar, "nativo-1");
      yield* fechar;
    }),
  );

  it.effect(
    "acompanhar: o turno que falha com a sessão viva deixa a conversa pronta, e o estado chega a quem acompanha",
    () =>
      Effect.gen(function* () {
        const registro = novoRegistro();
        const { conversas, fechar } = yield* abrir(novoBanco(), registro);
        const { sessao: id } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta }, "estavel");
        const recebidos = yield* Effect.scoped(
          Effect.gen(function* () {
            const fila = yield* Stream.toQueue(conversas.acompanhar(id, 0), { capacity: "unbounded" });
            const itens: Array<ItemAoVivo> = [yield* Queue.take(fila)];
            yield* conversas.enviar(id, "estourei o limite?");
            for (;;) {
              const item = yield* Queue.take(fila);
              itens.push(item);
              if (item._tag === "EventoTurno" && item.evento._tag === "FimTurno") return itens;
            }
          }),
        );
        assert.deepStrictEqual(
          recebidos.flatMap((item) => (item._tag === "Estado" ? [item.estado] : [])),
          ["pronta", "respondendo", "pronta"],
        );
        assert.deepInclude(recebidos.at(-1), { evento: { _tag: "FimTurno", motivo: "falha" } });
        assert.strictEqual((yield* conversas.carregar(id)).conversa.estado, "pronta");
        yield* fechar;
      }),
  );

  it.effect("acompanhar termina quando a conversa é apagada", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const { conversas, fechar } = yield* abrir(novoBanco(), registro);
      const { sessao: id } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta }, "estavel");
      yield* Effect.scoped(
        Effect.gen(function* () {
          const fila = yield* Stream.toQueue(conversas.acompanhar(id, 0), { capacity: "unbounded" });
          assert.deepStrictEqual(yield* Queue.take(fila), { _tag: "Estado", estado: "pronta" });
          yield* conversas.apagar(id);
          assert.isTrue(Exit.isFailure(yield* Effect.exit(Queue.take(fila))));
        }),
      );
      yield* fechar;
    }),
  );

  it.effect("acompanhar: quem chega no meio do turno recebe o gravado, o parcial e o resto", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const { conversas, fechar } = yield* abrir(novoBanco(), registro);
      const { sessao: id } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta }, "estavel");
      yield* turnoCompleto(conversas, id, "olá");
      // A interface que enviou caiu no meio do turno (o stream dela foi interrompido).
      const primeiro = yield* turnoCompleto(conversas, id, "pode escrever?").pipe(Effect.forkChild);
      yield* rodar;
      yield* Fiber.interrupt(primeiro);
      const { conversa, itens } = yield* conversas.carregar(id);
      assert.strictEqual(conversa.estado, "respondendo");
      const visto = itens.at(-1)?.ordem ?? 0;

      // A que recarregou acompanha a partir do que já viu, e responde à aprovação.
      const acompanhamento = yield* conversas.acompanhar(id, visto - 2).pipe(
        Stream.takeUntil((item) => item._tag === "EventoTurno" && item.evento._tag === "FimTurno"),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* rodar;
      yield* conversas.responderAprovacao(id, "f1", "permitir");
      const recebidos = [...(yield* Fiber.join(acompanhamento))];
      assert.deepStrictEqual(
        recebidos.map((item) =>
          item._tag === "EventoTurno" ? item.evento._tag : item._tag === "Estado" ? `Estado ${item.estado}` : item._tag,
        ),
        [
          "FerramentaIniciada",
          "PedidoAprovacao",
          "TextoParcial",
          // O retrato termina no estado de agora; o fim do turno traz o estado em repouso antes do `FimTurno`.
          "Estado respondendo",
          "DecisaoAprovacao",
          "FerramentaConcluida",
          "TextoFinal",
          "Estado pronta",
          "FimTurno",
        ],
      );
      assert.deepInclude(recebidos[2], { evento: { _tag: "TextoParcial", texto: "Vou " } });
      // Sem turno em andamento: o gravado e o estado, e o resto ao vivo.
      const resto = yield* conversas.acompanhar(id, 0).pipe(
        Stream.takeUntil((item) => item._tag === "Estado"),
        Stream.runCollect,
      );
      assert.deepStrictEqual(
        [...resto],
        [...(yield* conversas.carregar(id)).itens, { _tag: "Estado", estado: "pronta" }],
      );
      yield* fechar;
    }),
  );
});

/** Tira eventos da fila até chegar um que `aceita`, e o devolve. */
const ate = (fila: Queue.Dequeue<EventoAtividades, Cause.Done>, aceita: (evento: EventoAtividades) => boolean) =>
  Effect.gen(function* () {
    for (;;) {
      const evento = yield* Queue.take(fila);
      if (aceita(evento)) return evento;
    }
  });

/** As atividades do retrato de agora, como `<id> <situação>`. */
const retratoDe = (atividades: Atividades.Atividades["Service"]) =>
  atividades.acompanhar.pipe(
    Stream.take(1),
    Stream.runCollect,
    Effect.map((eventos) =>
      [...eventos].flatMap((evento) =>
        evento._tag === "Retrato" ? evento.atividades.map((x) => `${x.id} ${x.situacao}`) : [],
      ),
    ),
  );

const mudou = (id: string, situacao: string) => (evento: EventoAtividades) =>
  evento._tag === "Mudou" && evento.atividade.id === `conversa:${id}` && evento.atividade.situacao === situacao;

describe("atividades das conversas", () => {
  it.effect(
    "duas conversas: respondendo, a aprovação pendente até a decisão, a resposta pronta até ser vista, e o limite",
    () =>
      Effect.gen(function* () {
        const registro = novoRegistro();
        const arquivo = novoBanco();
        const { conversas, atividades, fechar } = yield* abrir(arquivo, registro);
        const { sessao: a } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta }, "estavel");
        const { sessao: b } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta }, "estavel");
        yield* Effect.scoped(
          Effect.gen(function* () {
            const fila = yield* Stream.toQueue(atividades.acompanhar, { capacity: "unbounded" });
            assert.deepStrictEqual(yield* Queue.take(fila), { _tag: "Retrato", atividades: [] });

            // A conversa A responde por muito tempo; a B pede para escrever.
            yield* conversas.enviar(a, "isto demora");
            const andando = yield* ate(fila, mudou(a, "andamento"));
            assert.deepInclude(andando, {
              atividade: {
                id: `conversa:${a}`,
                titulo: "Conversa “isto demora”",
                rota: `/conversa?id=${a}`,
                situacao: "andamento",
                provider: "claude",
                desde: (andando as Extract<EventoAtividades, { _tag: "Mudou" }>).atividade.desde,
              },
            });
            yield* conversas.enviar(b, "pode escrever?");
            yield* ate(fila, mudou(b, "andamento"));
            const pedido = yield* ate(fila, mudou(b, "permissao"));
            assert.deepStrictEqual((pedido as Extract<EventoAtividades, { _tag: "Mudou" }>).atividade.aprovacao, {
              conversa: b,
              id: "f1",
              ferramenta: "escrever",
              tipo: "escrita",
              descricao: "escrever um arquivo",
            });

            // Um retrato tirado agora tem as duas.
            assert.deepStrictEqual(
              (yield* retratoDe(atividades)).sort(),
              [`conversa:${a} andamento`, `conversa:${b} permissao`].sort(),
            );

            // A decisão volta a B a respondendo, e o fim do turno a deixa pronta até ser vista.
            yield* conversas.responderAprovacao(b, "f1", "permitir");
            yield* ate(fila, mudou(b, "andamento"));
            yield* ate(fila, mudou(b, "pronta"));
            yield* conversas.marcarVista(b);
            assert.deepStrictEqual(yield* Queue.take(fila), { _tag: "Saiu", id: `conversa:${b}` });

            // Interrompida, A sai sem "resposta pronta"; no limite, fica como limite.
            yield* conversas.interromper(a);
            assert.deepStrictEqual(yield* ate(fila, (evento) => evento._tag === "Saiu"), {
              _tag: "Saiu",
              id: `conversa:${a}`,
            });
            yield* conversas.enviar(a, "chegou ao limite?");
            yield* ate(fila, mudou(a, "limite"));
          }),
        );
        yield* fechar;

        // Reaberto o app, o que terminou sem ser visto volta: o limite de A, não a resposta vista de B.
        const segundo = yield* abrir(arquivo, registro);
        assert.deepStrictEqual(yield* retratoDe(segundo.atividades), [`conversa:${a} limite`]);

        // Continuar com outra IA: a mesma pasta, o histórico numa ficha (a pergunta interrompida e o texto que
        // chegou) e a última pergunta na caixa.
        const continuada = yield* segundo.conversas.iniciar(
          { provider: "antigravity", pastaTrabalho: "/nao/vale", continuaDe: a },
          "estavel",
        );
        assert.strictEqual(continuada.continuacao?.pergunta, "chegou ao limite?");
        const fichas = continuada.continuacao?.fichas ?? [];
        assert.deepInclude(fichas[0], { _tag: "texto", rotulo: "Histórico da conversa com o Claude (2 mensagens)" });
        assert.include(fichas[0]?._tag === "texto" ? fichas[0].texto : "", "Pessoa: isto demora");
        const nova = yield* segundo.conversas.carregar(continuada.sessao);
        assert.strictEqual(nova.conversa.pastaTrabalho, (yield* segundo.conversas.carregar(a)).conversa.pastaTrabalho);
        assert.deepStrictEqual((yield* segundo.conversas.carregar(a)).conversa.continuadaCom, {
          id: continuada.sessao,
          provider: "antigravity",
        });
        assert.deepInclude(
          (yield* segundo.conversas.listar).find((conversa) => conversa.id === a),
          { continuadaCom: { id: continuada.sessao, provider: "antigravity" } },
        );
        yield* segundo.fechar;
      }),
  );
});

describe("continuação com outra IA", () => {
  it.effect(
    "leva a origem e o sem web da antiga; recusa a que ainda responde; a apagada deixa de ser a continuação",
    () =>
      Effect.gen(function* () {
        const registro = novoRegistro();
        const arquivo = novoBanco();
        const origem = { rotulo: "Revisão do PPC de Teste", rota: "/revisao-ppc?id=lista-1" };
        const primeiro = yield* abrir(arquivo, registro);
        const { sessao: a } = yield* primeiro.conversas.iniciar(
          { provider: "claude", pastaTrabalho: pasta, tarefa: "tarefa-sem-web-nem-skill" },
          "estavel",
          origem,
        );
        yield* primeiro.fechar;

        // A tarefa saiu do catálogo: a continuação segue sem web, como a antiga.
        const { conversas, fechar } = yield* abrir(arquivo, registro, undefined, undefined, []);
        yield* conversas.enviar(a, "isto demora");
        yield* rodar;
        const respondendo = yield* Effect.exit(
          conversas.iniciar({ provider: "antigravity", pastaTrabalho: pasta, continuaDe: a }, "estavel"),
        );
        assert.isTrue(Exit.isFailure(respondendo));
        assert.include(Cause.pretty((respondendo as Exit.Failure<unknown, unknown>).cause), "TurnoEmAndamento");
        yield* conversas.interromper(a);
        yield* rodar;
        yield* turnoCompleto(conversas, a, "chegou ao limite?");

        const { sessao: b } = yield* conversas.iniciar(
          { provider: "antigravity", pastaTrabalho: pasta, continuaDe: a },
          "estavel",
        );
        assert.isTrue(registro.configs.at(-1)?.semWeb);
        assert.deepStrictEqual((yield* conversas.carregar(b)).conversa.origem, origem);
        assert.deepStrictEqual((yield* conversas.carregar(a)).conversa.continuadaCom, {
          id: b,
          provider: "antigravity",
        });

        yield* conversas.apagar(b);
        assert.isUndefined((yield* conversas.carregar(a)).conversa.continuadaCom);
        yield* fechar;
      }),
  );

  it.effect("a aprovação respondida depois de apagar a conversa falha sem gravar, e a bandeja fica sem ela", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      const { conversas, atividades, fechar } = yield* abrir(novoBanco(), registro);
      const { sessao: id } = yield* conversas.iniciar({ provider: "claude", pastaTrabalho: pasta }, "estavel");
      yield* Effect.scoped(
        Effect.gen(function* () {
          const fila = yield* Stream.toQueue(atividades.acompanhar, { capacity: "unbounded" });
          yield* conversas.enviar(id, "pode escrever?");
          yield* ate(fila, mudou(id, "permissao"));
          yield* conversas.apagar(id);
          yield* ate(fila, (evento) => evento._tag === "Saiu");
          const resposta = yield* Effect.exit(conversas.responderAprovacao(id, "f1", "permitir"));
          assert.isTrue(Exit.isFailure(resposta));
          const vista = yield* Effect.exit(conversas.marcarVista(id));
          assert.isTrue(Exit.isFailure(vista));
          yield* rodar;
          assert.deepStrictEqual(yield* retratoDe(atividades), []);
        }),
      );
      yield* fechar;
    }),
  );
});

describe("contexto do histórico", () => {
  it("a continuação com outra IA: a última pergunta e as fichas dela na caixa, o resto no histórico", () => {
    const itens: ReadonlyArray<ItemConversa> = [
      { _tag: "Mensagem", turno: 1, ordem: 1, texto: "Primeira?" },
      { _tag: "EventoTurno", turno: 1, ordem: 2, evento: { _tag: "TextoFinal", texto: "Resposta um." } },
      {
        _tag: "Mensagem",
        turno: 2,
        ordem: 3,
        texto: "E a carga?",
        fichas: [{ _tag: "texto", rotulo: "Trecho", texto: "carga horária" }],
      },
      { _tag: "EventoTurno", turno: 2, ordem: 4, evento: { _tag: "Erro", tipo: "cota", mensagem: "limite" } },
    ];
    const continuacao = Conversas.continuacaoDe(itens, "codex");
    assert.strictEqual(continuacao.pergunta, "E a carga?");
    assert.deepStrictEqual(continuacao.fichas.slice(1), [{ _tag: "texto", rotulo: "Trecho", texto: "carga horária" }]);
    assert.deepInclude(continuacao.fichas[0], { rotulo: "Histórico da conversa com o ChatGPT (2 mensagens)" });
    // Com mais do que cabe, as mais antigas ficam de fora, e o rótulo diz isso.
    const longos: Array<ItemConversa> = [];
    for (let turno = 1; turno <= 40; turno++) {
      longos.push({ _tag: "Mensagem", turno, ordem: turno * 2 - 1, texto: `Pergunta ${turno} ${"x".repeat(1000)}` });
      longos.push({
        _tag: "EventoTurno",
        turno,
        ordem: turno * 2,
        evento:
          turno === 40
            ? { _tag: "Erro", tipo: "cota", mensagem: "limite" }
            : { _tag: "TextoFinal", texto: `Resposta ${turno}` },
      });
    }
    const cortada = Conversas.continuacaoDe(longos, "claude");
    assert.match(
      cortada.fichas[0]?.rotulo ?? "",
      /^Histórico da conversa com o Claude \(\d+ mensagens; as mais antigas ficam de fora\)$/,
    );
    assert.strictEqual(cortada.pergunta, `Pergunta 40 ${"x".repeat(1000)}`);
  });

  it("a continuação de um limite antigo: a pergunta respondida depois dele fica no histórico, não na caixa", () => {
    const itens: ReadonlyArray<ItemConversa> = [
      { _tag: "Mensagem", turno: 1, ordem: 1, texto: "Primeira?" },
      { _tag: "EventoTurno", turno: 1, ordem: 2, evento: { _tag: "Erro", tipo: "cota", mensagem: "limite" } },
      { _tag: "Mensagem", turno: 2, ordem: 3, texto: "Segunda?" },
      { _tag: "EventoTurno", turno: 2, ordem: 4, evento: { _tag: "TextoFinal", texto: "Resposta dois." } },
    ];
    const continuacao = Conversas.continuacaoDe(itens, "claude");
    assert.strictEqual(continuacao.pergunta, "");
    assert.lengthOf(continuacao.fichas, 1);
    const historico = continuacao.fichas[0]?._tag === "texto" ? continuacao.fichas[0].texto : "";
    assert.include(historico, "Pessoa: Segunda?\n\nIA: Resposta dois.");
  });

  it("leva as fichas de cada mensagem, como foram à IA", () => {
    const contexto = Conversas.contextoDoHistorico([
      {
        _tag: "Mensagem",
        turno: 1,
        ordem: 1,
        texto: "O que falta?",
        fichas: [{ _tag: "texto", rotulo: "Pendência: estágio", texto: "Falta a carga horária." }],
      },
      { _tag: "EventoTurno", turno: 1, ordem: 2, evento: { _tag: "TextoFinal", texto: "A carga." } },
    ]);
    assert.include(contexto, "Pessoa: O que falta?");
    assert.include(contexto, "Falta a carga horária.");
    assert.include(contexto, "IA: A carga.");
  });
});
