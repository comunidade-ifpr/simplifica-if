// @effect-diagnostics nodeBuiltinImport:off globalJsonInEffect:off -- teste: arquivos de verdade na pasta temporária
/**
 * A pasta de trabalho das tarefas e o "Desfazer" (M1.9), pelo RPC do servidor de verdade com o driver
 * falso (`test/apoio.ts`): criar a pasta com nome seguro e sem colisão, anexar só o arquivo liberado
 * pelo desktop, listar o que entrou e o que saiu, cópia antes de cada turno, Desfazer que volta a pasta
 * como estava antes do turno que a mudou (e, de novo, mais um turno), recusa no meio do turno, limite
 * de tamanho e de quantidade de cópias, e a avaliação 👍/👎 gravada.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, describe, it, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import { CAMINHO_LIBERAR_ARQUIVO } from "@simplifica-if/contratos-app";
import { comNumero, nomeSeguro } from "../src/PastasTrabalho.ts";
import * as Servidor from "../src/servidor.ts";
import {
  bancoFixture,
  cliente,
  diretorioTemporario,
  layerDriversFalsos,
  limparTemporarios,
  novoRegistro,
  pedirHttp,
  TOKEN,
} from "./apoio.ts";

afterAll(limparTemporarios);

const TOKEN_DESKTOP = "token-do-processo-principal-0123456789abcdef";
const AUTORIZACAO = { authorization: `Bearer ${TOKEN}` };
const raiz = NodePath.join(diretorioTemporario("simplifica-trabalhos-"), "Simplifica IF");
const copias = diretorioTemporario("simplifica-copias-");
const fora = diretorioTemporario("simplifica-fora-");
const registro = novoRegistro();

const camada = Servidor.layer({
  banco: bancoFixture(),
  token: Redacted.make(TOKEN),
  tokenDesktop: Redacted.make(TOKEN_DESKTOP),
  pastaTrabalhos: raiz,
  pastaCopias: copias,
  limitesPasta: { copias: 3, bytes: 64 * 1024 },
}).pipe(Layer.provide(layerDriversFalsos(registro)), Layer.provide(NodeServices.layer));

describe("nomes", () => {
  it("nomeSeguro tira o que macOS e Windows recusam e encurta", () => {
    assert.strictEqual(nomeSeguro("Conferir: base/legal?  do PPC*"), "Conferir base legal do PPC");
    assert.strictEqual(nomeSeguro("  ..oculta.  "), "oculta");
    assert.strictEqual(nomeSeguro("CON"), "Tarefa");
    assert.strictEqual(nomeSeguro(""), "Tarefa");
    assert.isAtMost(nomeSeguro("a".repeat(200)).length, 60);
  });
  it("comNumero numera antes da extensão", () => {
    assert.strictEqual(comNumero("ppc.docx", 1), "ppc.docx");
    assert.strictEqual(comNumero("ppc.docx", 2), "ppc (2).docx");
    assert.strictEqual(comNumero("LEIAME", 3), "LEIAME (3)");
  });
});

layer(camada, { excludeTestServices: true })("pasta de trabalho", (it) => {
  it.effect("cria a pasta da tarefa sem colisão, anexa o arquivo liberado e lista o que entrou", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);
      const { pasta } = yield* rpc["pasta.criar"]({ titulo: "Conferir: base legal" });
      assert.strictEqual(NodePath.basename(pasta), "Conferir base legal");
      assert.strictEqual(NodePath.dirname(pasta), NodeFS.realpathSync(raiz));
      const segunda = yield* rpc["pasta.criar"]({ titulo: "Conferir: base legal" });
      assert.strictEqual(NodePath.basename(segunda.pasta), "Conferir base legal (2)");

      const original = NodePath.join(fora, "entrada.md");
      NodeFS.writeFileSync(original, "# Documento\n");
      // Sem a liberação do processo principal, o servidor não lê o arquivo.
      const recusa = yield* Effect.exit(rpc["pasta.anexar"]({ pasta, arquivo: original }));
      assert.isTrue(Exit.isFailure(recusa));
      assert.match(JSON.stringify(recusa), /Anexar arquivo/);
      const liberacao = yield* pedirHttp(urlRpc.replace(/\/rpc$/, CAMINHO_LIBERAR_ARQUIVO), {
        metodo: "POST",
        cabecalhos: { authorization: `Bearer ${TOKEN_DESKTOP}`, "content-type": "application/json" },
        corpo: JSON.stringify({ arquivo: original }),
      });
      assert.strictEqual(liberacao.status, 204);
      const anexado = yield* rpc["pasta.anexar"]({ pasta, arquivo: original });
      assert.deepInclude(anexado, { nome: "entrada.md", origem: "anexado" });
      const repetido = yield* rpc["pasta.anexar"]({ pasta, arquivo: original });
      assert.strictEqual(repetido.nome, "entrada (2).md");
      // Só em pasta de tarefa do app.
      const foraDaRaiz = yield* Effect.exit(rpc["pasta.anexar"]({ pasta: fora, arquivo: original }));
      assert.isTrue(Exit.isFailure(foraDaRaiz));
    }).pipe(Effect.scoped),
  );

  it.effect("cópia antes de cada turno; Desfazer restaura o turno que mudou a pasta, e de novo o anterior", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);
      const { pasta } = yield* rpc["pasta.criar"]({ titulo: "Desfazer" });
      NodeFS.writeFileSync(NodePath.join(pasta, "entrada.md"), "original\n");
      const { sessao } = yield* rpc["conversa.iniciar"]({ provider: "claude", pastaTrabalho: pasta, tarefa: "teste" });
      // O motor grava as skills em `.simplifica/`: fica fora da lista e das cópias.
      NodeFS.mkdirSync(NodePath.join(pasta, ".simplifica"), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(pasta, ".simplifica", "oculto.md"), "x");

      const turno = (texto: string) =>
        rpc["conversa.enviar"]({ sessao, texto }).pipe(
          Stream.tap((evento) =>
            evento._tag === "PedidoAprovacao"
              ? rpc["conversa.responderAprovacao"]({ sessao, aprovacao: evento.id, decisao: "permitir" })
              : Effect.void,
          ),
          Stream.runDrain,
        );

      yield* turno("oi"); // turno 1: não muda nada
      let vista = yield* rpc["pasta.ver"]({ sessao });
      assert.isTrue(vista.gerida);
      assert.deepStrictEqual(
        vista.arquivos.map((arquivo) => arquivo.nome),
        ["entrada.md"],
      );
      assert.isFalse(vista.desfazer.disponivel);

      yield* turno("grave o resultado"); // turno 2: cria resultado.md e altera entrada.md
      vista = yield* rpc["pasta.ver"]({ sessao });
      assert.deepStrictEqual(vista.arquivos.map((arquivo) => [arquivo.nome, arquivo.origem]).sort(), [
        ["entrada.md", "pasta"],
        ["resultado.md", "pasta"],
      ]);
      assert.deepInclude(vista.desfazer, { disponivel: true, turno: 2, criados: ["resultado.md"] });
      assert.deepStrictEqual(vista.desfazer.alterados, ["entrada.md"]);

      yield* turno("mais uma pergunta"); // turno 3: não muda nada; o Desfazer ainda volta o turno 2
      const desfeita = yield* rpc["pasta.desfazer"]({ sessao });
      assert.deepStrictEqual(
        desfeita.arquivos.map((arquivo) => arquivo.nome),
        ["entrada.md"],
      );
      assert.strictEqual(NodeFS.readFileSync(NodePath.join(pasta, "entrada.md"), "utf8"), "original\n");
      assert.isTrue(NodeFS.existsSync(NodePath.join(pasta, ".simplifica", "oculto.md")));
      assert.isFalse(desfeita.desfazer.disponivel);

      // A pessoa apaga um arquivo e a IA grava de novo: o Desfazer devolve o arquivo apagado no turno.
      yield* turno("grave de novo");
      NodeFS.rmSync(NodePath.join(pasta, "resultado.md"));
      vista = yield* rpc["pasta.ver"]({ sessao });
      assert.deepInclude(vista.desfazer, { disponivel: true, alterados: ["entrada.md"], criados: [] });
      yield* rpc["pasta.desfazer"]({ sessao });
      assert.strictEqual(NodeFS.readFileSync(NodePath.join(pasta, "entrada.md"), "utf8"), "original\n");

      // As cópias: só as 3 mais recentes da conversa.
      for (const texto of ["a", "b", "c", "d"]) yield* turno(texto);
      const guardadas = NodeFS.readdirSync(NodePath.join(copias, sessao));
      assert.strictEqual(guardadas.length, 3);

      // 👍/👎 gravados com a conversa.
      yield* rpc["conversa.avaliar"]({ sessao, turno: 1, nota: "util" });
      yield* rpc["conversa.avaliar"]({ sessao, turno: 2, nota: "nao_util" });
      yield* rpc["conversa.avaliar"]({ sessao, turno: 2, nota: null });
      const gravada = yield* rpc["conversa.carregar"]({ sessao });
      assert.deepStrictEqual(gravada.avaliacoes, [{ turno: 1, nota: "util" }]);
      assert.strictEqual(gravada.conversa.tarefa, "teste");
    }).pipe(Effect.scoped),
  );

  it.effect("recusa Desfazer no meio do turno; pasta grande demais fica sem cópia, com aviso", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);
      const { pasta } = yield* rpc["pasta.criar"]({ titulo: "Grande" });
      const { sessao } = yield* rpc["conversa.iniciar"]({ provider: "claude", pastaTrabalho: pasta });
      const emAndamento = yield* rpc["conversa.enviar"]({ sessao, texto: "demore" }).pipe(
        Stream.runDrain,
        Effect.forkScoped,
      );
      // Espera o turno começar (o estado passa a `respondendo`).
      yield* Effect.repeat(rpc["conversa.carregar"]({ sessao }), {
        until: (gravada) => gravada.conversa.estado === "respondendo",
      });
      const recusa = yield* Effect.exit(rpc["pasta.desfazer"]({ sessao }));
      assert.isTrue(Exit.isFailure(recusa));
      assert.match(JSON.stringify(recusa), /TurnoEmAndamento/);
      yield* rpc["conversa.interromper"]({ sessao });
      yield* Fiber.await(emAndamento);

      NodeFS.writeFileSync(NodePath.join(pasta, "grande.bin"), Buffer.alloc(128 * 1024));
      yield* rpc["conversa.enviar"]({ sessao, texto: "oi" }).pipe(Stream.runDrain);
      const vista = yield* rpc["pasta.ver"]({ sessao });
      assert.isFalse(vista.desfazer.disponivel);
      assert.match(vista.desfazer.aviso ?? "", /não guardou a cópia/);
    }).pipe(Effect.scoped),
  );

  it.effect("conversa com pasta escolhida fora da raiz: sem lista nem Desfazer", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);
      const { sessao } = yield* rpc["conversa.iniciar"]({ provider: "claude", pastaTrabalho: fora });
      const vista = yield* rpc["pasta.ver"]({ sessao });
      assert.isFalse(vista.gerida);
      assert.deepStrictEqual(vista.arquivos, []);
      assert.isTrue(Exit.isFailure(yield* Effect.exit(rpc["pasta.desfazer"]({ sessao }))));
    }).pipe(Effect.scoped),
  );
});
