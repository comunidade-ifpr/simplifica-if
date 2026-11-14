/**
 * Abertura do `kb.sqlite` pelo simplifica-mcp: só leitura, sem recompilar e sem procurar o
 * repositório (`layerLeitura`, sobre o `BaseKb` do kb), e as mensagens que o servidor dá a quem o
 * instala quando o banco falta ou é de outra versão (`mensagemDeAbertura`).
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as BaseKb from "@simplifica-if/kb/BaseKb";
import { VERSAO_ESQUEMA } from "@simplifica-if/kb/db/esquema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as Leitura from "../src/leitura/Leitura.ts";
import { layerLeitura, MENSAGEM_INCOMPATIVEL, mensagemDeAbertura } from "../src/servidor.ts";
import { CONTAGENS, criarBancoFixture, diretorioTemporario, FONTES_SHA256, limparTemporarios } from "./fixture.ts";

afterEach(limparTemporarios);

/** A mensagem com que o servidor recusa o banco em `caminho` (falha a abertura, se não abrir). */
const recusa = (caminho: string) =>
  Layer.build(layerLeitura({ banco: caminho, canal: "dev" })).pipe(
    Effect.scoped,
    Effect.flip,
    Effect.map((erro) =>
      BaseKb.ehBaseAusente(erro) || BaseKb.ehBaseIncompativel(erro) || Leitura.ehCanalDesconhecido(erro)
        ? mensagemDeAbertura(erro)
        : `${MENSAGEM_INCOMPATIVEL} (${erro._tag})`,
    ),
  );

/** As mensagens de um erro e das causas dele, encadeadas. */
function mensagensDaCadeia(erro: unknown): string {
  const partes: string[] = [];
  for (let atual = erro; atual instanceof Error; atual = atual.cause) partes.push(atual.message);
  return partes.join(" ← ");
}

describe("abertura do banco", () => {
  it.effect("lê a meta de um banco de hoje, sem versao, commit nem canal", () =>
    Effect.gen(function* () {
      const { meta } = yield* BaseKb.BaseKb;
      const { base } = yield* Leitura.Leitura;
      expect(meta).toMatchObject({
        versao_esquema: VERSAO_ESQUEMA,
        data_referencia: "2026-11-13",
        fontes_sha256: FONTES_SHA256,
        contagens: CONTAGENS,
        versao: null,
        commit: null,
        canal: null,
      });
      expect(base).toEqual({ versao: "dev-ab12cd34", commit: null, data_referencia: "2026-11-13", canal: "dev" });
    }).pipe(Effect.provide(layerLeitura({ banco: criarBancoFixture(), canal: "dev" }))),
  );

  it.effect("lê versao, commit e canal quando o banco os tem (passo T0)", () =>
    Effect.gen(function* () {
      const { base } = yield* Leitura.Leitura;
      expect(base).toMatchObject({ versao: "2026.11.13", commit: "dc6b4470abc", canal: "estavel" });
    }).pipe(
      Effect.provide(
        layerLeitura({
          banco: criarBancoFixture({ meta: { versao: "2026.11.13", commit: "dc6b4470abc", canal: "estavel" } }),
          canal: "beta",
        }),
      ),
    ),
  );

  it.effect("recusa versao_esquema diferente com a mensagem da especificação", () =>
    Effect.gen(function* () {
      const mensagem = yield* recusa(criarBancoFixture({ meta: { versao_esquema: String(VERSAO_ESQUEMA + 1) } }));
      expect(mensagem).toContain(MENSAGEM_INCOMPATIVEL);
      expect(mensagem).toContain(`esquema da base: ${VERSAO_ESQUEMA + 1}; esperado: ${VERSAO_ESQUEMA}`);
    }),
  );

  it.effect("recusa banco sem versao_esquema", () =>
    Effect.gen(function* () {
      expect(yield* recusa(criarBancoFixture({ meta: { versao_esquema: null } }))).toContain(MENSAGEM_INCOMPATIVEL);
    }),
  );

  it.effect("recusa meta incompleta ou inválida", () =>
    Effect.gen(function* () {
      expect(yield* recusa(criarBancoFixture({ meta: { data_referencia: null } }))).toContain(MENSAGEM_INCOMPATIVEL);
      expect(yield* recusa(criarBancoFixture({ meta: { contagens_json: "{" } }))).toContain("contagens_json");
      expect(yield* recusa(criarBancoFixture({ meta: { canal: "nightly" } }))).toContain(MENSAGEM_INCOMPATIVEL);
      // canal que o kb conhece e o simplifica-mcp não
      expect(yield* recusa(criarBancoFixture({ meta: { canal: "piloto" } }))).toContain(MENSAGEM_INCOMPATIVEL);
    }),
  );

  it.effect("recusa arquivo que não é um kb.sqlite", () =>
    Effect.gen(function* () {
      const caminho = path.join(diretorioTemporario(), "kb.sqlite");
      writeFileSync(caminho, "não sou um banco\n".repeat(200));
      expect(yield* recusa(caminho)).toContain(MENSAGEM_INCOMPATIVEL);
    }),
  );

  it.effect("banco ausente: erro claro, e nenhum arquivo é criado", () =>
    Effect.gen(function* () {
      const caminho = path.join(diretorioTemporario(), "nao-existe.sqlite");
      expect(yield* recusa(caminho)).toBe(`kb.sqlite não encontrado ou ilegível: ${caminho}`);
      expect(existsSync(caminho)).toBe(false);
    }),
  );

  it.effect("abre só para leitura: escrever falha", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      for (const comando of [
        "INSERT INTO meta (chave, valor) VALUES ('x', 'y')",
        "DELETE FROM campi",
        "CREATE TABLE t (x)",
      ]) {
        const erro: unknown = yield* Effect.flip(sql.unsafe(comando));
        expect(mensagensDaCadeia(erro)).toMatch(/readonly/);
      }
    }).pipe(Effect.provide(layerLeitura({ banco: criarBancoFixture(), canal: "dev" }))),
  );
});
