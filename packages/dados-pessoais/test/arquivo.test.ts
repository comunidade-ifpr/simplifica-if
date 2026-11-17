/**
 * O texto dos arquivos anexados (M1.13): o corpo do `.docx` em parágrafos e linhas de tabela, os
 * arquivos de texto por linha, o PDF e o `.docx` quebrado como "não conferido".
 */
import { comParagrafoFinal, montarDocx, par, tabelaDeTextos } from "@simplifica-if/docx/testes/sintetico";
import { describe, expect, test } from "vite-plus/test";
import { conferirArquivo } from "../src/arquivo.ts";

const texto = (conteudo: string) => new TextEncoder().encode(conteudo);

describe("conferirArquivo", () => {
  test(".docx: parágrafos e linhas de tabela, com o lugar", () => {
    const corpo = comParagrafoFinal(
      par("Parecer do colegiado") +
        par("") +
        par("Contato da estudante: (41) 99876-5432") +
        tabelaDeTextos([
          ["Nome", "CPF"],
          ["Fulana", "529.982.247-25"],
        ]),
    );
    const resultado = conferirArquivo("parecer.docx", montarDocx({ corpo }));
    expect(resultado).toMatchObject({ situacao: "conferido", total: 2, porTipo: { cpf: 1, telefone: 1 } });
    if (resultado.situacao !== "conferido") throw new Error("esperava conferido");
    expect(resultado.exemplos.map((exemplo) => exemplo.onde)).toEqual(["parágrafo 3", "tabela 1, linha 2"]);
    expect(resultado.exemplos[1]!.trecho).toBe("Fulana | 529.***.***-**");
  });

  test(".md e .txt por linha; sem achados", () => {
    expect(conferirArquivo("a.md", texto("# Título\n\nE-mail: joao@gmail.com\n"))).toMatchObject({
      situacao: "conferido",
      total: 1,
      exemplos: [{ tipo: "email", onde: "linha 3", trecho: "E-mail: j***@g***.com" }],
    });
    expect(conferirArquivo("b.TXT", texto("coordenacao@ifpr.edu.br\r\n(41) 3535-1234"))).toMatchObject({
      situacao: "conferido",
      total: 0,
    });
  });

  test("PDF, imagem e .docx quebrado: não conferido, com o motivo", () => {
    expect(conferirArquivo("ppc.pdf", texto("%PDF-1.7"))).toEqual({
      situacao: "nao-conferido",
      motivo: "O app ainda não lê PDF para procurar dados pessoais.",
    });
    expect(conferirArquivo("foto.jpg", new Uint8Array([0xff, 0xd8]))).toMatchObject({ situacao: "nao-conferido" });
    const quebrado = conferirArquivo("x.docx", texto("isto não é um zip"));
    expect(quebrado.situacao).toBe("nao-conferido");
    if (quebrado.situacao === "nao-conferido")
      expect(quebrado.motivo).toMatch(/^O app não conseguiu ler este documento do Word\./);
  });
});
