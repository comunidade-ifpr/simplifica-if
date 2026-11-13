/**
 * Orquestração da analise-ppc em TypeScript: preparação da rodada,
 * normalização do Markdown, identificação, CNCT, grupos de sub-agentes,
 * prompts, grupo avulso, mescla e validação de resultados (casos portados de
 * `test_flow.py`).
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { dumpsPy } from "@simplifica-if/kb/python/json";
import { casefold } from "@simplifica-if/kb/python/texto";
import { FloatPy, type ObjetoPy } from "@simplifica-if/kb/python/valores";
import { caminhosPadrao } from "../scripts/caminhos.ts";
import { compararPpcComCnct } from "../scripts/cnct-catalogo.ts";
import { normalizarMarkdown } from "../scripts/normalizador-markdown.ts";
import { mesclarIdentificacaoPreferindoPreenchidos, prepararDocumento } from "../scripts/preparar-documento.ts";
import { referenciasLegiveisDaFicha, universoOuVazio } from "../scripts/referencias-fichas.ts";
import { ErroResultadosSubagents, validarResultadosRodada } from "../scripts/resultados.ts";
import {
  agoraIso,
  caminhosRodada,
  escreverJsonPy,
  extrairIdentificacaoDaConversao,
  inferirIdentificacaoDoMarkdown,
  lerJsonPy,
  timestampSlug,
} from "../scripts/rodada.ts";
import {
  agruparFichas,
  carregarFichasOrdenadas,
  carregarValidacoesCruzadasOrdenadas,
  contextoFundamentacaoNormativa,
  fichaRequerContextoCnct,
  fichaRequerFundamentacaoNormativa,
  mesclarResultadosAvulsos,
  montarGrupoAvulso,
  montarGruposSubagents,
  prepararPromptsSubagents,
} from "../scripts/subagents.ts";

const caminhos = caminhosPadrao();
const RAIZ = path.resolve(caminhos.appDir, "../../..");
const ENTRYPOINT = path.join(caminhos.appDir, "scripts", "analise_ppc.ts");
const FIXTURES = path.join(caminhos.appDir, "tests", "fixtures");
const RELOGIO = () => new Date("2026-11-13T12:34:56Z");
const TOTAL_FICHAS = readdirSync(caminhos.fichasDir).filter((nome) => nome.endsWith(".json")).length;

const MARKDOWN_BASE = `# Curso Técnico em Informática

Curso: Curso Técnico em Informática
Campus: Assis Chateaubriand
Modalidade: Integrado

## 1. Apresentação

O curso apresenta objetivos, perfil do egresso e justificativa institucional.
`;

const temporarios: string[] = [];
afterEach(() => {
  for (const dir of temporarios.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function diretorioTemporario(): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "analise-ppc-")));
  temporarios.push(dir);
  return dir;
}

function criarRodada(markdown = MARKDOWN_BASE): string {
  const dir = diretorioTemporario();
  const arquivo = path.join(dir, "PPC.md");
  writeFileSync(arquivo, markdown, "utf-8");
  return prepararDocumento(arquivo, { saidaBase: path.join(dir, "output"), relogio: RELOGIO }).rodadaDir;
}

function resultado(fichaId: string, estado = "ATENDE", evidencias = 3): ObjetoPy {
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
  metadata: ObjetoPy;
  grupos: Array<{ grupo_id: string; resultados: ObjetoPy[] }>;
  [k: string]: unknown;
};

function payloadResultadosCompletos(): Payload {
  const grupos = agruparFichas(carregarFichasOrdenadas(), 20).map((grupo) => ({
    grupo_id: grupo.grupo_id,
    resultados: grupo.fichas.map((ficha) => resultado(String(ficha.id), "ATENDE", Number(ficha.evidencia_minima ?? 3))),
  }));
  return { metadata: { origem: "teste" }, grupos };
}

function textoFicha(ficha: ObjetoPy, campos: string[]): string {
  return campos.map((campo) => String(ficha[campo] ?? "")).join(" ");
}

function lerFicha(nome: string): ObjetoPy {
  return lerJsonPy(path.join(caminhos.fichasDir, nome)) as ObjetoPy;
}

const universo = universoOuVazio(caminhos);

/** `referencias_normativas` da ficha em texto legível. */
function referencias(ficha: ObjetoPy): string[] {
  return referenciasLegiveisDaFicha(ficha, universo).map((referencia) => referencia.texto);
}

function topico(id: string): ObjetoPy {
  const topicos = (lerJsonPy(caminhos.topicosFichasPath) as { topicos: ObjetoPy[] }).topicos;
  return topicos.find((item) => item.id === id)!;
}

function cli(...argumentos: string[]) {
  const processo = Bun.spawnSync(["bun", "run", ENTRYPOINT, ...argumentos], {
    cwd: RAIZ,
    env: { ...process.env, ANALISE_PPC_AGORA: "2026-11-13T12:34:56Z" },
  });
  return { codigo: processo.exitCode, stdout: processo.stdout.toString(), stderr: processo.stderr.toString() };
}

describe("relógio", () => {
  test("formatos de data do Python com relógio injetado", () => {
    const relogio = () => new Date(2026, 10, 13, 9, 5, 7);
    expect(timestampSlug(relogio)).toBe("2026-11-13t09-05-07");
    expect(agoraIso(relogio)).toMatch(/^2026-11-13T09:05:07[+-]\d{2}:\d{2}$/);
  });
});

describe("preparar-documento", () => {
  test("cria a rodada a partir de Markdown", () => {
    const rodada = criarRodada();
    const c = caminhosRodada(rodada);
    expect([c.ppc, c.metadata, c.manifesto].every((arquivo) => existsSync(arquivo))).toBe(true);
    expect((lerJsonPy(c.metadata) as ObjetoPy).curso).toBe("Curso Técnico em Informática");
    expect((lerJsonPy(c.manifesto) as ObjetoPy).execucao).toBe("subagents-na-conversa");
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
    expect(path.basename(rodada)).toMatch(/^2026-11-13t\d{2}-34-56-ppc$/);
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
    const ppc = readFileSync(caminhosRodada(rodada).ppc, "utf-8");
    expect(ppc).not.toContain("5.7 EMENTÁRIO 30");
    expect(ppc).toContain("# 1 APRESENTAÇÃO");
    expect(ppc).toContain("Texto do corpo.");
  });

  test("rejeita extensão desconhecida e arquivo ausente", () => {
    const dir = diretorioTemporario();
    writeFileSync(path.join(dir, "ppc.txt"), "x");
    expect(() => prepararDocumento(path.join(dir, "ppc.txt"), { saidaBase: dir })).toThrow(
      "A entrada deve ser um arquivo .md ou .docx.",
    );
    expect(() => prepararDocumento(path.join(dir, "nao-existe.md"), { saidaBase: dir })).toThrow(
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
    ).toBe("# CAPA\n\n# 1 APRESENTAÇÃO DO PROJETO\n\n## 1.1 IDENTIFICAÇÃO\n\nTexto do corpo.\n");
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

describe("fichas e grupos", () => {
  test("agrupa em blocos estáveis de 20", () => {
    const fichas = carregarFichasOrdenadas();
    const grupos = agruparFichas(fichas, 20);
    expect(fichas.length).toBe(TOTAL_FICHAS);
    const intervalos: string[] = [];
    const totais: number[] = [];
    for (let inicio = 1; inicio <= fichas.length; inicio += 20) {
      intervalos.push(`${inicio}-${Math.min(inicio + 19, fichas.length)}`);
      totais.push(Math.min(20, fichas.length - inicio + 1));
    }
    expect(grupos.map((g) => g.intervalo)).toEqual(intervalos);
    expect(grupos.map((g) => g.total_fichas)).toEqual(totais);
    expect(grupos[0]!.grupo_id).toBe("grupo-001");
    expect(grupos.at(-1)!.grupo_id).toBe(`grupo-${String(grupos.length).padStart(3, "0")}`);
    expect(() => agruparFichas(fichas, 0)).toThrow("O tamanho do grupo precisa ser maior que zero.");
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
    const marcos = contextoFundamentacaoNormativa().marcos_normativos as ObjetoPy[];
    expect(marcos.map((marco) => marco.id)).toEqual(expect.arrayContaining(["dcn_ept", "dcnem", "eja"]));
    const dcnEpt = marcos.find((marco) => marco.id === "dcn_ept")!;
    expect(dcnEpt.vigente).toBe("Resolução CNE/CP nº 2/2026");
    expect(dcnEpt.substitui).toContain("Resolução CNE/CP nº 1/2021");
    expect(dcnEpt.dispositivos_revogados).toEqual(["Resolução CNE/CEB nº 3/2025, art. 6º, III"]);
  });

  test("as fichas dos grupos levam as referências normativas em texto legível", () => {
    const rodada = criarRodada();
    const payload = montarGruposSubagents(rodada) as ObjetoPy & { grupos: Array<{ fichas: ObjetoPy[] }> };
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
    const avulso = montarGrupoAvulso(rodada, ["CT-CURR-06"]) as { grupo: { fichas: ObjetoPy[] } };
    expect(avulso.grupo.fichas[0]!.referencias_normativas).toEqual([
      { texto: "ABNT NBR 6023", papel: "complementar", ref: "externo:abnt/nbr/6023" },
      {
        texto: "Resolução CNE/CP nº 2/2026, art. 28, § 1º, I",
        papel: "fundamento",
        ref: "br/cne-cp/res/2026/2",
        path: "normas/br/resolucoes/RESOLUCAO_CNE-CP_2-2026_dcnept.md",
      },
    ]);
  });

  test("monta os grupos e salva o payload na rodada", () => {
    const rodada = criarRodada();
    const c = caminhosRodada(rodada);
    const payload = montarGruposSubagents(rodada) as ObjetoPy & { grupos: ObjetoPy[] };
    expect(existsSync(c.gruposSubagents)).toBe(true);
    expect(payload.grupos_subagents_path).toBe(c.gruposSubagents);
    expect(payload.ppc_markdown).toBe(c.ppc);
    expect(payload.total_fichas).toBe(TOTAL_FICHAS);
    expect(payload.grupos.length).toBe(Math.ceil(TOTAL_FICHAS / 20));
    expect([c.cnctContexto, c.contextoEstruturalSubagents, c.validacoesCruzadasContexto].every(existsSync)).toBe(true);
    const cnct = payload.cnct_contexto as { correspondencia: ObjetoPy; fonte_catalogo: string };
    expect(cnct.correspondencia.denominacao).toBe("Técnico em Informática");
    expect(cnct.fonte_catalogo).toContain("base-conhecimento/catalogos/cnct/index.json");
    expect(String(payload.sintese_transversal_template)).toEndWith("sintese-transversal.md");
    const validacoes = payload.validacoes_cruzadas as { total: number; validacoes: ObjetoPy[] };
    expect(validacoes.total).toBe(carregarValidacoesCruzadasOrdenadas().length);
    expect(String(validacoes.validacoes[0]!.id)).toStartWith("VC-");
    const comCnct = payload.grupos.filter((g) => g.requer_contexto_cnct);
    expect(comCnct.length).toBeGreaterThan(0);
    expect(comCnct.every((g) => "cnct" in (g.contextos as ObjetoPy))).toBe(true);
    expect(payload.grupos.every((g) => "estrutura" in (g.contextos as ObjetoPy))).toBe(true);
    const comFundamentacao = payload.grupos.filter((g) => g.requer_fundamentacao_normativa);
    expect(comFundamentacao.length).toBeGreaterThan(0);
    expect((payload.fundamentacao_normativa as ObjetoPy).protocolo).toBe("verificar-fundamentacao-normativa");
    expect(comFundamentacao.every((g) => "fundamentacao_normativa" in (g.contextos as ObjetoPy))).toBe(true);
    // O score do CNCT é float do Python: escrito como 1.0.
    expect(readFileSync(c.cnctContexto, "utf-8")).toContain('"score": 1.0');
  });

  test("a CLI imprime um resumo por padrão", () => {
    const rodada = criarRodada();
    const saida = cli("montar-grupos-subagents", "--rodada-dir", rodada);
    expect(saida.codigo).toBe(0);
    const resumo = JSON.parse(saida.stdout);
    expect(resumo.total_fichas).toBe(TOTAL_FICHAS);
    expect(resumo.grupos_subagents).toEndWith("grupos-subagents.json");
    expect(resumo).not.toHaveProperty("cnct_contexto");
    expect(resumo.grupos[0]).not.toHaveProperty("fichas");
    expect(saida.stdout).toContain('"score": 1.0');
  });

  test("anexa a representação gráfica quando disponível", () => {
    const rodada = criarRodada();
    const c = caminhosRodada(rodada);
    const imagem = path.join(c.artefatosConversaoDir, "imagens", "representacao_grafica.png");
    mkdirSync(path.dirname(imagem), { recursive: true });
    writeFileSync(imagem, "imagem");
    const dados = path.join(c.artefatosConversaoDir, "dados.json");
    escreverJsonPy(dados, { representacao_grafica: { extraida: true, caminho: "imagens/representacao_grafica.png" } });
    escreverJsonPy(c.preparacaoDocx, { dados });
    const payload = montarGruposSubagents(rodada) as { grupos: ObjetoPy[] };
    const comAnexo = payload.grupos.filter((g) => g.requer_anexos_visuais);
    expect(comAnexo.length).toBeGreaterThan(0);
    expect(((comAnexo[0]!.contextos as ObjetoPy).anexos_visuais as ObjetoPy[])[0]!.arquivo).toBe(imagem);
  });

  test("gera um pacote de prompt por grupo", () => {
    const rodada = criarRodada();
    montarGruposSubagents(rodada, 30);
    const manifest = prepararPromptsSubagents(rodada) as { total_pacotes: number; arquivos: ObjetoPy[] };
    expect(manifest.total_pacotes).toBe(Math.ceil(TOTAL_FICHAS / 30));
    const texto = readFileSync(String(manifest.arquivos[0]!.arquivo), "utf-8");
    for (const trecho of [
      "## Prompt de trabalho",
      "## PPC.md",
      "## Grupo e contextos",
      "Curso Técnico em Informática",
    ]) {
      expect(texto).toContain(trecho);
    }
  });

  test("fixtures qualitativas exercitam norma e estágio", () => {
    const fixtureNorma = path.join(FIXTURES, "ppc_norma_sem_suporte.md");
    const fixtureEstagio = path.join(FIXTURES, "ppc_estagio_contraditorio.md");
    expect(readFileSync(fixtureNorma, "utf-8")).toContain("dispensa a consulta ao Catálogo Nacional");
    expect(readFileSync(fixtureEstagio, "utf-8")).toContain("estágio é não obrigatório");
    const dir = diretorioTemporario();
    const { rodadaDir } = prepararDocumento(fixtureEstagio, { saidaBase: dir, relogio: RELOGIO });
    const grupos = montarGruposSubagents(rodadaDir) as ObjetoPy & { grupos: ObjetoPy[] };
    expect(((grupos.cnct_contexto as ObjetoPy).correspondencia as ObjetoPy).denominacao).toBe("Técnico em Informática");
    expect(grupos.grupos.some((g) => g.requer_fundamentacao_normativa)).toBe(true);
  });
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
    expect(contexto.correspondencia.score).toBeInstanceOf(FloatPy);
  });

  test("o catálogo interno foi substituído pela base unificada", () => {
    expect(existsSync(path.join(caminhos.baseAnaliseDir, "dados", "cnct", "catalogo_cnct.csv"))).toBe(false);
    expect(existsSync(path.join(caminhos.baseConhecimentoDir, "catalogos", "cnct", "index.json"))).toBe(true);
  });
});

describe("grupo avulso e mescla", () => {
  test("monta o grupo avulso e mescla os resultados", () => {
    const rodada = criarRodada();
    const c = caminhosRodada(rodada);
    escreverJsonPy(c.resultadosSubagents, payloadResultadosCompletos());
    const grupo = montarGrupoAvulso(rodada, ["CT-IDENT-01"]) as { grupo: ObjetoPy; grupo_avulso_path: string };
    expect(existsSync(grupo.grupo_avulso_path)).toBe(true);
    escreverJsonPy(path.join(c.suporteDir, "resultado-avulso.json"), {
      grupo_id: grupo.grupo.grupo_id,
      resultados: [{ ...resultado("CT-IDENT-01", "INCONCLUSIVO"), confianca: new FloatPy(1) }],
    });
    const mesclado = mesclarResultadosAvulsos(rodada, "resultados-subagents.json", "resultado-avulso.json");
    expect(mesclado.fichas_substituidas).toEqual(["CT-IDENT-01"]);
    const payload = lerJsonPy(c.resultadosSubagents) as Payload;
    const resultados = payload.grupos.flatMap((g) => g.resultados).filter((item) => item.ficha_id === "CT-IDENT-01");
    expect(resultados.length).toBe(1);
    expect(resultados[0]!.estado).toBe("INCONCLUSIVO");
    // A mescla preserva o float 1.0 do JSON.
    expect(readFileSync(c.resultadosSubagents, "utf-8")).toContain('"confianca": 1.0');
    expect(validarResultadosRodada(rodada, "resultados-subagents.json").valido).toBe(true);
  });

  test("rejeita ficha desconhecida no grupo avulso e avulso sem resultados", () => {
    const rodada = criarRodada();
    expect(() => montarGrupoAvulso(rodada, ["CT-NAO-EXISTE"])).toThrow("Fichas não encontradas: CT-NAO-EXISTE");
    const c = caminhosRodada(rodada);
    escreverJsonPy(c.resultadosSubagents, payloadResultadosCompletos());
    escreverJsonPy(path.join(c.suporteDir, "avulso.json"), { nada: [] });
    expect(() => mesclarResultadosAvulsos(rodada, "resultados-subagents.json", "avulso.json")).toThrow(
      "O resultado avulso precisa conter `grupos[]` ou `resultados[]`.",
    );
  });
});

describe("validar-resultados", () => {
  function validar(editar: (payload: Payload) => void = () => {}): ObjetoPy {
    const rodada = criarRodada();
    const payload = payloadResultadosCompletos();
    editar(payload);
    writeFileSync(
      path.join(caminhosRodada(rodada).suporteDir, "resultados-subagents.json"),
      dumpsPy(payload, { indent: 2 }),
    );
    return validarResultadosRodada(rodada, "resultados-subagents.json");
  }

  test("devolve o resumo sem gerar HTML", () => {
    const rodada = criarRodada();
    const c = caminhosRodada(rodada);
    escreverJsonPy(c.resultadosSubagents, payloadResultadosCompletos());
    const resumo = validarResultadosRodada(rodada, "resultados-subagents.json");
    expect(resumo.valido).toBe(true);
    expect(resumo.total_fichas).toBe(TOTAL_FICHAS);
    expect(resumo.total_fichas_esperadas).toBe(TOTAL_FICHAS);
    expect(resumo.total_alertas_transversais).toBe(0);
    expect(resumo.contagem_estado).toEqual({ ATENDE: TOTAL_FICHAS });
    expect(resumo.situacao).toBe("APROVADO");
    expect(existsSync(c.relatorioHtml)).toBe(false);
  });

  const casos: Array<[string, (p: Payload) => void, string]> = [
    ["ficha duplicada", (p) => (p.grupos[1]!.resultados[0] = { ...p.grupos[0]!.resultados[0]! }), "duplicadas"],
    ["ficha desconhecida", (p) => (p.grupos[0]!.resultados[0]!.ficha_id = "CT-NAO-EXISTE"), "desconhecidas"],
    ["ficha faltante", (p) => p.grupos[0]!.resultados.pop(), "sem resultado"],
    ["evidências abaixo do mínimo", (p) => (p.grupos[0]!.resultados[0]!.evidencias = []), "mínimo exigido"],
    ["estado inválido", (p) => (p.grupos[0]!.resultados[0]!.estado = "OK"), "Estado inválido"],
    [
      "confiança fora da faixa",
      (p) => (p.grupos[0]!.resultados[0]!.confianca = new FloatPy(1.5)),
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
    expect(resumo.situacao).toBe("COM_RESSALVAS");
  });

  test("a CLI imprime o resumo e falha com mensagem em stderr", () => {
    const rodada = criarRodada();
    const c = caminhosRodada(rodada);
    escreverJsonPy(c.resultadosSubagents, payloadResultadosCompletos());
    const ok = cli("validar-resultados", "--rodada-dir", rodada);
    expect(ok.codigo).toBe(0);
    expect(JSON.parse(ok.stdout).valido).toBe(true);
    const payload = payloadResultadosCompletos();
    payload.grupos[0]!.resultados.pop();
    escreverJsonPy(c.resultadosSubagents, payload);
    const erro = cli("validar-resultados", "--rodada-dir", rodada);
    expect(erro.codigo).toBe(1);
    expect(erro.stderr).toContain("ErroResultadosSubagents: Fichas sem resultado:");
  });
});

describe("conteúdo das fichas, validações e prompts", () => {
  const CAMPOS = ["pergunta", "rubrica", "boa_evidencia", "ma_evidencia", "escalonar_quando"];
  const CAMPOS_COM_TITULO = ["titulo", ...CAMPOS];
  const consultas = (ficha: ObjetoPy) => (ficha.consultas as string[]).map((c) => casefold(c));

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
    const fichas: Record<string, ObjetoPy> = {
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
    const validacao = lerJsonPy(path.join(caminhos.validacoesCruzadasDir, "vc-05-16.json")) as ObjetoPy;
    const prompt = readFileSync(path.join(caminhos.promptsDir, "sintese-transversal.md"), "utf-8");
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
    const prompt = readFileSync(path.join(caminhos.promptsDir, "subagent-lote-fichas.md"), "utf-8");
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
    const prompt = readFileSync(path.join(caminhos.promptsDir, "sintese-transversal.md"), "utf-8");
    for (const campo of ["alertas_transversais", "validacao_id", "fichas_relacionadas"])
      expect(prompt).toContain(campo);
  });

  test("não há código de execução por CLI de modelo nem contagem de tokens", () => {
    const scripts = path.join(caminhos.appDir, "scripts");
    const conteudo = readdirSync(scripts, { recursive: true })
      .map(String)
      .filter((nome) => nome.endsWith(".ts") || nome.endsWith(".py"))
      .map((nome) => readFileSync(path.join(scripts, nome), "utf-8"))
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
