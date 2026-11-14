import { describe, expect, test } from "vite-plus/test";
import {
  analisarPpc,
  corpoPpc,
  ErroFrontMatter,
  linhasFrontMatter,
  mascararFrontMatter,
  type ProvenienciaPpc,
  serializarFrontMatterPpc,
} from "./front-matter.ts";

const reconstruida: ProvenienciaPpc = {
  id: "ppc:curitiba/tecnico-em-enfermagem",
  fonte_url: "https://ifpr.edu.br/curitiba/wp-content/uploads/PPC_2024.pdf",
  fonte_sha256: "desconhecido",
  convertido_em: "2026-05-28",
  conversor: "desconhecido",
  proveniencia: "reconstruida",
  conversao_commit: "1b33c2cfd9a1f5c423a14f322ebb242ab7bdd1b8",
  pos_processamento_commits: ["9a5b159256e17dafe3d68a47936ef3d6cdcae6bb"],
  nota_proveniencia: "Reconstruída pelo git: hash e conversor desconhecidos.",
};

describe("front matter de PPC", () => {
  test("serializa, lê de volta e preserva o corpo", () => {
    const yaml = serializarFrontMatterPpc(reconstruida);
    expect(
      String(yaml).startsWith("---\nid: ppc:curitiba/tecnico-em-enfermagem\nfonte_url: https://ifpr.edu.br/"),
    ).toBe(true);
    expect(yaml).toContain('nota_proveniencia: "Reconstruída pelo git: hash e conversor desconhecidos."');
    expect(yaml).toContain("pos_processamento_commits:\n  - 9a5b159");
    const texto = `${yaml}\n## 1 Identificação\ntexto\n`;
    const { proveniencia, corpo } = analisarPpc(texto, "x.md");
    expect(proveniencia).toEqual(reconstruida);
    expect(corpo).toBe("\n## 1 Identificação\ntexto\n");
    expect(corpoPpc(texto)).toBe(corpo);
  });

  test("mascara o front matter sem mudar a numeração das linhas", () => {
    const texto = `${serializarFrontMatterPpc(reconstruida)}## Título\nResolução CNE/CP nº 1/2021\n`;
    const linhas = linhasFrontMatter(texto);
    expect(linhas).toBe(12);
    const mascarado = mascararFrontMatter(texto);
    expect(mascarado.split("\n")).toHaveLength(texto.split("\n").length);
    expect(
      mascarado
        .split("\n")
        .slice(0, linhas)
        .every((linha) => linha === ""),
    ).toBe(true);
    expect(mascarado.split("\n")[linhas]).toBe("## Título");
    expect(mascararFrontMatter("sem front matter\n")).toBe("sem front matter\n");
    expect(linhasFrontMatter("---\nsem fim\n")).toBe(0);
  });

  test("só remove bloco `---` que seja front matter de proveniência de PPC", () => {
    // Minuta que abre com régua horizontal: o texto entre as réguas é do PPC.
    const minuta = "---\n\n# Curso Técnico em Informática\n\nCampus: Curitiba\n\n---\n\n## 1. Apresentação\n";
    expect(linhasFrontMatter(minuta)).toBe(0);
    expect(corpoPpc(minuta)).toBe(minuta);
    expect(mascararFrontMatter(minuta)).toBe(minuta);
    // YAML válido, mas sem as chaves de proveniência.
    const outroYaml = "---\ntitle: Minuta do PPC\nautor: Comissão\n---\n# Curso\n";
    expect(linhasFrontMatter(outroYaml)).toBe(0);
    expect(corpoPpc(outroYaml)).toBe(outroYaml);
    // YAML inválido entre as réguas.
    const invalido = "---\nCurso: Técnico: em: Informática\n  - x\n---\n# Curso\n";
    expect(linhasFrontMatter(invalido)).toBe(0);
    // Chaves de proveniência misturadas com outras: não é o front matter da base.
    const misto = `${serializarFrontMatterPpc(reconstruida).replace("---\n", "---\ntitle: x\n")}# Curso\n`;
    expect(linhasFrontMatter(misto)).toBe(0);
  });

  test("registrada exige hash e conversor; reconstruída exige nota", () => {
    const { nota_proveniencia: _nota, ...semNota } = reconstruida;
    expect(() => serializarFrontMatterPpc({ ...semNota, proveniencia: "registrada" })).toThrow();
    expect(() =>
      analisarPpc(
        serializarFrontMatterPpc({ ...semNota, nota_proveniencia: "x" }).replace(/nota_proveniencia.*\n/, ""),
        "y.md",
      ),
    ).toThrow(ErroFrontMatter);
    expect(() => analisarPpc("## sem front matter", "z.md")).toThrow("z.md: arquivo sem front matter");
    expect(() => analisarPpc("---\nid: curitiba/x\n---\n", "w.md")).toThrow("w.md: front matter de PPC inválido");
  });
});
