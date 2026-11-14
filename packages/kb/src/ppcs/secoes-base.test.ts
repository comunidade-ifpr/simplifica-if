/** Conferências sobre a base real: o texto integral se reconstrói pelas linhas do índice. */
import { describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { raizRepositorio } from "../normas/registro.ts";
import { caminhoBase, carregarIndicePpcs, lerTextoSecao } from "./citacoes.ts";
import { limparTexto, palavrasDeCampi, previewSecao, segmentarPpc, taxonomiaDoNivel, textoDaSecao } from "./secoes.ts";

const raiz = raizRepositorio();
const ppcs = carregarIndicePpcs(raiz);

describe("texto integral das seções da base", () => {
  test("textoDaSecao reconstrói o texto de todas as seções dos 202 PPCs", () => {
    const palavras = palavrasDeCampi(ppcs.map((ppc) => ppc.campus_nome));
    let total = 0;
    for (const ppc of ppcs) {
      const md = readFileSync(path.join(caminhoBase(raiz), ppc.path), "utf-8");
      for (const secao of segmentarPpc(md, taxonomiaDoNivel(ppc.nivel), palavras)) {
        expect(textoDaSecao(md, secao.linhaInicio, secao.linhaFim)).toBe(secao.texto);
        total += 1;
      }
    }
    expect(total).toBeGreaterThan(20000);
  });

  test("lerTextoSecao parte das linhas do JSONL publicado e casa com o preview", () => {
    const arquivo = path.join(caminhoBase(raiz), "institucional/ifpr/ppcs/secoes/acompanhamento_egresso.jsonl");
    const linhas = readFileSync(arquivo, "utf-8").trim().split("\n");
    expect(linhas.length).toBeGreaterThan(100);
    for (const linha of linhas) {
      const secao = JSON.parse(linha) as { path: string; linha_inicio: number; linha_fim: number; preview: string };
      const texto = lerTextoSecao(secao, { raiz });
      expect(previewSecao({ textoLimpo: limparTexto(texto) })).toBe(secao.preview);
    }
  });
});
