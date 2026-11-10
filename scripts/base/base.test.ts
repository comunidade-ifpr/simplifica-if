import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { criarCaminhos, naBase, relativo } from "./caminhos.ts";
import {
  analisarFrontMatter,
  ErroFrontMatter,
  itemManifest,
  manifestJson,
  montarManifest,
  valorYaml,
} from "./front-matter.ts";
import {
  dataIndiceAtual,
  dividirSecoes,
  gerarIndices,
  gravarIndices,
  limparTitulo,
  removerAcentos,
  tipoSecao,
  tituloDaLinha,
  verificarIndices,
} from "./indice-ppcs.ts";
import { gravarBase, substituirTabela, verificarBase } from "./readme.ts";
import { validarJsonSchema } from "./schema.ts";
import { compararDiretorios, renderizarSite } from "./site.ts";
import { validarBase } from "./validacao.ts";

const temporarios: string[] = [];
afterAll(() => {
  for (const diretorio of temporarios) rmSync(diretorio, { recursive: true, force: true });
});

function projetoTemporario(): string {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "base-teste-"));
  temporarios.push(raiz);
  return raiz;
}

function escrever(raiz: string, relativo: string, conteudo: string) {
  const caminho = path.join(raiz, relativo);
  mkdirSync(path.dirname(caminho), { recursive: true });
  writeFileSync(caminho, conteudo);
}

const NORMA = `---
title: "Lei nº 1/2020"
tipo_documento: Lei
numero: 1
ano: 2020
data_publicacao: "2020-01-02"
orgao: "Congresso"
jurisdicao: BR
ementa: "Ementa de teste."
status_vigencia: vigente
keywords:
  - "teste"
aliases: ["Lei 1/2020", "L1"]
fonte: "https://exemplo.gov.br/lei"
---

## Resumo

Texto.
`;

const README = `# Base

| Documento | Tipo | Ano | Assunto |
|-----------|------|-----|---------|
| antigo |

## Manutenção

Texto.
`;

describe("front matter", () => {
  test("interpreta escalares, listas YAML, listas inline e ano inteiro", () => {
    const { meta, corpo } = analisarFrontMatter(NORMA, "x.md");
    expect(meta.ano).toBe(2020);
    expect(meta.numero).toBe("1");
    expect(meta.title).toBe("Lei nº 1/2020");
    expect(meta.keywords).toEqual(["teste"]);
    expect(meta.aliases).toEqual(["Lei 1/2020", "L1"]);
    expect(corpo.startsWith("\n## Resumo")).toBe(true);
    expect(valorYaml('[a, , "b"]')).toEqual(["a", "b"]);
    expect(valorYaml("2020", "numero")).toBe("2020");
  });

  test("acusa erros com o caminho do arquivo", () => {
    expect(() => analisarFrontMatter("sem", "a.md")).toThrow("a.md: arquivo sem front matter");
    expect(() => analisarFrontMatter("---\nx: 1\n", "a.md")).toThrow("a.md: front matter sem fechamento");
    expect(() => analisarFrontMatter("---\nx: 1\n  - y\n---\n", "a.md")).toThrow("campo x mistura escalar e lista");
    expect(() => analisarFrontMatter("---\nsem dois pontos\n---\n", "a.md")).toThrow(ErroFrontMatter);
  });

  test("ano com dígitos Unicode vira inteiro, como int() do Python", () => {
    expect(valorYaml("２０２６", "ano")).toBe(2026);
    expect(valorYaml("٢٠٢٤", "ano")).toBe(2024);
    expect(valorYaml("𝟐𝟎𝟏𝟗", "ano")).toBe(2019);
    expect(valorYaml("２０２６", "numero")).toBe("２０２６");
  });
});

describe("caminhos", () => {
  test("naBase e relativo são léxicos como o pathlib (preservam ..)", () => {
    const caminhos = criarCaminhos("/p");
    expect(naBase(caminhos, "../README.md")).toBe("/p/base-conhecimento/../README.md");
    expect(relativo(caminhos, naBase(caminhos, "../README.md"))).toBe("../README.md");
    expect(relativo(caminhos, path.dirname(naBase(caminhos, "../README.md")))).toBe("..");
    expect(relativo(caminhos, naBase(caminhos, "normas//./a.md"))).toBe("normas/a.md");
    expect(naBase(caminhos, "/etc/x")).toBe("/etc/x");
    expect(() => relativo(caminhos, "/etc/x")).toThrow("is not in the subpath");
  });
});

describe("manifest e README", () => {
  test("gera manifest ordenado e tabela do README; --check detecta divergência", () => {
    const raiz = projetoTemporario();
    escrever(raiz, "base-conhecimento/normas/br/leis/lei-b.md", NORMA);
    escrever(
      raiz,
      "base-conhecimento/normas/br/leis/lei-a.md",
      NORMA.replace("Lei nº 1/2020", "Lei nº 0/2019").replace('"2020-01-02"', '"2019-05-05"'),
    );
    escrever(raiz, "base-conhecimento/README.md", README);
    escrever(raiz, "base-conhecimento/manifest.json", "[]\n");
    const caminhos = criarCaminhos(raiz);
    const manifest = montarManifest(caminhos);
    expect(manifest.map((item) => item.path)).toEqual(["normas/br/leis/lei-a.md", "normas/br/leis/lei-b.md"]);
    expect(Object.keys(manifest[0]!).at(-1)).toBe("path");
    expect(verificarBase(caminhos, manifest)).toEqual([
      "manifest.json está desatualizado",
      "README.md está desatualizado",
    ]);

    gravarBase(caminhos, manifest);
    expect(verificarBase(caminhos, manifest)).toEqual([]);
    expect(readFileSync(caminhos.manifest, "utf-8")).toBe(manifestJson(manifest));
    expect(readFileSync(caminhos.readme, "utf-8")).toContain(
      "| [Lei nº 0/2019](normas/br/leis/lei-a.md) | Lei | 2020 | Ementa de teste. |\n| [Lei nº 1/2020](normas/br/leis/lei-b.md) | Lei | 2020 | Ementa de teste. |\n\n## Manutenção",
    );
    expect(() => substituirTabela("sem tabela", manifest)).toThrow();
  });
});

describe("índice de PPCs", () => {
  test("reconhece títulos markdown e em negrito com marcadores", () => {
    expect(tituloDaLinha("## 3.1 –Objetivos  ##")).toBe("3.1 – Objetivos");
    expect(tituloDaLinha("**4. MATRIZ CURRICULAR**")).toBe("4. MATRIZ CURRICULAR");
    expect(tituloDaLinha("**Texto qualquer em negrito**")).toBeNull();
    expect(tituloDaLinha("# Título de nível 1")).toBeNull();
    expect(limparTitulo("2.1-  <br>Justificativa |")).toBe("2.1- Justificativa");
  });

  test("classifica seções sem acentos", () => {
    expect(removerAcentos("Concepção ﬁ")).toBe("Concepcao fi");
    expect(tipoSecao("PERFIL PROFISSIONAL DE CONCLUSÃO")).toBe("perfil_egresso");
    expect(tipoSecao("Estágio Supervisionado")).toBe("estagio_praticas");
    expect(tipoSecao("Perfil do pessoal docente")).toBe("corpo_docente");
    expect(tipoSecao("Anexos")).toBe("outros");
  });

  test("divide seções e descarta as curtas", () => {
    const markdown = `capa\n## Justificativa\n${"texto ".repeat(10)}\n## Objetivos\ncurto\n**Referências**\n${"ref ".repeat(20)}`;
    const secoes = dividirSecoes(markdown);
    expect(secoes.map(([titulo]) => titulo)).toEqual(["Justificativa", "Referências"]);
    expect(secoes[0]![1]).toBe("texto ".repeat(10).trim());
  });

  test("gera e verifica index.json e secoes/*.jsonl", () => {
    const raiz = projetoTemporario();
    const campus = {
      id: "campus-a",
      nome: "Campus A",
      cursos: [
        {
          curso_slug: "tecnico-x",
          nome: "Técnico X",
          nivel: "Técnico",
          tipo_oferta: "Integrado",
          url: "https://ifpr.edu.br/x",
          modalidade: "Presencial",
          ppc: {
            url: "https://ifpr.edu.br/x.pdf",
            markdown_path: "institucional/ifpr/ppcs/campus-a/tecnico-x.md",
            conversao: { status: "convertido" },
            metadados: { ano_documento: { ano: 2021 }, vagas: { quantidade: "40" } },
          },
        },
        { curso_slug: "sem-ppc", nome: "Sem PPC", nivel: "Técnico", tipo_oferta: "Subsequente", url: "https://x" },
      ],
    };
    escrever(raiz, "base-conhecimento/institucional/ifpr/campi/campus-a.json", JSON.stringify(campus));
    escrever(raiz, "base-conhecimento/institucional/ifpr/campi/index.json", "{}");
    escrever(
      raiz,
      "base-conhecimento/institucional/ifpr/ppcs/campus-a/tecnico-x.md",
      `## Objetivos\n${"objetivo ".repeat(80)}\n## Ementas\n${"ementa ".repeat(10)}\n`,
    );
    const caminhos = criarCaminhos(raiz);
    const indices = gerarIndices(caminhos, "2026-01-01");
    expect(indices.itensPpc).toHaveLength(1);
    expect(indices.itensPpc[0]).toMatchObject({
      id: "campus-a/tecnico-x",
      modalidade: "Presencial",
      ano_documento: 2021,
    });
    expect(indices.itensPpc[0]).not.toHaveProperty("vagas");
    expect(indices.itensSecao.map((item) => item.id)).toEqual([
      "campus-a/tecnico-x#objetivos-1",
      "campus-a/tecnico-x#ementas-1",
    ]);
    expect((indices.itensSecao[0]!.preview as string).length).toBe(500);
    expect(verificarIndices(caminhos, indices)).toContain("institucional/ifpr/ppcs/index.json está desatualizado");

    escrever(raiz, "base-conhecimento/institucional/ifpr/ppcs/secoes/antigo.jsonl", "");
    gravarIndices(caminhos, indices);
    expect(verificarIndices(caminhos, indices)).toEqual([]);
    expect(dataIndiceAtual(caminhos, "2030-01-01")).toBe("2026-01-01");
    expect(readFileSync(path.join(caminhos.secoesPpcs, "ementas.jsonl"), "utf-8")).toStartWith(
      '{"id":"campus-a/tecnico-x#ementas-1",',
    );
    expect(readFileSync(path.join(caminhos.secoesPpcs, "avaliacao.jsonl"), "utf-8")).toBe("");

    escrever(raiz, "base-conhecimento/institucional/ifpr/ppcs/secoes/extra.jsonl", "");
    expect(verificarIndices(caminhos, indices)).toEqual([
      "institucional/ifpr/ppcs/secoes/extra.jsonl não é mais gerado",
    ]);
  });
});

describe("JSON Schema", () => {
  const schema = {
    type: "object",
    required: ["id", "data"],
    additionalProperties: false,
    properties: {
      id: { type: "string", pattern: "^[a-z]+$", minLength: 2 },
      data: { type: "string", format: "date" },
      url: { type: "string", format: "uri" },
      n: { type: "number", minimum: 1 },
      tipo: { enum: ["a", "b"] },
      lista: { type: "array", maxItems: 1, items: { type: "integer" } },
    },
  };

  test("aceita documento válido (inteiro conta como number)", () => {
    expect(
      validarJsonSchema({ id: "ab", data: "2026-01-01", url: "https://x", n: 2, tipo: "a", lista: [1] }, schema, "r"),
    ).toEqual([]);
  });

  test("reporta erros com as mensagens do validador Python", () => {
    expect(
      validarJsonSchema({ id: "A", url: "x y", n: 0, tipo: "c", lista: [1, "2"], extra: true }, schema, "r"),
    ).toEqual([
      "r: $.data é obrigatório",
      "r: $.id deve ter ao menos 2 caractere(s)",
      "r: $.id não corresponde ao padrão ^[a-z]+$",
      "r: $.url deve ser URI absoluta válida",
      "r: $.n deve ser maior ou igual a 1",
      "r: $.tipo deve ser um de ['a', 'b']",
      "r: $.lista deve ter no máximo 1 item(ns)",
      "r: $.lista[1] deve ser integer, recebido string",
      "r: $.extra não é permitido",
    ]);
    expect(validarJsonSchema([], schema, "r")).toEqual(["r: $ deve ser object, recebido array"]);
  });
});

describe("validação da base", () => {
  test("aponta normas, manifest e coleções ausentes", () => {
    const raiz = projetoTemporario();
    escrever(
      raiz,
      "base-conhecimento/normas/br/leis/lei.md",
      NORMA.replace("## Resumo", "## Outro") + "\n[x](nao.md)\n",
    );
    escrever(
      raiz,
      "base-conhecimento/normas/ifpr/resolucoes/2020-01-01_res.md",
      NORMA.replace('keywords:\n  - "teste"\n', ""),
    );
    escrever(raiz, "base-conhecimento/README.md", `${README}\n[ok](normas/br/leis/lei.md) ${"/Us"}${"ers/"}x\n`);
    escrever(raiz, "base-conhecimento/solta.md", "x");
    const caminhos = criarCaminhos(raiz);
    const manifest = [itemManifest(caminhos, path.join(caminhos.normas, "br/leis/lei.md"))];
    writeFileSync(caminhos.manifest, manifestJson(manifest));

    const { erros, totalNormas } = validarBase(caminhos);
    expect(totalNormas).toBe(1);
    expect(erros).toEqual([
      `README.md contém padrão local proibido: ${"/Us"}${"ers/"}`,
      "normas não devem ficar na raiz do repositório: ['solta.md']",
      "manifest.json não cobre exatamente as normas publicadas: manifest=['normas/br/leis/lei.md'] markdown=['normas/br/leis/lei.md', 'normas/ifpr/resolucoes/2020-01-01_res.md']",
      `README.md contém padrão local proibido: ${"/Us"}${"ers/"}`,
      "institucional_manifest.json não encontrado: institucional_manifest.json",
      "índice de campi não encontrado: institucional/ifpr/campi/index.json",
      "catalogos_manifest.json não encontrado: catalogos_manifest.json",
      "manifesto CNCT não encontrado: catalogos/cnct/manifest.json",
      "índice CNCT não encontrado: catalogos/cnct/index.json",
      "normas/br/leis/lei.md: corpo não começa com ## Resumo",
      "normas/br/leis/lei.md: link interno inexistente: nao.md",
      "normas/ifpr/resolucoes/2020-01-01_res.md: campos obrigatórios ausentes: keywords",
      "normas/ifpr/resolucoes/2020-01-01_res.md: keywords deve ser lista não vazia",
    ]);

    writeFileSync(caminhos.manifest, manifestJson([{ ...manifest[0]!, jurisdicao: "XX", title: "Outro" }]));
    const { erros: errosManifest } = validarBase(caminhos);
    expect(errosManifest).toContain("manifest.json: item com jurisdição/tipo sem diretório configurado: ('XX', 'Lei')");
    expect(errosManifest).toContain("normas/br/leis/lei.md: manifest.json diverge do front matter no campo title");
    expect(errosManifest).not.toContain("normas/br/leis/lei.md: manifest.json diverge do front matter no campo ano");
  });
});

describe("site", () => {
  test("copia a base sem arquivos locais e compara como filecmp.dircmp", () => {
    const raiz = projetoTemporario();
    escrever(raiz, "base/a.md", "a");
    escrever(raiz, "base/docs/b.md", "b");
    escrever(raiz, "base/.DS_Store", "x");
    escrever(raiz, "base/__pycache__/m.pyc", "x");
    escrever(raiz, "base/docs/c.pyc", "x");
    const site = path.join(raiz, "site");
    renderizarSite(path.join(raiz, "base"), site);
    const esperado = path.join(raiz, "esperado");
    renderizarSite(path.join(raiz, "base"), esperado);
    expect(compararDiretorios(esperado, site)).toEqual([]);

    writeFileSync(path.join(site, "docs", "b.md"), "B");
    escrever(site, "extra.txt", "x");
    escrever(site, ".DS_Store", "x");
    rmSync(path.join(site, "a.md"));
    expect(compararDiretorios(esperado, site)).toEqual([
      "ausente em site/: a.md",
      "extra em site/: .DS_Store",
      "extra em site/: extra.txt",
      "docs/conteúdo divergente: b.md",
    ]);
    expect(() => renderizarSite(path.join(raiz, "base"), path.join(raiz, "base"))).toThrow("não pode ser o mesmo");
  });
});
