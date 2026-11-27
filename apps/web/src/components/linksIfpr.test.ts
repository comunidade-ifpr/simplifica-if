import { assert, describe, it } from "@effect/vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ligarLinksIfpr } from "./linksIfpr.ts";
import { Markdown } from "./Markdown.tsx";

const paragrafo = (texto: string) => ({
  type: "root",
  children: [{ type: "paragraph", children: [{ type: "text", value: texto }] }],
});

describe("ligarLinksIfpr", () => {
  it("troca os links soltos por nós link, sem a pontuação do fim", () => {
    const arvore = paragrafo(
      "Veja ifpr://norma/br/cne-cp/res/2021/1#art20. E ifpr://curso/curitiba/tecnico-em-enfermagem, também.",
    );
    ligarLinksIfpr(arvore);
    assert.deepStrictEqual(arvore.children[0]!.children, [
      { type: "text", value: "Veja " },
      {
        type: "link",
        url: "ifpr://norma/br/cne-cp/res/2021/1#art20",
        children: [{ type: "text", value: "ifpr://norma/br/cne-cp/res/2021/1#art20" }],
      },
      { type: "text", value: ". E " },
      {
        type: "link",
        url: "ifpr://curso/curitiba/tecnico-em-enfermagem",
        children: [{ type: "text", value: "ifpr://curso/curitiba/tecnico-em-enfermagem" }],
      },
      { type: "text", value: ", também." },
    ]);
  });

  it("não mexe no texto sem link, nem no texto de um link", () => {
    const semLink = paragrafo("Nada aqui, nem ifpr:// sozinho.");
    ligarLinksIfpr(semLink);
    assert.deepStrictEqual(semLink.children[0]!.children, [{ type: "text", value: "Nada aqui, nem ifpr:// sozinho." }]);

    const link = {
      type: "link",
      url: "ifpr://campus/curitiba",
      children: [{ type: "text", value: "ifpr://campus/curitiba" }],
    };
    const arvore = { type: "root", children: [{ type: "paragraph", children: [link] }] };
    ligarLinksIfpr(arvore);
    assert.deepStrictEqual(arvore.children[0]!.children, [link]);
  });
});

describe("Markdown", () => {
  const html = (texto: string) => renderToStaticMarkup(createElement(Markdown, { texto, aoAbrirLink: () => {} }));

  it("o link solto vira o botão do painel de leitura, como o da sintaxe de link", () => {
    const solto = html("Base: ifpr://norma/br/cne-cp/res/2021/1 (DCN).");
    assert.include(solto, '<button type="button" class="link-ifpr" data-link="ifpr://norma/br/cne-cp/res/2021/1"');
    assert.include(solto, " (DCN).");
    const sintaxe = html("[DCN](ifpr://norma/br/cne-cp/res/2021/1)");
    assert.include(sintaxe, 'data-link="ifpr://norma/br/cne-cp/res/2021/1"');
  });

  it("a citação entre crases, só com o link, vira o botão; no meio de outro código ou num bloco, fica texto", () => {
    const citacao = html("O que a lei diz: Lei 11.788/2008, art. 2º (`ifpr://norma/br/lei/2008/11788#art2`).");
    assert.include(citacao, 'data-link="ifpr://norma/br/lei/2008/11788#art2"');
    assert.notInclude(citacao, "<code>");
    assert.include(citacao, ").");
    assert.notInclude(html("`kb ler ifpr://campus/curitiba`"), "<button");
    assert.notInclude(html("```\nifpr://campus/curitiba\n```"), "<button");
    assert.notInclude(html("`ifpr://`"), "<button");
  });
});
