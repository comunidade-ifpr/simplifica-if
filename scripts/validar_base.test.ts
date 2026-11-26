// @effect-diagnostics nodeBuiltinImport:off -- teste: monta um projeto temporário com catalogo/ e .agents/skills/
/**
 * O que o `validar_base` confere fora de `base-conhecimento/`: os manifestos de `catalogo/tarefas/` (o
 * schema estrito, a skill e o módulo citados), o bloco `simplifica:` das skills (obrigatório em
 * `catalogo/skills/`, proibido em `.agents/skills/`) e os dados pessoais em `catalogo/` e `.agents/skills/`.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { validarDadosPessoais, validarSkillsDoApp, validarTarefas } from "./validar_base.ts";

const temporarios: Array<string> = [];
afterAll(() => {
  for (const pasta of temporarios) NodeFS.rmSync(pasta, { recursive: true, force: true });
});

/** Um projeto temporário com os arquivos dados (caminho relativo → texto). */
const projeto = (arquivos: Readonly<Record<string, string | Uint8Array>>) => {
  const raiz = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "simplifica-validar-"));
  temporarios.push(raiz);
  for (const [caminho, texto] of Object.entries(arquivos)) {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(raiz, caminho)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(raiz, caminho), texto);
  }
  return raiz;
};

const manifesto = (id: string, abertura: string, extras: ReadonlyArray<string> = []) =>
  [
    `id: ${id}`,
    "titulo: Tarefa de teste",
    "resumo: Uma tarefa de teste.",
    "area: ensino",
    "situacao: estavel",
    "mantenedor: { nome: Pessoa de Teste, github: pessoa-de-teste }",
    ...extras,
    `abre: ${abertura}`,
    "",
  ].join("\n");

describe("validar_base: tarefas", () => {
  it.effect("manifestos válidos, com a skill e o módulo que existem", () =>
    Effect.gen(function* () {
      const raiz = projeto({
        "catalogo/tarefas/conferir.yaml": manifesto(
          "conferir",
          '{ conversa: { skill: skill-do-app, pedido: "Confira." } }',
        ),
        "catalogo/tarefas/revisar.yaml": manifesto("revisar", "{ modulo: revisao-ppc }"),
        "catalogo/tarefas/calendario.yaml": manifesto(
          "calendario",
          '{ link: { url: "https://calendario.example.org", requer_login: false } }',
        ),
      });
      assert.deepStrictEqual(yield* validarTarefas(raiz, ["skill-do-app", "skill-sem-cartao"]), {
        erros: [],
        // A skill sem cartão é aviso, não erro.
        avisos: [
          "skill skill-sem-cartao: nenhuma tarefa de catalogo/tarefas/ a cita (vai para o app sem cartão, só nas conversas livres)",
        ],
        ids: ["calendario", "conferir", "revisar"],
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "recusa skill que não é do app, módulo que não existe, id trocado, campo desconhecido e {id} sem entrada",
    () =>
      Effect.gen(function* () {
        const raiz = projeto({
          "catalogo/tarefas/sem-skill.yaml": manifesto(
            "sem-skill",
            '{ conversa: { skill: skill-do-repositorio, pedido: "Faça." } }',
          ),
          "catalogo/tarefas/outro-modulo.yaml": manifesto("outro-modulo", "{ modulo: calendario }"),
          "catalogo/tarefas/nome-do-arquivo.yaml": manifesto("outro-id", "{ modulo: revisao-ppc }"),
          "catalogo/tarefas/campo-a-mais.yaml": manifesto("campo-a-mais", "{ modulo: revisao-ppc }", ["versao: 1.0.0"]),
          "catalogo/tarefas/pedido.yaml": manifesto("pedido", '{ conversa: { pedido: "Confira {documento}." } }'),
        });
        const { erros, ids } = yield* validarTarefas(raiz, ["skill-do-app"]);
        assert.deepStrictEqual(ids, ["outro-modulo", "sem-skill"]);
        const texto = erros.join("\n");
        assert.include(texto, 'tarefa sem-skill: abre.conversa.skill: "skill-do-repositorio" não é skill do app');
        assert.include(texto, 'tarefa outro-modulo: abre.modulo: "calendario" não é módulo do app (revisao-ppc)');
        assert.include(texto, 'tarefa nome-do-arquivo.yaml: id "outro-id" difere do nome do arquivo');
        assert.match(texto, /tarefa campo-a-mais\.yaml: manifesto inválido\n {2}versao: /);
        assert.include(texto, "o pedido cita {documento}, que não está em entradas");
        assert.strictEqual(erros.length, 5);
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("recusa a tarefa de app_minimo menor que o da skill que ela cita", () =>
    Effect.gen(function* () {
      const conversa = '{ conversa: { skill: skill-do-app, pedido: "Confira." } }';
      const raiz = projeto({
        "catalogo/tarefas/sem-minimo.yaml": manifesto("sem-minimo", conversa),
        "catalogo/tarefas/menor.yaml": manifesto("menor", conversa, ["app_minimo: 0.1.5"]),
        "catalogo/tarefas/igual.yaml": manifesto("igual", conversa, ["app_minimo: 0.2.0"]),
      });
      const { erros } = yield* validarTarefas(raiz, ["skill-do-app"], new Map([["skill-do-app", "0.2.0"]]));
      assert.deepStrictEqual(erros, [
        "tarefa menor: app_minimo 0.1.5 é menor que o 0.2.0 da skill skill-do-app; declare app_minimo: 0.2.0 ou maior na tarefa",
        "tarefa sem-minimo: app_minimo ausente (0.1.0) é menor que o 0.2.0 da skill skill-do-app; declare app_minimo: 0.2.0 ou maior na tarefa",
      ]);
      // A skill sem app_minimo vale 0.1.0: a tarefa sem ele passa.
      assert.deepStrictEqual((yield* validarTarefas(raiz, ["skill-do-app"])).erros, []);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("projeto sem a pasta catalogo/tarefas/: nenhuma tarefa, nenhum erro", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* validarTarefas(projeto({}), []), { erros: [], avisos: [], ids: [] });
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("validar_base: skills do app", () => {
  const skillMd = (nome: string, bloco: ReadonlyArray<string>) =>
    ["---", `name: ${nome}`, "description: Uma skill de teste.", "simplifica:", ...bloco, "---", "", "Corpo.", ""].join(
      "\n",
    );

  it.effect("o bloco simplifica: com campo antigo do cartão é recusado; o bloco de hoje passa", () =>
    Effect.gen(function* () {
      const raiz = projeto({
        "catalogo/skills/atual/SKILL.md": skillMd("atual", [
          "  versao: 0.1.0",
          "  app_minimo: 0.2.0",
          "  ferramentas: [buscar_norma]",
          "  arquivos: []",
        ]),
        "catalogo/skills/antiga/SKILL.md": skillMd("antiga", [
          "  titulo: Cartão antigo",
          "  resumo: Do tempo em que a skill era o cartão.",
          "  area: ensino",
          "  publico: [docente]",
          "  entradas: []",
          "  duracao_estimada: 10min",
          "  donos: [pessoa-de-teste]",
          "  ferramentas: []",
          "  arquivos: []",
        ]),
        ".agents/skills/so-do-repositorio/SKILL.md": "---\nname: so-do-repositorio\ndescription: x\n---\nCorpo.\n",
      });
      const { erros, doApp } = yield* validarSkillsDoApp(raiz);
      assert.deepStrictEqual(doApp, ["atual"]);
      assert.strictEqual(erros.length, 1);
      assert.include(erros[0], "skill antiga: bloco simplifica: inválido");
      for (const campo of ["titulo", "resumo", "area", "publico", "entradas", "duracao_estimada", "donos"]) {
        assert.include(erros[0], `simplifica.${campo}`);
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("cada pasta com o seu: catalogo/skills/ exige o bloco, .agents/skills/ o recusa", () =>
    Effect.gen(function* () {
      const semBloco = (nome: string) => `---\nname: ${nome}\ndescription: x\n---\nCorpo.\n`;
      const bloco = ["  versao: 0.1.0", "  ferramentas: []", "  arquivos: []"];
      const raiz = projeto({
        "catalogo/skills/do-app/SKILL.md": skillMd("do-app", bloco),
        "catalogo/skills/esquecida/SKILL.md": semBloco("esquecida"),
        ".agents/skills/curadoria/SKILL.md": semBloco("curadoria"),
        ".agents/skills/fora-do-lugar/SKILL.md": skillMd("fora-do-lugar", bloco),
      });
      const { erros, doApp } = yield* validarSkillsDoApp(raiz);
      assert.deepStrictEqual(doApp, ["do-app"]);
      assert.strictEqual(erros.length, 2);
      assert.include(erros[0], "skill esquecida: está em catalogo/skills/ sem o bloco simplifica:");
      assert.include(erros[1], "skill fora-do-lugar: está em .agents/skills/ com o bloco simplifica:");
      // A skill retirada que continua no catálogo, e o registro fora do formato.
      const comRetirada = projeto({
        "catalogo/skills/do-app/SKILL.md": skillMd("do-app", bloco),
        "catalogo/skills/retiradas.yaml": "retiradas:\n  - { skill: do-app, data: 2026-11-26, motivo: Erro grave. }\n",
      });
      assert.deepStrictEqual((yield* validarSkillsDoApp(comRetirada)).erros, [
        "catalogo/skills/retiradas.yaml: a skill do-app está retirada e continua em catalogo/skills/ (apague a pasta dela)",
      ]);
      const foraDoFormato = projeto({ "catalogo/skills/retiradas.yaml": "retiradas:\n  - do-app\n" });
      assert.match((yield* validarSkillsDoApp(foraDoFormato)).erros[0]!, /retiradas\.yaml: fora do formato/);
      // Sem nenhuma das duas pastas, nada a conferir.
      assert.deepStrictEqual(yield* validarSkillsDoApp(projeto({})), { erros: [], doApp: [], appMinimos: new Map() });
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("validar_base: dados pessoais fora da base", () => {
  it.effect("acha CPF e celular em catalogo/ e em .agents/skills/, sem repetir o valor na mensagem", () =>
    Effect.gen(function* () {
      const raiz = projeto({
        "catalogo/tarefas/limpa.yaml": manifesto("limpa", "{ modulo: revisao-ppc }"),
        "catalogo/tarefas/com-cpf.yaml": manifesto("com-cpf", "{ modulo: revisao-ppc }", [
          "autoria: Fulana, CPF 529.982.247-25",
        ]),
        ".agents/skills/exemplo/SKILL.md": "---\nname: exemplo\ndescription: x\n---\nLigue para (41) 99876-5432.\n",
        ".agents/skills/exemplo/references/limpo.md": "Telefone do campus: (41) 3535-1600.\n",
        "catalogo/skills/do-app/references/contato.md": "RG 12.345.678-9 e celular (41) 91234-5678.\n",
      });
      const erros = yield* validarDadosPessoais(raiz);
      assert.strictEqual(erros.length, 3);
      assert.match(erros[0]!, /^catalogo\/skills\/do-app\/references\/contato\.md contém dados pessoais/);
      assert.match(erros[1]!, /^catalogo\/tarefas\/com-cpf\.yaml contém dados pessoais \(1 CPF\)/);
      assert.match(erros[2]!, /^\.agents\/skills\/exemplo\/SKILL\.md contém dados pessoais \(1 celular\)/);
      assert.notMatch(erros.join("\n"), /529|99876|91234/);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("arquivo que não é UTF-8 fica de fora da varredura; o texto ao lado dele é varrido", () =>
    Effect.gen(function* () {
      // Um PNG cujos bytes, lidos como Latin-1, trariam um CPF: não é texto, não se varre.
      const png = Uint8Array.from([
        0x89,
        0x50,
        0x4e,
        0x47,
        0xff,
        0xfe,
        ...Buffer.from(" CPF 529.982.247-25 ", "latin1"),
      ]);
      const raiz = projeto({
        ".agents/skills/exemplo/assets/figura.png": png,
        ".agents/skills/exemplo/assets/legenda.md": "Fulana, CPF 529.982.247-25\n",
      });
      const erros = yield* validarDadosPessoais(raiz);
      assert.strictEqual(erros.length, 1);
      assert.match(erros[0]!, /^\.agents\/skills\/exemplo\/assets\/legenda\.md contém dados pessoais \(1 CPF\)/);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("link simbólico quebrado: vira erro da validação, sem derrubar o script nem esconder os outros", () =>
    Effect.gen(function* () {
      const raiz = projeto({
        "catalogo/tarefas/com-cpf.yaml": manifesto("com-cpf", "{ modulo: revisao-ppc }", [
          "autoria: Fulana, CPF 529.982.247-25",
        ]),
      });
      NodeFS.symlinkSync(
        NodePath.join(raiz, "nao-existe.yaml"),
        NodePath.join(raiz, "catalogo", "tarefas", "quebrado.yaml"),
      );
      const erros = yield* validarDadosPessoais(raiz);
      assert.strictEqual(erros.length, 2);
      assert.match(erros[0]!, /^catalogo\/tarefas\/com-cpf\.yaml contém dados pessoais \(1 CPF\)/);
      assert.strictEqual(erros[1], "catalogo/tarefas/quebrado.yaml: não foi possível examinar o arquivo (NotFound)");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
