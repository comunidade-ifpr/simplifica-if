// @effect-diagnostics nodeBuiltinImport:off -- teste da regra de lint: o caminho absoluto pelo node:path
// Testes da regra própria `fronteira-modulos` (não vem do T3).

import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";

import {
  ARQUIVOS_QUE_CITAM,
  ARQUIVOS_QUE_IMPORTAM,
  camadaDe,
  moduloDoCaminho,
  moduloDoImport,
  violacaoDeFronteira,
} from "../modulos.ts";
import { createOxlintRuleHarness } from "../test/utils.ts";

/** O `RuleTester` resolve o nome relativo a partir da pasta dele: o caso leva o caminho absoluto. */
const RAIZ = NodePath.resolve(import.meta.dirname, "../../..");

const em = (arquivo: string) =>
  createOxlintRuleHarness("simplifica-if/fronteira-modulos", { filename: NodePath.join(RAIZ, arquivo) });

const noNucleo = em("apps/web/src/conversa/Tela.tsx");
const naComposicao = em("apps/web/src/inicializar.ts");
const noModulo = em("apps/web/src/modulos/revisao-ppc/Leitura.tsx");
const soCita = em("packages/contratos-app/src/ponte.ts");
const servidor = em("apps/server/src/servidor.ts");

describe("simplifica-if/fronteira-modulos", () => {
  noNucleo.valid("o núcleo importa do núcleo", `import { useApi } from "../contexto.tsx";`);
  noNucleo.invalid(
    "o núcleo não importa de um módulo",
    `import { ControleRevisao } from "../modulos/revisao-ppc/ControleRevisao.ts";`,
    (saida) => assert.include(saida, `o núcleo não importa do módulo "revisao-ppc"`),
  );
  noNucleo.invalid(
    "nem o contrato do módulo, pelo pacote",
    `import type { ListaPendencias } from "@simplifica-if/contratos-app/modulos/revisao-ppc";`,
  );
  noNucleo.invalid("nem reexporta", `export * from "../modulos/revisao-ppc/lista.ts";`);
  noNucleo.invalid("nem por import dinâmico", `const m = import("../modulos/revisao-ppc/Tela.tsx");`);
  noNucleo.invalid(
    "nem por import dinâmico com template sem expressão",
    "const m = import(`../modulos/revisao-ppc/Tela.tsx`);",
  );
  noNucleo.invalid("nem por require", `const m = require("../modulos/revisao-ppc/lista.ts");`);
  noNucleo.invalid("nem por require.resolve", `const m = require.resolve("../modulos/revisao-ppc/lista.ts");`);
  noNucleo.invalid("nem por import = require", `import Lista = require("../modulos/revisao-ppc/lista.ts");`);
  noNucleo.invalid("nem por tipo importado", `type L = import("../modulos/revisao-ppc/lista.ts").Lista;`);
  noNucleo.invalid("nem por vi.mock", `vi.mock("../modulos/revisao-ppc/lista.ts");`);
  noNucleo.invalid("nem por vi.importActual", `const m = await vi.importActual("../modulos/revisao-ppc/lista.ts");`);
  noNucleo.invalid("nem por import.meta.resolve", `const m = import.meta.resolve("../modulos/revisao-ppc/lista.ts");`);
  noNucleo.invalid(
    "nem por new URL ao lado do arquivo",
    `const w = new URL("../modulos/revisao-ppc/trabalhador.ts", import.meta.url);`,
  );
  noNucleo.invalid("nem pela pasta do módulo, sem arquivo", `import * as M from "../modulos/revisao-ppc";`);
  noNucleo.invalid("nem pela pasta de todos os módulos", `import * as M from "../modulos";`, (saida) =>
    assert.include(saida, "importa a pasta de todos os módulos"),
  );
  noNucleo.invalid("nem pela pasta de todos os módulos, com a barra", `import * as M from "../modulos/";`);
  noNucleo.valid("template com expressão não se confere", "const m = import(`../modulos/${nome}/Tela.tsx`);");
  noNucleo.valid(
    "URL que não é relativa ao arquivo não é import",
    `const u = new URL("../modulos/revisao-ppc/x.ts", "https://exemplo.org/");`,
  );
  noNucleo.valid("chamada qualquer com um caminho não é import", `registrar("../modulos/revisao-ppc/x.ts");`);
  naComposicao.valid(
    "o arquivo de composição importa o módulo da própria camada",
    `import { ControleRevisao } from "./modulos/revisao-ppc/ControleRevisao.ts";`,
  );
  naComposicao.invalid("mas não a pasta de todos os módulos", `import * as M from "./modulos";`);
  servidor.invalid(
    "o arquivo de composição não importa o módulo de outra camada, pelo pacote",
    `import { GrupoRevisaoPpc } from "@simplifica-if/contratos-app/modulos/revisao-ppc";`,
    (saida) => assert.include(saida, 'só importa do módulo "revisao-ppc" da própria camada (apps/server'),
  );
  servidor.invalid(
    "nem por caminho relativo",
    `import { GrupoRevisaoPpc } from "../../../packages/contratos-app/src/modulos/revisao-ppc.ts";`,
  );
  soCita.invalid(
    "o arquivo que cita o módulo só pelo nome não importa dele",
    `import { GrupoRevisaoPpc } from "./modulos/revisao-ppc.ts";`,
    (saida) => assert.include(saida, "só pelo nome"),
  );
  noModulo.valid("o módulo importa de si", `import { useRevisao } from "./contexto.ts";`);
  noModulo.valid("o módulo importa do núcleo", `import { useApi } from "../../contexto.tsx";`);
  noModulo.valid(
    "o módulo importa o mesmo módulo de outra camada",
    `import type { ListaPendencias } from "@simplifica-if/contratos-app/modulos/revisao-ppc";`,
  );
  noModulo.invalid("um módulo não importa de outro", `import { x } from "../outro-modulo/x.ts";`, (saida) =>
    assert.include(saida, `o módulo "revisao-ppc" não importa do módulo "outro-modulo"`),
  );
  noModulo.invalid("nem por vi.mock", `vi.mock("../outro-modulo/x.ts");`);

  it("o módulo e a camada de um caminho", () => {
    assert.strictEqual(moduloDoCaminho("apps/server/src/modulos/revisao-ppc/RevisorPpc.ts"), "revisao-ppc");
    assert.strictEqual(moduloDoCaminho("packages/contratos-app/src/modulos/revisao-ppc.ts"), "revisao-ppc");
    assert.strictEqual(moduloDoCaminho("packages/contratos-app/test/modulos/revisao-ppc.test.ts"), "revisao-ppc");
    assert.strictEqual(moduloDoCaminho("@simplifica-if/contratos-app/modulos/revisao-ppc"), "revisao-ppc");
    assert.strictEqual(moduloDoCaminho("apps/web/src/modulos/revisao-ppc"), "revisao-ppc");
    // a lista dos módulos do catálogo não é um módulo
    assert.isUndefined(moduloDoCaminho("packages/mcp/src/modulos.ts"));
    assert.isUndefined(moduloDoCaminho("@simplifica-if/mcp/modulos"));
    assert.isUndefined(violacaoDeFronteira("apps/web/src/tarefas/catalogo.ts", "@simplifica-if/mcp/modulos"));
    assert.isUndefined(violacaoDeFronteira("packages/mcp/src/tarefas.ts", "./modulos.ts"));
    assert.isNull(moduloDoImport("apps/web/src/inicializar.ts", "./modulos"));
    assert.isNull(moduloDoImport("apps/web/src/inicializar.ts", "./modulos/"));
    assert.strictEqual(moduloDoImport("apps/server/test/modulos/revisao-ppc/apoio.ts", "../../apoio.ts"), undefined);
    assert.strictEqual(
      moduloDoImport("apps/server/src/handlers.ts", "./modulos/revisao-ppc/handlers.ts"),
      "revisao-ppc",
    );
    assert.strictEqual(camadaDe("apps/server/src/servidor.ts"), "apps/server");
    assert.strictEqual(camadaDe("packages/contratos-app/src/ponte.ts"), "packages/contratos-app");
    assert.strictEqual(camadaDe("scripts/fabrica_atualizacao.ts"), "scripts");
    assert.isUndefined(violacaoDeFronteira("apps/server/src/handlers.ts", "./modulos/revisao-ppc/handlers.ts"));
    assert.isDefined(violacaoDeFronteira("apps/server/src/Conversas.ts", "./modulos/revisao-ppc/RevisaoIa.ts"));
  });

  it("os que importam e os que só citam são listas separadas", () => {
    assert.deepStrictEqual(
      ARQUIVOS_QUE_IMPORTAM.filter((arquivo) => ARQUIVOS_QUE_CITAM.includes(arquivo)),
      [],
    );
    for (const arquivo of ARQUIVOS_QUE_CITAM) {
      assert.isDefined(violacaoDeFronteira(arquivo, "./modulos/revisao-ppc/x.ts"), arquivo);
      assert.isDefined(violacaoDeFronteira(arquivo, "./modulos/revisao-ppc.ts"), arquivo);
    }
  });
});
