import { describe, expect, test } from "vite-plus/test";
import {
  carregarCaso,
  conferirTrechos,
  lerVeredito,
  pontuarAutomatico,
  pontuarJuiz,
  promptJuiz,
  resumoSkillMarkdown,
  type Execucao,
  type RelatorioSkill,
} from "./skills.ts";

const carregado = carregarCaso("avaliacao/skills/verificar-fundamentacao-normativa");
const { caso } = carregado;
const parecer = caso.documentos.find((documento) => documento.id === "parecer-informatica")!;

describe("caso da verificar-fundamentacao-normativa", () => {
  test("tem erros plantados e alegações corretas em cada documento", () => {
    expect(caso.documentos).toHaveLength(2);
    for (const documento of caso.documentos) {
      expect(documento.alegacoes.some((alegacao) => alegacao.tipo === "erro")).toBe(true);
      expect(documento.alegacoes.some((alegacao) => alegacao.tipo === "correta")).toBe(true);
    }
  });

  test("os trechos estão no documento e na base, e as regex casam com o próprio trecho", () => {
    expect(conferirTrechos(carregado)).toEqual([]);
  });
});

const RELATORIO_BOM = `# Verificação de fundamentação normativa

## Síntese
Três problemas.

## Fontes consultadas
- ifpr://normas/br/lei/2008/11788#art12
- ifpr://normas/br/cne-cp/res/2026/2#art29-par2

## Achados

### Achado 1 - estágio em todos os cursos
**Status:** CONTRADITÓRIA
O art. 37, § 1º, diz que o estágio pode ser obrigatório ou não obrigatório.

### Achado 2 - Lei nº 6.494/1977
**Status:** CONTRADITÓRIA
A lei foi revogada pela Lei nº 11.788/2008.

### Achado 3 - bolsa compulsória
**Status:** IMPRECISA
A regra está no art. 12, não no art. 9º.

### Achado 4 - art. 29
**Status:** CONFIRMADA
`;

describe("pontuação automática", () => {
  test("acha as alegações, os problemas, os links, os rótulos e as seções", () => {
    const pontuacao = pontuarAutomatico(parecer, RELATORIO_BOM);
    const porId = Object.fromEntries(pontuacao.alegacoes.map((alegacao) => [alegacao.id, alegacao]));
    expect(porId["e6-lei-revogada"]).toMatchObject({ tratada: true, problema_apontado: true });
    expect(porId["e7-artigo-errado"]).toMatchObject({ tratada: true, problema_apontado: true });
    expect(porId["c4-integrado-3000"]).toMatchObject({ tratada: true, problema_apontado: null });
    expect(porId["c5-consup-64"]?.tratada).toBe(false);
    expect(pontuacao.links_ifpr).toBe(2);
    expect(pontuacao.rotulos).toEqual(["CONFIRMADA", "IMPRECISA", "CONTRADITÓRIA"]);
    expect(pontuacao.secoes).toEqual(["sintese", "fontes", "achados"]);
  });

  test("CONFIRMADA COM RESSALVA não conta como CONFIRMADA", () => {
    expect(pontuarAutomatico(parecer, "Status: CONFIRMADA COM RESSALVA").rotulos).toEqual(["CONFIRMADA COM RESSALVA"]);
  });
});

describe("juiz", () => {
  const veredito = {
    alegacoes: parecer.alegacoes.map((alegacao) => ({
      id: alegacao.id,
      tratada: alegacao.id !== "c5-consup-64",
      status:
        alegacao.tipo === "erro" ? "IMPRECISA" : alegacao.id === "c3-cnct-informatica" ? "IMPRECISA" : "CONFIRMADA",
      problema_identificado: alegacao.id === "e7-artigo-errado" || alegacao.id === "c3-cnct-informatica",
      justificativa: "…",
    })),
  };

  test("o prompt traz o gabarito, o documento e o relatório", () => {
    const prompt = promptJuiz(parecer, "TEXTO DO DOCUMENTO", "TEXTO DO RELATÓRIO");
    expect(prompt).toContain("e6-lei-revogada");
    expect(prompt).toContain("TEXTO DO DOCUMENTO");
    expect(prompt).toContain("TEXTO DO RELATÓRIO");
  });

  test("lê o JSON com ou sem cerca e recusa veredito incompleto", () => {
    const json = JSON.stringify(veredito);
    expect(lerVeredito(parecer, `Segue:\n\`\`\`json\n${json}\n\`\`\``)).toEqual(veredito);
    expect(lerVeredito(parecer, json)).toEqual(veredito);
    expect(lerVeredito(parecer, JSON.stringify({ alegacoes: veredito.alegacoes.slice(1) }))).toBeUndefined();
    expect(lerVeredito(parecer, "sem json")).toBeUndefined();
  });

  test("status correto vem de status_aceitos; falso alarme só em alegação correta", () => {
    const pontuacao = pontuarJuiz(parecer, lerVeredito(parecer, JSON.stringify(veredito))!);
    const porId = Object.fromEntries(pontuacao.alegacoes.map((alegacao) => [alegacao.id, alegacao]));
    expect(porId["e7-artigo-errado"]?.status_correto).toBe(true);
    expect(porId["e6-lei-revogada"]?.status_correto).toBe(true);
    expect(porId["c4-integrado-3000"]?.status_correto).toBe(true);
    expect(porId["c5-consup-64"]).toMatchObject({ tratada: false, status: "NENHUM", status_correto: false });
    expect(porId["c3-cnct-informatica"]?.status_correto).toBe(false);
    expect(pontuacao.erros_detectados).toBe(1);
    expect(pontuacao.falsos_alarmes).toBe(1);
    expect(pontuacao.tratadas).toBe(5);
  });

  test("o resumo tem uma coluna por condição", () => {
    const execucao: Execucao = {
      documento: parecer.id,
      condicao: "skill",
      provider: "claude",
      modelo: null,
      duracao_ms: 1000,
      ferramentas: ["ifpr.resolver_citacoes", "Read"],
      leu_skill: true,
      tokens_entrada: 10,
      tokens_saida: 5,
      tokens_cache_leitura: 0,
      custo_usd: 0.01,
      desfecho: "end_turn",
      resposta: RELATORIO_BOM,
      automatica: pontuarAutomatico(parecer, RELATORIO_BOM),
      juiz: pontuarJuiz(parecer, veredito as never),
    };
    const relatorio: RelatorioSkill = {
      versao: 1,
      skill: caso.skill,
      iniciado_em: "x",
      concluido_em: "y",
      commit: null,
      rev_skill_antiga: caso.rev_skill_antiga,
      modelo_juiz: null,
      execucoes: [execucao, { ...execucao, condicao: "sem-skill", juiz: null }],
    };
    const resumo = resumoSkillMarkdown(relatorio, caso);
    expect(resumo).toContain("| Métrica | sem-skill | skill |");
    expect(resumo).toContain("| Status corretos (juiz) | — | 4/6 |");
  });
});
