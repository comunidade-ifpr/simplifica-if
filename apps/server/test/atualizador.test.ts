// @effect-diagnostics nodeBuiltinImport:off -- teste: canais adulterados e pastas do app em pastas temporárias
/**
 * O serviço `Atualizador` do servidor (M1.10) contra um servidor HTTP local, com canais gerados pela
 * fábrica e um par minisign descartável: troca adiada durante revisão, aplicar, novidades, voltar,
 * canal trocado e desligado sem feed.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { prepararAbertura } from "@simplifica-if/atualizacao/local";
import { estadoNoDisco, limparTemporarios } from "@simplifica-if/atualizacao/testes/apoio";
import { type Cenario, cenario, LAYER_TESTE, VERSAO_APP } from "@simplifica-if/atualizacao/testes/cenario";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as Atualizador from "../src/Atualizador.ts";

afterEach(limparTemporarios);

describe("Atualizador (serviço)", () => {
  const abertura = (c: Cenario) => prepararAbertura({ pasta: c.pastaApp, bancoEmpacotado: c.empacotada });
  const servico = Effect.fn(function* (c: Cenario, ocupado: boolean) {
    return yield* Atualizador.make({
      desligada: null,
      feed: c.feed,
      chave: c.chave,
      canalPadrao: "beta",
      pasta: c.pastaApp,
      bancoEmpacotado: c.empacotada,
      versaoApp: VERSAO_APP,
      abertura: yield* abertura(c),
      versoesSkills: new Map(),
      ocupado: Effect.succeed(ocupado),
      prazo: "5 seconds",
      automatico: false,
    });
  });

  it.effect("troca durante revisão: adiada, e entra na próxima abertura", () =>
    Effect.gen(function* () {
      const c = yield* Effect.promise(cenario);
      c.publicar({ versao: "2026.11.13" });
      const atualizador = yield* servico(c, true);
      const estado = yield* atualizador.procurar;
      expect(estado).toMatchObject({ situacao: "pronta", pendente: "2026.11.13", erro: null });
      expect(yield* atualizador.aplicar).toStrictEqual({
        resultado: "adiada",
        mensagem: "Há um trabalho em andamento no app. A troca da base fica para quando o app abrir de novo.",
      });
      expect((yield* abertura(c)).info?.versao).toBe("2026.11.13");
      yield* Effect.promise(() => c.fechar());
    }).pipe(Effect.scoped, Effect.provide(LAYER_TESTE)),
  );

  it.effect("catálogo de tarefas e skills retiradas: chegam com a base e entram na abertura seguinte", () =>
    Effect.gen(function* () {
      const c = yield* Effect.promise(cenario);
      const tarefa = { id: "nova", titulo: "Tarefa nova", abre: { modulo: "revisao-ppc" } };
      c.publicar({ versao: "2026.11.13", tarefas: [tarefa], skillsRetiradas: ["skill-velha"] });
      const atualizador = yield* servico(c, false);
      expect(yield* atualizador.procurar).toMatchObject({ situacao: "pronta", skillsPendentes: "2026.11.13" });
      expect(yield* atualizador.aplicar).toMatchObject({ resultado: "reiniciar" });
      const aberta = yield* abertura(c);
      expect(aberta.catalogo).toEqual({ versao: "2026.11.13", tarefas: [tarefa] });
      expect(aberta.skillsRetiradas).toEqual(["skill-velha"]);

      // Só o catálogo esperando (a base já em dia): a tela ainda mostra "pronta", e aplicar reinicia.
      const depois = yield* servico(c, false);
      expect(yield* depois.estado).toMatchObject({ situacao: "parada", skillsPendentes: null });
      NodeFS.writeFileSync(
        NodePath.join(c.pastaApp, "atualizacao.json"),
        JSON.stringify({ ...estadoNoDisco(c.pastaApp), catalogoPendente: "2026.11.14" }),
      );
      expect(yield* depois.estado).toMatchObject({ situacao: "pronta", pendente: null, skillsPendentes: "2026.11.14" });
      expect(yield* depois.aplicar).toMatchObject({ resultado: "reiniciar" });
      yield* Effect.promise(() => c.fechar());
    }).pipe(Effect.scoped, Effect.provide(LAYER_TESTE)),
  );

  it.effect("sem revisão rodando: aplicar pede reinício; o aviso de novidades some depois de visto", () =>
    Effect.gen(function* () {
      const c = yield* Effect.promise(cenario);
      c.publicar({ versao: "2026.11.13" });
      const antes = yield* servico(c, false);
      yield* antes.procurar;
      expect(yield* antes.aplicar).toMatchObject({ resultado: "reiniciar" });
      const depois = yield* servico(c, false);
      const estado = yield* depois.estado;
      expect(estado.base).toMatchObject({ versao: "2026.11.13", origem: "baixada" });
      expect(estado.anterior).toBe("2026.11.10");
      expect(estado.novidades?.itens[0]?.titulo).toBe("Norma da versão 2026.11.13");
      expect((yield* depois.novidadesVistas).novidades).toBeNull();
      yield* Effect.promise(() => c.fechar());
    }).pipe(Effect.scoped, Effect.provide(LAYER_TESTE)),
  );

  it.effect("voltar: troca pela anterior na abertura e não baixa de novo a versão recusada", () =>
    Effect.gen(function* () {
      const c = yield* Effect.promise(cenario);
      c.publicar({ versao: "2026.11.12", anteriores: [c.empacotada] });
      yield* (yield* servico(c, false)).procurar;
      const v12 = yield* servico(c, false);
      expect((yield* v12.estado).base.versao).toBe("2026.11.12");
      c.publicar({ versao: "2026.11.13" });
      yield* v12.procurar;
      const v13 = yield* servico(c, false);
      expect((yield* v13.estado).base.versao).toBe("2026.11.13");
      expect((yield* v13.estado).anterior).toBe("2026.11.12");
      expect(yield* v13.voltar).toMatchObject({ resultado: "reiniciar" });
      const voltou = yield* servico(c, false);
      expect((yield* voltou.estado).base.versao).toBe("2026.11.12");
      expect(estadoNoDisco(c.pastaApp).recusada).toBe("2026.11.13");
      // Voltar de novo levaria à versão recusada: o botão some, e o pedido não troca nada.
      expect((yield* voltou.estado).anterior).toBeNull();
      expect(yield* voltou.voltar).toMatchObject({ resultado: "nada" });
      expect(estadoNoDisco(c.pastaApp).voltar).toBeUndefined();
      const depois = yield* voltou.procurar;
      expect(depois.pendente).toBeNull();
      // O gerado_em do manifesto conferido vai ao estado (o aviso de 14 dias na tela).
      expect(depois.manifestoGeradoEm).not.toBeNull();
      yield* Effect.promise(() => c.fechar());
    }).pipe(Effect.scoped, Effect.provide(LAYER_TESTE)),
  );

  it.effect("canal trocado: confere o manifesto do outro canal e recusa um manifesto de canal errado", () =>
    Effect.gen(function* () {
      const c = yield* Effect.promise(cenario);
      c.publicar({ versao: "2026.11.13", canal: "beta" });
      c.publicar({ versao: "2026.11.11", canal: "estavel" });
      const atualizador = yield* servico(c, false);
      expect(yield* atualizador.canal).toBe("beta");
      const estavel = yield* atualizador.trocarCanal("estavel");
      expect(estavel.canal).toBe("estavel");
      // O canal barato acompanha a troca, e o gravado vale na próxima abertura.
      expect(yield* atualizador.canal).toBe("estavel");
      expect(estadoNoDisco(c.pastaApp).canal).toBe("estavel");
      expect(yield* (yield* servico(c, false)).canal).toBe("estavel");
      expect((yield* atualizador.procurar).pendente).toBe("2026.11.11");
      expect(c.servidor.pedidos).toContain("estavel/estavel.json");
      expect(c.servidor.pedidos).not.toContain("beta/beta.json");
      // O manifesto do beta servido no lugar do estável: assinado, mas de outro canal.
      c.publicar({ versao: "2026.11.14", canal: "beta", pastaCanal: "estavel" });
      NodeFS.renameSync(
        NodePath.join(c.raiz, "servido", "estavel", "beta.json"),
        NodePath.join(c.raiz, "servido", "estavel", "estavel.json"),
      );
      NodeFS.renameSync(
        NodePath.join(c.raiz, "servido", "estavel", "beta.json.minisig"),
        NodePath.join(c.raiz, "servido", "estavel", "estavel.json.minisig"),
      );
      const recusado = yield* atualizador.procurar;
      expect(recusado.situacao).toBe("erro");
      expect(recusado.erro).toContain("canal beta");
      yield* Effect.promise(() => c.fechar());
    }).pipe(Effect.scoped, Effect.provide(LAYER_TESTE)),
  );

  it.effect("retirada de skill em uso: a tela oferece a troca, também em dia", () =>
    Effect.gen(function* () {
      const c = yield* Effect.promise(cenario);
      c.publicar({ versao: "2026.11.13", skillsRetiradas: ["a"] });
      const atualizador = yield* Atualizador.make({
        desligada: null,
        feed: c.feed,
        chave: c.chave,
        canalPadrao: "beta",
        pasta: c.pastaApp,
        bancoEmpacotado: c.empacotada,
        versaoApp: VERSAO_APP,
        abertura: yield* abertura(c),
        versoesSkills: new Map([["a", "1.0.0"]]),
        ocupado: Effect.succeed(false),
        prazo: "5 seconds",
        automatico: false,
      });
      yield* atualizador.procurar;
      yield* atualizador.aplicar;
      // A base e o catálogo entraram; a skill "a" continua no catálogo em memória desta execução.
      const depois = yield* Atualizador.make({
        desligada: null,
        feed: c.feed,
        chave: c.chave,
        canalPadrao: "beta",
        pasta: c.pastaApp,
        bancoEmpacotado: c.empacotada,
        versaoApp: VERSAO_APP,
        abertura: yield* abertura(c),
        versoesSkills: new Map([["a", "1.0.0"]]),
        ocupado: Effect.succeed(false),
        prazo: "5 seconds",
        automatico: false,
      });
      expect(yield* depois.estado).toMatchObject({ situacao: "parada", skillsPendentes: null });
      expect(yield* depois.procurar).toMatchObject({
        situacao: "pronta",
        pendente: null,
        skillsPendentes: "2026.11.13",
      });
      expect(yield* depois.aplicar).toMatchObject({ resultado: "reiniciar" });
      yield* Effect.promise(() => c.fechar());
    }).pipe(Effect.scoped, Effect.provide(LAYER_TESTE)),
  );

  it.effect("trocar o canal não espera o download em curso, e o que ele baixar do canal antigo não fica pendente", () =>
    Effect.gen(function* () {
      const c = yield* Effect.promise(cenario);
      c.publicar({
        versao: "2026.11.13",
        tarefas: [{ id: "nova", titulo: "Tarefa nova", abre: { modulo: "revisao-ppc" } }],
      });
      const liberar = yield* Deferred.make<void>();
      const pediu = yield* Deferred.make<void>();
      // O download da base fica preso até o teste liberar: a conferência segura o semáforo dela.
      const preso = Layer.effect(
        HttpClient.HttpClient,
        Effect.gen(function* () {
          const real = yield* HttpClient.HttpClient;
          return HttpClient.tapRequest(real, (pedido) =>
            pedido.url.includes("base-")
              ? Deferred.succeed(pediu, undefined).pipe(Effect.andThen(Deferred.await(liberar)))
              : Effect.void,
          );
        }),
      ).pipe(Layer.provide(LAYER_TESTE));
      const atualizador = yield* servico(c, false).pipe(Effect.provide(preso));
      const conferencia = yield* Effect.forkChild(atualizador.procurar);
      yield* Deferred.await(pediu);
      // A troca termina com o download ainda preso: o canal muda na hora, na memória e no disco.
      const estavel = yield* atualizador.trocarCanal("estavel");
      expect(estavel.canal).toBe("estavel");
      expect(estadoNoDisco(c.pastaApp).canal).toBe("estavel");
      yield* Deferred.succeed(liberar, undefined);
      const depois = yield* Fiber.join(conferencia);
      // A base, as skills e o catálogo do beta não ficaram pendentes.
      expect(depois).toMatchObject({ canal: "estavel", situacao: "parada", pendente: null, skillsPendentes: null });
      const noDisco = estadoNoDisco(c.pastaApp);
      expect(noDisco).toMatchObject({ canal: "estavel" });
      expect(noDisco.pendente).toBeUndefined();
      expect(noDisco.catalogoPendente).toBeUndefined();
      expect(NodeFS.existsSync(NodePath.join(c.pastaApp, "base", "pendente.sqlite"))).toBe(false);
      expect(NodeFS.existsSync(NodePath.join(c.pastaApp, "base", "baixando.sqlite"))).toBe(false);
      yield* Effect.promise(() => c.fechar());
    }).pipe(Effect.scoped, Effect.provide(LAYER_TESTE)),
  );

  it.effect("novidades vistas espera a trava do atualizacao.json que a conferência segura ao gravar", () =>
    Effect.gen(function* () {
      const c = yield* Effect.promise(cenario);
      c.publicar({ versao: "2026.11.13" });
      NodeFS.mkdirSync(c.pastaApp, { recursive: true });
      NodeFS.writeFileSync(
        NodePath.join(c.pastaApp, "atualizacao.json"),
        JSON.stringify({ novidades: { versao: "2026.11.10", itens: [], vista: false } }),
      );
      const liberar = yield* Deferred.make<void>();
      const pausou = yield* Deferred.make<void>();
      const pausa = { ativa: false, leiturasDoEstado: 0 };
      // A conferência para entre a leitura e a gravação do estado (o `rename` da base baixada, na trava).
      const vigiado = Layer.effect(
        FileSystem.FileSystem,
        Effect.gen(function* () {
          const real = yield* FileSystem.FileSystem;
          return {
            ...real,
            rename: (de: string, para: string) =>
              de.endsWith("baixando.sqlite")
                ? Effect.sync(() => {
                    pausa.ativa = true;
                  }).pipe(
                    Effect.andThen(Deferred.succeed(pausou, undefined)),
                    Effect.andThen(Deferred.await(liberar)),
                    Effect.andThen(
                      Effect.sync(() => {
                        pausa.ativa = false;
                      }),
                    ),
                    Effect.andThen(real.rename(de, para)),
                  )
                : real.rename(de, para),
            readFileString: (caminho: string, codificacao?: string) => {
              if (pausa.ativa && caminho.endsWith("atualizacao.json")) pausa.leiturasDoEstado += 1;
              return real.readFileString(caminho, codificacao);
            },
          } satisfies FileSystem.FileSystem;
        }),
      ).pipe(Layer.provide(LAYER_TESTE));
      const atualizador = yield* servico(c, false).pipe(Effect.provide(vigiado));
      const conferencia = yield* Effect.forkChild(atualizador.procurar);
      yield* Deferred.await(pausou);
      const vista = yield* Effect.forkChild(atualizador.novidadesVistas);
      for (let i = 0; i < 10; i += 1) yield* Effect.yieldNow;
      // Na trava: nem leu o estado, que a conferência vai regravar.
      expect(pausa.leiturasDoEstado).toBe(0);
      expect(vista.pollUnsafe()).toBeUndefined();
      yield* Deferred.succeed(liberar, undefined);
      yield* Fiber.join(conferencia);
      yield* Fiber.join(vista);
      // As duas gravações ficaram: a base pendente e a marca de vista.
      const noDisco = estadoNoDisco(c.pastaApp);
      expect(noDisco.pendente?.versao).toBe("2026.11.13");
      expect(noDisco.novidades?.vista).toBe(true);
      yield* Effect.promise(() => c.fechar());
    }).pipe(Effect.scoped, Effect.provide(LAYER_TESTE)),
  );

  it.effect("sem pasta de atualização, nada vai ao disco: o canal fica só na memória", () =>
    Effect.gen(function* () {
      const c = yield* Effect.promise(cenario);
      const tocados: string[] = [];
      // Todo acesso ao `atualizacao.json` (um caminho vazio o leria e gravaria no diretório corrente).
      const vigiado = Layer.effect(
        FileSystem.FileSystem,
        Effect.gen(function* () {
          const real = yield* FileSystem.FileSystem;
          const anota = (caminho: string) => {
            if (caminho.includes("atualizacao.json")) tocados.push(caminho);
          };
          return {
            ...real,
            readFileString: (caminho: string, codificacao?: string) => {
              anota(caminho);
              return real.readFileString(caminho, codificacao);
            },
            writeFileString: (caminho: string, dados: string, opcoes?: Parameters<typeof real.writeFileString>[2]) => {
              anota(caminho);
              return real.writeFileString(caminho, dados, opcoes);
            },
            rename: (de: string, para: string) => {
              anota(para);
              return real.rename(de, para);
            },
          } satisfies FileSystem.FileSystem;
        }),
      ).pipe(Layer.provide(LAYER_TESTE));
      const aberta = yield* abertura(c);
      const atualizador = yield* Atualizador.make({
        desligada: "a atualização não foi configurada neste servidor",
        feed: null,
        chave: null,
        canalPadrao: "beta",
        pasta: "",
        bancoEmpacotado: c.empacotada,
        versaoApp: VERSAO_APP,
        abertura: aberta,
        versoesSkills: new Map(),
        ocupado: Effect.succeed(false),
        automatico: false,
      }).pipe(Effect.provide(vigiado));
      expect((yield* atualizador.estado).canal).toBe("beta");
      expect((yield* atualizador.trocarCanal("estavel")).canal).toBe("estavel");
      expect(yield* atualizador.canal).toBe("estavel");
      yield* atualizador.novidadesVistas;
      yield* atualizador.voltar;
      expect(tocados).toEqual([]);
      yield* Effect.promise(() => c.fechar());
    }).pipe(Effect.scoped, Effect.provide(LAYER_TESTE)),
  );

  it.effect("sem feed ou chave na política: desligada, e procurar não sai para a rede", () =>
    Effect.gen(function* () {
      const c = yield* Effect.promise(cenario);
      const atualizador = yield* Atualizador.make({
        desligada: "a hospedagem do feed ainda não está no app",
        feed: null,
        chave: null,
        canalPadrao: "beta",
        pasta: c.pastaApp,
        bancoEmpacotado: c.empacotada,
        versaoApp: VERSAO_APP,
        abertura: yield* abertura(c),
        versoesSkills: new Map(),
        ocupado: Effect.succeed(false),
        automatico: false,
      });
      const estado = yield* atualizador.procurar;
      expect(estado.desligada).toContain("hospedagem");
      expect(c.servidor.pedidos).toEqual([]);
      yield* Effect.promise(() => c.fechar());
    }).pipe(Effect.scoped, Effect.provide(LAYER_TESTE)),
  );
});
