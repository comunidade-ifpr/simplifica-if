/**
 * O plugin do leitor pelo mesmo caminho da tela: `react-markdown` com `remark-gfm`, `skipHtml` e o
 * plugin, renderizado em HTML estático pelo `react-dom/server`.
 */
import { describe, expect, it } from "@effect/vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ancorasPorLinha, linhasDoTrecho, type OpcoesDispositivos, rehypeDispositivos } from "./rehypeDispositivos.ts";

const html = (markdown: string, opcoes: OpcoesDispositivos) =>
  renderToStaticMarkup(
    createElement(ReactMarkdown, {
      remarkPlugins: [remarkGfm],
      rehypePlugins: [[rehypeDispositivos, opcoes]],
      skipHtml: true,
      children: markdown,
    }),
  );

const NORMA = [
  "", // 1: front matter em branco
  "",
  "#### Art. 28.", // 3
  "",
  "A estrutura do PPC deve conter, no mínimo:", // 5
  "",
  "- **I –** a identificação do curso;", // 7
  "- **II –** o formato da oferta;", // 8
  "",
  "#### Art. 29.", // 10
  "",
  "Texto do art. 29.", // 12
].join("\n");

const ANCORAS = [
  { id: "art28", pai: null, linha_inicio: 3, linha_fim: 5 },
  { id: "art28-i", pai: "art28", linha_inicio: 7, linha_fim: 7 },
  { id: "art28-ii", pai: "art28", linha_inicio: 8, linha_fim: 8 },
  { id: "art29", pai: null, linha_inicio: 10, linha_fim: 12 },
];

describe("rehypeDispositivos", () => {
  it("põe o id de cada dispositivo no elemento da linha dele", () => {
    const saida = html(NORMA, { ancoras: ancorasPorLinha(ANCORAS), destaque: null, deslocamento: 0 });
    expect(saida).toContain('<h4 id="art28">Art. 28.</h4>');
    expect(saida).toContain('<li id="art28-i"><strong>I –</strong> a identificação do curso;</li>');
    expect(saida).toContain('<li id="art28-ii">');
    expect(saida).toContain('<h4 id="art29">');
    expect(saida).not.toContain("<mark");
  });

  it("destaca o trecho citado em <mark>, e só ele", () => {
    const saida = html(NORMA, {
      ancoras: ancorasPorLinha(ANCORAS),
      destaque: linhasDoTrecho(ANCORAS, "art28")!,
      deslocamento: 0,
    });
    expect(saida).toContain('<h4 id="art28"><mark class="trecho-citado">Art. 28.</mark></h4>');
    expect(saida).toContain('<p><mark class="trecho-citado">A estrutura do PPC deve conter, no mínimo:</mark></p>');
    expect(saida).toContain(
      '<li id="art28-ii"><mark class="trecho-citado"><strong>II –</strong> o formato da oferta;</mark></li>',
    );
    expect(saida).toContain("<p>Texto do art. 29.</p>");
    expect(saida.match(/<mark/g)).toHaveLength(4);
  });

  it("um inciso só: o destaque não vaza para o vizinho", () => {
    const saida = html(NORMA, {
      ancoras: ancorasPorLinha(ANCORAS),
      destaque: linhasDoTrecho(ANCORAS, "art28-i")!,
      deslocamento: 0,
    });
    expect(saida.match(/<mark/g)).toHaveLength(1);
    expect(saida).toContain('<li id="art28-i"><mark class="trecho-citado">');
  });

  it("num bloco, soma o deslocamento às linhas", () => {
    // o bloco começa na linha 10 do arquivo
    const saida = html("#### Art. 29.\n\nTexto do art. 29.", {
      ancoras: ancorasPorLinha(ANCORAS),
      destaque: { inicio: 12, fim: 12 },
      deslocamento: 9,
    });
    expect(saida).toBe('<h4 id="art29">Art. 29.</h4>\n<p><mark class="trecho-citado">Texto do art. 29.</mark></p>');
  });

  it("duas âncoras na mesma linha: a segunda vira um marcador vazio no começo do elemento", () => {
    const saida = html("ANEXO I – Itens", {
      ancoras: ancorasPorLinha([
        { id: "anexo1", linha_inicio: 1 },
        { id: "anexo1-item1", linha_inicio: 1 },
      ]),
      destaque: null,
      deslocamento: 0,
    });
    expect(saida).toBe('<p id="anexo1"><span id="anexo1-item1"></span>ANEXO I – Itens</p>');
  });

  it("seção de PPC com tabela, e o HTML cru do arquivo some", () => {
    const md = [
      "## 1.1 Identificação",
      "",
      "| Item | Valor |",
      "| --- | --- |",
      "| Carga horária | 1.600 h |",
      "",
      '<script>alert(1)</script><img src="x" onerror="alert(1)">',
    ].join("\n");
    const saida = html(md, {
      ancoras: ancorasPorLinha([{ id: "identificacao-1", linha_inicio: 1 }]),
      destaque: { inicio: 1, fim: 7 },
      deslocamento: 0,
    });
    expect(saida).toContain('<h2 id="identificacao-1"><mark class="trecho-citado">1.1 Identificação</mark></h2>');
    expect(saida).toContain('<td><mark class="trecho-citado">Carga horária</mark></td>');
    expect(saida).not.toMatch(/<script|<img|onerror/);
  });
});

describe("linhasDoTrecho", () => {
  it("vai da âncora até o último descendente", () => {
    expect(linhasDoTrecho(ANCORAS, "art28")).toEqual({ inicio: 3, fim: 8 });
    expect(linhasDoTrecho(ANCORAS, "art28-ii")).toEqual({ inicio: 8, fim: 8 });
    expect(linhasDoTrecho(ANCORAS, "art99")).toBeNull();
  });
});
