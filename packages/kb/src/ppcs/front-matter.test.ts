import { describe, expect, test } from "vite-plus/test";
import {
  analisarPpc,
  corpoPpc,
  ErroFrontMatter,
  linhasFrontMatter,
  analisarPpcPendente,
  conferirEvidenciaAno,
  mascararFrontMatter,
  type PpcPendente,
  type ProvenienciaPpc,
  serializarFrontMatterPendente,
  serializarFrontMatterPpc,
} from "./front-matter.ts";

const reconstruida: ProvenienciaPpc = {
  id: "ppc:curitiba/tecnico-em-enfermagem/2023",
  ano_documento: "2023",
  ano_evidencia: "Curitiba 2023",
  ano_fonte: "texto",
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
      String(yaml).startsWith(
        '---\nid: ppc:curitiba/tecnico-em-enfermagem/2023\nano_documento: 2023\nano_evidencia: "Curitiba 2023"\nano_fonte: texto\nfonte_url: https://ifpr.edu.br/',
      ),
    ).toBe(true);
    expect(yaml).toContain('nota_proveniencia: "Reconstruída pelo git: hash e conversor desconhecidos."');
    expect(yaml).toContain("pos_processamento_commits:\n  - 9a5b159");
    const texto = `${yaml}\n## 1 Identificação\ntexto\n`;
    const { proveniencia, corpo } = analisarPpc(texto, "x.md");
    expect(proveniencia).toEqual(reconstruida);
    expect(corpo).toBe("\n## 1 Identificação\ntexto\n");
    expect(corpoPpc(texto)).toBe(corpo);
  });

  test("arquivo convertido diferente da fonte: o hash vai em arquivo_convertido", () => {
    const registrada: ProvenienciaPpc = {
      id: "ppc:curitiba/tecnico-em-enfermagem/2023",
      ano_documento: "2023",
      ano_evidencia: "Curitiba 2023",
      ano_fonte: "texto",
      fonte_url: "https://ifpr.edu.br/curitiba/wp-content/uploads/PPC_2026.pdf",
      fonte_sha256: "desconhecido",
      convertido_em: "2026-11-17",
      conversor: `simplifica-if/packages/ppc@${"c".repeat(40)}`,
      arquivo_convertido: "docx",
      arquivo_convertido_sha256: "d".repeat(64),
      proveniencia: "registrada",
      nota_proveniencia: "Convertido do DOCX.",
    };
    const yaml = serializarFrontMatterPpc(registrada);
    expect(yaml).toContain(
      `arquivo_convertido: docx\narquivo_convertido_sha256: ${"d".repeat(64)}\nproveniencia: registrada\n`,
    );
    const texto = `${yaml}## 1 Apresentação\n`;
    expect(analisarPpc(texto, "x.md").proveniencia).toEqual(registrada);
    expect(linhasFrontMatter(texto)).toBe(yaml.split("\n").length - 1);
  });

  test("mascara o front matter sem mudar a numeração das linhas", () => {
    const texto = `${serializarFrontMatterPpc(reconstruida)}## Título\nResolução CNE/CP nº 1/2021\n`;
    const linhas = linhasFrontMatter(texto);
    expect(linhas).toBe(15);
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
    // Hash da fonte desconhecido: a registrada precisa do hash do arquivo convertido.
    const docx: ProvenienciaPpc = {
      id: reconstruida.id,
      ano_documento: "2023",
      ano_evidencia: "Curitiba 2023",
      ano_fonte: "texto",
      fonte_url: reconstruida.fonte_url,
      fonte_sha256: "desconhecido",
      convertido_em: "2026-11-17",
      conversor: `simplifica-if/packages/ppc@${"c".repeat(40)}`,
      proveniencia: "registrada",
    };
    expect(() => serializarFrontMatterPpc(docx)).toThrow(/arquivo_convertido_sha256/);
    expect(() => serializarFrontMatterPpc({ ...docx, arquivo_convertido: "docx" })).toThrow(/vêm juntos/);
    expect(() =>
      serializarFrontMatterPpc({ ...docx, arquivo_convertido: "docx", arquivo_convertido_sha256: "xyz" }),
    ).toThrow();
    expect(() => analisarPpc("## sem front matter", "z.md")).toThrow("z.md: arquivo sem front matter");
    expect(() => analisarPpc("---\nid: curitiba/x\n---\n", "w.md")).toThrow("w.md: front matter de PPC inválido");
  });
  test("ano obrigatório, com evidência que contém o ano e versão do id que começa por ele", () => {
    expect(() => serializarFrontMatterPpc({ ...reconstruida, ano_evidencia: "Curitiba" })).toThrow(/conter o ano 2023/);
    expect(() =>
      serializarFrontMatterPpc({ ...reconstruida, ano_documento: "2024", ano_evidencia: "Curitiba 2024" }),
    ).toThrow(/deve começar pelo ano_documento 2024/);
    expect(() => serializarFrontMatterPpc({ ...reconstruida, ano_fonte: "http://x" })).toThrow();
    const semFonte = serializarFrontMatterPpc(reconstruida).replace("ano_fonte: texto\n", "");
    expect(() => analisarPpc(`${semFonte}x\n`, "a.md")).toThrow(/ano_fonte/);
    expect(conferirEvidenciaAno(reconstruida, "**Curitiba\n2023**")).toBeNull();
    expect(conferirEvidenciaAno(reconstruida, "Curitiba, 2023")).toMatch(/não aparece/);
    expect(conferirEvidenciaAno({ ...reconstruida, ano_fonte: "https://x.br/a.pdf#page=1" }, "")).toBeNull();
  });

  test("PPC pendente: sem id, com uma pendência por grupo incompleto", () => {
    const { id: _id, ano_documento: _a, ano_evidencia: _e, ano_fonte: _f, ...base } = reconstruida;
    const pendente: PpcPendente = { ...base, pendencias: ["ano: a capa não traz data; PDF consultado"] };
    const yaml = serializarFrontMatterPendente(pendente);
    expect(yaml).toContain('pendencias:\n  - "ano: a capa não traz data; PDF consultado"');
    const texto = `${yaml}# PPC\n`;
    expect(analisarPpcPendente(texto, "p.md").pendente).toEqual(pendente);
    expect(linhasFrontMatter(texto)).toBe(yaml.split("\n").length - 1);
    // Ano provisório sem evidência: a pendência continua.
    expect(() => serializarFrontMatterPendente({ ...pendente, ano_documento: "2019" })).not.toThrow();
    expect(() => serializarFrontMatterPendente({ ...base, pendencias: ["vagas: x"] })).toThrow(/campo desconhecido/);
    expect(() => serializarFrontMatterPendente({ ...base, pendencias: ["ano"] })).toThrow(/<campo>: <motivo>/);
    expect(() =>
      serializarFrontMatterPendente({
        ...base,
        ano_documento: "2023",
        ano_evidencia: "Curitiba 2023",
        ano_fonte: "texto",
        pendencias: ["ano: x"],
      }),
    ).toThrow(/já preenchidos/);
    expect(() => analisarPpc(texto, "p.md")).toThrow(ErroFrontMatter);
  });
});
