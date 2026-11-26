import { FalhaRevisaoPpc } from "@simplifica-if/contratos-app/modulos/revisao-ppc";
import { describe, expect, test } from "vite-plus/test";
import { obterArquivo, pedeArquivoDeNovo, textoMesmoArquivo } from "./arquivo.ts";

const RECUSA = { texto: "Só dá para revisar um arquivo do Word (.docx)." };

describe("obterArquivo", () => {
  test("o caminho que a ponte devolve", async () => {
    expect(await obterArquivo(async () => "/x/PPC.docx", RECUSA)).toEqual({ arquivo: "/x/PPC.docx" });
  });

  test("nulo é a recusa do desktop (o arquivo solto que não é .docx) ou o diálogo fechado", async () => {
    expect(await obterArquivo(async () => null, RECUSA)).toEqual({ erro: RECUSA });
    expect(await obterArquivo(async () => null)).toBeUndefined();
  });

  test("um erro da ponte não culpa o arquivo: diz para tentar de novo, com o detalhe", async () => {
    const obtido = await obterArquivo(async () => {
      throw new Error("ipc caiu");
    }, RECUSA);
    expect(obtido).toEqual({ erro: { texto: "Não foi possível usar o arquivo. Tente de novo.", detalhe: "ipc caiu" } });
  });
});

describe("pedeArquivoDeNovo", () => {
  test("só a falha da revisão com escolherDeNovo", () => {
    expect(pedeArquivoDeNovo(new FalhaRevisaoPpc({ arquivo: "/x", motivo: "m", escolherDeNovo: true }))).toBe(true);
    expect(pedeArquivoDeNovo(new FalhaRevisaoPpc({ arquivo: "/x", motivo: "m" }))).toBe(false);
    expect(pedeArquivoDeNovo({ _tag: "AvisoNaoAceito", escolherDeNovo: true })).toBe(false);
    expect(pedeArquivoDeNovo(undefined)).toBe(false);
  });

  test("a frase quando a pessoa escolhe outro arquivo diz qual", () => {
    expect(textoMesmoArquivo("/Users/ana/PPC Agro.docx").texto).toMatch(/^Escolha o mesmo arquivo, “PPC Agro\.docx”\./);
  });
});
