// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- os testes leem e gravam fixtures e fixam o relógio com datas dadas
/**
 * Identificação do curso (curso, campus, forma de oferta, modalidade e eixo)
 * em PPCs Markdown e nos dados da conversão DOCX, mais a medição contra
 * `dados/institucional/cursos` numa amostra fixa da base.
 *
 * Os trechos são mínimos e anonimizados, reproduzindo os formatos observados
 * nos PPCs da base.
 */
import { afterEach, describe, expect, test } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { ObjetoPy } from "@simplifica-if/kb/python/valores";
import {
  extrairIdentificacao,
  extrairIdentificacaoDaConversao,
  formaOfertaCanonica,
  limparDenominacaoCurso,
  modalidadeEnsinoCanonica,
  removerFrontMatter,
} from "../scripts/identificacao.ts";
import {
  AMOSTRA_MEDICAO,
  categoriaFormaOferta,
  medirIdentificacao,
  nucleoCurso,
} from "../scripts/medicao-identificacao.ts";
import { prepararDocumento } from "../scripts/preparar-documento.ts";
import { montarDocx, par, tabelaDeTextos } from "@simplifica-if/docx/testes/sintetico";
import { lerJsonPy } from "../scripts/rodada.ts";

const temporarios: string[] = [];
afterEach(() => {
  for (const dir of temporarios.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

function diretorioTemporario(): string {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "revisar-ppc-identificacao-"));
  temporarios.push(dir);
  return dir;
}

/** Capa e folha de rosto como no PPC de Técnico em Enfermagem (T1), com a base legal numa tabela adiante. */
const PPC_TITULOS_NUMERADOS = `## **MINISTÉRIO DA EDUCAÇÃO INSTITUTO FEDERAL DO PARANÁ PRÓ-REITORIA DE ENSINO**

**PROJETO PEDAGÓGICO DE CURSO CURSO TÉCNICO EM ENFERMAGEM FORMA DE OFERTA: SUBSEQUENTE**

**Curitiba 2023**

## **Diretor Geral do Campus**

Fulano de Tal

## 1.1 IDENTIFICAÇÃO

## 1.1.2 Informações do Campus

Campus: Instituto Federal do Paraná Campus Curitiba. Endereço: R. Exemplo, 100 – Curitiba – PR. Telefone: (41) 0000-0000

## 1.1.3 Denominação do Curso

Curso Técnico em Enfermagem

## 1.1.4 Eixo Tecnológico

Ambiente e Saúde

## 1.1.5 Modalidade

Presencial

## 1.1.6 Forma de Oferta

Subsequente ao Ensino Médio

## 2 ORGANIZAÇÃO CURRICULAR

|Componente|CH|
|---|---|
||Base legal específica do curso: Resolução CNE/CP nº 1/2021||||
`;

describe("extração da identificação no Markdown", () => {
  test("rótulo no meio da frase não vira nome do curso (regressão do T1)", () => {
    const identificacao = extrairIdentificacao(PPC_TITULOS_NUMERADOS, "PPC");
    expect(identificacao).toMatchObject({
      curso: "Técnico em Enfermagem",
      campus: "Curitiba",
      forma_oferta: "Subsequente",
      modalidade: "Subsequente",
      modalidade_ensino: "Presencial",
      eixo_tecnologico: "Ambiente e Saúde",
      fontes: { curso: "rotulo", campus: "rotulo", forma_oferta: "rotulo", modalidade_ensino: "rotulo" },
    });
  });

  test("só a linha da base legal não identifica o curso", () => {
    const identificacao = extrairIdentificacao(
      "||Base legal específica do curso: Resolução CNE/CP nº 1/2021||||\n",
      "meu-ppc",
    );
    expect(identificacao.curso).toBe("meu-ppc");
    expect(identificacao.fontes.curso).toBe("nome_arquivo");
  });

  test("vários rótulos em negrito na mesma linha", () => {
    const identificacao = extrairIdentificacao(
      `## **CAMPUS EXEMPLO**

**NÚMERO DO PROCESSO:** 23411.000000/2018-00 **NOME DO CURSO:** Curso Técnico em Comércio **EIXO TECNOLÓGICO** : Gestão e Negócios **COORDENAÇÃO DO CURSO** Coordenador: Fulano

**LOCAL DE REALIZAÇÃO/CAMPUS: ASSIS CHATEAUBRIAND**

**Forma de oferta:** Articulada Integrada

**Modalidade de oferta: (** X ) Presencial   (   ) A distância
`,
    );
    expect(identificacao).toMatchObject({
      curso: "Técnico em Comércio",
      campus: "Assis Chateaubriand",
      forma_oferta: "Integrado",
      modalidade_ensino: "Presencial",
      eixo_tecnologico: "Gestão e Negócios",
    });
  });

  test("tabela de identificação com rótulo e valor em células", () => {
    const identificacao = extrairIdentificacao(
      `|Campo|Valor|
|---|---|
|Denominação do curso|TÉCNICO EM AUTOMAÇÃO INDUSTRIAL|
|Eixo Tecnológico|Controle e Processos Industriais|
|Campus|Telêmaco Borba|
|Forma de oferta|Integrada ao ensino médio|
|Modalidade|Presencial|
|Coordenador do curso|Fulano de Tal|
`,
    );
    expect(identificacao).toMatchObject({
      curso: "Técnico em Automação Industrial",
      campus: "Telêmaco Borba",
      forma_oferta: "Integrado",
      modalidade_ensino: "Presencial",
      eixo_tecnologico: "Controle e Processos Industriais",
    });
  });

  test("grade de opções: opções sem marca são ambíguas, e o X marca a opção anterior", () => {
    const identificacao = extrairIdentificacao(
      `**NOME DO CURSO: TÉCNICO EM ELETROTÉCNICA**

**LOCAL DE REALIZAÇÃO/CAMPUS: ASSIS CHATEAUBRIAND**

|**MODALIDADE:**||||PROEJA|||||INTEGRADO|||||CONCOMITANTE|||
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
|SUBSEQUENTE|||||X||||||||||||
|OFERTA:|||PRESENCIAL|||||||X||||A DISTÂNCIA|||
`,
    );
    expect(identificacao).toMatchObject({
      curso: "Técnico em Eletrotécnica",
      forma_oferta: "Subsequente",
      modalidade_ensino: "Presencial",
    });
  });

  test("capa em caixa alta quando não há rótulo; campus pela palavra campus, ignorando a Pró-Reitoria", () => {
    const identificacao = extrairIdentificacao(
      `# PROJETO PEDAGÓGICO DE CURSO CURSO TÉCNICO EM MECATRÔNICA FORMA DE OFERTA: Integrado

**CAMPUS AVANÇADO ARAPONGAS 2025**

Pró-Reitoria de Ensino; o curso é ofertado de forma presencial.
`,
    );
    expect(identificacao).toMatchObject({
      curso: "Técnico em Mecatrônica",
      campus: "Arapongas",
      forma_oferta: "Integrado",
      modalidade_ensino: "Presencial",
      fontes: { curso: "capa", campus: "inicio", forma_oferta: "rotulo", modalidade_ensino: "inicio" },
    });
  });

  test("PROEJA na denominação ou na modalidade vai para a forma de oferta", () => {
    const identificacao = extrairIdentificacao(
      `**NOME DO CURSO:** Curso Técnico em Manutenção e Suporte em Informática

**Modalidade:** presencial/Educação de Jovens e Adultos/PROEJA

**Forma de Oferta:** Integrada
`,
    );
    expect(identificacao.curso).toBe("Técnico em Manutenção e Suporte em Informática");
    expect(identificacao.forma_oferta).toBe("Integrado (PROEJA)");
    expect(identificacao.modalidade_ensino).toBe("Presencial");
  });

  test("front matter YAML no topo é ignorado", () => {
    const texto = `---
titulo: "Curso: Resolução CNE/CP nº 1/2021"
campus: Reitoria
---
${PPC_TITULOS_NUMERADOS}`;
    expect(removerFrontMatter(texto)).toBe(PPC_TITULOS_NUMERADOS);
    expect(extrairIdentificacao(texto)).toMatchObject({ curso: "Técnico em Enfermagem", campus: "Curitiba" });
  });

  test("régua horizontal no topo não é front matter", () => {
    const minuta = `---\n\n${PPC_TITULOS_NUMERADOS}\n---\n\nResto do texto.\n`;
    expect(removerFrontMatter(minuta)).toBe(minuta);
    expect(extrairIdentificacao(minuta)).toMatchObject({ curso: "Técnico em Enfermagem", campus: "Curitiba" });
    const naoYaml = "---\nTexto livre, sem chave e valor\n---\nCorpo\n";
    expect(removerFrontMatter(naoYaml)).toBe(naoYaml);
  });

  test("sem nada identificável, os marcadores de ausência", () => {
    const identificacao = extrairIdentificacao("Texto qualquer sobre o curso: sem identificação.\n");
    expect(identificacao).toMatchObject({
      curso: "Curso não identificado",
      campus: "Campus não identificado",
      modalidade: "Modalidade não identificada",
      forma_oferta: "Forma de oferta não identificada",
      modalidade_ensino: "Modalidade de ensino não identificada",
      fontes: {},
    });
    expect(identificacao.eixo_tecnologico).toBeUndefined();
  });
});

describe("validadores", () => {
  test("denominação do curso", () => {
    expect(limparDenominacaoCurso("Resolução CNE/CP nº 1/2021||||")).toEqual({ curso: "", forma: "" });
    expect(limparDenominacaoCurso("3300h.").curso).toBe("");
    expect(limparDenominacaoCurso("Curso Técnico em Mecânica Resolução de Criação: Nº 78/2011").curso).toBe(
      "Técnico em Mecânica",
    );
    expect(limparDenominacaoCurso("Técnico Integrado em Petróleo e Gás")).toEqual({
      curso: "Técnico em Petróleo e Gás",
      forma: "Integrado",
    });
    expect(limparDenominacaoCurso("Curso Técnico em Programação de Jogos Digitais, modalidade integrado").curso).toBe(
      "Técnico em Programação de Jogos Digitais",
    );
    expect(limparDenominacaoCurso("ENSINO MÉDIO INTEGRADO EM MECÂNICA").curso).toBe("Técnico em Mecânica");
    expect(limparDenominacaoCurso("Técnico em informática").curso).toBe("Técnico em Informática");
    expect(limparDenominacaoCurso("Curso Técnico em Melhoria de Processos Oferta Experimental").curso).toBe(
      "Técnico em Melhoria de Processos",
    );
  });

  test("forma de oferta e modalidade de ensino", () => {
    expect(formaOfertaCanonica("Subsequente ao Ensino Médio")).toBe("Subsequente");
    expect(formaOfertaCanonica("Articulada Integrada")).toBe("Integrado");
    expect(formaOfertaCanonica("PROEJA INTEGRADO CONCOMITANTE")).toBe("");
    expect(formaOfertaCanonica("PROEJA INTEGRADO X CONCOMITANTE")).toBe("Integrado");
    expect(formaOfertaCanonica("Presencial")).toBe("");
    expect(modalidadeEnsinoCanonica("( x ) Presencial ( ) A distância")).toBe("Presencial");
    expect(modalidadeEnsinoCanonica("( ) Presencial ( X ) A distância")).toBe("A distância");
    expect(modalidadeEnsinoCanonica("Presencial ou a distância")).toBe("");
  });
});

describe("dados da conversão DOCX", () => {
  test("valores que não parecem identificação são descartados", () => {
    const identificacao = extrairIdentificacaoDaConversao({
      dados_extraidos: {
        nome_curso: "Resolução CNE/CP nº 1/2021",
        curso_tecnico_em_x: "Coordenador: Fulano",
        denominacao_do_curso: "Curso Técnico em Química",
        campus: "Instituto Federal do Paraná – Campus Umuarama. Endereço: Rua X, 100",
        modalidade: "Integrado",
        forma_oferta: "Presencial",
        eixo_tecnologico: "Eixo de Produção Industrial",
      },
    });
    expect(identificacao).toEqual({
      curso: "Técnico em Química",
      campus: "Umuarama",
      modalidade: "Integrado",
      forma_oferta: "Integrado",
      modalidade_ensino: "Presencial",
      eixo_tecnologico: "Produção Industrial",
    });
  });
});

describe("preparar-documento", () => {
  test("metadata registra a identificação e a fonte de cada campo", () => {
    const dir = diretorioTemporario();
    const arquivo = NodePath.join(dir, "ppc-enfermagem.md");
    NodeFS.writeFileSync(arquivo, PPC_TITULOS_NUMERADOS, "utf8");
    const { metadata } = prepararDocumento(arquivo, { saidaBase: dir, relogio: () => new Date(2026, 10, 13) });
    expect(lerJsonPy(metadata) as ObjetoPy).toMatchObject({
      curso: "Técnico em Enfermagem",
      campus: "Curitiba",
      modalidade: "Subsequente",
      forma_oferta: "Subsequente",
      modalidade_ensino: "Presencial",
      eixo_tecnologico: "Ambiente e Saúde",
      identificacao_fontes: {
        curso: "rotulo",
        campus: "rotulo",
        forma_oferta: "rotulo",
        modalidade_ensino: "rotulo",
        eixo_tecnologico: "rotulo",
      },
    });
  });

  test("DOCX: base legal numa tabela não vira nome do curso", () => {
    const dir = diretorioTemporario();
    const arquivo = NodePath.join(dir, "ppc-sintetico.docx");
    NodeFS.writeFileSync(
      arquivo,
      montarDocx({
        corpo: [
          par("PROJETO PEDAGÓGICO DE CURSO", { estilo: "Ttulo" }),
          par("1 IDENTIFICAÇÃO", { estilo: "Ttulo1" }),
          tabelaDeTextos([
            ["Base legal específica do curso", "Resolução CNE/CP nº 1/2021"],
            ["Coordenador do curso", "Fulano de Tal"],
            ["Denominação do curso", "Curso Técnico em Enfermagem"],
            ["Campus", "Curitiba"],
            ["Forma de oferta", "Subsequente"],
            ["Modalidade", "Presencial"],
          ]),
          par("Base legal específica do curso: Resolução CNE/CP nº 1/2021"),
        ].join(""),
      }),
    );
    const { metadata } = prepararDocumento(arquivo, {
      saidaBase: dir,
      relogio: () => new Date(2026, 10, 13),
    });
    expect(lerJsonPy(metadata) as ObjetoPy).toMatchObject({
      curso: "Técnico em Enfermagem",
      campus: "Curitiba",
      forma_oferta: "Subsequente",
      modalidade_ensino: "Presencial",
      identificacao_fontes: { curso: "rotulo", campus: "rotulo" },
    });
  });
});

describe("medição contra dados/institucional", () => {
  test("comparação por núcleo da denominação e por categoria", () => {
    expect(nucleoCurso("Curso Técnico em Informática Integrado ao Ensino Médio")).toBe("informatica");
    expect(nucleoCurso("Administração – PROEJA")).toBe("administracao");
    expect(nucleoCurso("Técnico em Informática para Internet")).toBe("informatica para internet");
    expect(categoriaFormaOferta("Integrado (PROEJA)")).toBe("integrado");
  });

  test("a amostra fixa da base sai toda certa", () => {
    const medicao = medirIdentificacao({ amostra: AMOSTRA_MEDICAO });
    expect(medicao.total).toBe(AMOSTRA_MEDICAO.length);
    const falhas = medicao.casos.flatMap((caso) =>
      Object.entries(caso.resultado)
        .filter(([, resultado]) => resultado === "errado" || resultado === "vazio")
        .map(([campo]) => `${caso.caminho}: ${campo} = ${caso.extraido[campo as keyof typeof caso.extraido]}`),
    );
    expect(falhas).toEqual([]);
  });
});
