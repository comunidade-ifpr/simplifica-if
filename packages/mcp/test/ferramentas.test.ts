// @effect-diagnostics nodeBuiltinImport:off -- teste: lê a especificação e o package.json do disco
/**
 * Testes de contrato: o registro, as descrições, os schemas e as duas ferramentas do T1, chamadas
 * diretamente e pelo protocolo (Client do SDK ligado ao servidor em memória).
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it, test } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { Tool } from "effect/ai";
import { ROTULOS_INDICADOR as ROTULOS_KB } from "@simplifica-if/kb/adequacao/art71";
import { ehEntradaInvalida } from "../src/contratos.ts";
import { jsonSchema } from "../src/esquema.ts";
import { etapa } from "../src/ferramentas/etapa.ts";
import { ROTULOS_INDICADOR } from "../src/ferramentas/ficha-curso.ts";
import { sobreABase } from "../src/ferramentas/sobre-a-base.ts";
import { FERRAMENTAS } from "../src/ferramentas/toolkit.ts";
import * as Leitura from "../src/leitura/Leitura.ts";
import { INSTRUCOES, layerLeitura, NOME_SERVIDOR, VERSAO_PACOTE } from "../src/servidor.ts";
import { camadaFerramentas, conectarEmMemoria, mensagemDeErro, responder, saidaValida } from "./apoio.ts";
import { CONTAGENS, criarBancoFixture, limparTemporarios } from "./fixture.ts";

afterEach(limparTemporarios);

/** As 16 ferramentas da especificação M0.1, na ordem da tabela "Ferramentas". */
const PREVISTAS = [
  "buscar_norma",
  "ler_dispositivos",
  "ficha_norma",
  "correspondencia",
  "resolver_citacoes",
  "citacoes_da_norma",
  "impacto_da_norma",
  "adequacao_art71",
  "buscar_secoes",
  "ler_secao",
  "listar_cursos",
  "ficha_curso",
  "fatos_ppc",
  "pacote_contexto",
  "sobre_a_base",
  "etapa",
];

/** As ferramentas sobre um banco de fixture novo. */
const naFixture = <A, E, R>(efeito: Effect.Effect<A, E, R>) =>
  efeito.pipe(Effect.provide(camadaFerramentas(criarBancoFixture())));

describe("registro", () => {
  test("nomes únicos, em snake_case e previstos na especificação", () => {
    const nomes = FERRAMENTAS.map((f) => f.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
    for (const nome of nomes) {
      expect(nome).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
      expect(PREVISTAS).toContain(nome);
    }
    // todas as previstas, na ordem da tabela da especificação
    expect(nomes).toEqual(PREVISTAS);
  });

  test("descrições: curtas, com título e dizendo quando usar", () => {
    for (const f of FERRAMENTAS) {
      expect(f.descricao.length).toBeLessThanOrEqual(600);
      // toda descrição diz quando usar a ferramenta, com "Use"
      expect(f.descricao).toMatch(/\bUse\b/);
      expect(f.titulo.length).toBeGreaterThan(0);
    }
  });

  test("anotações: só leitura, não destrutiva, idempotente, mundo fechado", () => {
    for (const f of FERRAMENTAS) {
      const anotacoes = f.tool.annotations;
      expect({
        title: Context.getUnsafe(anotacoes, Tool.Title),
        readOnlyHint: Context.get(anotacoes, Tool.Readonly),
        destructiveHint: Context.get(anotacoes, Tool.Destructive),
        idempotentHint: Context.get(anotacoes, Tool.Idempotent),
        openWorldHint: Context.get(anotacoes, Tool.OpenWorld),
      }).toEqual({
        title: f.titulo,
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });

  test("entrada e saída viram JSON Schema de objeto", () => {
    for (const f of FERRAMENTAS) {
      expect(jsonSchema(f.entrada)).toMatchObject({ type: "object", additionalProperties: false });
      expect(jsonSchema(f.saida)).toMatchObject({
        type: "object",
        required: ["base", "dados", "avisos"],
      });
    }
  });
});

describe("sobre_a_base", () => {
  it.effect("saída válida no outputSchema, com contagens, tipos, níveis e campi ordenados", () =>
    naFixture(
      Effect.gen(function* () {
        const { resposta } = yield* responder(sobreABase, {});
        expect(saidaValida(sobreABase, resposta)).toBe(true);
        expect(resposta.base).toEqual({
          versao: "dev-ab12cd34",
          data: null,
          commit: null,
          canal: "dev",
        });
        expect(resposta.avisos).toEqual([]);
        expect(resposta.dados).toEqual({
          vigencia_em: "2026-11-13",
          contagens: CONTAGENS,
          tipos_de_secao: ["avaliacao", "estagio_praticas"],
          niveis: ["médio", "superior"],
          campi: [
            { id: "assis-chateaubriand", nome: "Assis Chateaubriand", link: "ifpr://campus/assis-chateaubriand" },
            { id: "curitiba", nome: "Curitiba", link: "ifpr://campus/curitiba" },
            { id: "foz-do-iguacu", nome: "Foz do Iguaçu", link: "ifpr://campus/foz-do-iguacu" },
          ],
        });
      }),
    ),
  );

  it.effect("texto: conteúdo, filtros com links e rodapé", () =>
    naFixture(
      Effect.gen(function* () {
        const { texto } = yield* responder(sobreABase, {});
        expect(texto).toContain("versão `dev-ab12cd34` (canal dev)");
        expect(texto).toContain("Conteúdo: 1 PPCs, 3 seções de PPC, 2 cursos, 3 campi.");
        expect(texto).toContain("[Foz do Iguaçu](ifpr://campus/foz-do-iguacu) `foz-do-iguacu`");
        expect(texto).not.toContain("Atenção:");
        expect(texto.split("\n").at(-1)).toBe("Base de desenvolvimento (versão `dev-ab12cd34`).");
      }),
    ),
  );

  it.effect("determinismo: mesma entrada e mesmo banco, mesma saída byte a byte", () =>
    naFixture(
      Effect.gen(function* () {
        const a = yield* responder(sobreABase, {});
        const b = yield* responder(sobreABase, {});
        expect(JSON.stringify(b.resposta)).toBe(JSON.stringify(a.resposta));
        expect(b.texto).toBe(a.texto);
      }),
    ),
  );

  it.effect("entrada inválida: erro legível", () =>
    naFixture(
      Effect.gen(function* () {
        const erro = yield* Effect.flip(responder(sobreABase, { consulta: "x" }));
        expect(ehEntradaInvalida(erro)).toBe(true);
        expect(yield* mensagemDeErro(sobreABase, { consulta: "x" })).toContain('"consulta"');
      }),
    ),
  );
});

describe("etapa", () => {
  it.effect("não registra nada fora do app; saída válida", () =>
    naFixture(
      Effect.gen(function* () {
        for (const args of [{ id: "fase-1" }, { id: "fase-1", progresso: { feito: 2, total: 5 } }]) {
          const { resposta, texto } = yield* responder(etapa, args);
          expect(resposta.dados).toEqual({ registrado: false });
          expect(saidaValida(etapa, resposta)).toBe(true);
          expect(texto).toContain("Etapa não registrada");
        }
      }),
    ),
  );

  it.effect("no app (etapaRegistrada), registra a etapa", () =>
    Effect.gen(function* () {
      const leitura = yield* Leitura.Leitura;
      const resposta = yield* leitura.etapa({ id: "fase-1" });
      expect(resposta.dados).toEqual({ registrado: true });
      expect(saidaValida(etapa, resposta)).toBe(true);
    }).pipe(Effect.provide(layerLeitura({ banco: criarBancoFixture(), canal: "dev", etapaRegistrada: true }))),
  );

  it.effect("entrada inválida: erro legível com o campo", () =>
    naFixture(
      Effect.gen(function* () {
        expect(yield* mensagemDeErro(etapa, {})).toContain("id: ");
        expect(yield* mensagemDeErro(etapa, { id: "x", progresso: { feito: 3, total: 2 } })).toContain(
          "feito não pode passar de total",
        );
        expect(ehEntradaInvalida(yield* Effect.flip(responder(etapa, { id: "" })))).toBe(true);
      }),
    ),
  );
});

describe("pelo protocolo MCP (em memória)", () => {
  it.effect("identifica o servidor e entrega as instruções", () =>
    Effect.gen(function* () {
      const cliente = yield* conectarEmMemoria(criarBancoFixture());
      expect(cliente.getServerVersion()).toMatchObject({ name: NOME_SERVIDOR, version: VERSAO_PACOTE });
      expect(cliente.getInstructions()).toBe(INSTRUCOES);
    }).pipe(Effect.scoped),
  );

  it.effect("chamada válida: structuredContent é a Resposta, content é o texto", () =>
    Effect.gen(function* () {
      const banco = criarBancoFixture();
      const cliente = yield* conectarEmMemoria(banco);
      // O Client valida structuredContent contra o outputSchema listado.
      const r = yield* Effect.promise(() => cliente.callTool({ name: "sobre_a_base", arguments: {} }));
      const direto = yield* responder(sobreABase, {}).pipe(Effect.provide(camadaFerramentas(banco)));
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent).toEqual(direto.resposta);
      expect(r.content).toEqual([{ type: "text", text: direto.texto }]);
    }).pipe(Effect.scoped),
  );

  it.effect("entrada inválida: resultado de erro com mensagem em português e o campo", () =>
    Effect.gen(function* () {
      const cliente = yield* conectarEmMemoria(criarBancoFixture());
      const r = yield* Effect.promise(() =>
        cliente.callTool({ name: "etapa", arguments: { progresso: { feito: 1, total: 0 } } }),
      );
      expect(r.isError).toBe(true);
      const texto = (r.content as { text: string }[])[0]!.text;
      expect(texto).toMatch(/^Entrada inválida para a ferramenta etapa: /);
      expect(texto).toContain("id: campo obrigatório; esperava um texto");
      expect(texto).toContain("progresso.total: ");
    }).pipe(Effect.scoped),
  );
});

describe("pacote", () => {
  test("instruções: no máximo 400 palavras, 7 itens, só ferramentas previstas", () => {
    expect(INSTRUCOES.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(400);
    for (let i = 1; i <= 7; i += 1) expect(INSTRUCOES).toContain(`\n${i}. **`);
    const citadas = [...INSTRUCOES.matchAll(/`([a-z0-9]+(?:_[a-z0-9]+)+)`/g)].map((m) => m[1]!);
    expect(citadas.length).toBeGreaterThan(0);
    for (const nome of citadas) expect(PREVISTAS).toContain(nome);
  });

  test("a versão do servidor é a do package.json", () => {
    const pacote = JSON.parse(NodeFS.readFileSync(NodePath.join(import.meta.dirname, "../package.json"), "utf8")) as {
      version: string;
    };
    expect(VERSAO_PACOTE).toBe(pacote.version);
  });
});

test("os rótulos da adequação ao art. 71 na ficha_curso são os do kb", () => {
  // A ficha_curso guarda uma cópia: o módulo dela é contrato da interface e não importa o kb.
  expect(ROTULOS_INDICADOR).toStrictEqual(ROTULOS_KB);
});
