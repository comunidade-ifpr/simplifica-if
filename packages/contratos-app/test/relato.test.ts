/**
 * "Isto está errado" (M1.12): o relato montado como a pessoa o vê e envia, a retirada de trechos e a
 * página da issue, com o limite de tamanho da URL.
 */
import { describe, expect, it } from "@effect/vitest";
import {
  CORPO_PARA_COLAR,
  citacoesDe,
  ESCOLHAS_INICIAIS,
  FONTE_RETIRADA,
  neutralizarGithub,
  montarRelato,
  montarUrlIssue,
  type RascunhoRelato,
  TRECHO_RETIRADO,
  tituloRelato,
  trechosDe,
} from "../src/relato.ts";

const RASCUNHO: RascunhoRelato = {
  sessao: "s1",
  turno: 2,
  pergunta: "O estágio é obrigatório?\n\nMeu curso é o Técnico em Enfermagem.",
  resposta:
    "Sim, conforme ifpr://norma/br/cne-cp/res/2021/1#art20.\n\n```\nlinha 1\n\nlinha 2\n```\n\nVeja também ifpr://cnct/tecnico-em-enfermagem.",
  citacoes: ["ifpr://norma/br/cne-cp/res/2021/1#art20", "ifpr://cnct/tecnico-em-enfermagem"],
  versoes: {
    app: "0.3.0",
    base: "2026.11.13",
    baseCommit: "0123456789abcdef0123",
    tarefa: {
      nome: "verificar-fundamentacao-normativa",
      titulo: "Conferir a fundamentação normativa",
      versao: "1.2.0",
    },
    provider: "claude",
    versaoProvider: "2.1.30",
    modelo: null,
  },
  repositorio: "exemplo/simplifica-if",
  rotulos: ["relato-do-app"],
  podeSalvar: true,
};

describe("trechos", () => {
  it("parágrafos separados por linha em branco; bloco de código inteiro", () => {
    expect(trechosDe("a\nb\n\n\nc")).toEqual(["a\nb", "c"]);
    expect(trechosDe(RASCUNHO.resposta)).toHaveLength(3);
    expect(trechosDe(RASCUNHO.resposta)[1]).toBe("```\nlinha 1\n\nlinha 2\n```");
    expect(trechosDe("  \n")).toEqual([]);
  });

  it("citações sem repetição e sem a pontuação do fim", () => {
    expect(citacoesDe("ver ifpr://norma/x#art1, ifpr://norma/x#art1. e ifpr://")).toEqual(["ifpr://norma/x#art1"]);
  });
});

describe("montarRelato", () => {
  it("o pacote inteiro: o que está errado, pergunta, resposta, fontes e versões", () => {
    const { titulo, corpo } = montarRelato(RASCUNHO, {
      ...ESCOLHAS_INICIAIS,
      descricao: "O art. 20 não trata de estágio.\nO certo é o art. 21.",
    });
    expect(titulo).toBe("Isto está errado: O art. 20 não trata de estágio.");
    expect(corpo).toContain("## O que está errado\n\nO art. 20 não trata de estágio.\nO certo é o art. 21.");
    expect(corpo).toContain("## Pergunta\n\n> O estágio é obrigatório?\n>\n> Meu curso é o Técnico em Enfermagem.");
    expect(corpo).toContain("> ```\n> linha 1\n>\n> linha 2\n> ```");
    expect(corpo).toContain("- `ifpr://norma/br/cne-cp/res/2021/1#art20`\n- `ifpr://cnct/tecnico-em-enfermagem`");
    expect(corpo).toContain("- Base: 2026.11.13 (commit 0123456789ab)");
    expect(corpo).toContain("- Tarefa: Conferir a fundamentação normativa (`verificar-fundamentacao-normativa` 1.2.0)");
    expect(corpo).toContain("- IA: Claude (Claude Code) (versão 2.1.30)");
    expect(corpo).toMatch(/não traz anexos nem arquivos da pasta da tarefa/);
  });

  it("retirar trechos, fontes e versões: o que sai não aparece no corpo", () => {
    const { titulo, corpo } = montarRelato(RASCUNHO, {
      descricao: "",
      retiradosPergunta: new Set([1]),
      retiradosResposta: new Set([0, 2]),
      retiradasCitacoes: new Set(["ifpr://cnct/tecnico-em-enfermagem"]),
      semVersoes: true,
    });
    expect(titulo).toBe("Isto está errado: resposta do Simplifica IF");
    expect(corpo).toContain("_(não descrito)_");
    expect(corpo).not.toContain("Técnico em Enfermagem.");
    expect(corpo).not.toContain("Sim, conforme");
    expect(corpo).not.toContain("Veja também");
    expect(corpo).toContain("linha 2");
    expect(corpo.split(TRECHO_RETIRADO)).toHaveLength(4);
    // A fonte retirada sai da lista e do texto da resposta.
    expect(corpo).not.toContain("tecnico-em-enfermagem");
    expect(corpo).not.toContain("## Versões");
    expect(corpo).not.toContain("2.1.30");
  });

  it("título curto mesmo com descrição longa", () => {
    expect(tituloRelato("x".repeat(200))).toHaveLength("Isto está errado: ".length + 80);
  });
});

describe("montarUrlIssue", () => {
  const relato = montarRelato(RASCUNHO, { ...ESCOLHAS_INICIAIS, descricao: "Errado & incompleto?" });

  it("a página issues/new com título, rótulos e corpo codificados", () => {
    const { url, completa } = montarUrlIssue("exemplo/simplifica-if", ["relato-do-app", "base"], relato);
    expect(completa).toBe(true);
    const lida = new URL(url);
    expect(`${lida.origin}${lida.pathname}`).toBe("https://github.com/exemplo/simplifica-if/issues/new");
    expect(lida.searchParams.get("title")).toBe("Isto está errado: Errado & incompleto?");
    expect(lida.searchParams.get("labels")).toBe("relato-do-app,base");
    expect(lida.searchParams.get("body")).toBe(relato.corpo);
  });

  it("acima do limite, o corpo fica de fora e a interface o copia", () => {
    const grande = { titulo: "t", corpo: "á".repeat(3000) };
    const { url, completa } = montarUrlIssue("exemplo/simplifica-if", [], grande);
    expect(completa).toBe(false);
    expect(url.length).toBeLessThanOrEqual(8000);
    expect(new URL(url).searchParams.get("body")).toBe(CORPO_PARA_COLAR);
    expect(new URL(url).searchParams.has("labels")).toBe(false);
    expect(montarUrlIssue("exemplo/simplifica-if", [], relato, 100).completa).toBe(false);
  });

  it("recusa repositório que não é dono/repo", () => {
    expect(() => montarUrlIssue("https://evil.example/x", [], relato)).toThrow(/repositório inválido/);
    expect(() => montarUrlIssue("a/b/c", [], relato)).toThrow(/repositório inválido/);
    expect(() => montarUrlIssue("dono/..", [], relato)).toThrow(/repositório inválido/);
    expect(() => montarUrlIssue("dono/.", [], relato)).toThrow(/repositório inválido/);
    expect(montarUrlIssue("dono/.github", [], relato).completa).toBe(true);
  });
});

describe("issue pública", () => {
  it("@menções e #referências entre crases, fora dos blocos de código; e-mail e títulos ficam", () => {
    expect(neutralizarGithub("Fale com @fulana e @org/equipe sobre #12, dono/repo#3 e GH-7.")).toBe(
      "Fale com `@fulana` e `@org/equipe` sobre `#12`, `dono/repo#3` e `GH-7`.",
    );
    expect(neutralizarGithub("## Pergunta\n> a@b.com.br, `@ja` e C# 7")).toBe(
      "## Pergunta\n> a@b.com.br, `@ja` e C# 7",
    );
    expect(neutralizarGithub("> ```\n> @dentro #1\n> ```\n@fora")).toBe("> ```\n> @dentro #1\n> ```\n`@fora`");
  });

  it("montarRelato neutraliza título e corpo, e a prévia mostra o mesmo texto que sai", () => {
    const { titulo, corpo } = montarRelato(
      { ...RASCUNHO, pergunta: "Pergunte a @coordenacao sobre a issue #4" },
      { ...ESCOLHAS_INICIAIS, descricao: "Veja #4 com @fulana" },
    );
    expect(titulo).toBe("Isto está errado: Veja `#4` com `@fulana`");
    expect(corpo).toContain("> Pergunte a `@coordenacao` sobre a issue `#4`");
    const url = new URL(montarUrlIssue("exemplo/simplifica-if", [], { titulo, corpo }).url);
    expect(url.searchParams.get("body")).toBe(corpo);
  });

  it("fonte retirada: o link em Markdown fica só com o texto, o solto vira o aviso", () => {
    const { corpo } = montarRelato(
      {
        ...RASCUNHO,
        resposta: "Ver [Res. 1/2021](ifpr://norma/a#art1) e ifpr://norma/a#art1. Também ifpr://norma/a#art10.",
      },
      { ...ESCOLHAS_INICIAIS, retiradasCitacoes: new Set(["ifpr://norma/a#art1"]) },
    );
    expect(corpo).toContain(`> Ver Res. 1/2021 ${FONTE_RETIRADA} e ${FONTE_RETIRADA}. Também ifpr://norma/a#art10.`);
  });
});
