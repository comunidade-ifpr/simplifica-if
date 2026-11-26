// @effect-diagnostics nodeBuiltinImport:off -- teste: monta uma pasta de tarefas temporária
/**
 * O `CatalogoTarefas`: o que entra em `tarefas.listar` e o que fica de fora, e por quê (a
 * descontinuada, o módulo que o app não tem, a skill ausente, o app ou a base mais velhos que o mínimo
 * e a experimental fora do canal beta); o que as `Conversas` recebem de uma tarefa de conversa; e a
 * leitura da pasta, com o manifesto inválido no log.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Schema from "effect/Schema";
import { CatalogoTarefas as CatalogoTarefasContrato } from "@simplifica-if/contratos-app";
import type { SkillDoApp } from "@simplifica-if/mcp/skills";
import type { ManifestoTarefa } from "@simplifica-if/mcp/tarefas";
import * as CatalogoSkills from "../src/CatalogoSkills.ts";
import * as CatalogoTarefas from "../src/CatalogoTarefas.ts";
import { diretorioTemporario, limparTemporarios } from "./apoio.ts";

afterAll(limparTemporarios);

const ETAPAS = [{ id: "ler", rotulo: "Ler o documento" }];

/** A codificação de `tarefas.listar` para a interface. */
const codificarCatalogo = Schema.encodeSync(CatalogoTarefasContrato);

const SKILL: SkillDoApp = {
  nome: "skill-de-teste",
  descricao: "Use para testar.",
  instrucoes: "# Skill de teste",
  arquivos: [],
  manifesto: { ferramentas: [], arquivos: [], etapas: ETAPAS },
  pasta: "/nao/usada",
};

const tarefa = (
  id: string,
  abertura: ManifestoTarefa["abre"],
  extras: Partial<ManifestoTarefa> = {},
): ManifestoTarefa => ({
  id,
  titulo: `Tarefa ${id}`,
  resumo: "Uma tarefa de teste.",
  area: "ensino",
  situacao: "estavel",
  mantenedor: { nome: "Pessoa de Teste", github: "pessoa-de-teste" },
  abre: abertura,
  ...extras,
});

const LINK = { link: { url: "https://calendario.example.org/letivo", requer_login: true } } as const;
const MODULO = { modulo: "revisao-ppc" } as const;
const CONVERSA = {
  conversa: {
    skill: "skill-de-teste",
    pedido: "Confira {documento}.",
    entradas: [{ id: "documento", tipo: "arquivo", rotulo: "Documento" }],
    web: false,
  },
} as const;

const AMBIENTE: CatalogoTarefas.Ambiente = {
  etapasDasSkills: new Map([["skill-de-teste", ETAPAS]]),
  versaoApp: "0.3.0",
  versaoBase: "2026.11.20",
};

describe("catálogo de tarefas", () => {
  it("as três aberturas vão à interface, com as etapas da skill e os campos do cartão", () => {
    const { servico, deFora } = CatalogoTarefas.deManifestos(
      [
        tarefa("calendario", LINK, { publico: ["docente"], limites: "Não aprova o calendário.", autoria: "Comissão" }),
        tarefa("conferir", CONVERSA, { duracao_estimada: "10min" }),
        tarefa("pergunta", { conversa: { pedido: "Qual é o calendário?" } }),
        tarefa("revisar", MODULO, { situacao: "experimental" }),
      ],
      AMBIENTE,
    );
    assert.deepStrictEqual(deFora, []);
    const { tarefas, retiradas } = servico.listar("beta");
    assert.deepStrictEqual(retiradas, []);
    assert.deepStrictEqual(tarefas, [
      {
        id: "calendario",
        titulo: "Tarefa calendario",
        resumo: "Uma tarefa de teste.",
        area: "ensino",
        publico: ["docente"],
        situacao: "estavel",
        mantenedor: { nome: "Pessoa de Teste", github: "pessoa-de-teste" },
        limites: "Não aprova o calendário.",
        autoria: "Comissão",
        abre: { tipo: "link", url: "https://calendario.example.org/letivo", requerLogin: true },
      },
      {
        id: "conferir",
        titulo: "Tarefa conferir",
        resumo: "Uma tarefa de teste.",
        area: "ensino",
        publico: [],
        situacao: "estavel",
        mantenedor: { nome: "Pessoa de Teste", github: "pessoa-de-teste" },
        duracaoEstimada: "10min",
        abre: {
          tipo: "conversa",
          skill: "skill-de-teste",
          pedido: "Confira {documento}.",
          entradas: [{ id: "documento", tipo: "arquivo", rotulo: "Documento" }],
          etapas: ETAPAS,
        },
      },
      {
        id: "pergunta",
        titulo: "Tarefa pergunta",
        resumo: "Uma tarefa de teste.",
        area: "ensino",
        publico: [],
        situacao: "estavel",
        mantenedor: { nome: "Pessoa de Teste", github: "pessoa-de-teste" },
        abre: { tipo: "conversa", pedido: "Qual é o calendário?", entradas: [], etapas: [] },
      },
      {
        id: "revisar",
        titulo: "Tarefa revisar",
        resumo: "Uma tarefa de teste.",
        area: "ensino",
        publico: [],
        situacao: "experimental",
        mantenedor: { nome: "Pessoa de Teste", github: "pessoa-de-teste" },
        abre: { tipo: "modulo", modulo: "revisao-ppc" },
      },
    ]);
  });

  it.each([
    ["descontinuada", tarefa("x", MODULO, { situacao: "descontinuada" })],
    ["modulo-ausente", tarefa("x", { modulo: "modulo-do-futuro" })],
    ["skill-ausente", tarefa("x", { conversa: { skill: "skill-que-saiu", pedido: "Faça." } })],
    ["app-antigo", tarefa("x", MODULO, { app_minimo: "0.3.1" })],
    ["base-antiga", tarefa("x", MODULO, { base_minima: "2026.11.21" })],
  ] as const)("fica de fora: %s", (motivo, manifesto) => {
    assert.strictEqual(CatalogoTarefas.motivoDeFora(manifesto, AMBIENTE), motivo);
    const { servico, deFora } = CatalogoTarefas.deManifestos([manifesto, tarefa("fica", LINK)], AMBIENTE);
    assert.deepStrictEqual(deFora, [{ id: "x", motivo }]);
    const lista = servico.listar("beta");
    assert.deepStrictEqual(
      lista.tarefas.map((item) => item.id),
      ["fica"],
    );
    // A de fora ainda nomeia as conversas antigas dela, e não abre conversa nova.
    assert.deepStrictEqual(lista.retiradas, [{ id: "x", titulo: "Tarefa x" }]);
    assert.strictEqual(servico.titulo("x"), "Tarefa x");
    assert.strictEqual(servico.recusaDeConversa("x", "beta"), "indisponivel");
  });

  it("o mínimo que o app e a base atendem entra; sem versão conhecida, ou na base de desenvolvimento, não se confere", () => {
    const exigente = tarefa("x", MODULO, { app_minimo: "0.3.0", base_minima: "2026.11.20" });
    assert.isUndefined(CatalogoTarefas.motivoDeFora(exigente, AMBIENTE));
    const doFuturo = tarefa("x", MODULO, { app_minimo: "9.0.0", base_minima: "2099.01.01" });
    assert.isUndefined(CatalogoTarefas.motivoDeFora(doFuturo, { etapasDasSkills: new Map() }));
    assert.isUndefined(
      CatalogoTarefas.motivoDeFora(tarefa("x", MODULO, { base_minima: "2099.01.01" }), {
        ...AMBIENTE,
        versaoBase: "dev-20261126",
      }),
    );
  });

  it.each([
    // O schema recusa o mínimo malformado; se um chegar (ou a versão em uso sair do padrão), esconde.
    ["app_minimo fora do padrão", { app_minimo: "v0.9.0" }, AMBIENTE, "app-antigo"],
    ["versão do app fora do padrão", { app_minimo: "0.2.0" }, { ...AMBIENTE, versaoApp: "v0.9.0" }, "app-antigo"],
    ["base_minima fora do padrão", { base_minima: "base-nova" }, AMBIENTE, "base-antiga"],
    ["versão da base fora do padrão", { base_minima: "2026.11.01" }, { ...AMBIENTE, versaoBase: "?" }, "base-antiga"],
  ] as const)("versão que não se compara esconde a tarefa: %s", (_caso, extras, ambiente, motivo) => {
    assert.strictEqual(CatalogoTarefas.motivoDeFora(tarefa("x", MODULO, extras), ambiente), motivo);
  });

  it("skill com nome herdado de Object.prototype: não é do catálogo, e a lista segue codificável", () => {
    const herdadas = ["constructor", "toString", "hasOwnProperty", "valueOf"].map((skill, indice) =>
      tarefa(`herdada-${indice}`, { conversa: { skill, pedido: "Faça." } }),
    );
    const { servico, deFora } = CatalogoTarefas.deManifestos([...herdadas, tarefa("fica", CONVERSA)], AMBIENTE);
    assert.deepStrictEqual(
      deFora.map((fora) => fora.motivo),
      ["skill-ausente", "skill-ausente", "skill-ausente", "skill-ausente"],
    );
    const lista = servico.listar("beta");
    assert.deepStrictEqual(
      lista.tarefas.map((item) => item.id),
      ["fica"],
    );
    // O que `tarefas.listar` manda à interface passa no schema do contrato (nenhuma função em `etapas`).
    assert.deepStrictEqual(codificarCatalogo(lista), lista);
    assert.strictEqual(servico.recusaDeConversa("constructor", "beta"), "indisponivel");
    assert.strictEqual(servico.recusaDeConversa("herdada-0", "beta"), "indisponivel");
    // A conversa antiga de uma tarefa cuja skill não é do app segue sem skill.
    assert.deepStrictEqual(servico.regraDaSessao("herdada-0"), { skill: undefined, web: true });
    assert.isUndefined(servico.titulo("toString"));
  });

  it("experimental: só no canal beta; fora dele, só o título", () => {
    const { servico } = CatalogoTarefas.deManifestos(
      [tarefa("nova", CONVERSA, { situacao: "experimental" }), tarefa("pronta", MODULO)],
      AMBIENTE,
    );
    assert.deepStrictEqual(
      servico.listar("beta").tarefas.map((item) => item.id),
      ["nova", "pronta"],
    );
    const estavel = servico.listar("estavel");
    assert.deepStrictEqual(
      estavel.tarefas.map((item) => item.id),
      ["pronta"],
    );
    assert.deepStrictEqual(estavel.retiradas, [{ id: "nova", titulo: "Tarefa nova" }]);
    // A mesma regra para abrir conversa: a experimental só no beta; a regra da sessão não depende do canal.
    assert.isUndefined(servico.recusaDeConversa("nova", "beta"));
    assert.strictEqual(servico.recusaDeConversa("nova", "estavel"), "so-no-beta");
    assert.deepStrictEqual(servico.regraDaSessao("nova"), { skill: "skill-de-teste", web: false });
  });

  it("a regra da sessão: a skill e o web da tarefa de conversa; link e módulo não abrem conversa", () => {
    const { servico } = CatalogoTarefas.deManifestos(
      [
        tarefa("conferir", CONVERSA),
        tarefa("pergunta", { conversa: { pedido: "Qual?" } }),
        tarefa("calendario", LINK),
        tarefa("revisar", MODULO),
        tarefa("antiga", CONVERSA, { situacao: "descontinuada" }),
      ],
      AMBIENTE,
    );
    assert.deepStrictEqual(servico.regraDaSessao("conferir"), { skill: "skill-de-teste", web: false });
    assert.deepStrictEqual(servico.regraDaSessao("pergunta"), { skill: undefined, web: true });
    assert.deepStrictEqual(
      ["conferir", "pergunta", "calendario", "revisar", "inventada", "antiga"].map((id) =>
        servico.recusaDeConversa(id, "estavel"),
      ),
      [undefined, undefined, "indisponivel", "indisponivel", "indisponivel", "indisponivel"],
    );
    // A descontinuada não abre conversa nova, e a conversa que nasceu dela mantém a regra.
    assert.deepStrictEqual(servico.regraDaSessao("antiga"), { skill: "skill-de-teste", web: false });
    // Sem manifesto de conversa: nenhuma skill, e nada a desligar.
    assert.deepStrictEqual(servico.regraDaSessao("inventada"), { skill: undefined, web: true });
    assert.deepStrictEqual(servico.regraDaSessao("revisar"), { skill: undefined, web: true });
    assert.isUndefined(servico.titulo("inventada"));
  });
});

const manifestoYaml = (id: string, abertura: string) =>
  [
    `id: ${id}`,
    "titulo: Tarefa de teste",
    "resumo: Uma tarefa de teste.",
    "area: ensino",
    "situacao: estavel",
    "mantenedor: { nome: Pessoa de Teste, github: pessoa-de-teste }",
    `abre: ${abertura}`,
    "",
  ].join("\n");

/** Abre o catálogo sobre `pasta` (ou sobre o catálogo baixado), com a skill de teste, e devolve o serviço e os logs. */
const abrir = (pasta: string, baixado?: CatalogoTarefas.CatalogoBaixado) =>
  Effect.gen(function* () {
    const logs: Array<string> = [];
    const registrar = Logger.make<unknown, void>(({ logLevel, message }) => {
      logs.push(`${logLevel}: ${Array.isArray(message) ? message.join(" ") : String(message)}`);
    });
    const catalogo = yield* CatalogoTarefas.CatalogoTarefas.pipe(
      Effect.provide(
        CatalogoTarefas.layer(pasta, { versaoApp: "0.3.0", baixado }).pipe(
          Layer.provide(CatalogoSkills.layerFixo([SKILL])),
          Layer.provide(Layer.mergeAll(NodeServices.layer, Logger.layer([registrar]))),
        ),
      ),
    );
    return { catalogo, logs };
  });

describe("pasta de tarefas do servidor", () => {
  it.effect("lê os manifestos; o inválido e o que o app não atende vão ao log e não derrubam os outros", () =>
    Effect.gen(function* () {
      const raiz = diretorioTemporario("simplifica-catalogo-tarefas-");
      const escrever = (id: string, abertura: string) =>
        NodeFS.writeFileSync(NodePath.join(raiz, `${id}.yaml`), manifestoYaml(id, abertura));
      escrever("calendario", '{ link: { url: "https://calendario.example.org", requer_login: false } }');
      escrever("conferir", '{ conversa: { skill: skill-de-teste, pedido: "Confira." } }');
      escrever("link-inseguro", '{ link: { url: "http://calendario.example.org", requer_login: false } }');
      escrever("sem-skill-no-app", '{ conversa: { skill: skill-que-saiu, pedido: "Faça." } }');
      escrever("outro-modulo", "{ modulo: modulo-do-futuro }");

      const { catalogo, logs } = yield* abrir(raiz);
      const lista = catalogo.listar("estavel");
      assert.deepStrictEqual(
        lista.tarefas.map((item) => [item.id, item.abre.tipo]),
        [
          ["calendario", "link"],
          ["conferir", "conversa"],
        ],
      );
      assert.deepStrictEqual(
        lista.retiradas.map((item) => item.id),
        ["outro-modulo", "sem-skill-no-app"],
      );
      const erros = logs.filter((linha) => linha.startsWith("Error"));
      assert.strictEqual(erros.length, 1);
      assert.include(erros[0], "tarefa link-inseguro.yaml: manifesto inválido");
      assert.include(erros[0], "abre.link.url: o link de uma tarefa só pode ser https");
      assert.isTrue(logs.some((linha) => linha.includes("tarefa outro-modulo fora do catálogo: pede um módulo")));
      assert.isTrue(logs.some((linha) => linha.includes("tarefa sem-skill-no-app fora do catálogo: cita uma skill")));
      assert.isTrue(logs.some((linha) => linha.includes("tarefas do app") && linha.includes("calendario, conferir")));
    }),
  );

  it.effect("todas as tarefas de fora: o log diz isso, sem lista vazia", () =>
    Effect.gen(function* () {
      const raiz = diretorioTemporario("simplifica-catalogo-tarefas-");
      NodeFS.writeFileSync(NodePath.join(raiz, "a.yaml"), manifestoYaml("a", "{ modulo: modulo-do-futuro }"));
      NodeFS.writeFileSync(
        NodePath.join(raiz, "b.yaml"),
        manifestoYaml("b", '{ conversa: { skill: constructor, pedido: "Faça." } }'),
      );
      const { catalogo, logs } = yield* abrir(raiz);
      assert.deepStrictEqual(catalogo.listar("beta").tarefas, []);
      assert.isTrue(logs.some((linha) => linha.includes("tarefa b fora do catálogo: cita uma skill")));
      assert.isTrue(
        logs.some((linha) => linha.includes(`nenhuma tarefa do app em ${raiz}: as 2 lidas ficaram fora do catálogo`)),
      );
      assert.isFalse(logs.some((linha) => /tarefas do app \(.*\): *$/.test(linha)));

      const vazia = diretorioTemporario("simplifica-catalogo-tarefas-");
      assert.isTrue((yield* abrir(vazia)).logs.some((linha) => linha.includes(`nenhuma tarefa em ${vazia}`)));
    }),
  );

  it.effect("pasta que não existe: o catálogo não abre", () =>
    Effect.gen(function* () {
      const erro = yield* Effect.flip(abrir("/nao/existe/simplifica-tarefas"));
      assert.strictEqual(erro._tag, "PastaTarefasInvalida");
      assert.include(erro.message, "/nao/existe/simplifica-tarefas");
    }),
  );

  it.effect("catálogo baixado: entra no lugar da pasta inteira, no modo tolerante", () =>
    Effect.gen(function* () {
      const raiz = diretorioTemporario("simplifica-catalogo-tarefas-");
      NodeFS.writeFileSync(
        NodePath.join(raiz, "so-no-instalador.yaml"),
        manifestoYaml("so-no-instalador", "{ modulo: revisao-ppc }"),
      );
      NodeFS.writeFileSync(NodePath.join(raiz, "nas-duas.yaml"), manifestoYaml("nas-duas", "{ modulo: revisao-ppc }"));
      const doCanal = (id: string, abre: unknown, extras: object = {}) => ({
        id,
        titulo: `Tarefa ${id} (do canal)`,
        resumo: "Uma tarefa de teste.",
        area: "ensino",
        situacao: "estavel",
        mantenedor: { nome: "Pessoa de Teste", github: "pessoa-de-teste" },
        abre,
        ...extras,
      });
      const { catalogo, logs } = yield* abrir(raiz, {
        versao: "2026.11.26",
        tarefas: [
          doCanal("nas-duas", { modulo: "revisao-ppc" }, { campo_do_futuro: true }),
          doCanal("nova", { conversa: { skill: "skill-de-teste", pedido: "Confira." } }),
          doCanal("quebrada", { link: { url: "javascript:alert(1)", requer_login: false } }),
          doCanal("do-app-novo", { modulo: "revisao-ppc" }, { app_minimo: "9.0.0" }),
        ],
      });
      const lista = catalogo.listar("estavel");
      // A tarefa que só o instalador tinha some: o catálogo baixado não se mescla com o da pasta.
      assert.deepStrictEqual(
        lista.tarefas.map((item) => [item.id, item.titulo]),
        [
          ["nas-duas", "Tarefa nas-duas (do canal)"],
          ["nova", "Tarefa nova (do canal)"],
        ],
      );
      assert.isUndefined(catalogo.titulo("so-no-instalador"));
      assert.strictEqual(catalogo.recusaDeConversa("so-no-instalador", "beta"), "indisponivel");
      assert.deepStrictEqual(lista.retiradas, [{ id: "do-app-novo", titulo: "Tarefa do-app-novo (do canal)" }]);
      const erros = logs.filter((linha) => linha.startsWith("Error"));
      assert.strictEqual(erros.length, 1);
      assert.include(erros[0], "tarefa nº 3 do catálogo baixado: manifesto inválido");
      assert.isTrue(
        logs.some((linha) => linha.includes("tarefas do app (catálogo baixado 2026.11.26): nas-duas, nova")),
      );

      // Sem catálogo baixado (ou com o do instalador mais novo), vale a pasta.
      const daPasta = yield* abrir(raiz);
      assert.deepStrictEqual(
        daPasta.catalogo.listar("estavel").tarefas.map((item) => item.id),
        ["nas-duas", "so-no-instalador"],
      );
    }),
  );
});
