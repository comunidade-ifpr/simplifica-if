// @effect-diagnostics nodeBuiltinImport:off -- teste: banco das conversas num arquivo, lido entre duas partidas do servidor
/**
 * Apagar a conversa quando o provider recusa apagar o registro dele: a conversa sai do banco na hora, a
 * pendência fica (`apagamentos_pendentes`, só identificadores), e o servidor tenta de novo na próxima
 * partida, sobre o mesmo `conversas.sqlite`, até dar certo.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as Servidor from "../src/servidor.ts";
import {
  bancoFixture,
  cliente,
  diretorioTemporario,
  layerDriversFalsos,
  limparTemporarios,
  novoRegistro,
  type Registro,
  TOKEN,
} from "./apoio.ts";

afterAll(limparTemporarios);

const AUTORIZACAO = { authorization: `Bearer ${TOKEN}` };
const estado = diretorioTemporario("simplifica-apagamentos-");
const conversas = NodePath.join(estado, "conversas.sqlite");
const raiz = NodePath.join(diretorioTemporario("simplifica-trabalhos-"), "Simplifica IF");
const copias = diretorioTemporario("simplifica-copias-");
const banco = bancoFixture();

/** Uma partida do servidor, sempre sobre o mesmo banco das conversas e as mesmas pastas. */
const camada = (registro: Registro) =>
  Servidor.layer({
    primeiroUsoFeito: true,
    banco,
    bancoConversas: conversas,
    token: Redacted.make(TOKEN),
    pastaTrabalhos: raiz,
    pastaCopias: copias,
  }).pipe(Layer.provide(layerDriversFalsos(registro)), Layer.provide(NodeServices.layer));

const pendentes = () => {
  const db = new NodeSqlite.DatabaseSync(conversas);
  try {
    return db.prepare("SELECT conversa, id_nativo, tentativas FROM apagamentos_pendentes").all() as Array<{
      conversa: string;
      id_nativo: string | null;
      tentativas: number;
    }>;
  } finally {
    db.close();
  }
};

describe("o que falta apagar fora do banco", () => {
  it.effect("o provider recusa: a conversa sai, a pendência fica e a próxima partida apaga o registro", () =>
    Effect.gen(function* () {
      // Primeira partida: o provider recusa apagar o registro da conversa.
      const primeira = novoRegistro();
      primeira.recusarEsquecer = true;
      const { sessao, pasta } = yield* Effect.gen(function* () {
        const { urlRpc } = yield* Servidor.ServidorApp;
        const rpc = yield* cliente(urlRpc, AUTORIZACAO);
        const { pasta } = yield* rpc["pasta.criar"]({ titulo: "Recusada" });
        const { sessao } = yield* rpc["conversa.iniciar"]({ provider: "claude", pastaTrabalho: pasta });
        yield* rpc["conversa.enviar"]({ sessao, texto: "oi" }).pipe(Stream.runDrain);
        const resultado = yield* rpc["conversa.apagar"]({ sessao });
        assert.strictEqual(resultado.transcricao, "ficou");
        // A conversa já não existe no app; as cópias do Desfazer saíram.
        assert.notInclude(
          (yield* rpc["conversa.listar"]({})).map((c) => c.id),
          sessao,
        );
        assert.isFalse(NodeFS.existsSync(NodePath.join(copias, sessao)));
        return { sessao, pasta };
      }).pipe(Effect.scoped, Effect.provide(camada(primeira)));
      assert.deepStrictEqual(pendentes(), [{ conversa: sessao, id_nativo: "nativo-1", tentativas: 1 }]);

      // Segunda partida: o provider aceita, e a pendência sai sozinha.
      const segunda = novoRegistro();
      const esquecida = yield* Deferred.make<void>();
      segunda.aoEsquecer = () => Deferred.doneUnsafe(esquecida, Effect.void);
      yield* Effect.gen(function* () {
        yield* Servidor.ServidorApp;
        yield* Deferred.await(esquecida);
      }).pipe(Effect.scoped, Effect.provide(camada(segunda)));
      assert.deepStrictEqual(segunda.esquecidas, [`nativo-1 em ${pasta}`]);
      assert.deepStrictEqual(pendentes(), []);
    }),
  );

  it.effect("a conversa sem sessão no provider não deixa pendência", () =>
    Effect.gen(function* () {
      const registro = novoRegistro();
      yield* Effect.gen(function* () {
        const { urlRpc } = yield* Servidor.ServidorApp;
        const rpc = yield* cliente(urlRpc, AUTORIZACAO);
        const { pasta } = yield* rpc["pasta.criar"]({ titulo: "Sem sessão" });
        // O Codex falso falha ao abrir: a conversa não chega a existir.
        const falhou = yield* rpc["conversa.iniciar"]({ provider: "codex", pastaTrabalho: pasta }).pipe(Effect.flip);
        assert.strictEqual(falhou._tag, "FalhaProvider");
      }).pipe(Effect.scoped, Effect.provide(camada(registro)));
      assert.deepStrictEqual(pendentes(), []);
    }),
  );
});
