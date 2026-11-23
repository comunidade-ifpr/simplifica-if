import { describe, expect, it } from "@effect/vitest";
import type { Ancora } from "@simplifica-if/contratos-app";
import {
  artigoPedido,
  conteudoDoIndice,
  faixaDeArtigos,
  faixaPorExtenso,
  type ItemSumario,
  itensVisiveis,
  linhasDeDivisao,
  rotuloCurto,
} from "./sumario.ts";

const item = (tipo: ItemSumario["tipo"], rotulo: string, nivel: number, linha: number): ItemSumario => ({
  tipo,
  rotulo,
  nome: null,
  nivel,
  linha,
  linha_fim: linha + 2,
  artigos: null,
});
const artigo = (id: string, linha: number): Ancora => ({
  id,
  rotulo: id,
  tipo: "artigo",
  pai: null,
  linha_inicio: linha,
  linha_fim: linha,
  revogado: false,
});

const SUMARIO = [
  item("titulo", "TÍTULO I", 0, 10), // 0
  item("titulo", "TÍTULO II", 0, 20), // 1
  item("capitulo", "CAPÍTULO I", 1, 22), // 2
  item("secao", "Seção I", 2, 24), // 3
  item("secao", "Seção II", 2, 30), // 4
  item("capitulo", "CAPÍTULO II", 1, 40), // 5
  item("secao", "Seção Única", 2, 42), // 6
  item("topico", "Notas", 0, 90), // 7
];

describe("o índice do leitor", () => {
  it("mostra dois níveis sempre e as seções só do capítulo em leitura", () => {
    expect(itensVisiveis(SUMARIO, null)).toEqual([0, 1, 2, 5, 7]);
    expect(itensVisiveis(SUMARIO, 0)).toEqual([0, 1, 2, 5, 7]);
    expect(itensVisiveis(SUMARIO, 2)).toEqual([0, 1, 2, 3, 4, 5, 7]);
    expect(itensVisiveis(SUMARIO, 4)).toEqual([0, 1, 2, 3, 4, 5, 7]);
    expect(itensVisiveis(SUMARIO, 6)).toEqual([0, 1, 2, 5, 6, 7]);
  });

  it("abrevia o rótulo e escreve a faixa de artigos", () => {
    expect(rotuloCurto(SUMARIO[0]!)).toBe("Título I");
    expect(rotuloCurto(SUMARIO[2]!)).toBe("Cap. I");
    expect(rotuloCurto(SUMARIO[6]!)).toBe("Seção única");
    expect(rotuloCurto(item("capitulo", "CAPÍTULO II-A", 0, 1))).toBe("Cap. II-A");
    expect(rotuloCurto(SUMARIO[7]!)).toBe("Notas");
    expect(faixaDeArtigos({ artigos: { primeiro: "14", ultimo: "72" } })).toBe("14–72");
    expect(faixaDeArtigos({ artigos: { primeiro: "18", ultimo: "18" } })).toBe("18");
    expect(faixaPorExtenso({ artigos: { primeiro: "14", ultimo: "72" } })).toBe("artigos 14 a 72");
    expect(faixaDeArtigos({ artigos: null })).toBeNull();
  });

  it("as linhas dos cabeçalhos de divisão, sem o tópico", () => {
    expect([...linhasDeDivisao([SUMARIO[0]!, SUMARIO[7]!])]).toEqual([10, 11, 12]);
  });

  it("acha o artigo pedido: o do ato antes do do anexo", () => {
    const ancoras = [artigo("art1", 5), artigo("art36A", 9), artigo("anexo1-art1", 20), artigo("anexo1-art7", 30)];
    expect(artigoPedido("1", ancoras)?.id).toBe("art1");
    expect(artigoPedido(" art. 36-a ", ancoras)?.id).toBe("art36A");
    expect(artigoPedido("36A", ancoras)?.id).toBe("art36A");
    expect(artigoPedido("7º", ancoras)?.id).toBe("anexo1-art7");
    expect(artigoPedido("99", ancoras)).toBeNull();
    expect(artigoPedido("capítulo", ancoras)).toBeNull();
  });

  it("norma sem divisões: a grade de artigos, se há artigos que cheguem", () => {
    const quatro = [1, 2, 3, 4].map((n) => artigo(`art${n}`, n));
    expect(conteudoDoIndice({ sumario: [], ancoras: quatro })).toMatchObject({ comGrade: true, vazio: false });
    expect(conteudoDoIndice({ sumario: [], ancoras: quatro.slice(0, 2) })).toMatchObject({
      comGrade: false,
      vazio: true,
    });
    expect(conteudoDoIndice({ sumario: SUMARIO, ancoras: quatro })).toMatchObject({
      comDivisoes: true,
      comGrade: false,
      vazio: false,
    });
  });
});
