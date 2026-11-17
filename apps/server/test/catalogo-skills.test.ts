// @effect-diagnostics nodeBuiltinImport:off -- teste: monta uma pasta de skills temporária
/**
 * O `CatalogoSkills` sobre uma pasta de skills temporária: só as com bloco `simplifica:` válido entram,
 * como `Motor.Skill` (nome, descrição, corpo, arquivos listados) e como `ResumoSkill`; a skill sem bloco
 * fica de fora sem erro, a inválida (bloco, ferramenta inexistente, arquivo que falta) fica de fora com
 * o erro no log; a pasta que não existe impede a abertura.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as CatalogoSkills from "../src/CatalogoSkills.ts";
import { diretorioTemporario, limparTemporarios } from "./apoio.ts";

afterAll(limparTemporarios);

const skillMd = (nome: string, bloco?: ReadonlyArray<string>) =>
  [
    "---",
    `name: ${nome}`,
    `description: A skill ${nome}.`,
    ...(bloco === undefined ? [] : ["simplifica:", ...bloco.map((linha) => `  ${linha}`)]),
    "---",
    "",
    `Instruções de ${nome}.`,
    "",
  ].join("\n");

const bloco = (opcoes: { readonly ferramentas?: string; readonly arquivos?: string } = {}) => [
  "titulo: Título",
  "resumo: Resumo.",
  "area: ensino",
  `ferramentas: [${opcoes.ferramentas ?? "buscar_norma"}]`,
  `arquivos: [${opcoes.arquivos ?? "ref.md"}]`,
];

const escrever = (raiz: string, caminho: string, texto: string) => {
  NodeFS.mkdirSync(NodePath.dirname(NodePath.join(raiz, caminho)), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(raiz, caminho), texto);
};

/** Abre o catálogo sobre `pasta` e devolve o serviço e os logs. */
const abrir = (pasta: string) =>
  Effect.gen(function* () {
    const logs: Array<string> = [];
    const registrar = Logger.make<unknown, void>(({ logLevel, message }) => {
      logs.push(`${logLevel}: ${Array.isArray(message) ? message.join(" ") : String(message)}`);
    });
    const catalogo = yield* CatalogoSkills.CatalogoSkills.pipe(
      Effect.provide(
        CatalogoSkills.layer(pasta).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, Logger.layer([registrar])))),
      ),
    );
    return { catalogo, logs };
  });

describe("catálogo de skills", () => {
  it.effect("aceita só as skills com bloco válido; ignora as sem bloco; registra as inválidas", () =>
    Effect.gen(function* () {
      const raiz = diretorioTemporario("simplifica-catalogo-");
      escrever(raiz, "boa/SKILL.md", skillMd("boa", bloco()));
      escrever(raiz, "boa/ref.md", "referência");
      escrever(raiz, "boa/scripts/gerar.ts", "// não vai");
      escrever(raiz, "do-repositorio/SKILL.md", skillMd("do-repositorio"));
      escrever(raiz, "ferramenta-falsa/SKILL.md", skillMd("ferramenta-falsa", bloco({ ferramentas: "kb.ppc_fatos" })));
      escrever(raiz, "ferramenta-falsa/ref.md", "");
      escrever(raiz, "falta-arquivo/SKILL.md", skillMd("falta-arquivo", bloco({ arquivos: "nao-existe.md" })));
      escrever(raiz, "bloco-ruim/SKILL.md", skillMd("bloco-ruim", ["titulo: só o título"]));

      const { catalogo, logs } = yield* abrir(raiz);
      assert.deepStrictEqual(catalogo.skills, [
        {
          nome: "boa",
          descricao: "A skill boa.",
          instrucoes: "Instruções de boa.",
          arquivos: [{ caminho: "ref.md", conteudo: "referência" }],
        },
      ]);
      assert.deepStrictEqual(catalogo.resumos, [
        { nome: "boa", titulo: "Título", resumo: "Resumo.", area: "ensino", publico: [], entradas: [], etapas: [] },
      ]);

      const erros = logs.filter((linha) => linha.startsWith("Error"));
      assert.strictEqual(erros.length, 3);
      assert.isTrue(erros.some((linha) => linha.includes("skill bloco-ruim: bloco simplifica: inválido")));
      assert.isTrue(erros.some((linha) => linha.includes('"kb.ppc_fatos" não é ferramenta do simplifica-mcp')));
      assert.isTrue(
        erros.some((linha) =>
          linha.includes("skill falta-arquivo: o arquivo listado em simplifica.arquivos não existe: nao-existe.md"),
        ),
      );
      // A skill do repositório não é erro.
      assert.isFalse(logs.some((linha) => linha.includes("do-repositorio") && linha.startsWith("Error")));
      assert.isTrue(logs.some((linha) => linha.includes("skills do app") && linha.includes("boa")));
    }),
  );

  it.effect("pasta que não existe: o catálogo não abre", () =>
    Effect.gen(function* () {
      const erro = yield* Effect.flip(abrir("/nao/existe/simplifica-skills"));
      assert.strictEqual(erro._tag, "PastaSkillsInvalida");
      assert.include(erro.message, "/nao/existe/simplifica-skills");
    }),
  );
});
