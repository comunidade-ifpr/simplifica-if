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
import * as SqlClient from "effect/sql/SqlClient";
import type { Continuidade, Perfil } from "@simplifica-if/contratos-app";
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

const CONTINUIDADE: Continuidade = {
  rota: "/conversa?id=abc",
  painel: {
    aberto: true,
    aba: "conversar",
    trilha: { links: ["ifpr://norma/br/cne-cp/res/2026/2", "ifpr://revisao/x/1#p-2"], posicao: 1 },
    marcados: ["ifpr://norma/br/cne-cp/res/2026/2"],
    preso: false,
    conversa: { id: "c1", origem: { chave: "revisao:x", ia: "claude" } },
  },
};

const camada = Servidor.layer({ banco: bancoFixture(), token: Redacted.make(TOKEN) }).pipe(
  Layer.provide(layerDriversFalsos(novoRegistro())),
  Layer.provide(NodeServices.layer),
);

const AUTORIZACAO = { authorization: `Bearer ${TOKEN}` };

layer(camada, { excludeTestServices: true })("preferências pelo RPC", (it) => {
  it.effect("sem o aviso aceito, nada vai à IA: a conversa recusa com a frase do aviso", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);
      const iniciar = yield* Effect.flip(rpc["conversa.iniciar"]({ provider: "claude", pastaTrabalho: "/" }));
      assert.strictEqual(iniciar._tag, "AvisoNaoAceito");
      assert.match(iniciar.message, /leia o aviso de uso/);
      const enviar = yield* Effect.flip(rpc["conversa.enviar"]({ sessao: "x", texto: "oi" }));
      assert.strictEqual(enviar._tag, "AvisoNaoAceito");
    }),
  );

  it.effect("primeiro uso: nada gravado, depois perfil, aviso, boas-vindas e IAs", () =>
    Effect.gen(function* () {
      const { urlRpc } = yield* Servidor.ServidorApp;
      const rpc = yield* cliente(urlRpc, AUTORIZACAO);

      assert.deepStrictEqual(yield* rpc["preferencias.ler"]({}), { iasDesligadas: [], avisosDoSistema: true });

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

      // O aviso do sistema vem ligado e desliga.
      assert.isFalse((yield* rpc["preferencias.avisarNoSistema"]({ ligar: false })).avisosDoSistema);
      assert.isFalse((yield* rpc["preferencias.ler"]({})).avisosDoSistema);

      const semPerfil = yield* rpc["preferencias.apagarPerfil"]({});
      assert.isUndefined(semPerfil.perfil);
      assert.strictEqual(semPerfil.avisoAceitoEm, avisado.avisoAceitoEm);
    }),
  );

  it.effect(
    "a continuidade: a última rota e o painel, trocados a cada gravação; o RPC recusa o que passa do teto",
    () =>
      Effect.gen(function* () {
        const { urlRpc } = yield* Servidor.ServidorApp;
        const rpc = yield* cliente(urlRpc, AUTORIZACAO);
        yield* rpc["preferencias.guardarContinuidade"]({ continuidade: CONTINUIDADE });
        assert.deepStrictEqual((yield* rpc["preferencias.ler"]({})).continuidade, CONTINUIDADE);

        const outra: Continuidade = {
          rota: "/",
          painel: { aberto: false, aba: "ler", trilha: { links: [], posicao: -1 }, marcados: [], preso: true },
        };
        yield* rpc["preferencias.guardarContinuidade"]({ continuidade: outra });
        assert.deepStrictEqual((yield* rpc["preferencias.ler"]({})).continuidade, outra);

        // A prateleira tem até cinco documentos.
        const demais = yield* Effect.exit(
          rpc["preferencias.guardarContinuidade"]({
            continuidade: { ...outra, painel: { ...outra.painel, marcados: ["a", "b", "c", "d", "e", "f"] } },
          }),
        );
        assert.isTrue(Exit.isFailure(demais));
        assert.deepStrictEqual((yield* rpc["preferencias.ler"]({})).continuidade, outra);
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
      assert.isUndefined(lidas.continuidade);

      const estragado = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE preferencias SET valor = '{"funcao":"reitoria"' WHERE chave = 'perfil'`;
        return yield* (yield* Preferencias.Preferencias).ler;
      }).pipe(Effect.provide(abrir));
      assert.isUndefined(estragado.perfil);
      assert.strictEqual(estragado.avisoAceitoEm, lidas.avisoAceitoEm);
    }),
  );

  it.effect("a continuidade sobrevive ao servidor fechar; estragada, conta como ausente", () =>
    Effect.gen(function* () {
      const outro = NodePath.join(diretorioTemporario("simplifica-preferencias-continuidade-"), "conversas.sqlite");
      const camadaOutro = Preferencias.layer.pipe(
        Layer.provideMerge(Banco.layerArquivo(outro)),
        Layer.provide(NodeServices.layer),
      );
      yield* Effect.gen(function* () {
        yield* (yield* Preferencias.Preferencias).guardarContinuidade(CONTINUIDADE);
      }).pipe(Effect.provide(camadaOutro));
      const lidas = yield* Effect.gen(function* () {
        return yield* (yield* Preferencias.Preferencias).ler;
      }).pipe(Effect.provide(camadaOutro));
      assert.deepStrictEqual(lidas.continuidade, CONTINUIDADE);
      const estragada = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE preferencias SET valor = '{"rota":"/"}' WHERE chave = 'continuidade'`;
        return yield* (yield* Preferencias.Preferencias).ler;
      }).pipe(Effect.provide(camadaOutro));
      assert.isUndefined(estragada.continuidade);
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
