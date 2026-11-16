// @effect-diagnostics nodeBuiltinImport:off -- teste: dois bancos pequenos com normas, PPCs e cursos
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { arquivosFonte } from "@simplifica-if/kb/db/fontes";
import { fontesNaoClassificadas } from "../src/fontes.ts";
import { lerNovidades, novidadesDaVersao, proporNovidades, soAcrescimos } from "../src/novidades.ts";
import { limparTemporarios, pastaTemporaria } from "./apoio.ts";

afterEach(limparTemporarios);

const RAIZ = NodePath.resolve(import.meta.dirname, "..", "..", "..");

function banco(caminho: string, normas: string[][], ppcs: string[][], cursos: string[][]) {
  const db = new NodeSqlite.DatabaseSync(caminho);
  db.exec(`CREATE TABLE normas (id TEXT, titulo TEXT, status_vigencia TEXT);
    CREATE TABLE ppcs (id TEXT, curso_nome TEXT, campus_nome TEXT, ano_documento TEXT, caracteres INTEGER);
    CREATE TABLE cursos (id TEXT, nome TEXT, campus_id TEXT);`);
  for (const n of normas) db.prepare("INSERT INTO normas VALUES (?, ?, ?)").run(...n);
  for (const p of ppcs) db.prepare("INSERT INTO ppcs VALUES (?, ?, ?, ?, ?)").run(...p);
  for (const c of cursos) db.prepare("INSERT INTO cursos VALUES (?, ?, ?)").run(...c);
  db.close();
  return caminho;
}

describe("novidades", () => {
  it("propõe norma nova, revogação, PPC atualizado e curso novo pela diferença", () => {
    const pasta = pastaTemporaria();
    const de = banco(
      NodePath.join(pasta, "de.sqlite"),
      [["br/cne-cp/res/2021/1", "Resolução CNE/CP nº 1/2021", "vigente"]],
      [["ppc:a", "Técnico em Enfermagem", "Curitiba", "2019", "100"]],
      [],
    );
    const para = banco(
      NodePath.join(pasta, "para.sqlite"),
      [
        ["br/cne-cp/res/2021/1", "Resolução CNE/CP nº 1/2021", "revogada"],
        ["br/cne-cp/res/2026/2", "Resolução CNE/CP nº 2/2026", "vigente"],
      ],
      [["ppc:a", "Técnico em Enfermagem", "Curitiba", "2026", "120"]],
      [["curitiba/tecnico-em-redes", "Técnico em Redes", "curitiba"]],
    );
    const itens = proporNovidades(de, para);
    expect(itens.map((item) => item.tipo).sort()).toEqual(["curso-novo", "norma-nova", "ppc-atualizado", "revogacao"]);
    expect(itens.find((item) => item.tipo === "ppc-atualizado")?.detalhe).toBe("documento de 2019 → 2026");
  });

  it("o arquivo só aceita acréscimos, e o manifesto leva os itens da versão", () => {
    const antes = lerNovidades(
      'versoes:\n  - versao: "2026.11.13"\n    data: "2026-11-13"\n    itens:\n      - { tipo: outro, titulo: "A" }\n',
    );
    const depois = lerNovidades(
      'versoes:\n  - versao: "2026.11.13"\n    data: "2026-11-13"\n    itens:\n      - { tipo: outro, titulo: "A" }\n  - versao: "2026.11.20"\n    data: "2026-11-20"\n    itens:\n      - { tipo: norma-nova, titulo: "B", refs: [x] }\n',
    );
    expect(soAcrescimos(antes, depois)).toEqual([]);
    expect(soAcrescimos(depois, antes)).toEqual(["a versão 2026.11.20 saiu do registro"]);
    const alterado = lerNovidades(
      'versoes:\n  - versao: "2026.11.13"\n    data: "2026-11-13"\n    itens:\n      - { tipo: outro, titulo: "Z" }\n',
    );
    expect(soAcrescimos(antes, alterado)).toEqual(["a versão 2026.11.13 foi alterada"]);
    expect(novidadesDaVersao(depois, "2026.11.20")).toEqual([{ tipo: "norma-nova", titulo: "B" }]);
  });

  it("o novidades.yaml do repositório é válido", () => {
    expect(() =>
      lerNovidades(NodeFS.readFileSync(NodePath.join(RAIZ, "base-conhecimento", "novidades.yaml"), "utf8")),
    ).not.toThrow();
  });

  it("todas as fontes do kb.sqlite estão classificadas como publicáveis; uma nova falha", () => {
    expect(fontesNaoClassificadas(arquivosFonte(RAIZ))).toEqual([]);
    expect(fontesNaoClassificadas(["dados/arquivo-notion/pareceres.json"])).toEqual([
      "dados/arquivo-notion/pareceres.json",
    ]);
  });
});

describe("hospedagem no GitHub Releases", () => {
  it("feed por link direto, nunca a API, e os yml do app apontando para o release da versão", async () => {
    const { feedGitHub, reescreverLatestYml, urlPacoteBase } = await import("../src/hospedagem.ts");
    expect(feedGitHub("ifpr/simplifica-if")).toBe(
      "https://github.com/ifpr/simplifica-if/releases/download/canal-{canal}/",
    );
    expect(() => feedGitHub("não é repo")).toThrow();
    expect(
      new URL(urlPacoteBase("2026.11.20")("base.zst"), "https://github.com/o/r/releases/download/canal-beta/beta.json")
        .href,
    ).toBe("https://github.com/o/r/releases/download/base-2026.11.20/base.zst");
    const yml =
      "version: 0.2.0\nfiles:\n  - url: Simplifica-IF-0.2.0-arm64.zip\n    sha512: abc\n    size: 10\npath: Simplifica-IF-0.2.0-arm64.zip\nsha512: abc\n";
    const reescrito = reescreverLatestYml(yml, "0.2.0");
    expect(reescrito).toContain("url: ../app-v0.2.0/Simplifica-IF-0.2.0-arm64.zip");
    expect(reescrito).toContain("sha512: abc");
    expect(() => reescreverLatestYml(yml, "0.3.0")).toThrow("versão");
  });
});
