// @effect-diagnostics nodeBuiltinImport:off -- teste: pastas de tarefas e banco de conversas em pastas temporárias
/**
 * As tarefas pelo RPC do servidor de verdade (`test/apoio.ts`), com pastas de tarefas de teste:
 *
 * - `tarefas.listar` segue o canal de "Atualizações": a tarefa `experimental` aparece no beta e some no
 *   estável assim que `atualizacao.trocarCanal` responde, sem reabrir o servidor, e `conversa.iniciar`
 *   a recusa fora do beta; a recusa chega à interface com o `motivo` e a mensagem;
 * - `relato.preparar` diz de que tarefa a conversa é: a de conversa sem skill, e a que o app retirou
 *   (o manifesto saiu da pasta) vai pelo `id`, não como conversa livre.
 *
 * Sem os serviços de teste (`it.live`), como o `servidor.test.ts`: o cliente sobre WebSocket usa o relógio.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Servidor from "../src/servidor.ts";
import {
  bancoFixture,
  cliente,
  diretorioTemporario,
  layerDriversFalsos,
  limparTemporarios,
  novoRegistro,
  TOKEN,
  turnoRpc,
} from "./apoio.ts";

afterAll(limparTemporarios);

const AUTORIZACAO = { authorization: `Bearer ${TOKEN}` };

const manifesto = (id: string, situacao: string, abertura: string) =>
  [
    `id: ${id}`,
    `titulo: Tarefa ${id}`,
    "resumo: Uma tarefa de teste.",
    "area: ensino",
    `situacao: ${situacao}`,
    "mantenedor: { nome: Pessoa de Teste, github: pessoa-de-teste }",
    `abre: ${abertura}`,
    "",
  ].join("\n");

/** Uma pasta de tarefas temporária com os manifestos dados (`id` → [situação, abertura]). */
const pastaTarefas = (tarefas: Readonly<Record<string, readonly [string, string]>>) => {
  const pasta = diretorioTemporario("simplifica-tarefas-rpc-");
  for (const [id, [situacao, abertura]] of Object.entries(tarefas)) {
    NodeFS.writeFileSync(NodePath.join(pasta, `${id}.yaml`), manifesto(id, situacao, abertura));
  }
  return pasta;
};

const servidor = (opcoes: Partial<Servidor.Opcoes>) =>
  Servidor.layer({ primeiroUsoFeito: true, banco: bancoFixture(), token: Redacted.make(TOKEN), ...opcoes }).pipe(
    Layer.provide(layerDriversFalsos(novoRegistro())),
    Layer.provide(NodeServices.layer),
  );

/** O cliente RPC do servidor do ambiente. */
const rpcDoServidor = Effect.gen(function* () {
  const { urlRpc } = yield* Servidor.ServidorApp;
  return yield* cliente(urlRpc, AUTORIZACAO);
});

/** A atualização sem feed, só para o canal de "Atualizações" existir e trocar. */
const atualizacaoSemFeed = (banco: string): Servidor.OpcoesAtualizacao => ({
  desligada: "teste: sem feed",
  feed: null,
  chave: null,
  canalPadrao: "beta",
  pasta: diretorioTemporario("simplifica-atualizacao-"),
  bancoEmpacotado: banco,
  versaoApp: "0.3.0",
  abertura: {
    banco,
    origem: "empacotada",
    info: null,
    pastasSkills: [],
    catalogo: null,
    versaoEmpacotada: null,
    origemCatalogo: { tipo: "sem-pasta" },
    skillsRetiradas: [],
    eventos: [],
  },
  automatico: false,
});

describe("tarefas pelo RPC", () => {
  it.live("tarefas.listar: a experimental aparece no beta e some no estável depois de trocarCanal", () => {
    const banco = bancoFixture();
    return Effect.gen(function* () {
      const rpc = yield* rpcDoServidor;
      const ids = Effect.map(rpc["tarefas.listar"]({}), (lista) => ({
        tarefas: lista.tarefas.map((tarefa) => tarefa.id),
        retiradas: lista.retiradas,
      }));
      assert.deepStrictEqual(yield* ids, { tarefas: ["nova", "pronta"], retiradas: [] });

      assert.strictEqual((yield* rpc["atualizacao.trocarCanal"]({ canal: "estavel" })).canal, "estavel");
      assert.deepStrictEqual(yield* ids, {
        tarefas: ["pronta"],
        retiradas: [{ id: "nova", titulo: "Tarefa nova" }],
      });

      yield* rpc["atualizacao.trocarCanal"]({ canal: "beta" });
      assert.deepStrictEqual((yield* ids).tarefas, ["nova", "pronta"]);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        servidor({
          banco,
          pastaTarefas: pastaTarefas({
            nova: ["experimental", "{ modulo: revisao-ppc }"],
            pronta: ["estavel", "{ modulo: revisao-ppc }"],
          }),
          atualizacao: atualizacaoSemFeed(banco),
        }),
      ),
    );
  });

  it.live("conversa.iniciar: a tarefa experimental abre conversa no beta e é recusada no estável", () => {
    const banco = bancoFixture();
    return Effect.gen(function* () {
      const rpc = yield* rpcDoServidor;
      const { pasta } = yield* rpc["pasta.criar"]({ titulo: "nova" });
      const iniciar = (tarefa: string) => rpc["conversa.iniciar"]({ provider: "claude", pastaTrabalho: pasta, tarefa });
      yield* iniciar("nova");
      // O motivo e a mensagem chegam à interface depois do transporte.
      const indisponivel = yield* Effect.flip(iniciar("nao-esta-no-catalogo"));
      assert.strictEqual(indisponivel._tag, "TarefaDesconhecida");
      assert.deepInclude(indisponivel, { tarefa: "nao-esta-no-catalogo", motivo: "indisponivel" });
      assert.strictEqual(
        indisponivel.message,
        "Esta tarefa não está disponível neste app: pode ter saído do catálogo ou pedir uma versão mais nova do app.",
      );
      const pedeAppNovo = yield* Effect.flip(iniciar("app-novo"));
      assert.deepInclude(pedeAppNovo, { tarefa: "app-novo", motivo: "indisponivel" });
      yield* rpc["atualizacao.trocarCanal"]({ canal: "estavel" });
      const soNoBeta = yield* Effect.flip(iniciar("nova"));
      assert.strictEqual(soNoBeta._tag, "TarefaDesconhecida");
      assert.deepInclude(soNoBeta, { tarefa: "nova", motivo: "so-no-beta" });
      assert.strictEqual(soNoBeta.message, "Esta tarefa é experimental: só abre no canal beta das atualizações.");
      // A estável segue abrindo, e a conversa que já nasceu da experimental continua na lista.
      yield* iniciar("pronta");
      assert.deepStrictEqual((yield* rpc["conversa.listar"]({})).map((conversa) => conversa.tarefa).sort(), [
        "nova",
        "pronta",
      ]);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        servidor({
          banco,
          versaoApp: "0.3.0",
          pastaTarefas: pastaTarefas({
            nova: ["experimental", '{ conversa: { pedido: "Experimente." } }'],
            pronta: ["estavel", '{ conversa: { pedido: "Responda." } }'],
            "app-novo": ["estavel", '{ conversa: { pedido: "Responda." } }\napp_minimo: 9.0.0'],
          }),
          atualizacao: atualizacaoSemFeed(banco),
        }),
      ),
    );
  });

  it.live("relato: a tarefa de conversa sem skill, e a tarefa retirada do app vai pelo id", () => {
    const bancoConversas = NodePath.join(diretorioTemporario("simplifica-conversas-"), "conversas.sqlite");
    const pastaTrabalhos = NodePath.join(diretorioTemporario("simplifica-trabalhos-"), "Simplifica IF");
    const comum = { bancoConversas, pastaTrabalhos };
    const SEM_SKILL = '{ conversa: { pedido: "Qual é o calendário?" } }';

    // O app com as duas tarefas: uma conversa de cada.
    const antes = Effect.gen(function* () {
      const rpc = yield* rpcDoServidor;
      const abrir = Effect.fn(function* (tarefa: string) {
        const { pasta } = yield* rpc["pasta.criar"]({ titulo: tarefa });
        const { sessao } = yield* rpc["conversa.iniciar"]({ provider: "claude", pastaTrabalho: pasta, tarefa });
        yield* turnoRpc(rpc, sessao, "Qual é o calendário?");
        return sessao;
      });
      const fica = yield* abrir("fica");
      const sai = yield* abrir("sai");
      assert.deepStrictEqual((yield* rpc["relato.preparar"]({ sessao: fica, turno: 1 })).versoes.tarefa, {
        id: "fica",
        titulo: "Tarefa fica",
        skill: null,
      });
      return { fica, sai };
    }).pipe(
      Effect.scoped,
      Effect.provide(
        servidor({
          ...comum,
          pastaTarefas: pastaTarefas({ fica: ["estavel", SEM_SKILL], sai: ["estavel", SEM_SKILL] }),
        }),
      ),
    );

    // O app seguinte, sem o manifesto de `sai`: a conversa antiga continua sendo da tarefa.
    const depois = (sessoes: { readonly fica: string; readonly sai: string }) =>
      Effect.gen(function* () {
        const rpc = yield* rpcDoServidor;
        assert.deepStrictEqual(
          (yield* rpc["tarefas.listar"]({})).tarefas.map((tarefa) => tarefa.id),
          ["fica"],
        );
        const retirada = yield* rpc["relato.preparar"]({ sessao: sessoes.sai, turno: 1 });
        assert.deepStrictEqual(retirada.versoes.tarefa, { id: "sai", titulo: "sai", skill: null });
        const mantida = yield* rpc["relato.preparar"]({ sessao: sessoes.fica, turno: 1 });
        assert.deepStrictEqual(mantida.versoes.tarefa, { id: "fica", titulo: "Tarefa fica", skill: null });
      }).pipe(
        Effect.scoped,
        Effect.provide(servidor({ ...comum, pastaTarefas: pastaTarefas({ fica: ["estavel", SEM_SKILL] }) })),
      );

    return Effect.flatMap(antes, depois);
  });
});
