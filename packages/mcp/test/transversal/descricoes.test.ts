/**
 * Descrições (suíte transversal do T6), como o cliente as recebe no `tools/list` (protocolo em
 * memória): tamanho máximo da descrição de cada ferramenta e de cada parâmetro, a frase que diz quando
 * usar a ferramenta, e o tamanho do `tools/list` sem os schemas de saída, que muitos clientes põem em toda conversa. O
 * texto exato de cada descrição é o da especificação, conferido em `ferramentas.test.ts`; a escolha da
 * ferramenta pelo modelo é avaliada no M0.5.
 */
import { afterAll, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { FERRAMENTAS } from "../../src/ferramentas/toolkit.ts";
import { conectarEmMemoria } from "../apoio.ts";
import { criarBancoFixture, limparTemporarios } from "../fixture.ts";

afterAll(limparTemporarios);

/** Máximo da descrição de uma ferramenta, em caracteres. */
const MAX_DESCRICAO = 600;
/** Máximo da descrição de um parâmetro. */
const MAX_PARAMETRO = 200;
/** Máximo do título. */
const MAX_TITULO = 40;
/**
 * Máximo do `tools/list` sem os `outputSchema` (nome, título, descrição, anotações e `inputSchema`), a
 * parte que os clientes põem no contexto do modelo: hoje cerca de 18 mil caracteres, com 16 ferramentas.
 */
const MAX_TOOLS_LIST = 24_000;

/** A frase que diz quando usar: "Use quando…", "Use antes de…", "Use para…", "Use só quando…", "Use dentro da…". */
const QUANDO_USAR = /(^|[.:] )Use (quando|antes|para|só quando|dentro d[aoe])\b/;

/**
 * Descrições da especificação que ainda não dizem quando usar a ferramenta. Mudar a descrição muda o
 * comportamento do modelo e o gabarito do C0, e por isso é decisão à parte; o teste falha quando a
 * descrição deixar de precisar da exceção, para que ela saia daqui.
 */
const SEM_QUANDO: Readonly<Record<string, string>> = {};

interface Propriedade {
  readonly description?: string;
}

describe("descrições no tools/list", () => {
  it.effect("ferramentas: título, descrição curta, quando usar e parâmetros descritos", () =>
    Effect.gen(function* () {
      const cliente = yield* conectarEmMemoria(criarBancoFixture());
      const { tools } = yield* Effect.promise(() => cliente.listTools());
      expect(tools.map((t) => t.name)).toEqual(FERRAMENTAS.map((f) => f.nome));
      for (const t of tools) {
        expect(t.title?.length ?? 0, t.name).toBeGreaterThan(0);
        expect(t.title!.length, t.name).toBeLessThanOrEqual(MAX_TITULO);
        expect(t.description?.length ?? 0, t.name).toBeGreaterThan(40);
        expect(t.description!.length, t.name).toBeLessThanOrEqual(MAX_DESCRICAO);
        expect(t.description, t.name).toMatch(/\bUse\b/);
        if (t.name in SEM_QUANDO) {
          expect(t.description, `${t.name}: tire a exceção de SEM_QUANDO`).not.toMatch(QUANDO_USAR);
        } else {
          expect(t.description, `${t.name}: a descrição não diz quando usar a ferramenta`).toMatch(QUANDO_USAR);
        }
        const propriedades = (t.inputSchema.properties ?? {}) as Record<string, Propriedade>;
        for (const [nome, p] of Object.entries(propriedades)) {
          expect(p.description?.length ?? 0, `${t.name}.${nome} sem descrição`).toBeGreaterThan(0);
          expect(p.description!.length, `${t.name}.${nome}`).toBeLessThanOrEqual(MAX_PARAMETRO);
        }
      }
      const paraOModelo = tools.map(({ outputSchema: _saida, ...resto }) => resto);
      expect(JSON.stringify(paraOModelo).length).toBeLessThanOrEqual(MAX_TOOLS_LIST);
    }).pipe(Effect.scoped),
  );
});
