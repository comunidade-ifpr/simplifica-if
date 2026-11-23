// @effect-diagnostics nodeBuiltinImport:off -- teste: o banco numa pasta temporária, lido byte a byte
/**
 * O primeiro uso (M1.8) no servidor: o perfil, o aviso de uso, as boas-vindas e as IAs em uso, pelo
 * RPC (`preferencias.*`), e o que fica gravado no `conversas.sqlite` quando o servidor fecha e abre de
 * novo.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, describe, it, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import type { Perfil } from "@simplifica-if/contratos-app";
import * as Banco from "../src/persistencia/Banco.ts";
import * as Preferencias from "../src/persistencia/Preferencias.ts";
import * as Servidor from "../src/servidor.ts";
import {
  bancoFixture,
  cliente,
  diretorioTemporario,
  layerDriversFalsos,
  limparTemporarios,
  novoRegistro,
  TOKEN,
} from "./apoio.ts";

afterAll(limparTemporarios);

const PERFIL: Perfil = {
  campus: { id: "curitiba", nome: "Curitiba" },
  categoria: "docente",
  cargo: "professor-ebtt",
  funcao: "coordenacao-curso",
};

const camada = Servidor.layer({ banco: bancoFixture(), token: Redacted.make(TOKEN) }).pipe(
  Layer.provide(layerDriversFalsos(novoRegistro())),
  Layer.provide(NodeServices.layer),
);

const AUTORIZACAO = { authorization: `Bearer ${TOKEN}` };

layer(camada, { excludeTestServices: true })("preferências pelo RPC", (it) => {
  it.effect("sem o aviso aceito, nada vai à IA: conversa e revisão com IA recusam com a frase do aviso", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);
      const iniciar = yield* Effect.flip(rpc["conversa.iniciar"]({ provider: "claude", pastaTrabalho: "/" }));
      assert.strictEqual(iniciar._tag, "AvisoNaoAceito");
      assert.match(iniciar.message, /leia o aviso de uso/);
      const enviar = yield* Effect.flip(Stream.runDrain(rpc["conversa.enviar"]({ sessao: "x", texto: "oi" })));
      assert.strictEqual(enviar._tag, "AvisoNaoAceito");
      const ia = yield* Effect.flip(rpc["revisaoPpc.iniciarIa"]({ revisao: "x" }));
      assert.strictEqual(ia._tag, "AvisoNaoAceito");
      const sugerir = yield* Effect.flip(rpc["revisaoPpc.sugerir"]({ lista: "x", chave: "y", provider: "claude" }));
      assert.strictEqual(sugerir._tag, "AvisoNaoAceito");
      const preparar = yield* Effect.flip(
        rpc["revisaoPpc.prepararIa"]({ lista: "x", provider: "claude", modo: "completo" }),
      );
      assert.strictEqual(preparar._tag, "AvisoNaoAceito");
      const contestar = yield* Effect.flip(
        rpc["revisaoPpc.contestar"]({ lista: "x", chave: "y", motivo: "z", provider: "claude" }),
      );
      assert.strictEqual(contestar._tag, "AvisoNaoAceito");
      const deNovo = yield* Effect.flip(
        rpc["revisaoPpc.revisarDeNovo"]({ lista: "x", chave: "y", arquivo: "/x.docx", provider: "claude" }),
      );
      assert.strictEqual(deNovo._tag, "AvisoNaoAceito");
    }),
  );

  it.effect("primeiro uso: nada gravado, depois perfil, aviso, boas-vindas e IAs", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);

      assert.deepStrictEqual(yield* rpc["preferencias.ler"]({}), { iasDesligadas: [] });

      const comPerfil = yield* rpc["preferencias.gravarPerfil"]({ perfil: PERFIL });
      assert.deepStrictEqual(comPerfil.perfil, PERFIL);

      const avisado = yield* rpc["preferencias.aceitarAviso"]({});
      assert.isString(avisado.avisoAceitoEm);
      // A primeira data fica: aceitar de novo não a troca.
      const deNovo = yield* rpc["preferencias.aceitarAviso"]({});
      assert.strictEqual(deNovo.avisoAceitoEm, avisado.avisoAceitoEm);

      const concluido = yield* rpc["preferencias.concluirBoasVindas"]({});
      assert.isString(concluido.boasVindasEm);

      assert.deepStrictEqual((yield* rpc["preferencias.usarIa"]({ provider: "codex", usar: false })).iasDesligadas, [
        "codex",
      ]);
      // Desligar duas vezes não duplica; religar tira da lista.
      yield* rpc["preferencias.usarIa"]({ provider: "codex", usar: false });
      yield* rpc["preferencias.usarIa"]({ provider: "claude", usar: false });
      assert.deepStrictEqual((yield* rpc["preferencias.usarIa"]({ provider: "codex", usar: true })).iasDesligadas, [
        "claude",
      ]);

      const semPerfil = yield* rpc["preferencias.apagarPerfil"]({});
      assert.isUndefined(semPerfil.perfil);
      assert.strictEqual(semPerfil.avisoAceitoEm, avisado.avisoAceitoEm);
    }),
  );

  it.effect("o RPC recusa função ou cargo fora da lista", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);
      const funcao = yield* Effect.exit(
        rpc["preferencias.gravarPerfil"]({ perfil: { ...PERFIL, funcao: "reitoria" as "direcao-ensino" } }),
      );
      assert.isTrue(Exit.isFailure(funcao));
      const cargo = yield* Effect.exit(
        rpc["preferencias.gravarPerfil"]({ perfil: { ...PERFIL, cargo: "reitor" as "outro" } }),
      );
      assert.isTrue(Exit.isFailure(cargo));
    }),
  );
});

describe("preferências no arquivo", () => {
  const arquivo = NodePath.join(diretorioTemporario("simplifica-preferencias-"), "conversas.sqlite");
  const abrir = Preferencias.layer.pipe(
    Layer.provideMerge(Banco.layerArquivo(arquivo)),
    Layer.provide(NodeServices.layer),
  );

  it.effect("o perfil e o aviso sobrevivem ao servidor fechar; valor estragado conta como ausente", () =>
    Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const preferencias = yield* Preferencias.Preferencias;
        yield* preferencias.gravarPerfil(PERFIL);
        yield* preferencias.aceitarAviso;
      }).pipe(Effect.provide(abrir));

      const lidas = yield* Effect.gen(function* () {
        return yield* (yield* Preferencias.Preferencias).ler;
      }).pipe(Effect.provide(abrir));
      assert.deepStrictEqual(lidas.perfil, PERFIL);
      assert.isString(lidas.avisoAceitoEm);
      assert.isUndefined(lidas.boasVindasEm);

      const estragado = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE preferencias SET valor = '{"funcao":"reitoria"' WHERE chave = 'perfil'`;
        return yield* (yield* Preferencias.Preferencias).ler;
      }).pipe(Effect.provide(abrir));
      assert.isUndefined(estragado.perfil);
      assert.strictEqual(estragado.avisoAceitoEm, lidas.avisoAceitoEm);
    }),
  );

  it.effect("apagar o perfil não deixa o texto dele no arquivo do banco nem no -wal", () =>
    Effect.gen(function* () {
      const outro = NodePath.join(diretorioTemporario("simplifica-preferencias-apagar-"), "conversas.sqlite");
      const camadaOutro = Preferencias.layer.pipe(
        Layer.provideMerge(Banco.layerArquivo(outro)),
        Layer.provide(NodeServices.layer),
      );
      const marca = "Campus-Marca-Que-Deve-Sumir-7f3a";
      const bytes = () =>
        [outro, `${outro}-wal`]
          .filter((arquivo) => NodeFS.existsSync(arquivo))
          .map((arquivo) => NodeFS.readFileSync(arquivo).toString("latin1"))
          .join("");
      yield* Effect.gen(function* () {
        const preferencias = yield* Preferencias.Preferencias;
        yield* preferencias.gravarPerfil({ ...PERFIL, campus: { id: "marca", nome: marca } });
        yield* preferencias.aceitarAviso;
        assert.include(bytes(), marca);
        yield* preferencias.apagarPerfil;
        assert.notInclude(bytes(), marca);
      }).pipe(Effect.provide(camadaOutro));
      assert.notInclude(bytes(), marca);
    }),
  );

  it.effect("primeiro uso feito (testes que não passam pelas boas-vindas)", () =>
    Effect.gen(function* () {
      const lidas = yield* (yield* Preferencias.Preferencias).ler;
      assert.isString(lidas.avisoAceitoEm);
      assert.isString(lidas.boasVindasEm);
    }).pipe(Effect.provide(Preferencias.layerPrimeiroUsoFeito.pipe(Layer.provide(Banco.layerMemoria)))),
  );
});
