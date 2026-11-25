// @effect-diagnostics nodeBuiltinImport:off -- monta raízes temporárias com node:fs síncrono para os carregadores e montadores síncronos sob teste
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterAll, describe, expect, test } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { criarCaminhos, naBase, relativo } from "./caminhos.ts";
import { analisarFrontMatter, ErroFrontMatter } from "./front-matter.ts";
import { aplicarGerados, type ArquivoGerado, mensagensDivergencias, type PastaGerada } from "./gerados.ts";
import { arquivosIndices, gerarIndices } from "./indice-ppcs.ts";
import { limparTitulo, removerAcentos, tituloDaLinha } from "@simplifica-if/kb/ppcs/secoes";
import { serializarFrontMatterPpc } from "@simplifica-if/kb/ppcs/front-matter";
import { conferirContrato, ehUrlAbsoluta } from "./esquemas.ts";
import { validarBase } from "./validacao.ts";
import { validarContratoNorma } from "./validacao/normas.ts";

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

/** Mensagens da conferência dos arquivos gerados, relativas a `base-conhecimento/`. */
const conferir = (
  raiz: string,
  arquivos: ReadonlyArray<ArquivoGerado>,
  pastas: { extrasEm?: ReadonlyArray<PastaGerada> } = {},
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
assinada_em: "2020-01-02"
publicada_em: "a confirmar"
vigente_de: "2020-01-02"
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

Texto da lei.
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
    expect(corpo.startsWith("\nTexto da lei.")).toBe(true);
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
            markdown_path: "institucional/ifpr/ppcs/campus-a/tecnico-x/2021.md",
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
        "base-conhecimento/institucional/ifpr/ppcs/campus-a/tecnico-x/2021.md",
        serializarFrontMatterPpc({
          id: "ppc:campus-a/tecnico-x/2021",
          ano_documento: "2021",
          ano_evidencia: "PPC de 2021",
          ano_fonte: "https://ifpr.edu.br/x.pdf#page=1",
          fonte_url: "https://ifpr.edu.br/x.pdf",
          fonte_sha256: "a".repeat(64),
          convertido_em: "2026-11-13",
          conversor: "teste",
          proveniencia: "registrada",
        }) + `## 1 Objetivos\n${"objetivo ".repeat(80)}\n## 2 Ementário\n${"ementa ".repeat(10)}\n`,
      );
      const caminhos = criarCaminhos(raiz);
      const indices = gerarIndices(caminhos);
      expect(indices.itensPpc).toHaveLength(1);
      expect(indices.itensPpc[0]).toMatchObject({
        id: "campus-a/tecnico-x/2021",
        versao: "2021",
        vigente: true,
        modalidade: "Presencial",
        ano_documento: 2021,
        taxonomia: "tecnico",
        proveniencia: { situacao: "registrada", convertido_em: "2026-11-13", conversor: "teste" },
      });
      expect(indices.itensPpc[0]).not.toHaveProperty("vagas");
      expect(indices.itensSecao.map((item) => item.id)).toEqual([
        "campus-a/tecnico-x/2021#objetivos-1",
        "campus-a/tecnico-x/2021#ementas-1",
      ]);
      expect(indices.itensSecao[0]).toMatchObject({
        heading: "1 Objetivos",
        numeracao: "1",
        linha_inicio: 12,
        linha_fim: 13,
        preview: "objetivo ".repeat(80).slice(0, 500),
        origem_tipo: "titulo",
      });
      const { arquivos, ...pastas } = arquivosIndices(caminhos, indices);
      expect(yield* conferir(caminhos.raiz, arquivos, pastas)).toContain(
        "institucional/ifpr/ppcs/index.json ausente; rode x",
      );

      escrever(raiz, "base-conhecimento/institucional/ifpr/ppcs/secoes/antigo.jsonl", "");
      yield* aplicarGerados(arquivos, { modo: "gravar", raiz: caminhos.raiz, ...pastas });
      expect(yield* conferir(caminhos.raiz, arquivos, pastas)).toEqual([]);
      expect(
        NodeFS.readFileSync(NodePath.join(caminhos.secoesPpcs, "ementas.jsonl"), "utf-8").startsWith(
          '{"id":"campus-a/tecnico-x/2021#ementas-1",',
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

describe("contratos dos manifestos e índices", () => {
  const curso = {
    id: "tecnico-em-x",
    indice: 1,
    denominacao: "Técnico em X",
    denominacao_normalizada: "tecnico em x",
    eixo_tecnologico: "Eixo",
    area_tecnologica: "Área",
    carga_horaria_minima_horas: 800,
    descricao_carga_horaria_minima: "800 horas",
    perfil_profissional: "Perfil",
    pre_requisitos_ingresso: "Ensino fundamental",
    itinerarios_formativos: "Itinerários",
    campo_atuacao: "Campo",
    ocupacoes_cbo: "1234-56 Ocupação",
    codigos_cbo: ["1234-56"],
    infraestrutura_minima: "Laboratório",
    legislacao_profissional: "Lei",
  };

  test("aceita documento válido e devolve os dados decodificados", () => {
    expect(conferirContrato("cursoCnct", curso, "r")).toEqual({ erros: [], validos: curso });
  });

  test("relata cada problema com o rótulo, o caminho e a mensagem em português", () => {
    const { indice: _, ...semIndice } = curso;
    expect(
      conferirContrato(
        "cursoCnct",
        { ...semIndice, id: "Tecnico X", carga_horaria_minima_horas: 0, codigos_cbo: ["12", 3], extra: true },
        "r",
      ).erros,
    ).toEqual([
      "r: extra: Entrada inválida: campo não permitido",
      "r: id: deve ser slug ASCII minúsculo",
      "r: indice: Entrada inválida: campo obrigatório ausente",
      "r: carga_horaria_minima_horas: Entrada inválida: esperava um valor maior ou igual a 1",
      "r: codigos_cbo.0: deve ser código CBO (0000 ou 0000-00)",
      "r: codigos_cbo.1: Entrada inválida: esperava um texto",
    ]);
    expect(conferirContrato("cursoCnct", [], "r")).toEqual({
      erros: ["r: (raiz): Entrada inválida: esperava um objeto"],
      validos: null,
    });
  });

  test("datas, URLs, constantes e listas não vazias", () => {
    const manifesto = {
      id: "cnct",
      title: "CNCT",
      sigla: "CNCT",
      tipo: "catalogo_nacional_cursos_tecnicos",
      tipo_item: "curso_tecnico_cnct",
      schema_version: 1,
      edicao: "4ª",
      atualizacao_referencia: "2024",
      atualizado_em: "2026-01-01",
      fonte: "MEC",
      fonte_url: "https://cnct.mec.gov.br",
      atos_normativos_url: "https://cnct.mec.gov.br/atos",
      catalogo_pdf_url: "https://cnct.mec.gov.br/cnct.pdf",
      csv_origem_sha256: "a".repeat(64),
      total_cursos: 1,
      index_path: "catalogos/cnct/index.json",
      campos_curso: ["id"],
      uso_recomendado: ["consulta"],
    };
    expect(conferirContrato("manifestCnct", manifesto, "m").erros).toEqual([]);
    expect(
      conferirContrato(
        "manifestCnct",
        { ...manifesto, sigla: "X", atualizado_em: "01/01/2026", fonte_url: "cnct.mec.gov.br", campos_curso: [] },
        "m",
      ).erros,
    ).toEqual([
      'm: sigla: Entrada inválida: esperava o valor "CNCT"',
      "m: atualizado_em: deve estar em AAAA-MM-DD",
      "m: fonte_url: deve ser URI absoluta válida",
      "m: fonte_url: deve começar por https://",
      "m: campos_curso: Entrada inválida: não pode ser vazio",
    ]);
  });

  test("ehUrlAbsoluta exige esquema, autoridade explícita e nenhum espaço", () => {
    expect(ehUrlAbsoluta("https://ifpr.edu.br", "https")).toBe(true);
    expect(ehUrlAbsoluta("HTTPS://ifpr.edu.br/x", "https")).toBe(true);
    expect(ehUrlAbsoluta("http://ifpr.edu.br", "https")).toBe(false);
    expect(ehUrlAbsoluta("https:ifpr.edu.br")).toBe(false);
    expect(ehUrlAbsoluta("https:///ifpr.edu.br")).toBe(false);
    expect(ehUrlAbsoluta("https://:80")).toBe(true);
    expect(ehUrlAbsoluta("https://a b")).toBe(false);
    expect(ehUrlAbsoluta("https://[x")).toBe(false);
    expect(ehUrlAbsoluta("ftp://x")).toBe(true);
  });
});

describe("validação da base", () => {
  test("aponta normas fora do contrato ou do lugar e coleções ausentes", () => {
    const raiz = projetoTemporario();
    escrever(
      raiz,
      "base-conhecimento/normas/br/leis/lei.md",
      NORMA.replace("Texto da lei.", "## Resumo\n\nTexto da lei.") + "\n[x](nao.md)\n",
    );
    escrever(
      raiz,
      "base-conhecimento/normas/ifpr/resolucoes/2020-01-01_res.md",
      NORMA.replace('keywords:\n  - "teste"\n', ""),
    );
    escrever(raiz, "base-conhecimento/README.md", `${README}\n[ok](normas/br/leis/lei.md) ${"/Us"}${"ers/"}x\n`);
    escrever(raiz, "base-conhecimento/solta.md", "x");
    escrever(
      raiz,
      "base-conhecimento/normas/br/leis/outra.md",
      NORMA.replace("id: br/lei/2020/1", "id: br/lei/2020/2")
        .replace("numero: 1", "numero: 2")
        .replace("jurisdicao: BR", "jurisdicao: XX"),
    );
    const caminhos = criarCaminhos(raiz);

    const { erros, totalNormas } = validarBase(caminhos);
    expect(totalNormas).toBe(3);
    expect(erros).toEqual([
      `README.md contém padrão local proibido: ${"/Us"}${"ers/"}`,
      "normas não devem ficar na raiz do repositório: ['solta.md']",
      "manifesto CNCT não encontrado: catalogos/cnct/manifest.json",
      "índice CNCT não encontrado: catalogos/cnct/index.json",
      'normas/br/leis/lei.md: o corpo traz a seção "Resumo"; ele é só o texto da norma (use pontos_chave ou notas_da_fonte no front matter; orientação para PPC vai na ficha da revisão)',
      "normas/br/leis/lei.md: link interno inexistente: nao.md",
      "normas/br/leis/outra.md: id br/lei/2020/2 difere do derivado do ato: xx/lei/2020/2",
      "normas/br/leis/outra.md: jurisdição/tipo sem diretório configurado: ('XX', 'Lei')",
      "normas/ifpr/resolucoes/2020-01-01_res.md: keywords: Entrada inválida: campo obrigatório ausente",
      "normas/ifpr/resolucoes/2020-01-01_res.md: nome do arquivo não deve começar com data",
      "normas/ifpr/resolucoes/2020-01-01_res.md: deveria estar em normas/br/leis",
      "normas/ifpr/resolucoes/2020-01-01_res.md: id duplicado br/lei/2020/1 (também em normas/br/leis/lei.md)",
      "config/vigencia.yaml não encontrado (data_referencia da vigência publicada)",
    ]);
  });

  test("contrato da norma: todos os erros de esquemaNorma, de qualquer campo", () => {
    const { meta } = analisarFrontMatter(
      NORMA.replace('title: "Lei nº 1/2020"', 'title: ""').replace(
        "keywords:",
        'pontos_chave: "texto"\nnotas_da_fonte:\n  - ""\nkeywords:',
      ),
      "x.md",
    );
    expect(validarContratoNorma("x.md", meta)).toEqual([
      "x.md: title: Entrada inválida: não pode ser vazio",
      "x.md: pontos_chave: Entrada inválida: esperava uma lista",
      "x.md: notas_da_fonte.0: Entrada inválida: não pode ser vazio",
    ]);
  });

  test("vigência obrigatória: vigente_de com data ou aguardando publicação, nunca a confirmar", () => {
    const erros = (vigente: string) =>
      validarContratoNorma(
        "x.md",
        analisarFrontMatter(NORMA.replace('vigente_de: "2020-01-02"', `vigente_de: "${vigente}"`), "x.md").meta,
      );
    expect(erros("a confirmar")).toEqual(["x.md: vigente_de: Entrada inválida: formato inválido"]);
    expect(erros("aguardando publicação")).toEqual([]);
    expect(erros("2020-01-03")).toEqual([]);
  });

  test("fonte oficial: fonte_url só https", () => {
    const errosDeFonte = (troca: string) => {
      const raiz = projetoTemporario();
      escrever(
        raiz,
        "base-conhecimento/normas/br/leis/lei.md",
        NORMA.replace('fonte_url: "https://exemplo.gov.br/lei"', troca),
      );
      escrever(raiz, "base-conhecimento/README.md", README);
      return validarBase(criarCaminhos(raiz)).erros.filter((erro) => /fonte|assinada_em/.test(erro));
    };
    expect(errosDeFonte('fonte_url: "http://exemplo.gov.br/lei"')).toEqual([
      "normas/br/leis/lei.md: fonte_url: fonte_url deve ser URL https, sem espaços",
    ]);
    expect(errosDeFonte('fonte_referencia: "SEI/IFPR nº 1"')).toEqual([]);
  });
});
