/**
 * Orçamento (suíte transversal do T6), para cada ferramenta de `FERRAMENTAS`:
 *
 * - nenhum texto para a IA passa do teto da ferramenta (`teto` em `amostras.ts`), em todas as
 *   amostras válidas;
 * - nas ferramentas com `cursor`, a lista de `paginacao` percorrida página a página com o cursor tem
 *   mais de uma página, cada página no teto, `devolvidos` igual ao tamanho da página, e as chaves dos
 *   itens, somadas, são únicas e tantas quanto `pagina.total`: nada se repete e nada fica de fora.
 *
 * Na fixture, sempre; na base real (`tmp/kb.sqlite`), com `SIMPLIFICA_SMOKE=1`.
 */
import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { FERRAMENTAS } from "../../src/ferramentas/toolkit.ts";
import { camadaFerramentas, responder } from "../apoio.ts";
import { limparTemporarios } from "../fixture.ts";
import { AMOSTRAS, type Amostras, type Fixture } from "./amostras.ts";
import { BANCO_REAL, bancosFixture, comCursor, ferramenta, rotulo, SMOKE, SMOKE_APENAS } from "./apoio.ts";

let bancos: Record<Fixture, string>;
beforeAll(() => {
  if (!SMOKE_APENAS) bancos = bancosFixture();
});
afterAll(limparTemporarios);

/** Limite de páginas: uma paginação que não termina falha aqui, e não por tempo. */
const MAX_PAGINAS = 200;

/** Textos no teto e paginação completa, sobre `banco`. */
const conferir = (nome: string, a: Amostras, banco: string, real: boolean) =>
  Effect.gen(function* () {
    const f = ferramenta(nome);
    for (const args of real ? a.reais : a.validas) {
      const { texto } = yield* responder(f, args);
      expect(texto.length, rotulo({ nome, args })).toBeLessThanOrEqual(a.teto(args));
    }
    if (!a.paginacao) return;
    const args = real ? a.paginacao.real : a.paginacao.fixture;
    const chaves: string[] = [];
    let total: number | undefined;
    let cursor: string | undefined;
    let paginas = 0;
    do {
      const { resposta, texto } = yield* responder(f, comCursor(args, cursor));
      const contexto = `${rotulo({ nome, args })}, página ${paginas + 1}`;
      expect(texto.length, contexto).toBeLessThanOrEqual(a.teto(args));
      // uma lista que cabe numa página só não pagina; sem `pagina`, a página é a lista inteira
      const pagina = resposta.pagina;
      const daPagina = a.paginacao.chaves(resposta.dados);
      if (pagina) {
        expect(pagina.devolvidos, contexto).toBe(daPagina.length);
        total ??= pagina.total;
        expect(pagina.total, `${contexto}: o total mudou entre páginas`).toBe(total);
      }
      chaves.push(...daPagina);
      cursor = pagina?.cursor;
      paginas += 1;
    } while (cursor && paginas < MAX_PAGINAS);
    const contexto = rotulo({ nome, args });
    expect(cursor, `${contexto}: mais de ${MAX_PAGINAS} páginas`).toBeUndefined();
    expect(paginas, `${contexto}: a amostra de paginação cabe numa página só; use um limite menor`).toBeGreaterThan(1);
    expect(new Set(chaves).size, `${contexto}: itens repetidos entre as páginas`).toBe(chaves.length);
    expect(chaves.length, `${contexto}: a soma das páginas não dá o total`).toBe(total);
  }).pipe(Effect.provide(camadaFerramentas(banco)));

describe.each(FERRAMENTAS.map((f) => f.nome))("orçamento: %s", (nome) => {
  const a = (AMOSTRAS as Partial<Record<string, Amostras>>)[nome];

  it.effect.skipIf(SMOKE_APENAS)("fixture: textos no teto; paginação completa e sem repetição", () =>
    a ? conferir(nome, a, bancos[a.fixture], false) : Effect.die(new Error(`${nome}: sem amostras`)),
  );

  it.effect.skipIf(!SMOKE)("base real: textos no teto; paginação completa e sem repetição", () =>
    a ? conferir(nome, a, BANCO_REAL, true) : Effect.die(new Error(`${nome}: sem amostras`)),
  );
});
