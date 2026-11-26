// @effect-diagnostics nodeBuiltinImport:off -- teste: monta pastas de skills temporárias
/**
 * O manifesto das skills do app (`@simplifica-if/mcp/skills`): o bloco `simplifica:` do `SKILL.md`,
 * as ferramentas conferidas contra o Toolkit, os arquivos listados e a leitura de uma pasta de skills
 * (as do app, as que ficam no repositório e as inválidas). As skills reais do checkout também passam.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { FERRAMENTAS } from "../src/ferramentas/toolkit.ts";
import { lerPastaSkills, lerSkillMd, NOMES_FERRAMENTAS } from "../src/skills.ts";
import { diretorioTemporario, limparTemporarios } from "./fixture.ts";

afterAll(limparTemporarios);

const RAIZ = NodePath.resolve(import.meta.dirname, "../../..");

/** Um `SKILL.md` com o bloco dado (YAML já indentado em dois espaços). */
const skillMd = (nome: string, bloco?: string) =>
  [
    "---",
    `name: ${nome}`,
    "description: Uma skill de teste.",
    ...(bloco === undefined ? [] : ["simplifica:", bloco]),
    "---",
    "",
    `# ${nome}`,
    "",
    "Corpo da skill.",
    "",
  ].join("\n");

const BLOCO_VALIDO = ["  ferramentas: [buscar_norma, ler_dispositivos]", "  arquivos: [referencias/a.md]"].join("\n");

/** Cria `<raiz>/<nome>/SKILL.md` e os arquivos dados. */
const criarSkill = (raiz: string, nome: string, textoSkill: string, arquivos: Record<string, string> = {}) => {
  const pasta = NodePath.join(raiz, nome);
  NodeFS.mkdirSync(pasta, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(pasta, "SKILL.md"), textoSkill);
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(pasta, caminho)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(pasta, caminho), conteudo);
  }
};

const erroDe = (textoSkill: string) =>
  lerSkillMd(textoSkill, "x").pipe(
    Effect.flip,
    Effect.map((erro) => erro.detalhe),
  );

describe("manifesto da skill", () => {
  it("as ferramentas aceitas são as do Toolkit do simplifica-mcp", () => {
    assert.deepStrictEqual(
      NOMES_FERRAMENTAS,
      FERRAMENTAS.map((ferramenta) => ferramenta.nome),
    );
    assert.include(NOMES_FERRAMENTAS, "buscar_norma");
  });

  it.effect("sem bloco simplifica:, a skill não é do app", () =>
    Effect.gen(function* () {
      const lida = yield* lerSkillMd(skillMd("x"), "x");
      assert.isUndefined(lida.manifesto);
      assert.strictEqual(lida.nome, "x");
      assert.strictEqual(lida.corpo, "# x\n\nCorpo da skill.");
    }),
  );

  it.effect("bloco válido: só o que é da skill; o cartão é da tarefa", () =>
    Effect.gen(function* () {
      const bloco = [
        BLOCO_VALIDO,
        "  etapas:",
        '    - { id: fichas, rotulo: "Verificar as fichas", progresso: true }',
        "  versao: 0.3.0",
        "  base_minima: 2026.11.01",
        "  app_minimo: 0.1.0",
      ].join("\n");
      const lida = yield* lerSkillMd(skillMd("x", bloco), "x");
      assert.deepStrictEqual(lida.manifesto, {
        ferramentas: ["buscar_norma", "ler_dispositivos"],
        arquivos: ["referencias/a.md"],
        etapas: [{ id: "fichas", rotulo: "Verificar as fichas", progresso: true }],
        versao: "0.3.0",
        base_minima: "2026.11.01",
        app_minimo: "0.1.0",
      });
    }),
  );

  it.effect.each([
    ["  app_minimo: v0.9.0", "simplifica.app_minimo: esperava X.Y.Z"],
    ['  versao: "1.0"', "simplifica.versao: esperava X.Y.Z"],
    ["  versao: 1.0.0-beta", "simplifica.versao: esperava X.Y.Z"],
    ["  base_minima: 2026-11-30", "simplifica.base_minima: esperava AAAA.MM.DD"],
  ] as const)("versão mínima malformada é recusada: %s", ([linha, mensagem]) =>
    Effect.gen(function* () {
      assert.include(yield* erroDe(skillMd("x", `${BLOCO_VALIDO}\n${linha}`)), mensagem);
    }),
  );

  it.effect.each(["titulo", "resumo", "area", "publico", "entradas", "duracao_estimada", "donos"] as const)(
    "campo antigo do cartão (%s): passa na leitura do servidor, não na estrita do validar_base e do build",
    (campo) =>
      Effect.gen(function* () {
        const texto = skillMd("x", `${BLOCO_VALIDO}\n  ${campo}: [x]`);
        assert.isDefined((yield* lerSkillMd(texto, "x")).manifesto);
        const detalhe = yield* lerSkillMd(texto, "x", { estrito: true }).pipe(
          Effect.flip,
          Effect.map((erro) => erro.detalhe),
        );
        assert.include(detalhe, "bloco simplifica: inválido");
        assert.include(detalhe, `simplifica.${campo}`);
      }),
  );

  it.effect("ferramenta que não existe no simplifica-mcp", () =>
    Effect.gen(function* () {
      const detalhe = yield* erroDe(skillMd("x", BLOCO_VALIDO.replace("ler_dispositivos", "kb.ppc_fatos")));
      assert.include(detalhe, "simplifica.ferramentas.1");
      assert.include(detalhe, '"kb.ppc_fatos" não é ferramenta do simplifica-mcp');
    }),
  );

  it.effect("campos obrigatórios faltando e etapa com id fora do padrão", () =>
    Effect.gen(function* () {
      const detalhe = yield* erroDe(skillMd("x", "  versao: 0.1.0\n  etapas: [{ id: Ler Tudo, rotulo: Ler }]"));
      assert.include(detalhe, "bloco simplifica: inválido");
      assert.include(detalhe, "simplifica.etapas.0.id");
      assert.include(detalhe, "simplifica.ferramentas");
      assert.include(detalhe, "simplifica.arquivos");
    }),
  );

  it.effect("arquivos: scripts/, tests/, SKILL.md e caminhos que saem da pasta", () =>
    Effect.gen(function* () {
      for (const [caminho, mensagem] of [
        ["scripts/gerar.ts", "scripts/ não vai para o app"],
        ["tests/a.test.ts", "tests/ não vai para o app"],
        ["SKILL.md", "o SKILL.md vai sempre"],
        ["../fora.md", "partes vazias, . ou .."],
        ["/etc/passwd", "caminho relativo"],
      ] as const) {
        const detalhe = yield* erroDe(skillMd("x", BLOCO_VALIDO.replace("referencias/a.md", caminho)));
        assert.include(detalhe, mensagem, caminho);
      }
    }),
  );

  it.effect("SKILL.md sem front matter ou com name inválido", () =>
    Effect.gen(function* () {
      assert.include(yield* erroDe("# sem front matter\n"), "não começa com front matter");
      assert.include(yield* erroDe(skillMd("Nome Errado", BLOCO_VALIDO)), "name");
    }),
  );
});

describe("pasta de skills", () => {
  it.effect("separa as do app, as do repositório e as inválidas; lê só os arquivos listados", () =>
    Effect.gen(function* () {
      const raiz = diretorioTemporario("simplifica-skills-");
      criarSkill(raiz, "do-app", skillMd("do-app", BLOCO_VALIDO), {
        "referencias/a.md": "referência A",
        "scripts/x.ts": "// fica de fora",
      });
      criarSkill(raiz, "do-repositorio", skillMd("do-repositorio"));
      criarSkill(raiz, "falta-arquivo", skillMd("falta-arquivo", BLOCO_VALIDO));
      criarSkill(raiz, "nome-trocado", skillMd("outro-nome", BLOCO_VALIDO), { "referencias/a.md": "" });
      NodeFS.mkdirSync(NodePath.join(raiz, "sem-skill-md"));

      const pasta = yield* lerPastaSkills(raiz);
      assert.deepStrictEqual(
        pasta.skills.map((skill) => skill.nome),
        ["do-app"],
      );
      assert.deepStrictEqual(pasta.skills[0]?.arquivos, [{ caminho: "referencias/a.md", conteudo: "referência A" }]);
      assert.strictEqual(pasta.skills[0]?.instrucoes, "# do-app\n\nCorpo da skill.");
      assert.deepStrictEqual(pasta.foraDoApp, ["do-repositorio"]);
      assert.deepStrictEqual(
        pasta.invalidas.map((erro) => erro.message),
        [
          "skill falta-arquivo: o arquivo listado em simplifica.arquivos não existe: referencias/a.md",
          'skill nome-trocado: name "outro-nome" difere do nome da pasta',
        ],
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("as skills do checkout: as do app são válidas e levam os arquivos listados", () =>
    Effect.gen(function* () {
      const pasta = yield* lerPastaSkills(NodePath.join(RAIZ, "catalogo", "skills"), { estrito: true });
      assert.deepStrictEqual(pasta.invalidas, []);
      // No catálogo, toda skill é do app.
      assert.deepStrictEqual(pasta.foraDoApp, []);
      const nomes = pasta.skills.map((skill) => skill.nome);
      assert.includeMembers(nomes, ["verificar-fundamentacao-normativa"]);
      const fundamentacao = pasta.skills.find((skill) => skill.nome === "verificar-fundamentacao-normativa");
      assert.includeMembers(fundamentacao?.arquivos.map((arquivo) => arquivo.caminho) ?? [], [
        "references/relatorio.md",
      ]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
