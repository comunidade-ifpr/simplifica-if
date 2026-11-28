import type { Continuidade, PainelGuardado } from "@simplifica-if/contratos-app";
import { assert, describe, it } from "@effect/vitest";
import { MAXIMO_TEXTO_CONTINUIDADE } from "@simplifica-if/contratos-app";
import { type ConferenciaModulo, conferirContinuidade, continuidadeQueCabe, rotaParaGuardar } from "./conferir.ts";

const PAINEL: PainelGuardado = {
  aberto: true,
  aba: "ler",
  trilha: { links: ["ifpr://norma/a", "ifpr://revisao-ppc/apagada/1#p-2", "ifpr://norma/b"], posicao: 1 },
  marcados: ["ifpr://revisao-ppc/apagada/1", "ifpr://revisao-ppc/viva/1", "ifpr://norma/a"],
  abertos: ["ifpr://norma/a", "ifpr://revisao-ppc/apagada/1#p-2", "ifpr://norma/b"],
  preso: true,
  conversa: { id: "c1", origem: { chave: "revisao-ppc:apagada", ia: "claude" } },
};

/** A revisão de mentira: só a `viva` existe. */
const REVISAO: ConferenciaModulo = {
  rota: (pathname, busca) =>
    pathname === "/revisao-ppc" && typeof busca.id === "string" ? busca.id === "viva" : undefined,
  link: (link) => (link.startsWith("ifpr://revisao-ppc/") ? link.startsWith("ifpr://revisao-ppc/viva/") : undefined),
  origem: (chave) => (chave.startsWith("revisao-ppc:") ? chave === "revisao-ppc:viva" : undefined),
  aviso: "Esta revisão foi apagada",
};

const conferir = (rota: string, painel: PainelGuardado = PAINEL, conversas = ["c1", "c2"]) =>
  conferirContinuidade({ rota, painel } satisfies Continuidade, {
    conversas: new Set(conversas),
    modulos: [REVISAO],
  });

describe("o que volta ao reabrir", () => {
  it("o Início, o Explorar, a conversa e a revisão que existem; o resto vai ao Início", () => {
    assert.strictEqual(conferir("/").rota, "/");
    assert.strictEqual(
      conferir("/explorar/ver?link=ifpr%3A%2F%2Fnorma%2Fa").rota,
      "/explorar/ver?link=ifpr%3A%2F%2Fnorma%2Fa",
    );
    assert.strictEqual(conferir("/conversa?id=c2").rota, "/conversa?id=c2");
    assert.strictEqual(conferir("/conversa?id=sumiu").rota, "/");
    assert.strictEqual(conferir("/conversa").rota, "/");
    assert.strictEqual(conferir("/revisao-ppc?id=viva").rota, "/revisao-ppc?id=viva");
    assert.strictEqual(conferir("/revisao-ppc").rota, "/");
    assert.strictEqual(conferir("/tarefa/revisar-ppc").rota, "/");
    assert.strictEqual(conferir("/configuracoes").rota, "/");
  });

  it("nunca o compacto=1", () => {
    assert.strictEqual(conferir("/revisao-ppc?id=viva&compacto=1").rota, "/revisao-ppc?id=viva");
    assert.strictEqual(rotaParaGuardar("/revisao-ppc", { id: "viva", compacto: 1 }), "/revisao-ppc?id=viva");
  });

  it("a revisão apagada sai da rota, da trilha, dos marcados e da origem da conversa, com o aviso dela", () => {
    const conferida = conferir("/revisao-ppc?id=apagada");
    assert.strictEqual(conferida.rota, "/");
    assert.deepStrictEqual(conferida.avisos, ["Esta revisão foi apagada"]);
    assert.deepStrictEqual(conferida.painel.trilha, { links: ["ifpr://norma/a", "ifpr://norma/b"], posicao: 0 });
    assert.deepStrictEqual(conferida.painel.marcados, ["ifpr://revisao-ppc/viva/1", "ifpr://norma/a"]);
    assert.deepStrictEqual(conferida.painel.abertos, ["ifpr://norma/a", "ifpr://norma/b"]);
    // a conversa segue, como livre
    assert.deepStrictEqual(conferida.painel.conversa, { id: "c1" });
    // o Ler mostrava o PPC apagado: o painel volta recolhido
    assert.isFalse(conferida.painel.aberto);
    assert.isTrue(conferida.painel.preso);
  });

  it("sem nada apagado, tudo volta, sem aviso; a conversa apagada sai do painel", () => {
    const painel: PainelGuardado = {
      ...PAINEL,
      trilha: { links: ["ifpr://norma/a", "ifpr://revisao-ppc/viva/1"], posicao: 1 },
      marcados: ["ifpr://norma/a"],
      abertos: ["ifpr://norma/a", "ifpr://revisao-ppc/viva/1"],
      conversa: { id: "c1", origem: { chave: "revisao-ppc:viva" } },
    };
    const conferida = conferir("/explorar", painel);
    assert.deepStrictEqual(conferida, { rota: "/explorar", painel, avisos: [] });
    assert.isUndefined(conferir("/", painel, ["c2"]).painel.conversa);
  });

  it("o documento do Explorar volta se o link fica: o PPC da revisão apagada vai ao Início, com o aviso", () => {
    const ver = (link: string) => `/explorar/ver?link=${encodeURIComponent(link)}`;
    const apagada = conferir(ver("ifpr://revisao-ppc/apagada/1"));
    assert.strictEqual(apagada.rota, "/");
    assert.deepStrictEqual(apagada.avisos, ["Esta revisão foi apagada"]);
    assert.strictEqual(conferir(ver("ifpr://revisao-ppc/viva/1")).rota, ver("ifpr://revisao-ppc/viva/1"));
    assert.strictEqual(conferir(ver("ifpr://norma/a")).rota, ver("ifpr://norma/a"));
  });
});

describe("o que se grava cabe nas preferências", () => {
  const longo = `ifpr://norma/${"x".repeat(MAXIMO_TEXTO_CONTINUIDADE)}`;

  it("o que cabe grava como está", () => {
    const continuidade: Continuidade = { rota: "/explorar", painel: PAINEL };
    assert.strictEqual(continuidadeQueCabe(continuidade), continuidade);
  });

  it("a rota longa demais grava o Início; o link longo demais sai da trilha e dos marcados", () => {
    const painel: PainelGuardado = {
      ...PAINEL,
      trilha: { links: ["ifpr://norma/a", longo, "ifpr://norma/b"], posicao: 1 },
      marcados: [longo, "ifpr://norma/a"],
      abertos: ["ifpr://norma/a", longo, "ifpr://norma/b"],
    };
    const cabe = continuidadeQueCabe({ rota: `/explorar/buscar?q=${"y".repeat(MAXIMO_TEXTO_CONTINUIDADE)}`, painel });
    assert.strictEqual(cabe.rota, "/");
    assert.deepStrictEqual(cabe.painel.trilha, { links: ["ifpr://norma/a", "ifpr://norma/b"], posicao: 0 });
    assert.deepStrictEqual(cabe.painel.marcados, ["ifpr://norma/a"]);
    assert.deepStrictEqual(cabe.painel.abertos, ["ifpr://norma/a", "ifpr://norma/b"]);
    assert.isTrue(cabe.painel.preso);
  });
});
