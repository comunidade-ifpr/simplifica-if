// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalJsonInEffect:off -- os testes montam rodadas em diretórios temporários e chamam a CLI por processo, com relógio fixo injetado; o JSON lido do kb.sqlite é de fixture
/**
 * Orquestração da revisar-ppc em TypeScript: preparação da rodada,
 * normalização do Markdown, identificação, CNCT, grupos de sub-agentes,
 * prompts, grupo avulso, mescla e validação de resultados (casos portados de
 * `test_flow.py`).
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, describe, expect, layer, test } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { serializarJsonTipado } from "@simplifica-if/kb/primitivas/json-tipado";
import { casefold } from "@simplifica-if/kb/primitivas/texto";
import { Flutuante, type Dicionario } from "@simplifica-if/kb/primitivas/valores";
import { caminhosPadrao } from "../scripts/caminhos.ts";
import { compararPpcComCnct } from "../scripts/cnct-catalogo.ts";
import { extrairIdentificacaoDaConversao, inferirIdentificacaoDoMarkdown } from "../scripts/identificacao.ts";
import { normalizarMarkdown } from "@simplifica-if/ppc/normalizador-markdown";
import { mesclarIdentificacaoPreferindoPreenchidos, prepararDocumento } from "../scripts/preparar-documento.ts";
import { referenciasLegiveisDaFicha, universoOuVazio } from "../scripts/referencias-fichas.ts";
import { ErroResultadosSubagents, mesclarResultadosAvulsos, validarResultadosRodada } from "../scripts/resultados.ts";
import * as NodeSqlite from "node:sqlite";
import { camadaKb } from "../scripts/revisar_ppc.ts";
import { agoraIso, caminhosRodada, escreverJsonDaRodada, lerJsonDaRodada, timestampSlug } from "../scripts/rodada.ts";
import {
  agruparFichasPorTopico,
  carregarFichasOrdenadas,
  carregarTopicosFichas,
  carregarValidacoesCruzadasOrdenadas,
  contextoFundamentacaoNormativa,
  fichaRequerContextoCnct,
  fichaRequerFundamentacaoNormativa,
  montarGrupoAvulso,
  montarGruposSubagents,
  prepararPromptsSubagents,
} from "../scripts/subagents.ts";

const caminhos = caminhosPadrao();
const RAIZ = NodePath.resolve(caminhos.appDir, "../../..");
const ENTRYPOINT = NodePath.join(caminhos.appDir, "scripts", "revisar_ppc.ts");
const FIXTURES = NodePath.join(caminhos.appDir, "tests", "fixtures");
const RELOGIO = () => new Date("2026-11-13T12:34:56Z");
const TOTAL_FICHAS = NodeFS.readdirSync(caminhos.fichasDir).filter((nome) => nome.endsWith(".json")).length;

const MARKDOWN_BASE = `# Curso Técnico em Informática

Curso: Curso Técnico em Informática
Campus: Assis Chateaubriand
Modalidade: Integrado

## 1. Apresentação

O curso apresenta objetivos, perfil do egresso e justificativa institucional.
`;

// Os grupos leem o kb.sqlite pelos serviços do kb, na camada do ponto de entrada da CLI (`camadaKb`),
// que o recompila quando as fontes mudaram (cerca de 8 s); com o relógio real, para o mtime certo.
const CAMADA_KB = camadaKb({ raiz: RAIZ }).pipe(Layer.provide(NodeServices.layer));
const OPCOES_CAMADA_KB = { excludeTestServices: true, timeout: "180 seconds" } as const;
const caminhoBanco = process.env.KB_SQLITE
  ? NodePath.resolve(process.env.KB_SQLITE)
  : NodePath.join(RAIZ, "tmp", "kb.sqlite");

const temporarios: string[] = [];
afterEach(() => {
  for (const dir of temporarios.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

function diretorioTemporario(): string {
  const dir = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "revisar-ppc-")));
  temporarios.push(dir);
  return dir;
}

function criarRodada(markdown = MARKDOWN_BASE): string {
  const dir = diretorioTemporario();
  const arquivo = NodePath.join(dir, "PPC.md");
  NodeFS.writeFileSync(arquivo, markdown, "utf-8");
  return prepararDocumento(arquivo, { saidaBase: NodePath.join(dir, "output"), relogio: RELOGIO }).rodadaDir;
}

function resultado(fichaId: string, estado = "ATENDE", evidencias = 3): Dicionario {
  return {
    ficha_id: fichaId,
    estado,
    confianca: 0.9,
    justificativa: `Justificativa da ficha ${fichaId}.`,
    evidencias: Array.from({ length: evidencias }, (_, i) => `Evidência ${i + 1} de ${fichaId}`),
    lacunas: [],
    revisao_humana_obrigatoria: false,
  };
}

type Payload = {
  metadata: Dicionario;
  grupos: Array<{ grupo_id: string; resultados: Dicionario[] }>;
  [k: string]: unknown;
};

function payloadResultadosCompletos(): Payload {
  const grupos = agruparFichasPorTopico(carregarFichasOrdenadas(), carregarTopicosFichas(), 20).map((grupo) => ({
    grupo_id: grupo.grupo_id,
    resultados: grupo.fichas.map((ficha) => resultado(String(ficha.id), "ATENDE", Number(ficha.evidencia_minima ?? 3))),
  }));
  return { metadata: { origem: "teste" }, grupos };
}

function textoFicha(ficha: Dicionario, campos: string[]): string {
  return campos.map((campo) => String(ficha[campo] ?? "")).join(" ");
}

function lerFicha(nome: string): Dicionario {
  return lerJsonDaRodada(NodePath.join(caminhos.fichasDir, nome)) as Dicionario;
}

const universo = universoOuVazio(caminhos);

/** `referencias_normativas` da ficha em texto legível. */
function referencias(ficha: Dicionario): string[] {
  return referenciasLegiveisDaFicha(ficha, universo).map((referencia) => referencia.texto);
}

function topico(id: string): Dicionario {
  const topicos = (lerJsonDaRodada(caminhos.topicosFichasPath) as { topicos: Dicionario[] }).topicos;
  return topicos.find((item) => item.id === id)!;
}

function cli(...argumentos: string[]) {
  const processo = NodeChildProcess.spawnSync(process.execPath, [ENTRYPOINT, ...argumentos], {
    cwd: RAIZ,
    env: { ...process.env, REVISAR_PPC_AGORA: "2026-11-13T12:34:56Z" },
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { codigo: processo.status, stdout: processo.stdout, stderr: processo.stderr };
}

describe("relógio", () => {
  test("formatos de data do Python com relógio injetado", () => {
    const relogio = () => new Date(2026, 10, 13, 9, 5, 7);
    expect(timestampSlug(relogio)).toBe("2026-11-13t09-05-07");
    expect(agoraIso(relogio)).toMatch(/^2026-11-13T09:05:07[+-]\d{2}:\d{2}$/);
  });
});

describe("REVISAR_PPC_AGORA", () => {
  /** Relógio do ambiente lido num processo novo, com fuso e `REVISAR_PPC_AGORA` fixos. */
  function relogioEm(fuso: string, agora: string) {
    const codigo =
      `import { agoraIso, timestampSlug } from ${JSON.stringify(NodePath.join(caminhos.appDir, "scripts", "rodada.ts"))};` +
      "console.log(JSON.stringify([timestampSlug(), agoraIso()]));";
    const processo = NodeChildProcess.spawnSync(process.execPath, ["--input-type=module", "-e", codigo], {
      env: { ...process.env, TZ: fuso, REVISAR_PPC_AGORA: agora },
      encoding: "utf-8",
    });
    return { codigo: processo.status, stdout: processo.stdout, stderr: processo.stderr };
  }

  test("data sem hora é meia-noite local, como no Python (`datetime.fromisoformat`)", () => {
    for (const [fuso, deslocamento] of [
      ["America/Sao_Paulo", "-03:00"],
      ["Asia/Tokyo", "+09:00"],
    ]) {
      const { codigo, stdout, stderr } = relogioEm(fuso!, "2026-11-13");
      expect(stderr).toBe("");
      expect(codigo).toBe(0);
      expect(JSON.parse(stdout)).toEqual(["2026-11-13t00-00-00", `2026-11-13T00:00:00${deslocamento}`]);
    }
  });

  test("data-hora com fuso continua sendo o instante dado", () => {
    const { stdout } = relogioEm("America/Sao_Paulo", "2026-11-13T12:34:56Z");
    expect(JSON.parse(stdout)).toEqual(["2026-11-13t09-34-56", "2026-11-13T09:34:56-03:00"]);
  });

  test("valor inválido é recusado", () => {
    for (const valor of ["13/11/2026", "2026-02-30", "Nov 13 2026"]) {
      const { codigo, stderr } = relogioEm("America/Sao_Paulo", valor);
      expect(codigo).not.toBe(0);
      expect(stderr).toContain(`REVISAR_PPC_AGORA inválida: ${valor}`);
    }
  });
});

describe("preparar-documento", () => {
  test("cria a rodada a partir de Markdown", () => {
    const rodada = criarRodada();
    const c = caminhosRodada(rodada);
    expect([c.ppc, c.metadata, c.manifesto].every((arquivo) => NodeFS.existsSync(arquivo))).toBe(true);
    expect((lerJsonDaRodada(c.metadata) as Dicionario).curso).toBe("Técnico em Informática");
    expect((lerJsonDaRodada(c.manifesto) as Dicionario).execucao).toBe("subagents-na-conversa");
    expect(Object.keys(c).sort()).toEqual(
      [
        "rodadaDir",
        "suporteDir",
        "artefatosConversaoDir",
        "ppc",
        "ppcBruto",
        "metadata",
        "manifesto",
        "preparacaoDocx",
        "cnctContexto",
        "contextoEstruturalSubagents",
        "validacoesCruzadasContexto",
        "gruposAvulsosDir",
        "promptsSubagentsDir",
        "promptsSubagentsManifest",
        "resultadosSubagents",
        "gruposSubagents",
        "relatorioHtml",
      ].sort(),
    );
    expect(NodePath.basename(rodada)).toMatch(/^2026-11-13t\d{2}-34-56-ppc$/);
  });

  test("remove o sumário do PPC canônico", () => {
    const rodada = criarRodada(`# Curso Técnico em Informática

**Sumário**
1. APRESENTAÇÃO 4
1.1 IDENTIFICAÇÃO 5
5.7 EMENTÁRIO 30

# 1 APRESENTAÇÃO

Texto do corpo.
`);
    const ppc = NodeFS.readFileSync(caminhosRodada(rodada).ppc, "utf-8");
    expect(ppc).not.toContain("5.7 EMENTÁRIO 30");
    expect(ppc).toContain("# 1 APRESENTAÇÃO");
    expect(ppc).toContain("Texto do corpo.");
  });

  test("minuta que abre com régua horizontal mantém o início do texto", () => {
    const rodada = criarRodada(`---

# Curso Técnico em Informática

Campus: Assis Chateaubriand

---

## 1. Apresentação

O curso apresenta objetivos.
`);
    const ppc = NodeFS.readFileSync(caminhosRodada(rodada).ppc, "utf-8");
    expect(ppc).toContain("Curso Técnico em Informática");
    expect(ppc).toContain("Assis Chateaubriand");
    expect((lerJsonDaRodada(caminhosRodada(rodada).metadata) as Dicionario).campus).toBe("Assis Chateaubriand");
  });

  test("tira o front matter de proveniência de um PPC da base", () => {
    const arquivo = NodePath.join(
      caminhos.baseConhecimentoDir,
      "institucional",
      "ifpr",
      "ppcs",
      "curitiba",
      "tecnico-em-eventos.md",
    );
    const rodada = prepararDocumento(arquivo, { saidaBase: diretorioTemporario(), relogio: RELOGIO }).rodadaDir;
    const ppc = NodeFS.readFileSync(caminhosRodada(rodada).ppc, "utf-8");
    expect(ppc).not.toContain("fonte_url");
    expect(ppc).not.toContain("ppc:curitiba/tecnico-em-eventos");
  });

  test("rejeita extensão desconhecida e arquivo ausente", () => {
    const dir = diretorioTemporario();
    NodeFS.writeFileSync(NodePath.join(dir, "ppc.txt"), "x");
    expect(() => prepararDocumento(NodePath.join(dir, "ppc.txt"), { saidaBase: dir })).toThrow(
      "A entrada deve ser um arquivo .md ou .docx.",
    );
    expect(() => prepararDocumento(NodePath.join(dir, "nao-existe.md"), { saidaBase: dir })).toThrow(
      "Arquivo não encontrado",
    );
  });
});

describe("normalizador de Markdown", () => {
  const normalizar = (markdown: string) => normalizarMarkdown(markdown).markdownNormalizado;

  test("remove sumário convertido antes do corpo", () => {
    expect(
      normalizar(`# CAPA

**Sumário**
1. APRESENTAÇÃO DO PROJETO 4

## 1.1 IDENTIFICAÇÃO 4
## 5.7 EMENTÁRIO 30
### 5.7.1 Componentes curriculares obrigatórios 30
# 1 APRESENTAÇÃO DO PROJETO

## 1.1 IDENTIFICAÇÃO

Texto do corpo.
`),
    ).toBe("# CAPA\n\n## 1 APRESENTAÇÃO DO PROJETO\n\n### 1.1 IDENTIFICAÇÃO\n\nTexto do corpo.\n");
  });

  test("remove sumário em tabela sem título", () => {
    const normalizado = normalizar(`# CAPA

|---|---|---|
|1.1|CARACTERÍSTICAS DO CURSO|7|
|**2. JUSTIFICATIVA**||**9**|
||6.3.1 CONCEPÇÃO DE AVALIAÇÃO|24|
|6.15.1 EMENTÁRIO - 1° ANO|42|
|Componente Curricular: Arte I|43|

## **1. IDENTIFICAÇÃO DO CURSO**

Texto do corpo.
`);
    expect(normalizado).not.toContain("CARACTERÍSTICAS DO CURSO|7");
    expect(normalizado).not.toContain("Componente Curricular: Arte I|43");
    expect(normalizado).toContain("1. IDENTIFICAÇÃO DO CURSO");
    expect(normalizado).toContain("Texto do corpo.");
  });

  test("remove sumário com vários itens na mesma linha", () => {
    const normalizado = normalizar(`# CAPA

## **SUMÁRIO**
**1.APRESENTAÇÃO DO PROJETO ........ 5** 1.1 IDENTIFICAÇÃO ....... 5 1.2 CONTEXTO HISTÓRICO ....... 7
**2. PRINCÍPIOS E FUNDAMENTOS PEDAGÓGICOS ........ 16** 2.1 JUSTIFICATIVA ....... 17

## **1.APRESENTAÇÃO DO PROJETO**

Texto do corpo.
`);
    expect(normalizado).not.toContain("1.1 IDENTIFICAÇÃO ....... 5");
    expect(normalizado).not.toContain("2.1 JUSTIFICATIVA ....... 17");
    expect(normalizado).toContain("1.APRESENTAÇÃO DO PROJETO");
    expect(normalizado).toContain("Texto do corpo.");
  });

  test("remove sumário com pontilhado Unicode", () => {
    const normalizado = normalizar(`# CAPA

**SUMÁRIO 1. IDENTIFICAÇÃO DO CURSO** …………………………………...…………………………..……...….….3 1.1. CARACTERÍSTICAS DO CURSO…………………………………………………………..……...….…..5

**INSTITUTO FEDERAL DO PARANÁ | Pró-Reitoria de Ensino - PROENS**

Av. Victor Ferreira do Amaral, 306 - Tarumã, Curitiba - PR

10. AVALIAÇÃO DO PROJETO PEDAGÓGICO DO CURSO (PPC)......................................41 REFERÊNCIAS…………………………………………………………………………………………………………..42

## **1. IDENTIFICAÇÃO DO CURSO**

Texto do corpo.
`);
    expect(normalizado).not.toContain("SUMÁRIO 1. IDENTIFICAÇÃO");
    expect(normalizado).not.toContain("REFERÊNCIAS…………………………………………");
    expect(normalizado).toContain("1. IDENTIFICAÇÃO DO CURSO");
    expect(normalizado).toContain("Texto do corpo.");
  });

  test("remove sumário com número, título e página em células", () => {
    const normalizado = normalizar(`# CAPA

## **SUMÁRIO**
|**1**|**IDENTIFICAÇÃO DO CURSO**|**4**|

4

## **1 IDENTIFICAÇÃO DO CURSO**

Texto do corpo.
`);
    expect(normalizado).not.toContain("|**1**|**IDENTIFICAÇÃO DO CURSO**|**4**|");
    expect(normalizado).toContain("## **1 IDENTIFICAÇÃO DO CURSO**");
    expect(normalizado).toContain("Texto do corpo.");
  });

  test("não remove tabela do corpo com numeração", () => {
    const normalizado = normalizar(`# CAPA

## **1. IDENTIFICAÇÃO DA PROPOSTA**

|---|---|---|
|2.3 Vagas ofertadas|
|a) Mínimo: 100 vagas|
|2.4 Público-alvo|
|Professores da rede pública|

## **2. DADOS DO CURSO**

Texto do corpo.
`);
    expect(normalizado).toContain("|2.3 Vagas ofertadas|");
    expect(normalizado).toContain("|2.4 Público-alvo|");
    expect(normalizado).toContain("Texto do corpo.");
  });

  test("limpa paginação, une parágrafos e padroniza tabelas", () => {
    expect(
      normalizar(
        "Página 3 de 10\r\nTexto quebrado em\r\nduas linhas  ,  aqui .\r\nhifeni-\r\nzada.\r\n| A | B |\r\n|:--|--:|\r\n| 1 | 2 |\r\nfim.",
      ),
    ).toBe("Texto quebrado em duas linhas, aqui.\nhifenizada.\n\n| A | B |\n|:---|---:|\n| 1 | 2 |\n\nfim.\n");
  });
});

describe("identificação", () => {
  test("infere o campus pelos campi conhecidos na capa", () => {
    const identificacao = inferirIdentificacaoDoMarkdown(
      `# PROJETO PEDAGÓGICO DO CURSO

### TÉCNICO EM INFORMÁTICA PARA INTERNET

Quedas do Iguaçu

## SUMÁRIO
`,
      "PPC Técnico em Informática",
    );
    expect(identificacao.campus).toBe("Quedas do Iguaçu");
  });

  test("ignora chaves de inventário na extração do campus", () => {
    const identificacao = extrairIdentificacaoDaConversao({
      dados_extraidos: {
        nome_curso: "Curso Técnico em Informática para Internet",
        unidade_de_fluxo_de_ar: "5",
        capela_de_fluxo_laminar: "1",
      },
    });
    expect(identificacao.campus).toBe("Campus não identificado");
  });

  test("a mescla preserva o campus inferido quando a conversão não identifica", () => {
    const mesclada = mesclarIdentificacaoPreferindoPreenchidos(
      { curso: "PPC Técnico", campus: "Quedas do Iguaçu", modalidade: "Integrado" },
      {
        curso: "Curso Técnico em Informática para Internet",
        campus: "Campus não identificado",
        modalidade: "Integrado ao Ensino Médio",
      },
    );
    expect(mesclada).toEqual({
      curso: "Curso Técnico em Informática para Internet",
      campus: "Quedas do Iguaçu",
      modalidade: "Integrado ao Ensino Médio",
    });
  });
});

layer(CAMADA_KB, OPCOES_CAMADA_KB)("fichas e grupos", (it) => {
  test("agrupa por tópico: cada ficha uma vez, na ordem da taxonomia, transversal por último", () => {
    const fichas = carregarFichasOrdenadas();
    const topicos = carregarTopicosFichas();
    const grupos = agruparFichasPorTopico(fichas, topicos, 20);
    expect(fichas.length).toBe(TOTAL_FICHAS);
    const ids = grupos.flatMap((g) => g.fichas.map((f) => String(f.id)));
    expect(ids.length).toBe(TOTAL_FICHAS);
    expect(new Set(ids).size).toBe(TOTAL_FICHAS);
    expect(grupos.map((g) => g.grupo_id)).toEqual(grupos.map((_, i) => `grupo-${String(i + 1).padStart(3, "0")}`));
    const ordem = topicos.map((t) => t.id);
    const posicoes = grupos.filter((g) => g.topico !== "transversal").map((g) => ordem.indexOf(String(g.topico)));
    expect(posicoes).toEqual([...posicoes].sort((a, b) => a - b));
    const transversal = grupos.at(-1)!;
    expect(transversal.topico).toBe("transversal");
    expect(transversal.escopo_ppc).toBe("completo");
    expect(transversal.fichas.every((f) => f.tipo_escopo === "transversal")).toBe(true);
    expect(grupos.slice(0, -1).every((g) => g.escopo_ppc === "secoes")).toBe(true);
    // cada ficha não transversal fica num dos seus tópicos, no grupo do tópico
    for (const grupo of grupos.slice(0, -1)) {
      for (const ficha of grupo.fichas) expect(ficha.topicos_tematicos as string[]).toContain(String(grupo.topico));
    }
    expect(grupos.every((g) => g.total_fichas === g.fichas.length && g.fichas.length <= 20)).toBe(true);
    expect(() => agruparFichasPorTopico(fichas, topicos, 0)).toThrow("O tamanho do grupo precisa ser maior que zero.");
  });

  test("ficha multitemática vai para o tópico mais específico (menos fichas), não para o primeiro", () => {
    const grupos = agruparFichasPorTopico(carregarFichasOrdenadas(), carregarTopicosFichas(), 20);
    const grupoDa = (id: string) => grupos.find((g) => g.fichas.some((f) => f.id === id))!.topico;
    expect(grupoDa("CT-CURR-25")).toBe("estagio"); // estagio (4) × perfil_egresso_mundo_trabalho (13)
    expect(grupoDa("CT-IDENT-18")).toBe("avaliacao_ppc_egressos"); // 3 × 13
    expect(grupoDa("CT-SUP-11")).toBe("infraestrutura"); // 6 × aee_acessibilidade_inclusao (9)
    expect(grupoDa("CT-CURR-02")).toBe("identificacao_oferta"); // 11 × matriz_curricular (14)
    expect(grupoDa("CT-TRANS-04")).toBe("transversal");
  });

  test("tópico maior que o tamanho máximo vira partes equilibradas", () => {
    const fichas = carregarFichasOrdenadas();
    const grupos = agruparFichasPorTopico(fichas, carregarTopicosFichas(), 5);
    expect(grupos.every((g) => g.fichas.length <= 5)).toBe(true);
    expect(new Set(grupos.flatMap((g) => g.fichas.map((f) => f.id))).size).toBe(TOTAL_FICHAS);
    const partes = grupos.filter((g) => g.topico === "identificacao_oferta");
    expect(partes.map((g) => [g.parte, g.partes])).toEqual(partes.map((_, i) => [i + 1, partes.length]));
    const tamanhos = partes.map((g) => g.fichas.length);
    expect(Math.max(...tamanhos) - Math.min(...tamanhos)).toBeLessThanOrEqual(1);
  });

  test("detecta fichas que dependem do CNCT e de fundamentação normativa", () => {
    const fichas = new Map(carregarFichasOrdenadas().map((ficha) => [ficha.id, ficha]));
    expect(fichaRequerContextoCnct(fichas.get("CT-IDENT-01")!)).toBe(true);
    expect(fichaRequerContextoCnct(fichas.get("CT-SUP-01")!)).toBe(false);
    expect(fichaRequerFundamentacaoNormativa(fichas.get("CT-IDENT-08")!)).toBe(true);
    expect(fichaRequerFundamentacaoNormativa(fichas.get("CT-CURR-20")!)).toBe(true);
    expect(fichaRequerFundamentacaoNormativa(fichas.get("CT-IDENT-02")!)).toBe(true);
    expect(fichaRequerFundamentacaoNormativa(fichas.get("CT-IDENT-04")!)).toBe(false);
  });

  test("o contexto normativo inclui os marcos, com as normas por extenso", () => {
    const marcos = contextoFundamentacaoNormativa().marcos_normativos as Dicionario[];
    expect(marcos.map((marco) => marco.id)).toEqual(expect.arrayContaining(["dcn_ept", "dcnem", "eja"]));
    const dcnEpt = marcos.find((marco) => marco.id === "dcn_ept")!;
    expect(dcnEpt.vigente).toBe("Resolução CNE/CP nº 2/2026");
    expect(dcnEpt.substitui).toContain("Resolução CNE/CP nº 1/2021");
    expect(dcnEpt.dispositivos_revogados).toEqual(["Resolução CNE/CEB nº 3/2025, art. 6º, III"]);
  });

  it.effect("as fichas dos grupos levam as referências normativas em texto legível", () =>
    Effect.gen(function* () {
      const rodada = criarRodada();
      const payload = (yield* montarGruposSubagents(rodada)) as Dicionario & { grupos: Array<{ fichas: Dicionario[] }> };
      const fichas = new Map(payload.grupos.flatMap((grupo) => grupo.fichas).map((ficha) => [ficha.id, ficha]));
      expect(fichas.get("CT-CURR-02")!.referencias_normativas).toEqual([
        {
          texto: "Catálogo Nacional de Cursos Técnicos (CNCT)",
          papel: "fundamento",
          ref: "cnct:catalogo",
          path: "catalogos/cnct/manifest.json",
        },
        {
          texto: "Resolução CNE/CP nº 2/2026, arts. 29, 30 e 37, § 3º",
          papel: "fundamento",
          ref: "br/cne-cp/res/2026/2",
          path: "normas/br/resolucoes/RESOLUCAO_CNE-CP_2-2026_dcnept.md",
        },
        {
          texto: "Resolução CONSUP/IFPR nº 64/2022, art. 22",
          papel: "fundamento",
          ref: "ifpr/consup/res/2022/64",
          path: "normas/ifpr/resolucoes/RESOLUCAO_CONSUP-IFPR_64-2022_cursos-integrados.md",
        },
      ]);
      expect(fichas.get("CT-IDENT-17")!.referencias_normativas).toContainEqual({
        texto: "Lei nº 13.409/2016",
        papel: "fundamento",
        ref: "br/lei/2016/13409",
      });
      const avulso = (yield* montarGrupoAvulso(rodada, ["CT-CURR-06"])) as { grupo: { fichas: Dicionario[] } };
      expect(avulso.grupo.fichas[0]!.referencias_normativas).toEqual([
        { texto: "ABNT NBR 6023", papel: "complementar", ref: "externo:abnt/nbr/6023" },
        {
          texto: "Resolução CNE/CP nº 2/2026, art. 28, § 1º, I",
          papel: "fundamento",
          ref: "br/cne-cp/res/2026/2",
          path: "normas/br/resolucoes/RESOLUCAO_CNE-CP_2-2026_dcnept.md",
        },
      ]);
    }),
  );

  it.effect("monta os grupos e salva o payload na rodada", () =>
    Effect.gen(function* () {
      const rodada = criarRodada();
      const c = caminhosRodada(rodada);
      const payload = (yield* montarGruposSubagents(rodada)) as Dicionario & { grupos: Dicionario[] };
      expect(NodeFS.existsSync(c.gruposSubagents)).toBe(true);
      expect(payload.grupos_subagents_path).toBe(c.gruposSubagents);
      expect(payload.ppc_markdown).toBe(c.ppc);
      expect(payload.total_fichas).toBe(TOTAL_FICHAS);
      expect(payload.grupos.length).toBe(
        agruparFichasPorTopico(carregarFichasOrdenadas(), carregarTopicosFichas()).length,
      );
      expect((payload.agrupamento as Dicionario).criterio).toBe("topico");
      expect(payload.grupos.every((g) => (g.contextos as Dicionario).ppc !== undefined)).toBe(true);
      expect(
        [c.cnctContexto, c.contextoEstruturalSubagents, c.validacoesCruzadasContexto].every(NodeFS.existsSync),
      ).toBe(true);
      const cnct = payload.cnct_contexto as { correspondencia: Dicionario; fonte_catalogo: string };
      expect(cnct.correspondencia.denominacao).toBe("Técnico em Informática");
      expect(cnct.fonte_catalogo).toContain("base-conhecimento/catalogos/cnct/index.json");
      expect(String(String(payload.sintese_transversal_template)).endsWith("sintese-transversal.md")).toBe(true);
      const validacoes = payload.validacoes_cruzadas as { total: number; validacoes: Dicionario[] };
      expect(validacoes.total).toBe(carregarValidacoesCruzadasOrdenadas().length);
      expect(String(String(validacoes.validacoes[0]!.id)).startsWith("VC-")).toBe(true);
      const comCnct = payload.grupos.filter((g) => g.requer_contexto_cnct);
      expect(comCnct.length).toBeGreaterThan(0);
      expect(comCnct.every((g) => "cnct" in (g.contextos as Dicionario))).toBe(true);
      expect(payload.grupos.every((g) => "estrutura" in (g.contextos as Dicionario))).toBe(true);
      const comFundamentacao = payload.grupos.filter((g) => g.requer_fundamentacao_normativa);
      expect(comFundamentacao.length).toBeGreaterThan(0);
      expect((payload.fundamentacao_normativa as Dicionario).protocolo).toBe("verificar-fundamentacao-normativa");
      expect(comFundamentacao.every((g) => "fundamentacao_normativa" in (g.contextos as Dicionario))).toBe(true);
      // O score do CNCT é float do Python: escrito como 1.0.
      expect(NodeFS.readFileSync(c.cnctContexto, "utf-8")).toContain('"score": 1.0');
    }),
  );

  test("a CLI imprime um resumo por padrão", () => {
    const rodada = criarRodada();
    const saida = cli("montar-grupos-subagents", "--rodada-dir", rodada);
    expect(saida.codigo).toBe(0);
    const resumo = JSON.parse(saida.stdout);
    expect(resumo.total_fichas).toBe(TOTAL_FICHAS);
    expect(String(resumo.grupos_subagents).endsWith("grupos-subagents.json")).toBe(true);
    expect(resumo).not.toHaveProperty("cnct_contexto");
    expect(resumo.grupos[0]).not.toHaveProperty("fichas");
    expect(saida.stdout).toContain('"score": 1.0');
  });

  it.effect("anexa a representação gráfica quando disponível", () =>
    Effect.gen(function* () {
      const rodada = criarRodada();
      const c = caminhosRodada(rodada);
      const imagem = NodePath.join(c.artefatosConversaoDir, "imagens", "representacao_grafica.png");
      NodeFS.mkdirSync(NodePath.dirname(imagem), { recursive: true });
      NodeFS.writeFileSync(imagem, "imagem");
      const dados = NodePath.join(c.artefatosConversaoDir, "dados.json");
      escreverJsonDaRodada(dados, {
        representacao_grafica: { extraida: true, caminho: "imagens/representacao_grafica.png" },
      });
      escreverJsonDaRodada(c.preparacaoDocx, { dados });
      const payload = (yield* montarGruposSubagents(rodada)) as { grupos: Dicionario[] };
      const comAnexo = payload.grupos.filter((g) => g.requer_anexos_visuais);
      expect(comAnexo.length).toBeGreaterThan(0);
      expect(((comAnexo[0]!.contextos as Dicionario).anexos_visuais as Dicionario[])[0]!.arquivo).toBe(imagem);
    }),
  );

  it.effect("gera um pacote de prompt por grupo", () =>
    Effect.gen(function* () {
      const rodada = criarRodada();
      const payload = (yield* montarGruposSubagents(rodada, 30)) as { grupos: Dicionario[] };
      const manifest = (yield* prepararPromptsSubagents(rodada)) as { total_pacotes: number; arquivos: Dicionario[] };
      expect(manifest.total_pacotes).toBe(payload.grupos.length);
      const transversal = manifest.arquivos.find((a) => a.topico === "transversal")!;
      const texto = NodeFS.readFileSync(String(transversal.arquivo), "utf-8");
      for (const trecho of [
        "## Prompt de trabalho",
        "## PPC.md",
        "## Grupo e contextos",
        "Curso Técnico em Informática",
      ]) {
        expect(texto).toContain(trecho);
      }
      expect(manifest.arquivos.every((a) => Number(a.caracteres) > 0)).toBe(true);
    }),
  );

  it.effect("fixtures qualitativas exercitam norma e estágio", () =>
    Effect.gen(function* () {
      const fixtureNorma = NodePath.join(FIXTURES, "ppc_norma_sem_suporte.md");
      const fixtureEstagio = NodePath.join(FIXTURES, "ppc_estagio_contraditorio.md");
      expect(NodeFS.readFileSync(fixtureNorma, "utf-8")).toContain("dispensa a consulta ao Catálogo Nacional");
      expect(NodeFS.readFileSync(fixtureEstagio, "utf-8")).toContain("estágio é não obrigatório");
      const dir = diretorioTemporario();
      const { rodadaDir } = prepararDocumento(fixtureEstagio, { saidaBase: dir, relogio: RELOGIO });
      const grupos = (yield* montarGruposSubagents(rodadaDir)) as Dicionario & { grupos: Dicionario[] };
      expect(((grupos.cnct_contexto as Dicionario).correspondencia as Dicionario).denominacao).toBe(
        "Técnico em Informática",
      );
      expect(grupos.grupos.some((g) => g.requer_fundamentacao_normativa)).toBe(true);
    }),
  );
});

const MARKDOWN_TOPICOS = `# PROJETO PEDAGÓGICO DO CURSO TÉCNICO EM INFORMÁTICA

Curso: Curso Técnico em Informática
Campus: Assis Chateaubriand
Forma de oferta: Integrado

## 1. IDENTIFICAÇÃO DO CURSO

Denominação do curso: Técnico em Informática, forma integrada ao ensino médio, presencial, turno matutino.

## 2. JUSTIFICATIVA

A demanda regional por profissionais de informática no município justifica a oferta deste curso técnico.

## 3. ESTÁGIO CURRICULAR

O estágio curricular supervisionado é não obrigatório e segue o Regulamento Geral de Estágio do campus, com Termo de Compromisso.

## 4. AVALIAÇÃO DA APRENDIZAGEM

A avaliação da aprendizagem é contínua e diagnóstica, com recuperação paralela e conselho de classe.

## 5. INFRAESTRUTURA

O campus dispõe de laboratórios de informática equipados e biblioteca com acervo atualizado.
`;

type GrupoTopico = Dicionario & {
  grupo_id: string;
  topico: string;
  escopo_ppc: string;
  fichas: Dicionario[];
  contextos: Dicionario & { ppc: Dicionario & { secoes: Dicionario[] } };
};

layer(CAMADA_KB, OPCOES_CAMADA_KB)("grupos por tópico num PPC fora da base", (it) => {
  it.effect("cada grupo recebe as seções do PPC.md dos seus tópicos; o transversal, o PPC inteiro", () =>
    Effect.gen(function* () {
      const rodada = criarRodada(MARKDOWN_TOPICOS);
      const c = caminhosRodada(rodada);
      const payload = (yield* montarGruposSubagents(rodada)) as Dicionario & { grupos: GrupoTopico[] };
      const porTopico = new Map(payload.grupos.map((g) => [g.topico, g]));
      const secoes = (topico: string) => porTopico.get(topico)!.contextos.ppc.secoes;
      const tipos = (topico: string) => secoes(topico).map((s) => String(s.tipo));

      const estagio = porTopico.get("estagio")!;
      expect(estagio.contextos.ppc.escopo).toBe("secoes");
      expect(estagio.contextos.ppc.ppc_markdown).toBe(c.ppc);
      expect(tipos("estagio")).toContain("estagio_praticas");
      expect(secoes("estagio").find((s) => s.tipo === "estagio_praticas")!.motivo).toContain("topico:estagio");
      expect(tipos("avaliacao_aprendizagem")).toContain("avaliacao");
      expect(tipos("infraestrutura")).toContain("infraestrutura");
      // a capa (pré-textual, fora do índice publicado) vai para a identificação
      expect(tipos("identificacao_oferta")).toEqual(expect.arrayContaining(["pretextual", "identificacao"]));
      // linhas e IDs de seção na taxonomia técnica do índice
      const secaoEstagio = secoes("estagio").find((s) => s.tipo === "estagio_praticas")!;
      expect(secaoEstagio.id).toBe("estagio_praticas-1");
      expect(NodeFS.readFileSync(c.ppc, "utf-8").split("\n")[Number(secaoEstagio.linha_inicio) - 1]).toBe(
        "## 3. ESTÁGIO CURRICULAR",
      );

      const transversal = porTopico.get("transversal")!;
      expect(transversal.escopo_ppc).toBe("completo");
      expect(transversal.contextos.ppc.secoes).toEqual([]);

      // as normas citadas pelas fichas do grupo vêm com o texto do dispositivo e o caput
      const fundamentacao = estagio.contextos.fundamentacao_normativa as Dicionario & { normas: Dicionario[] };
      const dispositivos = fundamentacao.normas.flatMap((n) => n.dispositivos as Dicionario[]);
      expect(dispositivos.length).toBeGreaterThan(0);
      expect(dispositivos.every((d) => typeof d.texto === "string" && String(d.texto).length > 0)).toBe(true);
      expect(Array.isArray(fundamentacao.transicoes)).toBe(true);
      expect((fundamentacao.marcos_normativos as Dicionario[]).map((m) => m.id)).toContain("dcn_ept");

      const manifest = (yield* prepararPromptsSubagents(rodada)) as { arquivos: Dicionario[] };
      const pacote = (topico: string) =>
        NodeFS.readFileSync(String(manifest.arquivos.find((a) => a.topico === topico)!.arquivo), "utf-8");
      const textoEstagio = pacote("estagio");
      expect(textoEstagio).toContain("## PPC.md: seções do grupo");
      expect(textoEstagio).toContain("Regulamento Geral de Estágio do campus");
      expect(textoEstagio).toContain("<!-- seção estagio_praticas-1 · linhas");
      expect(textoEstagio).not.toContain("laboratórios de informática equipados");
      const textoTransversal = pacote("transversal");
      expect(textoTransversal).toContain("laboratórios de informática equipados");
      expect(textoTransversal).toContain("Regulamento Geral de Estágio do campus");
    }),
  );

  it.effect("toda ficha recebe as seções de todos os seus tópicos, inclusive as multitemáticas", () =>
    Effect.gen(function* () {
      const rodada = criarRodada(MARKDOWN_TOPICOS);
      const payload = (yield* montarGruposSubagents(rodada)) as Dicionario & { grupos: GrupoTopico[] };
      for (const grupo of payload.grupos.filter((g) => g.escopo_ppc === "secoes")) {
        const topicos = new Set(grupo.fichas.flatMap((f) => f.topicos_tematicos as string[]));
        expect(new Set(grupo.contextos.ppc.topicos as string[])).toEqual(topicos);
      }
      const infraestrutura = payload.grupos.find((g) => g.topico === "infraestrutura")!;
      // CT-SUP-11 (acessibilidade física) também é do tópico aee_acessibilidade_inclusao
      expect(infraestrutura.fichas.map((f) => f.id)).toContain("CT-SUP-11");
      expect(infraestrutura.contextos.ppc.topicos as string[]).toContain("aee_acessibilidade_inclusao");
    }),
  );

  test("pacotes determinísticos com o relógio fixo (REVISAR_PPC_AGORA)", () => {
    const conteudos = [diretorioTemporario(), diretorioTemporario()].map((base) => {
      const arquivo = NodePath.join(base, "minuta.md");
      NodeFS.writeFileSync(arquivo, MARKDOWN_TOPICOS, "utf-8");
      const preparo = cli("preparar-documento", arquivo, "--saida-base", NodePath.join(base, "saida"));
      expect(preparo.codigo).toBe(0);
      const rodada = JSON.parse(preparo.stdout).rodada_dir as string;
      expect(cli("montar-grupos-subagents", "--rodada-dir", rodada).codigo).toBe(0);
      expect(cli("preparar-prompts-subagents", "--rodada-dir", rodada).codigo).toBe(0);
      const c = caminhosRodada(rodada);
      const ler = (arquivo: string) => NodeFS.readFileSync(arquivo, "utf-8").replaceAll(base, "<base>");
      return [
        ler(c.gruposSubagents),
        ...NodeFS.readdirSync(c.promptsSubagentsDir)
          .sort()
          .map((nome) => ler(NodePath.join(c.promptsSubagentsDir, nome))),
      ];
    });
    expect(conteudos[0]!.length).toBeGreaterThan(10);
    expect(conteudos[1]).toEqual(conteudos[0]!);
  });

  it.effect("o CNCT identificado é o mesmo registro do kb.sqlite", () =>
    Effect.gen(function* () {
      const rodada = criarRodada(MARKDOWN_TOPICOS);
      const payload = (yield* montarGruposSubagents(rodada)) as Dicionario & { cnct_contexto: Dicionario };
      const correspondencia = payload.cnct_contexto.correspondencia as Dicionario;
      const db = new NodeSqlite.DatabaseSync(caminhoBanco, { readOnly: true });
      try {
        const linha = db.prepare("SELECT dados_json FROM cnct WHERE id = ?").get(`cnct:${correspondencia.id}`) as {
          dados_json: string;
        };
        const kb = JSON.parse(linha.dados_json) as Dicionario;
        for (const campo of [
          "denominacao",
          "eixo_tecnologico",
          "area_tecnologica",
          "perfil_profissional",
          "campo_atuacao",
        ]) {
          expect(correspondencia[campo]).toEqual(kb[campo]);
        }
        expect(Number(correspondencia.carga_horaria_minima_horas)).toBe(Number(kb.carga_horaria_minima_horas));
      } finally {
        db.close();
      }
    }),
  );
});

describe("CNCT", () => {
  test("o contexto inclui o resumo estruturado do estágio", () => {
    const contexto = compararPpcComCnct(
      { curso: "Curso Técnico em Informática" },
      { dados_extraidos: { carga_horaria_estagio: "0 horas" } },
      {},
    ) as Record<string, any>;
    expect(contexto.correspondencia.denominacao).toBe("Técnico em Informática");
    expect(contexto.fonte_catalogo).toContain("base-conhecimento/catalogos/cnct/index.json");
    expect(contexto.correspondencia.estagio.menciona_estagio).toBe(true);
    expect(contexto.correspondencia.estagio.obrigatoriedade).toBe("FACULTADO_A_INSTITUICAO");
    expect(contexto.estagio_ppc.indicio_estagio_obrigatorio_por_carga).toBe(false);
    expect(contexto.comparacoes.estagio_cnct.status).toBe("COMPATIVEL");
    expect(contexto.correspondencia.score).toBeInstanceOf(Flutuante);
  });

  test("o catálogo interno foi substituído pela base unificada", () => {
    expect(NodeFS.existsSync(NodePath.join(caminhos.baseAnaliseDir, "dados", "cnct", "catalogo_cnct.csv"))).toBe(false);
    expect(NodeFS.existsSync(NodePath.join(caminhos.baseConhecimentoDir, "catalogos", "cnct", "index.json"))).toBe(
      true,
    );
  });
});

layer(CAMADA_KB, OPCOES_CAMADA_KB)("grupo avulso e mescla", (it) => {
  it.effect("monta o grupo avulso e mescla os resultados", () =>
    Effect.gen(function* () {
      const rodada = criarRodada();
      const c = caminhosRodada(rodada);
      escreverJsonDaRodada(c.resultadosSubagents, payloadResultadosCompletos());
      const grupo = (yield* montarGrupoAvulso(rodada, ["CT-IDENT-01"])) as {
        grupo: Dicionario;
        grupo_avulso_path: string;
        prompt_subagent_path: string;
      };
      expect(NodeFS.existsSync(grupo.grupo_avulso_path)).toBe(true);
      expect(grupo.grupo.escopo_ppc).toBe("secoes");
      expect(NodeFS.readFileSync(grupo.prompt_subagent_path, "utf-8")).toContain("## PPC.md: seções do grupo");
      const transversal = (yield* montarGrupoAvulso(rodada, ["CT-TRANS-01", "CT-IDENT-01"])) as { grupo: Dicionario };
      expect(transversal.grupo.escopo_ppc).toBe("completo");
      escreverJsonDaRodada(NodePath.join(c.suporteDir, "resultado-avulso.json"), {
        grupo_id: grupo.grupo.grupo_id,
        resultados: [{ ...resultado("CT-IDENT-01", "INCONCLUSIVO"), confianca: new Flutuante(1) }],
      });
      const mesclado = mesclarResultadosAvulsos(rodada, "resultados-subagents.json", "resultado-avulso.json");
      expect(mesclado.fichas_substituidas).toEqual(["CT-IDENT-01"]);
      const payload = lerJsonDaRodada(c.resultadosSubagents) as Payload;
      const resultados = payload.grupos.flatMap((g) => g.resultados).filter((item) => item.ficha_id === "CT-IDENT-01");
      expect(resultados.length).toBe(1);
      expect(resultados[0]!.estado).toBe("INCONCLUSIVO");
      // A mescla preserva o float 1.0 do JSON.
      expect(NodeFS.readFileSync(c.resultadosSubagents, "utf-8")).toContain('"confianca": 1.0');
      expect(validarResultadosRodada(rodada, "resultados-subagents.json").valido).toBe(true);
    }),
  );

  test("mescla com base no formato `resultados[]` sem perder os resultados originais", () => {
    const rodada = criarRodada();
    const c = caminhosRodada(rodada);
    const resultadosBase = payloadResultadosCompletos().grupos.flatMap((grupo) => grupo.resultados);
    escreverJsonDaRodada(c.resultadosSubagents, {
      metadata: { origem: "teste" },
      grupo_id: "grupo-unico",
      resultados: resultadosBase,
    });
    expect(validarResultadosRodada(rodada, "resultados-subagents.json").total_fichas).toBe(TOTAL_FICHAS);
    escreverJsonDaRodada(NodePath.join(c.suporteDir, "avulso.json"), {
      resultados: [resultado("CT-IDENT-01", "INCONCLUSIVO")],
    });
    mesclarResultadosAvulsos(rodada, "resultados-subagents.json", "avulso.json");
    const resumo = validarResultadosRodada(rodada, "resultados-subagents.json");
    expect(resumo.total_fichas).toBe(TOTAL_FICHAS);
    const payload = lerJsonDaRodada(c.resultadosSubagents) as Payload;
    expect(payload.resultados).toBeUndefined();
    const reavaliado = payload.grupos.flatMap((g) => g.resultados).filter((item) => item.ficha_id === "CT-IDENT-01");
    expect(reavaliado.map((item) => item.estado)).toEqual(["INCONCLUSIVO"]);
  });

  const avulsosInvalidos: Array<[string, Dicionario, string]> = [
    ["estado inválido", { resultados: [resultado("CT-IDENT-01", "TALVEZ")] }, "Estado inválido para CT-IDENT-01"],
    ["ficha desconhecida", { resultados: [resultado("CT-NAO-EXISTE")] }, "Fichas desconhecidas: CT-NAO-EXISTE"],
    [
      "ficha repetida",
      { resultados: [resultado("CT-IDENT-01"), resultado("CT-IDENT-01")] },
      "Fichas duplicadas: CT-IDENT-01",
    ],
    [
      "evidências insuficientes",
      { resultados: [resultado("CT-IDENT-01", "ATENDE", 0)] },
      "CT-IDENT-01 trouxe 0 evidências",
    ],
  ];
  for (const [nome, avulso, mensagem] of avulsosInvalidos) {
    test(`recusa avulso com ${nome} sem tocar a base`, () => {
      const rodada = criarRodada();
      const c = caminhosRodada(rodada);
      escreverJsonDaRodada(c.resultadosSubagents, payloadResultadosCompletos());
      const antes = NodeFS.readFileSync(c.resultadosSubagents, "utf-8");
      escreverJsonDaRodada(NodePath.join(c.suporteDir, "avulso.json"), avulso);
      expect(() => mesclarResultadosAvulsos(rodada, "resultados-subagents.json", "avulso.json")).toThrow(
        ErroResultadosSubagents,
      );
      expect(() => mesclarResultadosAvulsos(rodada, "resultados-subagents.json", "avulso.json")).toThrow(mensagem);
      expect(NodeFS.readFileSync(c.resultadosSubagents, "utf-8")).toBe(antes);
    });
  }

  it.effect("rejeita ficha desconhecida no grupo avulso e avulso sem resultados", () =>
    Effect.gen(function* () {
      const rodada = criarRodada();
      const desconhecida = yield* Effect.flip(montarGrupoAvulso(rodada, ["CT-NAO-EXISTE"]));
      expect(desconhecida.message).toBe("Fichas não encontradas: CT-NAO-EXISTE");
      const c = caminhosRodada(rodada);
      escreverJsonDaRodada(c.resultadosSubagents, payloadResultadosCompletos());
      escreverJsonDaRodada(NodePath.join(c.suporteDir, "avulso.json"), { nada: [] });
      expect(() => mesclarResultadosAvulsos(rodada, "resultados-subagents.json", "avulso.json")).toThrow(
        "O resultado avulso precisa conter `grupos[]` ou `resultados[]`.",
      );
    }),
  );
});

describe("validar-resultados", () => {
  function validar(editar: (payload: Payload) => void = () => {}): Dicionario {
    const rodada = criarRodada();
    const payload = payloadResultadosCompletos();
    editar(payload);
    NodeFS.writeFileSync(
      NodePath.join(caminhosRodada(rodada).suporteDir, "resultados-subagents.json"),
      serializarJsonTipado(payload, { indent: 2 }),
    );
    return validarResultadosRodada(rodada, "resultados-subagents.json");
  }

  test("devolve o resumo sem gerar HTML", () => {
    const rodada = criarRodada();
    const c = caminhosRodada(rodada);
    escreverJsonDaRodada(c.resultadosSubagents, payloadResultadosCompletos());
    const resumo = validarResultadosRodada(rodada, "resultados-subagents.json");
    expect(resumo.valido).toBe(true);
    expect(resumo.total_fichas).toBe(TOTAL_FICHAS);
    expect(resumo.total_fichas_esperadas).toBe(TOTAL_FICHAS);
    expect(resumo.total_alertas_transversais).toBe(0);
    expect(resumo.contagem_estado).toEqual({ ATENDE: TOTAL_FICHAS });
    expect(resumo.situacao).toBe("APTO_PARA_SUBMISSAO");
    expect(NodeFS.existsSync(c.relatorioHtml)).toBe(false);
  });

  const casos: Array<[string, (p: Payload) => void, string]> = [
    ["ficha duplicada", (p) => (p.grupos[1]!.resultados[0] = { ...p.grupos[0]!.resultados[0]! }), "duplicadas"],
    ["ficha desconhecida", (p) => (p.grupos[0]!.resultados[0]!.ficha_id = "CT-NAO-EXISTE"), "desconhecidas"],
    ["ficha faltante", (p) => p.grupos[0]!.resultados.pop(), "sem resultado"],
    ["evidências abaixo do mínimo", (p) => (p.grupos[0]!.resultados[0]!.evidencias = []), "mínimo exigido"],
    ["estado inválido", (p) => (p.grupos[0]!.resultados[0]!.estado = "OK"), "Estado inválido"],
    [
      "confiança fora da faixa",
      (p) => (p.grupos[0]!.resultados[0]!.confianca = new Flutuante(1.5)),
      "Confiança inválida",
    ],
    [
      "alerta sem validacao_id",
      (p) =>
        (p.alertas_transversais = [
          {
            id: "ALERTA-001",
            titulo: "Inconsistência transversal",
            criticidade: "OBRIG",
            descricao: "Perfil e matriz precisam de revisão conjunta.",
            fichas_relacionadas: ["CT-IDENT-01"],
            evidencias: ["Evidência transversal"],
            revisao_humana_obrigatoria: true,
          },
        ]),
      "validacao_id",
    ],
    [
      "feedback_autores ausente",
      (p) => {
        for (const grupo of p.grupos) {
          for (const item of grupo.resultados) {
            if (item.ficha_id === "CT-TRANS-08") {
              item.estado = "NAO_ATENDE";
              item.revisao_humana_obrigatoria = true;
              delete item.feedback_autores;
            }
          }
        }
      },
      "feedback_autores",
    ],
  ];
  for (const [nome, editar, mensagem] of casos) {
    test(`rejeita ${nome}`, () => {
      expect(() => validar(editar)).toThrow(ErroResultadosSubagents);
      expect(() => validar(editar)).toThrow(mensagem);
    });
  }

  test("aceita alertas transversais válidos e calcula a situação", () => {
    const validacao = String(carregarValidacoesCruzadasOrdenadas()[0]!.id);
    const resumo = validar((p) => {
      p.grupos[0]!.resultados[0]!.estado = "INCONCLUSIVO";
      p.alertas_transversais = [
        {
          id: "ALERTA-001",
          validacao_id: validacao,
          titulo: "Inconsistência transversal",
          descricao: "Perfil e matriz precisam de revisão conjunta.",
          fichas_relacionadas: ["CT-IDENT-01"],
          evidencias: ["Evidência transversal"],
          revisao_humana_obrigatoria: true,
        },
      ];
    });
    expect(resumo.total_alertas_transversais).toBe(1);
    // Sem `criticidade`, o alerta é `OBRIG` e pesa como uma ficha OBRIG não atendida.
    expect(resumo.situacao).toBe("AJUSTES_NECESSARIOS");
  });

  test("a CLI imprime o resumo e falha com mensagem em stderr", () => {
    const rodada = criarRodada();
    const c = caminhosRodada(rodada);
    escreverJsonDaRodada(c.resultadosSubagents, payloadResultadosCompletos());
    const ok = cli("validar-resultados", "--rodada-dir", rodada);
    expect(ok.codigo).toBe(0);
    expect(JSON.parse(ok.stdout).valido).toBe(true);
    const payload = payloadResultadosCompletos();
    payload.grupos[0]!.resultados.pop();
    escreverJsonDaRodada(c.resultadosSubagents, payload);
    const erro = cli("validar-resultados", "--rodada-dir", rodada);
    expect(erro.codigo).toBe(1);
    expect(erro.stderr).toContain("ErroResultadosSubagents: Fichas sem resultado:");
  });
});

describe("conteúdo das fichas, validações e prompts", () => {
  const CAMPOS = ["pergunta", "rubrica", "boa_evidencia", "ma_evidencia", "escalonar_quando"];
  const CAMPOS_COM_TITULO = ["titulo", ...CAMPOS];
  const consultas = (ficha: Dicionario) => (ficha.consultas as string[]).map((c) => casefold(c));

  test("progressão parcial diferencia integrado e subsequente", () => {
    const ficha = lerFicha("ct-sup-26.json");
    const texto = textoFicha(ficha, CAMPOS);
    expect(ficha.topicos_tematicos).toEqual(["avaliacao_aprendizagem"]);
    expect(topico("avaliacao_aprendizagem").fichas).toContain("CT-SUP-26");
    expect((ficha.ancoras_semanticas as string[]).join(" ").toLowerCase()).toContain("progressão parcial");
    for (const trecho of [
      "cursos técnicos integrados",
      "cursos técnicos subsequentes",
      "arts. 18 e 19",
      "art. 20",
      "limite de 3 conceitos D próprio dos cursos integrados",
    ]) {
      expect(texto).toContain(trecho);
    }
  });

  test("educação política aplica obrigação nova sem exigir disciplina autônoma", () => {
    const ficha = lerFicha("ct-curr-26.json");
    const texto = textoFicha(ficha, CAMPOS);
    expect([ficha.criticidade, ficha.tipo_escopo]).toEqual(["OBRIG", "condicional"]);
    expect(ficha.topicos_tematicos).toEqual(["temas_transversais_cidadania"]);
    expect(topico("temas_transversais_cidadania").fichas).toContain("CT-CURR-26");
    expect(referencias(ficha)).toContain("Lei nº 9.394/1996, art. 26, §§ 1º e 9º-B");
    expect(referencias(ficha)).toContain("Lei nº 15.468/2026");
    for (const trecho of [
      "cursos técnicos integrados ao ensino médio",
      "cursos subsequentes",
      "NAO_APLICAVEL",
      "não exigir disciplina autônoma",
      "realidade social e política",
    ]) {
      expect(texto).toContain(trecho);
    }
  });

  test("convênios de estágio declaram as hipóteses da Resolução 82", () => {
    const texto = textoFicha(lerFicha("ct-curr-21.json"), CAMPOS);
    for (const trecho of [
      "agente de integração",
      "UCE pública ou privada",
      "10 estudantes simultaneamente",
      "Seção de Estágios e Relações Comunitárias",
      "Direção",
      "Termo de Compromisso de Estágio e Plano de Estágio",
    ]) {
      expect(texto).toContain(trecho);
    }
  });

  test("fichas de estágio têm escopos separados", () => {
    const estagio = topico("estagio");
    const fichas: Record<string, Dicionario> = {
      "CT-CURR-20": lerFicha("ct-curr-20.json"),
      "CT-CURR-21": lerFicha("ct-curr-21.json"),
      "CT-CURR-24": lerFicha("ct-curr-24.json"),
      "CT-CURR-25": lerFicha("ct-curr-25.json"),
    };
    expect(estagio.tipo_escopo).toBe("condicional");
    expect(new Set(estagio.fichas as string[])).toEqual(new Set(Object.keys(fichas)));
    for (const ficha of Object.values(fichas)) {
      expect(ficha.topicos_tematicos).toContain("estagio");
      expect(ficha.tipo_escopo).toBe("condicional");
      expect((ficha.ancoras_semanticas as string[]).join(" ").toLowerCase()).toContain("estágio");
    }
    expect(fichas["CT-CURR-25"]!.topicos_tematicos).toContain("perfil_egresso_mundo_trabalho");
    const [macro, convenios, orientacao, campos] = ["CT-CURR-20", "CT-CURR-21", "CT-CURR-24", "CT-CURR-25"].map((id) =>
      String(fichas[id]!.rubrica),
    ) as [string, string, string, string];
    expect(macro).toContain("aprovação/certificação");
    expect(convenios).toContain("Termo de Compromisso de Estágio e Plano de Estágio");
    expect(orientacao).toContain("modalidade de orientação");
    expect(orientacao).toContain("componente curricular");
    expect(campos).toContain("instituições públicas ou privadas");
    expect(campos).toContain("equivalência");
    expect(macro).not.toContain("orientação alternativa");
    expect(convenios).not.toContain("instituições públicas ou privadas");
  });

  test("eixo do CNCT não exige área tecnológica no PPC", () => {
    const texto = textoFicha(lerFicha("ct-ident-13.json"), CAMPOS);
    expect(texto).toContain("ausência de área tecnológica no PPC");
    expect(texto).toContain("não constitui lacuna");
    expect(texto).toContain("Não escalonar pela simples ausência de área tecnológica no PPC");
  });

  test("projeto final trata o PFI como prática profissional articulada", () => {
    const ficha = lerFicha("ct-curr-14.json");
    const texto = textoFicha(ficha, CAMPOS_COM_TITULO);
    expect(referencias(ficha)).toContain("Resolução CONSUP/IFPR nº 64/2022, art. 16");
    expect(consultas(ficha)).toContain("projeto final interdisciplinar");
    for (const trecho of ["Projeto Integrador", "prática profissional articulada", "TCC acadêmico tradicional"]) {
      expect(texto).toContain(trecho);
    }
  });

  test("validação cruzada fecha a aritmética de carga horária com memória de cálculo", () => {
    const validacao = lerJsonDaRodada(NodePath.join(caminhos.validacoesCruzadasDir, "vc-05-16.json")) as Dicionario;
    const prompt = NodeFS.readFileSync(NodePath.join(caminhos.promptsDir, "sintese-transversal.md"), "utf-8");
    const texto = textoFicha(validacao, ["titulo", "pergunta", "rubrica", "boa_evidencia", "ma_evidencia"]);
    expect([validacao.id, validacao.criticidade]).toEqual(["VC-05-16", "BLOQ"]);
    for (const trecho of [
      "memória de cálculo passo a passo",
      "aulas_totais * minutos_hora_aula / 60",
      "dias letivos anuais",
      "hora-relógio",
    ]) {
      expect(texto).toContain(trecho);
    }
    expect(prompt).toContain("memória de cálculo");
    expect(prompt).toContain("conversão de hora-aula para hora-relógio");
  });

  test("formação docente aceita política institucional verificável", () => {
    const ficha = lerFicha("ct-sup-17.json");
    const texto = textoFicha(ficha, CAMPOS);
    expect(referencias(ficha)).toContain("Resolução CNE/CP nº 2/2026, arts. 57, 59, 61 e 72");
    expect(referencias(ficha)).toContain("Resolução CONSUP/IFPR nº 64/2022, arts. 41 a 43");
    for (const trecho of [
      "política institucional do IFPR",
      "Não penalizar a simples presença de docentes bacharéis",
      "genérica demais para ser verificável",
    ]) {
      expect(texto).toContain(trecho);
    }
  });

  test("assistência estudantil exige a Resolução 239 e a revogação das antigas", () => {
    const ficha = lerFicha("ct-sup-24.json");
    const texto = textoFicha(ficha, CAMPOS_COM_TITULO);
    expect(referencias(ficha)).toContain("Resolução CONSUP/IFPR nº 239/2025");
    expect(referencias(ficha)).toContain("Lei nº 14.914/2024");
    expect(consultas(ficha)).toContain("política institucional de assistência estudantil");
    for (const trecho of [
      "Resolução nº 11/2009",
      "Resolução nº 53/2011",
      "normas revogadas",
      "ensino, pesquisa, extensão e inovação",
    ]) {
      expect(texto).toContain(trecho);
    }
  });

  test("avaliação do PPC exige periodicidade, registro e normas vigentes", () => {
    const ficha = lerFicha("ct-sup-08.json");
    const texto = textoFicha(ficha, CAMPOS_COM_TITULO);
    expect(referencias(ficha)).toContain("Resolução CONSUP/IFPR nº 64/2022, arts. 31 e 32");
    expect(referencias(ficha)).toContain("Portaria PROENS/IFPR nº 121/2024, arts. 67 a 69");
    expect(consultas(ficha)).toContain("avaliação do ppc");
    for (const trecho of [
      "avaliação emancipatória",
      "participação estudantil",
      "registro em atas",
      "ações estratégicas de melhoria",
      "não substituem a explicitação mínima do processo de avaliação periódica do PPC",
    ]) {
      expect(texto).toContain(trecho);
    }
  });

  test("biblioteca exige acessibilidade física do espaço", () => {
    const ficha = lerFicha("ct-sup-25.json");
    const texto = textoFicha(ficha, CAMPOS_COM_TITULO);
    for (const consulta of ["biblioteca", "piso térreo", "rampa", "elevador"])
      expect(consultas(ficha)).toContain(consulta);
    expect(referencias(ficha)).toContain("Lei nº 13.146/2015");
    for (const trecho of [
      "localização da biblioteca",
      "não estiver no térreo",
      "circulação interna",
      "declaração genérica de acessibilidade do campus",
    ]) {
      expect(texto).toContain(trecho);
    }
  });

  test("o prompt do sub-agente declara o contrato de saída", () => {
    const prompt = NodeFS.readFileSync(NodePath.join(caminhos.promptsDir, "subagent-lote-fichas.md"), "utf-8");
    for (const campo of [
      "grupo_id",
      "ficha_id",
      "estado",
      "confianca",
      "justificativa",
      "evidencias",
      "lacunas",
      "revisao_humana_obrigatoria",
      "fundamentacao_normativa",
      "feedback_autores",
    ]) {
      expect(prompt).toContain(campo);
    }
  });

  test("o prompt da síntese transversal declara o contrato", () => {
    const prompt = NodeFS.readFileSync(NodePath.join(caminhos.promptsDir, "sintese-transversal.md"), "utf-8");
    for (const campo of ["alertas_transversais", "validacao_id", "fichas_relacionadas"])
      expect(prompt).toContain(campo);
  });

  test("não há código de execução por CLI de modelo nem contagem de tokens", () => {
    const scripts = NodePath.join(caminhos.appDir, "scripts");
    const conteudo = NodeFS.readdirSync(scripts, { recursive: true })
      .map(String)
      .filter((nome) => nome.endsWith(".ts") || nome.endsWith(".py"))
      .map((nome) => NodeFS.readFileSync(NodePath.join(scripts, nome), "utf-8"))
      .join("\n");
    for (const proibido of [
      "codex exec",
      "ANALISE_PPC_CODEX",
      "ANALISE_PPC_GEMINI",
      "executar_prompt",
      "uso_tokens",
      "contabilizar-tokens",
    ]) {
      expect(conteudo).not.toContain(proibido);
    }
  });
});
