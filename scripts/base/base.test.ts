// @effect-diagnostics nodeBuiltinImport:off -- monta raízes temporárias com node:fs síncrono para os carregadores e montadores síncronos sob teste
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterAll, describe, expect, test } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { criarCaminhos, naBase, relativo } from "./caminhos.ts";
import { analisarFrontMatter, ErroFrontMatter, itemManifest, manifestJson, montarManifest } from "./front-matter.ts";
import { aplicarGerados, type ArquivoGerado, mensagensDivergencias, type PastaGerada } from "./gerados.ts";
import {
  arquivosIndices,
  dataIndiceAtual,
  gerarIndices,
  limparTitulo,
  removerAcentos,
  tituloDaLinha,
} from "./indice-ppcs.ts";
import { serializarFrontMatterPpc } from "@simplifica-if/kb/ppcs/front-matter";
import { validarJsonSchema } from "@simplifica-if/kb/schema";
import { validarBase } from "./validacao.ts";

const temporarios: string[] = [];
afterAll(() => {
  for (const diretorio of temporarios) NodeFS.rmSync(diretorio, { recursive: true, force: true });
});

function projetoTemporario(): string {
  const raiz = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "base-teste-"));
  temporarios.push(raiz);
  return raiz;
}

function escrever(raiz: string, relativo: string, conteudo: string) {
  const caminho = NodePath.join(raiz, relativo);
  NodeFS.mkdirSync(NodePath.dirname(caminho), { recursive: true });
  NodeFS.writeFileSync(caminho, conteudo);
}

/** Mensagens do `--check` sobre os arquivos gerados, relativas a `base-conhecimento/`. */
const conferir = (
  raiz: string,
  arquivos: ReadonlyArray<ArquivoGerado>,
  pastas: { extrasEm?: ReadonlyArray<PastaGerada>; obsoletos?: ReadonlyArray<string> } = {},
) =>
  aplicarGerados(arquivos, { modo: "verificar", raiz, ...pastas }).pipe(
    Effect.map((divergencias) => mensagensDivergencias(divergencias, "x")),
  );

const NORMA = `---
id: br/lei/2020/1
title: "Lei nº 1/2020"
tipo_documento: Lei
numero: 1
ano: 2020
data_publicacao: "2020-01-02"
assinada_em: "2020-01-02"
publicada_em: "a confirmar"
vigente_de: "a confirmar"
datas_fonte: "Teste."
orgao: "Presidência da República"
jurisdicao: BR
ementa: "Ementa de teste."
status_vigencia: vigente
keywords:
  - "teste"
aliases: ["Lei 1/2020", "L1"]
fonte_url: "https://exemplo.gov.br/lei"
---

## Resumo

Texto.
`;

const README = `# Base

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
  });

  test("schema failsafe: número, data e booleano ficam como texto; só ano vira inteiro", () => {
    const { meta } = analisarFrontMatter(
      "---\nnumero: 9394\nano: 1996\ndata_publicacao: 1996-12-20\nx: true\n---\n",
      "a.md",
    );
    expect(meta).toEqual({ numero: "9394", ano: 1996, data_publicacao: "1996-12-20", x: "true" });
  });

  test("acusa erros com o caminho do arquivo", () => {
    expect(() => analisarFrontMatter("sem", "a.md")).toThrow("a.md: arquivo sem front matter");
    expect(() => analisarFrontMatter("---\nx: 1\n", "a.md")).toThrow("a.md: front matter sem fechamento");
    expect(() => analisarFrontMatter("---\nx: [1, 2\n---\n", "a.md")).toThrow(ErroFrontMatter);
    expect(() => analisarFrontMatter("---\nx: 1\nx: 2\n---\n", "a.md")).toThrow("a.md: YAML inválido");
    expect(() => analisarFrontMatter("---\nx:\n  y: 1\n---\n", "a.md")).toThrow("só texto ou listas de texto");
  });

  test("ano com dígitos Unicode vira inteiro", () => {
    expect(analisarFrontMatter("---\nano: ２０２６\nnumero: ２０２６\n---\n", "a.md").meta).toEqual({
      ano: 2026,
      numero: "２０２６",
    });
    expect(analisarFrontMatter("---\nano: 𝟐𝟎𝟏𝟗\n---\n", "a.md").meta.ano).toBe(2019);
  });
});

describe("caminhos", () => {
  test("naBase e relativo são léxicos (preservam ..)", () => {
    const caminhos = criarCaminhos("/p");
    expect(naBase(caminhos, "../README.md")).toBe("/p/base-conhecimento/../README.md");
    expect(relativo(caminhos, naBase(caminhos, "../README.md"))).toBe("../README.md");
    expect(relativo(caminhos, NodePath.dirname(naBase(caminhos, "../README.md")))).toBe("..");
    expect(relativo(caminhos, naBase(caminhos, "normas//./a.md"))).toBe("normas/a.md");
    expect(naBase(caminhos, "/etc/x")).toBe("/etc/x");
    expect(() => relativo(caminhos, "/etc/x")).toThrow("is not in the subpath");
  });
});

describe("manifest", () => {
  it.effect("gera manifest ordenado; --check detecta divergência", () =>
    Effect.gen(function* () {
      const raiz = projetoTemporario();
      escrever(raiz, "base-conhecimento/normas/br/leis/lei-b.md", NORMA);
      escrever(
        raiz,
        "base-conhecimento/normas/br/leis/lei-a.md",
        NORMA.replace("Lei nº 1/2020", "Lei nº 0/2019").replace('"2020-01-02"', '"2019-05-05"'),
      );
      escrever(raiz, "base-conhecimento/manifest.json", "[]\n");
      const caminhos = criarCaminhos(raiz);
      const manifest = montarManifest(caminhos);
      expect(manifest.map((item) => item.path)).toEqual(["normas/br/leis/lei-a.md", "normas/br/leis/lei-b.md"]);
      expect(Object.keys(manifest[0]!).at(-1)).toBe("path");
      const arquivos = [{ caminho: caminhos.manifest, texto: manifestJson(manifest) }];
      expect(yield* conferir(caminhos.raiz, arquivos)).toEqual(["manifest.json está desatualizado; rode x"]);

      yield* aplicarGerados(arquivos, { modo: "gravar", raiz: caminhos.raiz });
      expect(yield* conferir(caminhos.raiz, arquivos)).toEqual([]);
      expect(NodeFS.readFileSync(caminhos.manifest, "utf-8")).toBe(manifestJson(manifest));
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("índice de PPCs", () => {
  test("reconhece títulos markdown e em negrito com marcadores", () => {
    expect(tituloDaLinha("## 3.1 –Objetivos  ##")).toBe("3.1 – Objetivos");
    expect(tituloDaLinha("**4. MATRIZ CURRICULAR**")).toBe("4. MATRIZ CURRICULAR");
    expect(tituloDaLinha("**Texto qualquer em negrito**")).toBeNull();
    expect(tituloDaLinha("# Título de nível 1")).toBeNull();
    expect(limparTitulo("2.1-  <br>Justificativa |")).toBe("2.1- Justificativa");
  });

  test("remove acentos", () => {
    expect(removerAcentos("Concepção ﬁ")).toBe("Concepcao fi");
  });

  it.effect("gera e verifica index.json e secoes/*.jsonl", () =>
    Effect.gen(function* () {
      const raiz = projetoTemporario();
      const ifpr = "base-conhecimento/institucional/ifpr";
      escrever(raiz, `${ifpr}/campi/campus-a.json`, JSON.stringify({ campus_id: "campus-a", nome: "Campus A" }));
      escrever(
        raiz,
        `${ifpr}/cursos/campus-a/tecnico-x.json`,
        JSON.stringify({
          campus_id: "campus-a",
          curso_slug: "tecnico-x",
          nome: "Técnico X",
          nivel: "médio",
          forma_oferta: "Integrado",
          pagina_oficial: "https://ifpr.edu.br/x",
          modalidade: "Presencial",
          // Vagas sem o trecho do PPC que as sustenta não vão para o índice.
          ppc: {
            url: "https://ifpr.edu.br/x.pdf",
            markdown_path: "institucional/ifpr/ppcs/campus-a/tecnico-x.md",
            ano_documento: 2021,
            vagas: "40",
          },
        }),
      );
      escrever(
        raiz,
        `${ifpr}/cursos/campus-a/sem-ppc.json`,
        JSON.stringify({
          campus_id: "campus-a",
          curso_slug: "sem-ppc",
          nome: "Sem PPC",
          nivel: "Técnico",
          forma_oferta: "Subsequente",
          pagina_oficial: "https://x",
        }),
      );
      escrever(raiz, `${ifpr}/cursos/index.json`, "{}");
      escrever(
        raiz,
        "base-conhecimento/institucional/ifpr/ppcs/campus-a/tecnico-x.md",
        serializarFrontMatterPpc({
          id: "ppc:campus-a/tecnico-x",
          fonte_url: "https://ifpr.edu.br/x.pdf",
          fonte_sha256: "a".repeat(64),
          convertido_em: "2026-11-13",
          conversor: "teste",
          proveniencia: "registrada",
        }) + `## 1 Objetivos\n${"objetivo ".repeat(80)}\n## 2 Ementário\n${"ementa ".repeat(10)}\n`,
      );
      const caminhos = criarCaminhos(raiz);
      const indices = gerarIndices(caminhos, "2026-01-01");
      expect(indices.itensPpc).toHaveLength(1);
      expect(indices.itensPpc[0]).toMatchObject({
        id: "campus-a/tecnico-x",
        modalidade: "Presencial",
        ano_documento: 2021,
        taxonomia: "tecnico",
        proveniencia: { situacao: "registrada", convertido_em: "2026-11-13", conversor: "teste" },
      });
      expect(indices.itensPpc[0]).not.toHaveProperty("vagas");
      expect(indices.itensSecao.map((item) => item.id)).toEqual([
        "campus-a/tecnico-x#objetivos-1",
        "campus-a/tecnico-x#ementas-1",
      ]);
      expect(indices.itensSecao[0]).toMatchObject({
        heading: "1 Objetivos",
        numeracao: "1",
        linha_inicio: 9,
        linha_fim: 10,
        preview: "objetivo ".repeat(80).slice(0, 500),
        origem_tipo: "titulo",
      });
      const { arquivos, ...pastas } = arquivosIndices(caminhos, indices);
      expect(yield* conferir(caminhos.raiz, arquivos, pastas)).toContain(
        "institucional/ifpr/ppcs/index.json ausente; rode x",
      );

      escrever(raiz, "base-conhecimento/institucional/ifpr/ppcs/secoes/antigo.jsonl", "");
      escrever(raiz, "base-conhecimento/institucional/ifpr/ppcs/secoes.jsonl", "");
      yield* aplicarGerados(arquivos, { modo: "gravar", raiz: caminhos.raiz, ...pastas });
      expect(yield* conferir(caminhos.raiz, arquivos, pastas)).toEqual([]);
      expect(NodeFS.existsSync(NodePath.join(caminhos.ppcs, "secoes.jsonl"))).toBe(false);
      expect(dataIndiceAtual(caminhos, "2030-01-01")).toBe("2026-01-01");
      expect(
        NodeFS.readFileSync(NodePath.join(caminhos.secoesPpcs, "ementas.jsonl"), "utf-8").startsWith(
          '{"id":"campus-a/tecnico-x#ementas-1",',
        ),
      ).toBe(true);
      expect(NodeFS.readFileSync(NodePath.join(caminhos.secoesPpcs, "avaliacao.jsonl"), "utf-8")).toBe("");

      escrever(raiz, "base-conhecimento/institucional/ifpr/ppcs/secoes/extra.jsonl", "");
      expect(yield* conferir(caminhos.raiz, arquivos, pastas)).toEqual([
        "institucional/ifpr/ppcs/secoes/extra.jsonl não é mais gerado; rode x",
      ]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
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

  test("reporta erros com as mensagens históricas do validador", () => {
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

  test("ordena as mensagens pelo documento, não pelo schema", () => {
    const aninhado = {
      type: "object",
      required: ["b", "a"],
      additionalProperties: false,
      properties: {
        a: { type: "object", additionalProperties: false, properties: { x: { const: 1 } } },
        b: { type: "string", enum: ["s"] },
      },
    };
    expect(validarJsonSchema({ z: 1, a: { y: 2, x: 3 }, b: 5 }, aninhado, "r")).toEqual([
      "r: $.z não é permitido",
      "r: $.a.y não é permitido",
      "r: $.a.x deve ser 1",
      "r: $.b deve ser string, recebido integer",
    ]);
    expect(validarJsonSchema({}, aninhado, "r")).toEqual(["r: $.b é obrigatório", "r: $.a é obrigatório"]);
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
    const manifest = [itemManifest(caminhos, NodePath.join(caminhos.normas, "br/leis/lei.md"))];
    NodeFS.writeFileSync(caminhos.manifest, manifestJson(manifest));

    const { erros, totalNormas } = validarBase(caminhos);
    expect(totalNormas).toBe(1);
    expect(erros).toEqual([
      `README.md contém padrão local proibido: ${"/Us"}${"ers/"}`,
      "normas não devem ficar na raiz do repositório: ['solta.md']",
      "manifest.json não cobre exatamente as normas publicadas: manifest=['normas/br/leis/lei.md'] markdown=['normas/br/leis/lei.md', 'normas/ifpr/resolucoes/2020-01-01_res.md']",
      `README.md contém padrão local proibido: ${"/Us"}${"ers/"}`,
      "institucional_manifest.json não encontrado: institucional_manifest.json",
      "catalogos_manifest.json não encontrado: catalogos_manifest.json",
      "manifesto CNCT não encontrado: catalogos/cnct/manifest.json",
      "índice CNCT não encontrado: catalogos/cnct/index.json",
      "normas/br/leis/lei.md: corpo não começa com ## Resumo",
      "normas/br/leis/lei.md: link interno inexistente: nao.md",
      "normas/ifpr/resolucoes/2020-01-01_res.md: campos obrigatórios ausentes: keywords",
      "normas/ifpr/resolucoes/2020-01-01_res.md: keywords deve ser lista não vazia",
      "normas/ifpr/resolucoes/2020-01-01_res.md: id duplicado br/lei/2020/1 (também em normas/br/leis/lei.md)",
      "config/vigencia.yaml não encontrado (data_referencia da vigência publicada)",
    ]);

    NodeFS.writeFileSync(caminhos.manifest, manifestJson([{ ...manifest[0]!, jurisdicao: "XX", title: "Outro" }]));
    const { erros: errosManifest } = validarBase(caminhos);
    expect(errosManifest).toContain("manifest.json: item com jurisdição/tipo sem diretório configurado: ('XX', 'Lei')");
    expect(errosManifest).toContain("normas/br/leis/lei.md: manifest.json diverge do front matter no campo title");
    expect(errosManifest).not.toContain("normas/br/leis/lei.md: manifest.json diverge do front matter no campo ano");
  });

  test("fonte oficial: fonte_url só https e o campo antigo fonte recusado", () => {
    const errosDeFonte = (troca: string, norma = NORMA) => {
      const raiz = projetoTemporario();
      escrever(
        raiz,
        "base-conhecimento/normas/br/leis/lei.md",
        norma.replace('fonte_url: "https://exemplo.gov.br/lei"', troca),
      );
      escrever(raiz, "base-conhecimento/README.md", README);
      const caminhos = criarCaminhos(raiz);
      NodeFS.writeFileSync(
        caminhos.manifest,
        manifestJson([itemManifest(caminhos, NodePath.join(caminhos.normas, "br/leis/lei.md"))]),
      );
      return validarBase(caminhos).erros.filter((erro) => /fonte|assinada_em/.test(erro));
    };
    expect(errosDeFonte('fonte_url: "http://exemplo.gov.br/lei"')).toEqual([
      "normas/br/leis/lei.md: fonte_url: fonte_url deve ser URL https, sem espaços",
    ]);
    // recusado na struct: sai junto com os outros erros, sem esperar a correção deles
    expect(
      errosDeFonte('fonte: "Fonte oficial pendente"', NORMA.replace('assinada_em: "2020-01-02"', 'assinada_em: "x"')),
    ).toEqual([
      "normas/br/leis/lei.md: fonte: campo substituído por fonte_url (URL https) e fonte_referencia (texto)",
      "normas/br/leis/lei.md: assinada_em: assinada_em deve ser AAAA-MM-DD",
    ]);
    expect(errosDeFonte('fonte_referencia: "SEI/IFPR nº 1"')).toEqual([]);
  });
});
