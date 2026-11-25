import { assert, describe, it } from "@effect/vitest";
import { ponteTeste } from "../../test/ponte.ts";
import { normalizarUrlServidor, resolverOrigem } from "./origem.ts";

const sem = { ponte: undefined, busca: "", sessao: null } as const;
const TOKEN = "um-token-de-teste-com-tamanho-suficiente";

describe("normalizarUrlServidor", () => {
  it("aceita a porta, o host com porta e a URL", () => {
    assert.strictEqual(normalizarUrlServidor("4321"), "http://127.0.0.1:4321");
    assert.strictEqual(normalizarUrlServidor("127.0.0.1:4321"), "http://127.0.0.1:4321");
    assert.strictEqual(normalizarUrlServidor(" http://localhost:4321/ "), "http://localhost:4321");
  });

  it("recusa o vazio e o que não é HTTP", () => {
    assert.isUndefined(normalizarUrlServidor(""));
    assert.isUndefined(normalizarUrlServidor("ws://127.0.0.1:1"));
    assert.isUndefined(normalizarUrlServidor("http://"));
  });
});

describe("resolverOrigem", () => {
  it("no desktop, usa a ponte mesmo com parâmetros na URL", () => {
    const ponte = ponteTeste({ conexao: async () => ({ urlServidor: "http://127.0.0.1:1", token: TOKEN }) });
    const { origem } = resolverOrigem({ ...sem, ponte, busca: `?servidor=2&token=${TOKEN}` });
    assert.strictEqual(origem.tipo, "desktop");
  });

  it("no navegador, lê ?servidor=…&token=…, guarda e tira da URL", () => {
    const resolvida = resolverOrigem({ ...sem, busca: `?servidor=4321&token=${TOKEN}&outro=1` });
    assert.deepStrictEqual(resolvida.origem, {
      tipo: "navegador",
      credenciais: { urlServidor: "http://127.0.0.1:4321", token: TOKEN },
    });
    assert.deepStrictEqual(resolvida.guardar, { urlServidor: "http://127.0.0.1:4321", token: TOKEN });
    assert.strictEqual(resolvida.buscaLimpa, "?outro=1");
  });

  it("sem parâmetros, usa o sessionStorage", () => {
    const sessao = JSON.stringify({ urlServidor: "http://127.0.0.1:5", token: TOKEN });
    const daSessao = resolverOrigem({ ...sem, sessao });
    assert.deepStrictEqual(daSessao.origem, {
      tipo: "navegador",
      credenciais: { urlServidor: "http://127.0.0.1:5", token: TOKEN },
    });
    assert.isUndefined(daSessao.buscaLimpa);
  });

  it("sem nada válido, a origem é ausente; parâmetros incompletos também saem da URL", () => {
    assert.deepStrictEqual(resolverOrigem(sem).origem, { tipo: "ausente" });
    const incompleta = resolverOrigem({ ...sem, busca: "?token=só-o-token", sessao: "{quebrado" });
    assert.deepStrictEqual(incompleta.origem, { tipo: "ausente" });
    assert.strictEqual(incompleta.buscaLimpa, "");
  });
});
