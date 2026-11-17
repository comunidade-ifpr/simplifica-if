// @effect-diagnostics nodeBuiltinImport:off -- teste de script de build: monta e confere pastas temporárias
/**
 * A identidade e os alvos do instalador (sem empacotar: isso é o `pnpm --filter @simplifica-if/desktop
 * dist`) e a cópia das skills do app para `<Resources>/skills`.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll, describe, expect, test } from "vite-plus/test";
import { EXTERNOS_SERVIDOR } from "../scripts/construir.ts";
import { configuracaoBuilder, deixarSoPortugues } from "../scripts/empacotar.ts";
import { copiarSkills } from "../scripts/skills.ts";

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
    expect(config.appId).toBe("br.edu.ifpr.simplifica");
    expect(config.productName).toBe("Simplifica IF");
    expect(config.electronVersion).toBe("44.10.1");
    expect(config.mac).toMatchObject({ target: ["dmg", "zip"], identity: null });
    expect(config.win).toMatchObject({ target: [{ target: "nsis", arch: ["x64"] }] });
    expect(config.nsis).toMatchObject({ oneClick: true, perMachine: false });
    // Feed generic só para o app-update.yml e os latest*.yml; nunca o provider github (que usa a API).
    expect(config.publish).toEqual([{ provider: "generic", url: expect.stringMatching(/\/$/) }]);
    expect(config.extraResources).toContainEqual({ from: "dist/recursos/assinatura.json", to: "assinatura.json" });
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

  test("o servidor, a base e as skills vão fora do asar", () => {
    const destinos = (configuracaoBuilder({ dir: true }).extraResources as Array<{ to: string }>).map((r) => r.to);
    expect(destinos).toEqual(["servidor", "base", "skills", "assinatura.json"]);
  });

  test("os opcionais nativos do ws ficam fora do bundle do servidor", () => {
    expect(EXTERNOS_SERVIDOR).toEqual(expect.arrayContaining(["bufferutil", "utf-8-validate"]));
  });
});

describe("skills do app no pacote", () => {
  test("copia só as skills com bloco simplifica: e só os arquivos listados", async () => {
    const destino = temporario();
    NodeFS.writeFileSync(NodePath.join(destino, "sobra.txt"), "de um build anterior");
    const nomes = await copiarSkills(NodePath.join(RAIZ, ".agents", "skills"), destino);
    expect(nomes).toEqual(["verificar-fundamentacao-normativa"]);
    expect(arquivos(destino)).toEqual([
      "verificar-fundamentacao-normativa/SKILL.md",
      "verificar-fundamentacao-normativa/references/relatorio.md",
    ]);
  });

  test("uma skill do app inválida faz o build falhar", async () => {
    const origem = temporario();
    NodeFS.mkdirSync(NodePath.join(origem, "quebrada"));
    NodeFS.writeFileSync(
      NodePath.join(origem, "quebrada", "SKILL.md"),
      "---\nname: quebrada\ndescription: x\nsimplifica:\n  titulo: x\n  resumo: x\n  area: ensino\n  ferramentas: []\n  arquivos: [falta.md]\n---\ncorpo\n",
    );
    await expect(copiarSkills(origem, temporario())).rejects.toThrow(/quebrada: o arquivo listado .* falta\.md/);
  });
});
