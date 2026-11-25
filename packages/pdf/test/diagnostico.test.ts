import { describe, expect, it } from "vite-plus/test";
import { diagnosticarMarkdown, regioesDosAchados, type TipoAchado } from "../src/diagnostico.ts";

const tipos = (texto: string, primeiraLinha?: number) =>
  diagnosticarMarkdown(texto, primeiraLinha).map((a) => [a.linha, a.tipo] as [number, TipoAchado]);

describe("diagnosticarMarkdown", () => {
  it("acha o parágrafo partido antes de maiúscula, com a linha", () => {
    const texto = [
      "Do ponto de vista legal, o curso é concebido a partir da consonância entre a",
      "",
      "Constituição Federal e as demais normativas.",
    ].join("\n");
    expect(tipos(texto, 10)).toEqual([[10, "paragrafo-partido"]]);
  });

  it("acha o título colado no texto, o título provável e o suspeito", () => {
    const texto = [
      "- 2.5.6 Mecanismos de Interação. Não se aplica (NSA).",
      "",
      "1.1.2 Área do Conhecimento",
      "",
      "## Este parágrafo virou título por engano e termina com ponto.",
    ].join("\n");
    expect(tipos(texto)).toEqual([
      [1, "titulo-colado"],
      [3, "titulo-provavel"],
      [5, "titulo-suspeito"],
    ]);
  });

  it("acha a tabela de cabeçalho partido e a palavra partida entre células", () => {
    const texto = [
      "|**PRIMEIRO PERÍODO**||||",
      "|---|---|---|---|",
      "||||Carga|",
      "||H/A|CH||",
      "|Componente|sem.|(T)|total|",
      "|Quadro 1 - ní|veis e modalidades|x|y|",
    ].join("\n");
    expect(tipos(texto)).toEqual([
      [1, "tabela-cabecalho-partido"],
      [6, "tabela-palavra-partida"],
    ]);
  });

  it("acha hífen partido, palavras coladas, letras espaçadas, caractere estranho e número solto", () => {
    const texto = [
      "a qualidade tornou- se tema recorrente",
      "",
      "INSTITUTOFEDERAL do Paraná",
      "",
      "o C A M P U S de Curitiba",
      "",
      "o caractere � estranho",
      "",
      "1",
      "",
      "2",
      "",
      "57",
    ].join("\n");
    expect(tipos(texto).map(([, tipo]) => tipo)).toEqual([
      "hifen-partido",
      "palavras-coladas",
      "letras-espacadas",
      "caractere-estranho",
      "numero-solto",
    ]);
  });

  it("não acha nada no texto limpo", () => {
    expect(tipos("## 1 INTRODUÇÃO\n\nO curso começa em março.\n\n- Primeiro item;\n\n- segundo item.")).toEqual([]);
  });
});

describe("regioesDosAchados", () => {
  it("agrupa os achados próximos", () => {
    const achado = (linha: number) => ({ tipo: "numero-solto" as const, linha, fim: linha, trecho: "" });
    const regioes = regioesDosAchados([achado(1), achado(50), achado(200)], 80);
    expect(regioes.map((r) => [r.linha, r.fim, r.achados.length])).toEqual([
      [1, 50, 2],
      [200, 200, 1],
    ]);
  });
});
