/**
 * Os comandos derivados das ferramentas (`src/consulta.ts`), que a CLI `kb` monta: um por ferramenta
 * (menos a `etapa`), com as flags do JSON Schema de entrada, sobre um banco de fixture. Conferem que o
 * comando imprime a mesma resposta do `chamador` (texto ou JSON), que as flags chegam à entrada na
 * forma certa (número, lista repetida, argumento repetível, booleano) e que a entrada inválida falha
 * com a mensagem da ferramenta.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, describe, expect, it, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Command from "effect/cli/Command";
import { TestConsole } from "effect/testing";
import { comandosDeConsulta } from "../src/consulta.ts";
import type { Resposta } from "../src/contratos.ts";
import { chamador } from "../src/ferramentas/registrar.ts";
import { FERRAMENTAS, layerHandlers } from "../src/ferramentas/toolkit.ts";
import { sobreABase } from "../src/ferramentas/sobre-a-base.ts";
import { layerLeitura } from "../src/servidor.ts";
import { CONTAGENS, criarBancoFixture, limparTemporarios } from "./fixture.ts";

const banco = criarBancoFixture();
afterAll(limparTemporarios);

const leitura = layerLeitura({ banco, canal: "dev" });
const raiz = Command.make("kb").pipe(Command.withSubcommands(comandosDeConsulta(leitura)));
const rodar = Command.runWith(raiz, { version: "0.0.0" });

/** As linhas que o comando imprimiu (o console de teste acumula as dos testes anteriores). */
const saida = (argumentos: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const antes = (yield* TestConsole.logLines).length;
    yield* rodar(argumentos);
    return (yield* TestConsole.logLines).slice(antes).map(String);
  });

const jsonDe = (linha: string) => JSON.parse(linha) as Resposta<Record<string, unknown>>;

describe("comandos derivados das ferramentas", () => {
  it("um comando por ferramenta, menos a etapa, com o nome em kebab-case e a descrição dela", () => {
    const nomes = FERRAMENTAS.filter((f) => f.nome !== "etapa").map((f) => f.nome.replaceAll("_", "-"));
    const comandos = comandosDeConsulta(leitura);
    expect(comandos.map((c) => c.name)).toEqual(nomes);
  });

  layer(Layer.mergeAll(NodeServices.layer, TestConsole.layer, layerHandlers.pipe(Layer.provide(leitura))))((it) => {
    it.effect("o texto padrão e o --json são os do chamador", () =>
      Effect.gen(function* () {
        const resposta = yield* Effect.flatMap(chamador, (chamar) => chamar("sobre_a_base", {}));
        expect(yield* saida(["sobre-a-base"])).toEqual([sobreABase.textoCompleto(resposta as never)]);
        const [linha] = yield* saida(["sobre-a-base", "--json"]);
        expect(jsonDe(linha!)).toEqual(resposta);
      }),
    );

    it.effect("número e --todas-as-paginas: uma resposta por página, com o limite pedido", () =>
      Effect.gen(function* () {
        const linhas = yield* saida(["listar-cursos", "--limite", "1", "--json", "--todas-as-paginas"]);
        expect(linhas.length).toBe(CONTAGENS.cursos);
        for (const linha of linhas) expect((jsonDe(linha).dados["cursos"] as unknown[]).length).toBe(1);
        expect(jsonDe(linhas.at(-1)!).pagina?.cursor).toBeUndefined();
      }),
    );

    it.effect("argumento posicional repetível e flag de lista repetida", () =>
      Effect.gen(function* () {
        const [citacoes] = yield* saida(["resolver-citacoes", "Lei nº 9.394/1996", "Lei nº 11.788/2008", "--json"]);
        expect((jsonDe(citacoes!).dados["itens"] as unknown[]).length).toBe(2);
        const [secoes] = yield* saida([
          "buscar-secoes",
          "estágio",
          "--tipo",
          "estagio_praticas",
          "--tipo",
          "avaliacao",
          "--json",
        ]);
        expect(jsonDe(secoes!).dados["resultados"]).toBeDefined();
      }),
    );

    it.effect("entrada inválida falha com a mensagem da ferramenta, sem imprimir", () =>
      Effect.gen(function* () {
        const antes = (yield* TestConsole.logLines).length;
        const erro = yield* Effect.flip(rodar(["listar-cursos", "--limite", "abc"]));
        expect(erro.message).toContain("listar_cursos");
        expect(erro.message).toContain("limite");
        expect((yield* TestConsole.logLines).length).toBe(antes);
      }),
    );
  });
});
