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
import * as Effect from "effect/Effect";
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
      versoesSkills: {},
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
      expect(yield* atualizador.aplicar).toMatchObject({ resultado: "adiada" });
      expect((yield* abertura(c)).info?.versao).toBe("2026.11.13");
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
      const estavel = yield* atualizador.trocarCanal("estavel");
      expect(estavel.canal).toBe("estavel");
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
        versoesSkills: {},
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
