/**
 * Contrato (suíte transversal do T6): toda ferramenta de `FERRAMENTAS` tem amostras em `amostras.ts`,
 * e, pelo protocolo (Client do SDK oficial, servidor em memória sobre a fixture):
 *
 * - cada entrada válida passa no `inputSchema` publicado, responde sem erro e a saída passa no
 *   `outputSchema` publicado (ajv, draft 2020-12) e no Effect Schema da ferramenta;
 * - cada entrada inválida volta como resultado `isError`, sem `structuredContent`, com a mensagem em
 *   português que nomeia o campo (a do schema, com o prefixo do SDK; a do handler, sem ele); neste
 *   processo, o erro é `EntradaInvalida`.
 */
import { afterAll, beforeAll, describe, expect, it, test } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { Ajv2020 } from "ajv/dist/2020.js";
import { ehEntradaInvalida } from "../../src/contratos.ts";
import { jsonSchema } from "../../src/esquema.ts";
import { FERRAMENTAS } from "../../src/ferramentas/toolkit.ts";
import { camadaFerramentas, conectarEmMemoria, responder, saidaValida } from "../apoio.ts";
import { limparTemporarios } from "../fixture.ts";
import { AMOSTRAS, type Amostras, type Fixture } from "./amostras.ts";
import { bancosFixture, ferramenta, rotulo } from "./apoio.ts";

let bancos: Record<Fixture, string>;
beforeAll(() => {
  bancos = bancosFixture();
});
afterAll(limparTemporarios);

/** As amostras de uma ferramenta, ou `undefined` se faltarem (o primeiro teste acusa). */
const amostrasDe = (nome: string) => (AMOSTRAS as Partial<Record<string, Amostras>>)[nome];

/** O rodapé de toda resposta válida, com a data e a versão da base. */
const RODAPE = /\n\nBase de (\d{2}\/\d{2}\/\d{4}|desenvolvimento) \(versão [^)]+\)\.$/;

/** Prefixo da mensagem de entrada inválida (`src/validacao.ts`). */
const prefixo = (nome: string) => `Entrada inválida para a ferramenta ${nome}: `;

/**
 * A mensagem é legível: em português (o formatador de `src/validacao.ts` ou a mensagem do handler),
 * nomeia um campo da entrada (ou as chaves não permitidas), sem as mensagens do Effect em inglês, sem
 * objeto serializado e sem pilha de chamadas.
 */
function conferirLegivel(mensagem: string, campos: ReadonlyArray<string>, contexto: string): void {
  const nomeiaCampo = campos.some((c) => new RegExp(`(^|[^a-z_])${c}([^a-z_]|$)`).test(mensagem));
  expect(nomeiaCampo || /Chaves? inválidas?: /.test(mensagem), `${contexto}: não nomeia o campo`).toBe(true);
  expect(mensagem, contexto).not.toMatch(/\b(Expected|Missing key|Unexpected|is missing|Invalid data)\b/);
  expect(mensagem, contexto).not.toContain("[object Object]");
  expect(mensagem, contexto).not.toMatch(/\n\s+at /);
  expect(mensagem.length, contexto).toBeLessThan(1000);
}

describe("amostras", () => {
  test("toda ferramenta tem amostras válidas (fixture e base real) e inválidas, e nenhuma amostra sobra", () => {
    const nomes = FERRAMENTAS.map((f) => f.nome as string);
    for (const nome of nomes) {
      const a = amostrasDe(nome);
      expect(a, `${nome}: sem amostras em test/transversal/amostras.ts`).toBeDefined();
      expect(a!.validas.length, `${nome}: sem amostra válida na fixture`).toBeGreaterThan(0);
      expect(a!.reais.length, `${nome}: sem amostra válida na base real`).toBeGreaterThan(0);
      expect(a!.invalidas.length, `${nome}: sem amostra inválida`).toBeGreaterThan(0);
    }
    expect(Object.keys(AMOSTRAS).sort()).toEqual([...nomes].sort());
  });

  test("paginação declarada exatamente nas ferramentas com cursor", () => {
    for (const f of FERRAMENTAS) {
      const propriedades = (jsonSchema(f.entrada).properties ?? {}) as Record<string, unknown>;
      expect(amostrasDe(f.nome)?.paginacao !== null, f.nome).toBe("cursor" in propriedades);
    }
  });
});

describe.each(FERRAMENTAS.map((f) => f.nome))("contrato: %s", (nome) => {
  it.effect("pelo protocolo: válidas no inputSchema e no outputSchema; inválidas com erro legível", () =>
    Effect.gen(function* () {
      const a = amostrasDe(nome);
      if (!a) return yield* Effect.die(new Error(`${nome}: sem amostras`));
      const f = ferramenta(nome);
      const banco = bancos[a.fixture];
      const cliente = yield* conectarEmMemoria(banco);
      const { tools } = yield* Effect.promise(() => cliente.listTools());
      const publicada = tools.find((t) => t.name === nome);
      expect(publicada, `${nome} fora do tools/list`).toBeDefined();
      const ajv = new Ajv2020({ strict: false, allErrors: true });
      const validarEntrada = ajv.compile(publicada!.inputSchema as object);
      const validarSaida = ajv.compile(publicada!.outputSchema as object);
      const campos = Object.keys(publicada!.inputSchema.properties ?? {});

      for (const args of a.validas) {
        const contexto = rotulo({ nome, args });
        expect(validarEntrada(args), `${contexto}: ${ajv.errorsText(validarEntrada.errors)}`).toBe(true);
        // o Client do SDK também confere o structuredContent no outputSchema listado
        const r = yield* Effect.promise(() => cliente.callTool({ name: nome, arguments: { ...args } }));
        expect(r.isError, `${contexto}: ${JSON.stringify(r.content).slice(0, 300)}`).toBeFalsy();
        expect(validarSaida(r.structuredContent), `${contexto}: ${ajv.errorsText(validarSaida.errors)}`).toBe(true);
        expect(saidaValida(f, r.structuredContent), contexto).toBe(true);
        const conteudo = r.content as { type: string; text: string }[];
        expect(
          conteudo.map((c) => c.type),
          contexto,
        ).toEqual(["text"]);
        expect(conteudo[0]!.text, contexto).toMatch(RODAPE);
      }

      for (const [args, trecho] of a.invalidas) {
        const contexto = rotulo({ nome, args });
        const r = yield* Effect.promise(() =>
          cliente.callTool({ name: nome, arguments: args as Record<string, unknown> }),
        );
        expect(r.isError, contexto).toBe(true);
        expect(r.structuredContent, contexto).toBeUndefined();
        const texto = (r.content as { text: string }[])[0]!.text;
        // a validação do schema leva o prefixo do SDK; a do handler (ID mal formado) vem sem ele
        const mensagem = texto.startsWith(prefixo(nome)) ? texto.slice(prefixo(nome).length) : texto;
        expect(mensagem, contexto).toContain(trecho);
        conferirLegivel(mensagem, campos, contexto);
        const erro = yield* Effect.flip(responder(f, args)).pipe(Effect.provide(camadaFerramentas(banco)));
        expect(ehEntradaInvalida(erro), contexto).toBe(true);
      }
    }).pipe(Effect.scoped),
  );
});
