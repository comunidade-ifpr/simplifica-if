// @effect-diagnostics nodeBuiltinImport:off -- teste: monta pastas de tarefas temporárias
/**
 * O manifesto de tarefa (`@simplifica-if/mcp/tarefas`): as três aberturas, as regras do link, as versões
 * mínimas, as mensagens de erro, a conferência da skill e do módulo citados e a leitura de uma pasta. Os
 * manifestos reais do checkout também passam, sem campo desconhecido, e citam skill e módulo que existem.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { YAMLParseError } from "yaml";
import { ehModulo } from "../src/modulos.ts";
import { marcadoresDoPedido } from "../src/pedido.ts";
import { lerPastaSkills } from "../src/skills.ts";
import {
  aberturaDe,
  conferirAbertura,
  lerManifestoTarefa,
  lerPastaTarefas,
  lerTarefasDoCanal,
  tarefasParaOCanal,
} from "../src/tarefas.ts";
import { diretorioTemporario, limparTemporarios } from "./fixture.ts";

afterAll(limparTemporarios);

const RAIZ = NodePath.resolve(import.meta.dirname, "../../..");

/** Um manifesto de `id` dado, com a abertura (YAML já indentado em dois espaços) e linhas a mais. */
const manifesto = (id: string, abertura: string, extras: ReadonlyArray<string> = []) =>
  [
    `id: ${id}`,
    "titulo: Tarefa de teste",
    "resumo: Uma tarefa de teste.",
    "area: ensino",
    "situacao: estavel",
    "mantenedor: { nome: Pessoa de Teste, github: pessoa-de-teste }",
    ...extras,
    "abre:",
    abertura,
    "",
  ].join("\n");

const LINK = '  link: { url: "https://calendario.example.org/letivo", requer_login: true }';
const CONVERSA = [
  "  conversa:",
  "    skill: skill-de-teste",
  '    pedido: "Confira {documento} do curso {curso}."',
  "    entradas:",
  '      - { id: documento, tipo: arquivo, aceita: [.docx], rotulo: "Documento" }',
  '      - { id: curso, tipo: curso, rotulo: "Curso", opcional: true }',
].join("\n");
const MODULO = "  modulo: revisao-ppc";

const ler = (texto: string, id = "x") => lerManifestoTarefa(texto, `${id}.yaml`);
const erroDe = (texto: string, id = "x") =>
  ler(texto, id).pipe(
    Effect.flip,
    Effect.map((erro) => erro.detalhe),
  );

describe("manifesto da tarefa", () => {
  it.effect("as três aberturas", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(aberturaDe(yield* ler(manifesto("x", LINK))), {
        tipo: "link",
        url: "https://calendario.example.org/letivo",
        requerLogin: true,
      });
      assert.deepStrictEqual(aberturaDe(yield* ler(manifesto("x", MODULO))), { tipo: "modulo", modulo: "revisao-ppc" });
      assert.deepStrictEqual(aberturaDe(yield* ler(manifesto("x", CONVERSA))), {
        tipo: "conversa",
        skill: "skill-de-teste",
        pedido: "Confira {documento} do curso {curso}.",
        entradas: [
          { id: "documento", tipo: "arquivo", aceita: [".docx"], rotulo: "Documento" },
          { id: "curso", tipo: "curso", rotulo: "Curso", opcional: true },
        ],
        web: true,
      });
    }),
  );

  it.effect("conversa sem skill e com a web desligada; módulo que este app não conhece passa no schema", () =>
    Effect.gen(function* () {
      const semSkill = yield* ler(manifesto("x", '  conversa: { pedido: "Qual é o calendário?", web: false }'));
      assert.deepStrictEqual(aberturaDe(semSkill), {
        tipo: "conversa",
        skill: undefined,
        pedido: "Qual é o calendário?",
        entradas: [],
        web: false,
      });
      // Quem tem a lista de módulos (o servidor, o validar_base) é que decide.
      const outro = aberturaDe(yield* ler(manifesto("x", "  modulo: modulo-do-futuro")));
      assert.deepStrictEqual(outro, { tipo: "modulo", modulo: "modulo-do-futuro" });
      assert.isFalse(ehModulo("modulo-do-futuro"));
      assert.isTrue(ehModulo("revisao-ppc"));
    }),
  );

  it.effect("os campos opcionais do cartão", () =>
    Effect.gen(function* () {
      const lido = yield* ler(
        manifesto("x", MODULO, [
          "publico: [proens, coordenacao-curso]",
          "limites: Não substitui a aprovação do colegiado.",
          "autoria: Comissão de teste",
          "duracao_estimada: 20min",
          "app_minimo: 0.3.0",
          "base_minima: 2026.11.01",
        ]),
      );
      assert.deepStrictEqual(lido.publico, ["proens", "coordenacao-curso"]);
      assert.strictEqual(lido.limites, "Não substitui a aprovação do colegiado.");
      assert.strictEqual(lido.autoria, "Comissão de teste");
      assert.strictEqual(lido.duracao_estimada, "20min");
      assert.strictEqual(lido.app_minimo, "0.3.0");
      assert.strictEqual(lido.base_minima, "2026.11.01");
    }),
  );

  it.effect.each([
    ['  link: { url: "http://calendario.example.org", requer_login: false }', "só pode ser https"],
    ['  link: { url: "mailto:alguem@example.org", requer_login: false }', "só pode ser https"],
    ['  link: { url: "calendario.example.org", requer_login: false }', "esperava uma URL completa"],
    ['  link: { url: "https://pessoa:senha@example.org", requer_login: false }', "usuário nem senha"],
  ] as const)("link recusado: %s", ([abertura, mensagem]) =>
    Effect.gen(function* () {
      const detalhe = yield* erroDe(manifesto("x", abertura));
      assert.include(detalhe, "abre.link.url");
      assert.include(detalhe, mensagem);
    }),
  );

  it.effect("link sem requer_login", () =>
    Effect.gen(function* () {
      const detalhe = yield* erroDe(manifesto("x", '  link: { url: "https://example.org" }'));
      assert.include(detalhe, "abre.link.requer_login");
    }),
  );

  it.effect("abre: exatamente uma de link, conversa, modulo", () =>
    Effect.gen(function* () {
      const duas = yield* erroDe(manifesto("x", `${LINK}\n${MODULO}`));
      assert.include(duas, "abre: esperava exatamente uma de link, conversa, modulo (veio link, modulo)");
      const nenhuma = yield* erroDe(manifesto("x", "  {}"));
      assert.include(nenhuma, "esperava exatamente uma de link, conversa, modulo (veio nenhuma)");
    }),
  );

  it.effect.each([
    ["app_minimo: v0.9.0", "app_minimo: esperava X.Y.Z"],
    ["app_minimo: '0.9'", "app_minimo: esperava X.Y.Z"],
    ["app_minimo: 0.9.0-beta.1", "app_minimo: esperava X.Y.Z"],
    ["base_minima: 2026-11-30", "base_minima: esperava AAAA.MM.DD"],
    ["base_minima: '2026.11'", "base_minima: esperava AAAA.MM.DD"],
    ["base_minima: '30.11.2026'", "base_minima: esperava AAAA.MM.DD"],
  ] as const)("versão mínima malformada é recusada: %s", ([linha, mensagem]) =>
    Effect.gen(function* () {
      assert.include(yield* erroDe(manifesto("x", MODULO, [linha])), mensagem);
    }),
  );

  it.effect("a base mínima aceita o sufixo de mais de uma versão no dia", () =>
    Effect.gen(function* () {
      assert.strictEqual(
        (yield* ler(manifesto("x", MODULO, ["base_minima: 2026.11.30.2"]))).base_minima,
        "2026.11.30.2",
      );
    }),
  );

  it.effect("YAML ilegível: o detalhe em português, com a posição, e o erro do parser em cause", () =>
    Effect.gen(function* () {
      const erro = yield* Effect.flip(ler("id: x\ntitulo: [aberto"));
      assert.match(erro.detalhe, /^não é YAML válido \(linha \d+, coluna \d+\)$/);
      assert.instanceOf(erro.cause, YAMLParseError);
      // A mensagem do parser, em inglês, não vai para o detalhe.
      assert.notInclude(erro.message, (erro.cause as YAMLParseError).message);
    }),
  );

  it.effect("a skill e o módulo citados: a regra que o servidor, o validar_base e o build usam", () =>
    Effect.gen(function* () {
      const skills = new Set(["skill-de-teste"]);
      assert.deepStrictEqual(conferirAbertura(yield* ler(manifesto("x", MODULO)), skills), {
        conferida: { tipo: "modulo", modulo: "revisao-ppc" },
      });
      assert.deepStrictEqual(conferirAbertura(yield* ler(manifesto("x", "  modulo: modulo-do-futuro")), skills), {
        ausente: { tipo: "modulo", nome: "modulo-do-futuro" },
      });
      assert.strictEqual(conferirAbertura(yield* ler(manifesto("x", CONVERSA)), skills).conferida?.tipo, "conversa");
      assert.deepStrictEqual(conferirAbertura(yield* ler(manifesto("x", CONVERSA)), new Set()), {
        ausente: { tipo: "skill", nome: "skill-de-teste" },
      });
      // Sem skill e de link, nada a conferir.
      const semSkill = yield* ler(manifesto("x", '  conversa: { pedido: "Qual?" }'));
      assert.isUndefined(conferirAbertura(semSkill, new Set()).ausente);
      assert.isUndefined(conferirAbertura(yield* ler(manifesto("x", LINK)), new Set()).ausente);
      // Um nome herdado de `Object.prototype` não é skill do app.
      const herdada = yield* ler(manifesto("x", '  conversa: { skill: constructor, pedido: "Faça." }'));
      assert.deepStrictEqual(conferirAbertura(herdada, new Map<string, unknown>()), {
        ausente: { tipo: "skill", nome: "constructor" },
      });
    }),
  );

  it.effect("o id é o nome do arquivo", () =>
    Effect.gen(function* () {
      const trocado = yield* erroDe(manifesto("outro-nome", MODULO), "x");
      assert.strictEqual(trocado, 'id "outro-nome" difere do nome do arquivo (esperava outro-nome.yaml)');
      assert.include(yield* erroDe(manifesto("Com Espaço", MODULO)), "id: esperava letras minúsculas, dígitos e hífen");
    }),
  );

  it.effect("o pedido só cita entradas que existem, e nenhuma entrada se repete", () =>
    Effect.gen(function* () {
      const semEntrada = yield* erroDe(manifesto("x", '  conversa: { pedido: "Confira {documento} e {curso}." }'));
      assert.include(semEntrada, "abre.conversa: o pedido cita {documento}, {curso}, que não está em entradas");
      const repetida = yield* erroDe(
        manifesto(
          "x",
          [
            "  conversa:",
            '    pedido: "Confira {a}."',
            "    entradas:",
            "      - { id: a, tipo: texto, rotulo: A }",
            "      - { id: a, tipo: texto, rotulo: De novo }",
          ].join("\n"),
        ),
      );
      assert.include(repetida, 'a entrada "a" aparece mais de uma vez');
      assert.deepStrictEqual(marcadoresDoPedido("De {a} a {b}, e {a} outra vez."), ["a", "b"]);
    }),
  );

  it.effect("todos os problemas de uma vez, cada um com o caminho do campo", () =>
    Effect.gen(function* () {
      const detalhe = yield* erroDe(
        [
          "id: x",
          "titulo: Tarefa",
          "area: Ensino",
          "situacao: pronta",
          "mantenedor: { nome: Pessoa, github: '@pessoa' }",
          "publico: [coordenacao]",
          "abre:",
          MODULO,
        ].join("\n"),
      );
      assert.include(detalhe, "manifesto inválido");
      for (const campo of ["resumo", "area", "situacao", "mantenedor.github", "publico.0"]) {
        assert.match(detalhe, new RegExp(`^  ${campo.replace(".", "\\.")}: `, "m"), campo);
      }
      assert.include(detalhe, "esperava um usuário do GitHub, sem @");
      assert.include(detalhe, "experimental");
      assert.include(yield* erroDe("id: [x"), "não é YAML válido");
      // Sem mantenedor a tarefa não entra.
      assert.include(yield* erroDe(manifesto("x", MODULO).replace(/^mantenedor:.*\n/m, "")), "mantenedor");
    }),
  );

  it.effect("campo desconhecido: passa na leitura do servidor, não na estrita do validar_base", () =>
    Effect.gen(function* () {
      const texto = manifesto("x", MODULO, ["palavras_chave: [ppc]"]);
      assert.strictEqual((yield* ler(texto)).id, "x");
      const detalhe = yield* lerManifestoTarefa(texto, "x.yaml", { estrito: true }).pipe(
        Effect.flip,
        Effect.map((erro) => erro.detalhe),
      );
      assert.include(detalhe, "palavras_chave");
    }),
  );
});

describe("pasta de tarefas", () => {
  it.effect("lê os .yaml em ordem do id e separa os inválidos", () =>
    Effect.gen(function* () {
      const raiz = diretorioTemporario("simplifica-tarefas-");
      NodeFS.writeFileSync(NodePath.join(raiz, "revisar.yaml"), manifesto("revisar", MODULO));
      NodeFS.writeFileSync(NodePath.join(raiz, "calendario.yaml"), manifesto("calendario", LINK));
      NodeFS.writeFileSync(NodePath.join(raiz, "nome-trocado.yaml"), manifesto("outro", MODULO));
      NodeFS.writeFileSync(NodePath.join(raiz, "LEIA-ME.md"), "não é manifesto");
      const pasta = yield* lerPastaTarefas(raiz);
      assert.deepStrictEqual(
        pasta.tarefas.map((tarefa) => tarefa.id),
        ["calendario", "revisar"],
      );
      assert.deepStrictEqual(
        pasta.invalidas.map((erro) => erro.message),
        ['tarefa nome-trocado.yaml: id "outro" difere do nome do arquivo (esperava outro.yaml)'],
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "o catálogo pelo canal: vai e volta inteiro; o inválido e o repetido ficam de fora, sem derrubar os outros",
    () =>
      Effect.gen(function* () {
        const raiz = diretorioTemporario("simplifica-tarefas-");
        NodeFS.writeFileSync(NodePath.join(raiz, "revisar.yaml"), manifesto("revisar", MODULO));
        NodeFS.writeFileSync(NodePath.join(raiz, "conferir.yaml"), manifesto("conferir", CONVERSA));
        NodeFS.writeFileSync(NodePath.join(raiz, "calendario.yaml"), manifesto("calendario", LINK));
        const pasta = yield* lerPastaTarefas(raiz, { estrito: true });
        // O que a fábrica põe no manifesto do canal, depois de passar pelo JSON, é o que o servidor lê.
        const noCanal = JSON.parse(JSON.stringify(tarefasParaOCanal(pasta.tarefas))) as ReadonlyArray<
          Record<string, unknown>
        >;
        assert.deepStrictEqual(lerTarefasDoCanal(noCanal), { tarefas: pasta.tarefas, invalidas: [] });

        const lida = lerTarefasDoCanal([
          noCanal[2],
          // Um campo que este app não conhece (de um catálogo mais novo) é ignorado.
          { ...noCanal[0], palavras_chave: ["calendário"] },
          { ...noCanal[1], abre: { link: { url: "http://inseguro.example.org", requer_login: false } } },
          noCanal[2],
          "não é tarefa",
          { ...noCanal[1], id: "../../fora" },
        ]);
        assert.deepStrictEqual(
          lida.tarefas.map((tarefa) => tarefa.id),
          ["calendario", "revisar"],
        );
        assert.deepStrictEqual(lida.tarefas[0], pasta.tarefas[0]);
        assert.strictEqual(lida.invalidas.length, 4);
        assert.include(lida.invalidas[0]?.message, "tarefa nº 3 do catálogo baixado: manifesto inválido");
        assert.include(lida.invalidas[0]?.message, "abre.link.url: o link de uma tarefa só pode ser https");
        assert.strictEqual(
          lida.invalidas[1]?.message,
          'tarefa nº 4 do catálogo baixado: id "revisar" repetido no catálogo',
        );
        assert.include(lida.invalidas[2]?.message, "tarefa nº 5 do catálogo baixado");
        // O id é só um identificador: o que não é slug não entra.
        assert.include(lida.invalidas[3]?.message, "tarefa nº 6 do catálogo baixado");
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("as tarefas do checkout: válidas, sem campo desconhecido, com skill e módulo que existem", () =>
    Effect.gen(function* () {
      const pasta = yield* lerPastaTarefas(NodePath.join(RAIZ, "catalogo", "tarefas"), { estrito: true });
      assert.deepStrictEqual(pasta.invalidas, []);
      assert.includeMembers(
        pasta.tarefas.map((tarefa) => tarefa.id),
        ["conferir-fundamentacao-normativa", "revisar-ppc"],
      );
      const skills = (yield* lerPastaSkills(NodePath.join(RAIZ, "catalogo", "skills"))).skills.map(
        (skill) => skill.nome,
      );
      for (const tarefa of pasta.tarefas) {
        assert.isUndefined(conferirAbertura(tarefa, new Set(skills)).ausente, tarefa.id);
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
