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

const BLOCO_VALIDO = [
  "  titulo: Teste",
  "  resumo: Uma skill de teste.",
  "  area: ensino",
  "  ferramentas: [buscar_norma, ler_dispositivos]",
  "  arquivos: [referencias/a.md]",
].join("\n");

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

  it.effect("bloco válido: o manifesto, com os campos opcionais do plano", () =>
    Effect.gen(function* () {
      const bloco = [
        BLOCO_VALIDO,
        "  publico: [proens, coordenacao-curso]",
        "  entradas:",
        '    - { id: ppc, tipo: arquivo, aceita: [.docx, .md], rotulo: "PPC do curso" }',
        "  etapas:",
        '    - { id: fichas, rotulo: "Verificar as fichas", progresso: true }',
        "  base_minima: 2026.11.01",
        "  app_minimo: 0.1.0",
        "  duracao_estimada: 20min",
        "  donos: [proens/dens]",
      ].join("\n");
      const lida = yield* lerSkillMd(skillMd("x", bloco), "x");
      assert.strictEqual(lida.manifesto?.titulo, "Teste");
      assert.deepStrictEqual(lida.manifesto?.ferramentas, ["buscar_norma", "ler_dispositivos"]);
      assert.strictEqual(lida.manifesto?.base_minima, "2026.11.01");
      assert.strictEqual(lida.manifesto?.etapas?.[0]?.progresso, true);
    }),
  );

  it.effect("ferramenta que não existe no simplifica-mcp", () =>
    Effect.gen(function* () {
      const detalhe = yield* erroDe(skillMd("x", BLOCO_VALIDO.replace("ler_dispositivos", "kb.ppc_fatos")));
      assert.include(detalhe, "simplifica.ferramentas.1");
      assert.include(detalhe, '"kb.ppc_fatos" não é ferramenta do simplifica-mcp');
    }),
  );

  it.effect("publico fora do vocabulário do perfil", () =>
    Effect.gen(function* () {
      const detalhe = yield* erroDe(skillMd("x", `${BLOCO_VALIDO}\n  publico: [coordenacao, docente]`));
      assert.include(detalhe, "simplifica.publico.0");
    }),
  );

  it.effect("campos obrigatórios faltando e área fora do padrão", () =>
    Effect.gen(function* () {
      const detalhe = yield* erroDe(skillMd("x", "  titulo: Teste\n  area: Ensino"));
      assert.include(detalhe, "bloco simplifica: inválido");
      assert.include(detalhe, "simplifica.resumo");
      assert.include(detalhe, "simplifica.area");
      assert.include(detalhe, "simplifica.ferramentas");
      assert.include(detalhe, "simplifica.arquivos");
    }),
  );

  it.effect("arquivos: scripts/, tests/, agents/, SKILL.md e caminhos que saem da pasta", () =>
    Effect.gen(function* () {
      for (const [caminho, mensagem] of [
        ["scripts/gerar.ts", "scripts/ não vai para o app"],
        ["tests/a.test.ts", "tests/ não vai para o app"],
        ["agents/openai.yaml", "agents/ não vai para o app"],
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
      const pasta = yield* lerPastaSkills(NodePath.join(RAIZ, ".agents", "skills"));
      assert.deepStrictEqual(pasta.invalidas, []);
      const nomes = pasta.skills.map((skill) => skill.nome);
      assert.includeMembers(nomes, ["verificar-fundamentacao-normativa"]);
      const fundamentacao = pasta.skills.find((skill) => skill.nome === "verificar-fundamentacao-normativa");
      assert.includeMembers(fundamentacao?.arquivos.map((arquivo) => arquivo.caminho) ?? [], [
        "references/relatorio.md",
      ]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
