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
import { remarkMarcadores, remarkQuebras } from "./remarkLeitor.ts";

const html = (markdown: string, opcoes: OpcoesDispositivos) =>
  renderToStaticMarkup(
    createElement(ReactMarkdown, {
      remarkPlugins: [remarkGfm, remarkMarcadores, remarkQuebras],
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

  it("marca os cabeçalhos de divisão pela linha", () => {
    const saida = html(["## TÍTULO I", "", "### DAS FINALIDADES", "", "#### Art. 1º"].join("\n"), {
      ancoras: ancorasPorLinha([{ id: "sumario-1", linha_inicio: 1 }]),
      destaque: null,
      deslocamento: 0,
      divisoes: new Set([1, 3]),
    });
    expect(saida).toContain('<h2 class="divisao" id="sumario-1">TÍTULO I</h2>');
    expect(saida).toContain('<h3 class="divisao">DAS FINALIDADES</h3>');
    expect(saida).toContain("<h4>Art. 1º</h4>");
  });

  it("destaca o trecho citado em <mark>, e só ele", () => {
    const saida = html(NORMA, {
      ancoras: ancorasPorLinha(ANCORAS),
      destaque: linhasDoTrecho(ANCORAS, "art28")!,
      deslocamento: 0,
    });
    expect(saida).toContain(
      '<h4 id="art28"><mark class="trecho-citado"><span class="sr-only">Trecho citado: </span>Art. 28.</mark></h4>',
    );
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
    expect(saida).toBe(
      '<h4 id="art29">Art. 29.</h4>\n<p><mark class="trecho-citado"><span class="sr-only">Trecho citado: </span>Texto do art. 29.</mark></p>',
    );
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
    expect(saida).toContain(
      '<h2 id="identificacao-1"><mark class="trecho-citado"><span class="sr-only">Trecho citado: </span>1.1 Identificação</mark></h2>',
    );
    expect(saida).toContain('<td><mark class="trecho-citado">Carga horária</mark></td>');
    expect(saida).not.toMatch(/<script|<img|onerror/);
  });
});

describe("redação não vigente, fora do ato e <br> (remarkLeitor)", () => {
  // Lei 11.892/2008, art. 1º: o inciso IV e o parágrafo único anteriores ficam ao lado dos vigentes
  const LEI = [
    "#### Art. 1º", // 1
    "",
    "- **IV –** Escolas Técnicas Vinculadas às Universidades Federais.", // 3
    "",
    "<!-- redacao-nao-vigente -->", // 5
    "",
    "**Parágrafo único.** Redação antiga, sem o inciso V.", // 7
    "",
    "<!-- /redacao-nao-vigente -->", // 9
    "",
    "**Parágrafo único.** Redação vigente, com o inciso V.", // 11
    "",
    "<!-- fora-do-ato: não consta do texto publicado -->", // 13
    "",
    "#### Art. 2º", // 15
    "",
    "<!-- /fora-do-ato -->", // 17
  ].join("\n");
  const ANCORAS_LEI = [
    { id: "art1", pai: null, linha_inicio: 1, linha_fim: 1 },
    { id: "art1-iv", pai: "art1", linha_inicio: 3, linha_fim: 3 },
    { id: "art1-parunico", pai: "art1", linha_inicio: 11, linha_fim: 11 },
  ];

  it("a região vira um bloco rotulado, e o destaque do artigo não alcança a redação anterior", () => {
    const saida = html(LEI, {
      ancoras: ancorasPorLinha(ANCORAS_LEI),
      destaque: linhasDoTrecho(ANCORAS_LEI, "art1")!,
      deslocamento: 0,
    });
    expect(saida).toContain(
      '<div class="regiao-marcada regiao-redacao-nao-vigente" data-marcador="redacao-nao-vigente"><p class="rotulo-regiao">Redação anterior, não vigente</p><p><strong>Parágrafo único.</strong> Redação antiga, sem o inciso V.</p></div>',
    );
    expect(saida).toContain('<p class="rotulo-regiao">Fora do texto publicado</p>');
    expect(saida).toContain(
      '<p id="art1-parunico"><mark class="trecho-citado"><strong>Parágrafo único.</strong> Redação vigente, com o inciso V.</mark></p>',
    );
    expect(saida).not.toMatch(/<!--|Redação antiga, sem o inciso V\.<\/mark>/);
  });

  it("marcador sem fechamento some, como o resto do HTML cru", () => {
    expect(
      html("<!-- redacao-nao-vigente -->\n\nTexto.", { ancoras: new Map(), destaque: null, deslocamento: 0 }).trim(),
    ).toBe("<p>Texto.</p>");
  });

  it("<br> vira quebra de linha, sem colar as palavras; outro HTML continua sumindo", () => {
    const saida = html("Logística<br>e Produção<BR/>e Gestão<br />final <b>x</b>", {
      ancoras: new Map(),
      destaque: null,
      deslocamento: 0,
    });
    expect(saida).toBe("<p>Logística<br/>\ne Produção<br/>\ne Gestão<br/>\nfinal x</p>");
  });
});

describe("âncora sem elemento na linha", () => {
  it("vai para o elemento anterior mais próximo (seção que começa no meio de um bloco do conversor)", () => {
    // a seção do índice começa na linha 4, no meio de um parágrafo: nenhum elemento começa ali
    const md = ["## Ementário", "", "| A | B |", "Ementas 4: texto colado à tabela", "", "Depois."].join("\n");
    const saida = html(md, {
      ancoras: ancorasPorLinha([
        { id: "ementas-3", linha_inicio: 1 },
        { id: "ementas-4", linha_inicio: 4 },
      ]),
      destaque: null,
      deslocamento: 0,
    });
    expect(saida).toContain('<h2 id="ementas-3">Ementário</h2>');
    expect(saida).toContain('<p><span id="ementas-4"></span>| A | B |\nEmentas 4: texto colado à tabela</p>');
    expect(saida.match(/id="ementas-4"/g)).toHaveLength(1);
  });

  it("âncoras de outros blocos não entram neste", () => {
    const saida = html("Texto do bloco.", {
      ancoras: ancorasPorLinha([{ id: "longe", linha_inicio: 500 }]),
      destaque: null,
      deslocamento: 10,
      linhaFinal: 11,
    });
    expect(saida).toBe("<p>Texto do bloco.</p>");
  });
});

describe("linhasDoTrecho", () => {
  it("vai da âncora até o último descendente", () => {
    expect(linhasDoTrecho(ANCORAS, "art28")).toEqual({ inicio: 3, fim: 8 });
    expect(linhasDoTrecho(ANCORAS, "art28-ii")).toEqual({ inicio: 8, fim: 8 });
    expect(linhasDoTrecho(ANCORAS, "art99")).toBeNull();
  });
});
