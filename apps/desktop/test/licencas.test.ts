// @effect-diagnostics nodeBuiltinImport:off -- teste de script de build: monta e confere pastas temporárias
/** O `LICENCAS.md` do instalador: quais pacotes entram e como o arquivo fica. */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll, describe, expect, test } from "vite-plus/test";
import { coletorLicencas, juntarPacotes, markdownLicencas, pastaDoPacote } from "../scripts/licencas.ts";

const temporarios: Array<string> = [];
afterAll(() => {
  for (const pasta of temporarios) NodeFS.rmSync(pasta, { recursive: true, force: true });
});

/** Um `node_modules` com `pacote` (licença em `LICENSE`) e `@escopo/outro` (sem arquivo de licença). */
function nodeModules(): string {
  const raiz = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "simplifica-licencas-"));
  temporarios.push(raiz);
  const escrever = (caminho: string, conteudo: string) => {
    const arquivo = NodePath.join(raiz, "node_modules", caminho);
    NodeFS.mkdirSync(NodePath.dirname(arquivo), { recursive: true });
    NodeFS.writeFileSync(arquivo, conteudo);
  };
  escrever("pacote/package.json", JSON.stringify({ name: "pacote", version: "1.2.3", license: "MIT" }));
  escrever("pacote/LICENSE", "MIT License\n\nCopyright (c) Fulano\n");
  // `package.json` só com o tipo de módulo: não é o dono da pasta.
  escrever("pacote/dist/esm/package.json", JSON.stringify({ type: "module" }));
  escrever("pacote/dist/esm/index.js", "");
  escrever("@escopo/outro/package.json", JSON.stringify({ name: "@escopo/outro", version: "0.1.0", license: "ISC" }));
  escrever("@escopo/outro/index.js", "");
  return raiz;
}

describe("licenças de terceiros", () => {
  test("o dono de um módulo é o package.json com nome mais próximo, sem sair do node_modules", () => {
    const raiz = nodeModules();
    const modulos = NodePath.join(raiz, "node_modules");
    expect(pastaDoPacote(NodePath.join(modulos, "pacote/dist/esm/index.js"))).toBe(NodePath.join(modulos, "pacote"));
    expect(pastaDoPacote(NodePath.join(modulos, "@escopo/outro/index.js"))).toBe(
      NodePath.join(modulos, "@escopo/outro"),
    );
  });

  test("o coletor anota só os módulos de node_modules dos chunks", () => {
    const raiz = nodeModules();
    const modulos = NodePath.join(raiz, "node_modules");
    const coletor = coletorLicencas();
    coletor.plugin.generateBundle(undefined, {
      "main.cjs": {
        moduleIds: [
          NodePath.join(modulos, "pacote/dist/esm/index.js"),
          NodePath.join(modulos, "@escopo/outro/index.js"),
          "\0virtual:auxiliar",
          NodePath.join(raiz, "packages/kb/src/index.ts"),
        ],
      },
      "estilo.css": {},
    });
    expect(juntarPacotes(coletor.pacotes())).toEqual([
      { name: "@escopo/outro", version: "0.1.0", identifier: "ISC" },
      { name: "pacote", version: "1.2.3", identifier: "MIT", text: "MIT License\n\nCopyright (c) Fulano" },
    ]);
  });

  test("um pacote por nome e versão, preferindo o que traz o texto da licença", () => {
    const juntos = juntarPacotes(
      [{ name: "b", version: "1.0.0", identifier: "MIT" }],
      [
        { name: "b", version: "1.0.0", identifier: "MIT", text: "texto" },
        { name: "a", version: "2.0.0" },
      ],
    );
    expect(juntos.map((p) => `${p.name}@${p.version}:${p.text ?? ""}`)).toEqual(["a@2.0.0:", "b@1.0.0:texto"]);
  });

  test("o Markdown traz a licença do app antes da dos terceiros", () => {
    const texto = markdownLicencas("MIT License\n\nCopyright (c) 2026 Simplifica IF\n", [
      { name: "pacote", version: "1.2.3", identifier: "MIT", text: "Texto da licença" },
      { name: "sem-arquivo", version: "0.0.1" },
    ]);
    expect(texto.indexOf("Copyright (c) 2026 Simplifica IF")).toBeLessThan(texto.indexOf("### pacote 1.2.3 (MIT)"));
    expect(texto).toContain("### pacote 1.2.3 (MIT)\n\nTexto da licença");
    expect(texto).toContain("### sem-arquivo 0.0.1\n\nSem arquivo de licença no pacote");
  });
});
