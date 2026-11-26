// @effect-diagnostics nodeBuiltinImport:off -- teste de script de build: monta e confere pastas temporárias
/**
 * A identidade e os alvos do instalador (sem empacotar: isso é o `pnpm --filter @simplifica-if/desktop
 * dist`) e a cópia das skills e dos manifestos de tarefa do app para `<Resources>/skills` e
 * `<Resources>/tarefas`.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { lerOrigemCatalogo } from "@simplifica-if/atualizacao/local";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterAll, describe, expect, test } from "vite-plus/test";
import { EXTERNOS_SERVIDOR } from "../scripts/construir.ts";
import { configuracaoBuilder, deixarSoPortugues, problemaBaseEmpacotada } from "../scripts/empacotar.ts";
import { copiarSkills } from "../scripts/skills.ts";
import { copiarTarefas, gravarOrigemCatalogo, origemDoCheckout } from "../scripts/tarefas.ts";

const RAIZ = NodePath.resolve(import.meta.dirname, "../../..");
const temporarios: Array<string> = [];
afterAll(() => {
  for (const pasta of temporarios) NodeFS.rmSync(pasta, { recursive: true, force: true });
});
const temporario = () => {
  const pasta = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "simplifica-skills-app-"));
  temporarios.push(pasta);
  return pasta;
};

/** Todos os arquivos de `pasta`, relativos e ordenados. */
const arquivos = (pasta: string): Array<string> =>
  (NodeFS.readdirSync(pasta, { recursive: true, withFileTypes: true }) as Array<NodeFS.Dirent>)
    .filter((entrada) => entrada.isFile())
    .map((entrada) =>
      NodePath.relative(pasta, NodePath.join(entrada.parentPath, entrada.name)).split(NodePath.sep).join("/"),
    )
    .sort();

describe("configuração do electron-builder", () => {
  test("nome, identificador e instaladores sem assinatura", () => {
    const config = configuracaoBuilder({ dir: false });
    expect(config.appId).toBe("io.github.comunidade-ifpr.simplifica");
    expect(config.productName).toBe("Simplifica IF");
    expect(config.electronVersion).toBe("44.10.1");
    expect(config.mac).toMatchObject({ target: ["dmg", "zip"], identity: null });
    expect(config.win).toMatchObject({ target: [{ target: "nsis", arch: ["x64"] }] });
    expect(config.nsis).toMatchObject({ oneClick: true, perMachine: false });
    expect(configuracaoBuilder({ dir: true }).mac).toMatchObject({ target: ["dir"] });
  });

  test("em português: o pacote do macOS e o instalador do Windows (M1.14)", () => {
    const config = configuracaoBuilder({ dir: false });
    expect(config.electronLanguages).toEqual(["pt-BR", "en-US"]);
    expect(config.mac?.extendInfo).toMatchObject({ CFBundleDevelopmentRegion: "pt-BR" });
    expect(config.nsis).toMatchObject({
      language: "1046",
      installerLanguages: ["pt_BR"],
      multiLanguageInstaller: false,
    });
  });

  test("o pacote do macOS declara só o pt-BR; as pastas com arquivo ficam", () => {
    const recursos = temporario();
    for (const nome of ["en.lproj", "en_GB.lproj", "pt_BR.lproj", "de.lproj", "com-arquivo.lproj"]) {
      NodeFS.mkdirSync(NodePath.join(recursos, nome));
    }
    NodeFS.writeFileSync(NodePath.join(recursos, "com-arquivo.lproj", "InfoPlist.strings"), "");
    NodeFS.writeFileSync(NodePath.join(recursos, "electron.icns"), "");
    expect([...deixarSoPortugues(recursos)].sort()).toEqual(["de.lproj", "en.lproj", "en_GB.lproj"]);
    expect(NodeFS.readdirSync(recursos).sort()).toEqual(["com-arquivo.lproj", "electron.icns", "pt_BR.lproj"]);
  });

  test("a base de desenvolvimento (dev-*) só entra com --base-dev", () => {
    const banco = (meta: ReadonlyArray<readonly [string, string]>) => {
      const caminho = NodePath.join(temporario(), "kb.sqlite");
      const db = new NodeSqlite.DatabaseSync(caminho);
      db.exec("CREATE TABLE meta (chave TEXT PRIMARY KEY, valor TEXT)");
      for (const [chave, valor] of meta) db.prepare("INSERT INTO meta VALUES (?, ?)").run(chave, valor);
      db.close();
      return caminho;
    };
    const dev = banco([["fontes_sha256", "ab12cd34ef56"]]);
    expect(problemaBaseEmpacotada(dev, false)).toContain("é de desenvolvimento (dev-ab12cd34)");
    expect(problemaBaseEmpacotada(dev, false)).toContain("--base-dev");
    expect(problemaBaseEmpacotada(dev, true)).toBeUndefined();
    expect(problemaBaseEmpacotada(banco([["versao", "2026.11.20"]]), false)).toBeUndefined();
    expect(problemaBaseEmpacotada(banco([]), true)).toContain("não tem versão legível");
  });

  test("o servidor, a base, as skills, as tarefas e as licenças vão fora do asar", () => {
    const destinos = (configuracaoBuilder({ dir: true }).extraResources as Array<{ to: string }>).map((r) => r.to);
    expect(destinos).toEqual(["servidor", "base", "skills", "tarefas", "LICENCAS.md"]);
  });

  test("os opcionais nativos do ws ficam fora do bundle do servidor", () => {
    expect(EXTERNOS_SERVIDOR).toEqual(expect.arrayContaining(["bufferutil", "utf-8-validate"]));
  });
});

describe("skills do app no pacote", () => {
  test("copia as skills do catálogo e, de cada uma, só os arquivos listados", async () => {
    const destino = temporario();
    NodeFS.writeFileSync(NodePath.join(destino, "sobra.txt"), "de um build anterior");
    const copiadas = await copiarSkills(NodePath.join(RAIZ, "catalogo", "skills"), destino);
    expect(copiadas.map((skill) => skill.nome)).toEqual(["verificar-fundamentacao-normativa"]);
    expect(arquivos(destino)).toEqual([
      "retiradas.yaml",
      "verificar-fundamentacao-normativa/SKILL.md",
      "verificar-fundamentacao-normativa/references/relatorio.md",
    ]);
  });

  test("uma skill retirada que continua no catálogo faz o build falhar", async () => {
    const origem = temporario();
    NodeFS.mkdirSync(NodePath.join(origem, "velha"));
    NodeFS.writeFileSync(
      NodePath.join(origem, "velha", "SKILL.md"),
      "---\nname: velha\ndescription: x\nsimplifica:\n  ferramentas: []\n  arquivos: []\n---\ncorpo\n",
    );
    NodeFS.writeFileSync(
      NodePath.join(origem, "retiradas.yaml"),
      "retiradas:\n  - { skill: velha, data: 2026-11-26, motivo: Erro grave. }\n",
    );
    await expect(copiarSkills(origem, temporario())).rejects.toThrow(/velha: está em retiradas\.yaml e continua/);
  });

  test("uma skill do app inválida faz o build falhar", async () => {
    const origem = temporario();
    NodeFS.mkdirSync(NodePath.join(origem, "quebrada"));
    NodeFS.writeFileSync(
      NodePath.join(origem, "quebrada", "SKILL.md"),
      "---\nname: quebrada\ndescription: x\nsimplifica:\n  ferramentas: []\n  arquivos: [falta.md]\n---\ncorpo\n",
    );
    await expect(copiarSkills(origem, temporario())).rejects.toThrow(/quebrada: o arquivo listado .* falta\.md/);
  });

  test("uma skill sem o bloco simplifica: no catálogo faz o build falhar", async () => {
    const origem = temporario();
    NodeFS.mkdirSync(NodePath.join(origem, "esquecida"));
    NodeFS.writeFileSync(
      NodePath.join(origem, "esquecida", "SKILL.md"),
      "---\nname: esquecida\ndescription: x\n---\ncorpo\n",
    );
    await expect(copiarSkills(origem, temporario())).rejects.toThrow(/esquecida: sem o bloco simplifica:/);
  });

  test("um campo desconhecido no bloco simplifica: (o título, que hoje é da tarefa) faz o build falhar", async () => {
    const origem = temporario();
    NodeFS.mkdirSync(NodePath.join(origem, "antiga"));
    NodeFS.writeFileSync(
      NodePath.join(origem, "antiga", "SKILL.md"),
      "---\nname: antiga\ndescription: x\nsimplifica:\n  titulo: Cartão antigo\n  ferramentas: []\n  arquivos: []\n---\ncorpo\n",
    );
    await expect(copiarSkills(origem, temporario())).rejects.toThrow(
      /antiga: bloco simplifica: inválido\n\s+simplifica\.titulo/,
    );
  });
});

describe("tarefas do app no pacote", () => {
  const manifesto = (id: string, abertura: string) =>
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

  test("copia os manifestos do checkout, que citam as skills que o build copiou", async () => {
    const destino = temporario();
    NodeFS.writeFileSync(NodePath.join(destino, "sobra.yaml"), "de um build anterior");
    const ids = await copiarTarefas(
      NodePath.join(RAIZ, "catalogo", "tarefas"),
      destino,
      await copiarSkills(NodePath.join(RAIZ, "catalogo", "skills"), temporario()),
    );
    expect(ids).toEqual(["conferir-fundamentacao-normativa", "elaborar-calendario-academico", "revisar-ppc"]);
    expect(arquivos(destino)).toEqual([
      "conferir-fundamentacao-normativa.yaml",
      "elaborar-calendario-academico.yaml",
      "revisar-ppc.yaml",
    ]);
  });

  it.effect("a origem do catálogo: o commit do checkout e a data dele, que o servidor lê do origem.json", () =>
    Effect.gen(function* () {
      const origem = origemDoCheckout(RAIZ);
      expect(origem.commit).toMatch(/^[0-9a-f]{7,}$/);
      expect(Date.parse(origem.dataCommit)).not.toBeNaN();
      const destino = temporario();
      gravarOrigemCatalogo(destino, origem);
      expect(yield* lerOrigemCatalogo(destino)).toEqual({
        tipo: "instalador",
        commit: origem.commit,
        dataCommit: origem.dataCommit,
      });
      // Sem o arquivo, a pasta não vira a do checkout: é a do instalador sem origem. Só quem sobe o servidor
      // diz que a pasta é a do checkout.
      expect(yield* lerOrigemCatalogo(temporario())).toEqual({ tipo: "sem-origem", motivo: "ausente" });
      expect(yield* lerOrigemCatalogo(temporario(), { checkout: true })).toEqual({ tipo: "checkout" });
      const ilegivel = temporario();
      NodeFS.writeFileSync(
        NodePath.join(ilegivel, "origem.json"),
        '{"commit":"abc","data_commit":"2026-13-45T10:00:00Z"}',
      );
      expect(yield* lerOrigemCatalogo(ilegivel)).toEqual({ tipo: "sem-origem", motivo: "ilegivel" });
      // O build recusa a data do commit que está no futuro (relógio adiantado, commit com data trocada).
      expect(() => origemDoCheckout(RAIZ, Date.parse(origem.dataCommit) - 60 * 60 * 1000)).toThrow(/está no futuro/);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  test("tarefa de app_minimo menor que o da skill que ela cita faz o build falhar", async () => {
    const origem = temporario();
    NodeFS.writeFileSync(
      NodePath.join(origem, "pede-app.yaml"),
      manifesto("pede-app", '{ conversa: { skill: skill-nova, pedido: "Faça." } }'),
    );
    const falha = await copiarTarefas(origem, temporario(), [{ nome: "skill-nova", appMinimo: "0.3.0" }]).then(
      () => "",
      (erro: unknown) => String(erro),
    );
    expect(falha).toMatch(/tarefa pede-app: app_minimo ausente \(0\.1\.0\) é menor que o 0\.3\.0 da skill skill-nova/);
    const ok = temporario();
    NodeFS.writeFileSync(
      NodePath.join(ok, "pede-app.yaml"),
      manifesto("pede-app", '{ conversa: { skill: skill-nova, pedido: "Faça." } }').replace(
        "situacao: estavel",
        "situacao: estavel\napp_minimo: 0.3.0",
      ),
    );
    expect(await copiarTarefas(ok, temporario(), [{ nome: "skill-nova", appMinimo: "0.3.0" }])).toEqual(["pede-app"]);
  });

  test("manifesto inválido, skill que não vai no app ou módulo que o app não tem fazem o build falhar", async () => {
    const origem = temporario();
    NodeFS.writeFileSync(
      NodePath.join(origem, "link-inseguro.yaml"),
      manifesto("link-inseguro", '{ link: { url: "http://calendario.example.org", requer_login: false } }'),
    );
    NodeFS.writeFileSync(
      NodePath.join(origem, "sem-skill.yaml"),
      manifesto("sem-skill", '{ conversa: { skill: skill-que-nao-vai, pedido: "Faça." } }'),
    );
    NodeFS.writeFileSync(NodePath.join(origem, "outro-modulo.yaml"), manifesto("outro-modulo", "{ modulo: outro }"));
    const destino = temporario();
    const falha = await copiarTarefas(origem, destino, []).then(
      () => "",
      (erro: unknown) => String(erro),
    );
    expect(falha).toMatch(/link-inseguro\.yaml: manifesto inválido/);
    expect(falha).toMatch(/tarefa sem-skill: a skill "skill-que-nao-vai" não é skill do app/);
    expect(falha).toMatch(/tarefa outro-modulo: o módulo "outro" não existe no app/);
    expect(arquivos(destino)).toEqual([]);
  });
});
