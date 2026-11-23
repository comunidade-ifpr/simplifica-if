/**
 * O `Documento` e o `useCarga` no Chromium, sem servidor: um documento de vários blocos (espaços
 * reservados, rolagem até o trecho, ancoragem da rolagem enquanto o texto de cima aparece e
 * `content-visibility`), a imagem do Markdown que não se carrega, os links que não são `http`, e a
 * leitura que termina entre a renderização e o efeito; e o índice da norma (`Sumario`) ao lado do texto.
 */
import type { DadosDocumento } from "@simplifica-if/contratos-app";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "../index.css";
import { ContextoMemoria, MemoriaLeitor, useCarga } from "./carga.ts";
import { Documento } from "./Documento.tsx";
import { Sumario } from "./Sumario.tsx";
import { buscarNoTexto, visivel } from "./busca.ts";
import { faixasDoRealce, textosDe } from "./realce.ts";

const montados: Array<() => void> = [];
afterEach(() => {
  for (const desmontar of montados.splice(0)) desmontar();
  delete window.simplifica;
});

function montar(elemento: React.ReactNode, altura = 400, largura = 500) {
  const conteiner = document.createElement("div");
  conteiner.style.cssText = `height:${altura}px;width:${largura}px;overflow-y:auto`;
  document.body.append(conteiner);
  const raiz = createRoot(conteiner);
  raiz.render(elemento);
  montados.push(() => {
    raiz.unmount();
    conteiner.remove();
  });
  return conteiner;
}

/** 60 seções de cerca de 1.000 caracteres: oito blocos de 8 mil. */
function documentoLongo(): DadosDocumento {
  const linhas: string[] = [];
  const ancoras: Array<DadosDocumento["ancoras"][number]> = [];
  for (let i = 1; i <= 60; i += 1) {
    ancoras.push({
      id: `secao-${i}`,
      rotulo: `Seção ${i}`,
      tipo: "outros",
      pai: null,
      linha_inicio: linhas.length + 1,
      linha_fim: linhas.length + 5,
      revogado: false,
    });
    linhas.push(`## Seção ${i}`, "");
    for (let p = 0; p < 3; p += 1) linhas.push(`Parágrafo ${p + 1} da seção ${i}. ${"texto ".repeat(55)}`, "");
  }
  linhas.push("![planta do laboratório](lab.png)", "");
  return {
    tipo: "ppc",
    id: "teste/documento-longo",
    titulo: "Documento longo",
    link: "ifpr://ppc/teste/documento-longo",
    path: "x.md",
    markdown: linhas.join("\n"),
    ancoras,
    sumario: [],
    alvo: null,
    datas: null,
  };
}

it("documento de vários blocos: o trecho primeiro, à vista, e no lugar enquanto o resto aparece", async () => {
  const documento = documentoLongo();
  const conteiner = montar(<Documento documento={documento} alvo="secao-50" aoAbrirLink={() => {}} rotulo="Texto" />);
  await expect.poll(() => document.getElementById("secao-50")?.querySelector("mark.trecho-citado")).toBeTruthy();
  // logo de início, os outros blocos ainda são espaço reservado
  const reservados = conteiner.querySelectorAll(".espaco-reservado").length;
  expect(reservados).toBeGreaterThan(0);
  const distancia = () =>
    document.getElementById("secao-50")!.getBoundingClientRect().top - conteiner.getBoundingClientRect().top;
  await expect.poll(distancia).toBeLessThan(40);
  expect(distancia()).toBeGreaterThanOrEqual(0);
  // todos os blocos se montam, e a ancoragem da rolagem deixa o trecho onde estava
  await expect.poll(() => conteiner.querySelectorAll(".espaco-reservado").length, { timeout: 10_000 }).toBe(0);
  expect(conteiner.querySelectorAll(".bloco-documento").length).toBeGreaterThan(5);
  expect(distancia()).toBeGreaterThanOrEqual(0);
  expect(distancia()).toBeLessThan(40);
  // o bloco do trecho sempre desenhado; os outros, só quando à vista
  const alvo = conteiner.querySelector(".bloco-alvo")!;
  expect(getComputedStyle(alvo).contentVisibility).toBe("visible");
  const outro = conteiner.querySelector(".bloco-documento:not(.bloco-alvo)")!;
  expect(getComputedStyle(outro).contentVisibility).toBe("auto");
  // a seção 49 não se destaca
  expect(document.getElementById("secao-49")?.querySelector("mark")).toBeNull();
  // a imagem do Markdown não se carrega: aparece o texto alternativo
  expect(conteiner.querySelector("img")).toBeNull();
  await expect.element(page.getByText("Imagem: planta do laboratório")).toBeInTheDocument();
});

it("links: âncora interna rola, mailto e relativo viram texto, e o link web recusado não deixa erro solto", async () => {
  const rejeicoes: unknown[] = [];
  const aoRejeitar = (evento: PromiseRejectionEvent) => {
    rejeicoes.push(evento.reason);
    evento.preventDefault();
  };
  window.addEventListener("unhandledrejection", aoRejeitar);
  const abertos: string[] = [];
  window.simplifica = {
    conexao: () => Promise.reject(new Error("sem servidor")),
    abrirExterno: (url) => {
      abertos.push(url);
      return Promise.reject(new Error("só links http e https abrem no navegador"));
    },
  };
  const markdown = [
    "[Ir ao fim](#fim) · [Escreva](mailto:secretaria@ifpr.edu.br) · [Outro arquivo](../anexo.md) · [Site](https://ifpr.edu.br)",
    "",
    ...Array.from({ length: 80 }, (_, i) => `Linha ${i}.\n`),
    "## Fim",
  ].join("\n");
  const documento: DadosDocumento = {
    ...documentoLongo(),
    markdown,
    ancoras: [
      { id: "fim", rotulo: "Fim", tipo: "outros", pai: null, linha_inicio: 163, linha_fim: 163, revogado: false },
    ],
  };
  const conteiner = montar(<Documento documento={documento} alvo={null} aoAbrirLink={() => {}} rotulo="Texto" />, 200);
  await expect.element(page.getByText("Escreva")).toBeInTheDocument();
  expect(page.getByText("Escreva").element().tagName).toBe("SPAN");
  expect(page.getByText("Outro arquivo").element().tagName).toBe("SPAN");

  expect(document.getElementById("fim")).not.toBeNull();
  await page.getByRole("link", { name: "Ir ao fim" }).click();
  await expect
    .poll(() => document.getElementById("fim")!.getBoundingClientRect().top - conteiner.getBoundingClientRect().top)
    .toBeLessThan(200);

  await page.getByRole("link", { name: "Site" }).click();
  await expect.poll(() => abertos).toEqual(["https://ifpr.edu.br"]);
  // oxlint-disable-next-line simplifica-if/no-frame-waits-in-browser-tests -- prova a ausência de um evento: dois quadros depois do clique, uma rejeição sem tratamento já teria disparado o `unhandledrejection`
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  window.removeEventListener("unhandledrejection", aoRejeitar);
  expect(rejeicoes).toEqual([]);
});

function Leitura({ memoria }: { readonly memoria: MemoriaLeitor }) {
  return (
    <ContextoMemoria value={memoria}>
      <Fase />
    </ContextoMemoria>
  );
}

function Fase() {
  // a leitura já resolvida: o `then` que muda o estado roda antes do efeito do React
  const carga = useCarga("chave", () => Promise.resolve("pronto"));
  return <p>{carga.fase === "lido" ? `Lido: ${carga.valor}` : carga.fase}</p>;
}

it("useCarga: a leitura que termina entre a renderização e o efeito não fica em 'carregando'", async () => {
  montar(<Leitura memoria={new MemoriaLeitor()} />);
  await expect.element(page.getByText("Lido: pronto")).toBeInTheDocument();
});

it("realce: a frase exata do trecho dentro do bloco destacado, sem marcação, acento nem caixa, e à vista", async () => {
  const documento = documentoLongo();
  const linhas = documento.markdown.split("\n");
  // Um parágrafo longo da seção 40, com a frase no meio, em negrito e com link.
  const linha = documento.ancoras.find((a) => a.id === "secao-40")!.linha_inicio + 2;
  linhas[linha - 1] =
    `${"Texto antes da frase. ".repeat(60)}O curso segue a **[Lei nº 14.945/2024](https://planalto.gov.br/x)** e o CNCT. ${"Texto depois. ".repeat(60)}`;
  const comTrecho: DadosDocumento = {
    ...documento,
    markdown: linhas.join("\n"),
    ancoras: [
      ...documento.ancoras,
      { id: "p-x", rotulo: "", tipo: "pendencia", pai: null, linha_inicio: linha, linha_fim: linha, revogado: false },
    ],
  };
  const conteiner = montar(
    <Documento
      documento={comTrecho}
      alvo="p-x"
      aoAbrirLink={() => {}}
      rotulo="Texto"
      realce="o curso segue a LEI Nº 14.945/2024 e o CNCT … Texto depois"
    />,
  );
  await expect.poll(() => CSS.highlights.get("trecho-exato")?.size).toBe(2);
  const [frase, depois] = [...CSS.highlights.get("trecho-exato")!] as Range[];
  expect(frase!.toString()).toBe("O curso segue a Lei nº 14.945/2024 e o CNCT");
  expect(depois!.toString()).toBe("Texto depois");
  expect(conteiner.querySelector(".com-realce")).not.toBeNull();
  // a frase, no meio de um parágrafo maior que a área, fica à vista
  const caixa = frase!.getBoundingClientRect();
  const area = conteiner.getBoundingClientRect();
  expect(caixa.top).toBeGreaterThanOrEqual(area.top);
  expect(caixa.bottom).toBeLessThanOrEqual(area.bottom);
  // desmontado, o realce sai
  for (const desmontar of montados.splice(0)) desmontar();
  expect(CSS.highlights.has("trecho-exato")).toBe(false);
});

it("realce: a marcação do Markdown no trecho (negrito, tabela, número do item) não impede achar a frase", () => {
  const raiz = document.createElement("div");
  raiz.innerHTML =
    '<mark class="trecho-citado"><span class="sr-only">Trecho citado: </span>O <strong>Estágio</strong> supervisionado</mark>' +
    '<mark class="trecho-citado"><span>tem 200 h</span></mark>';
  document.body.append(raiz);
  try {
    const faixas = faixasDoRealce(
      textosDe([...raiz.querySelectorAll("mark")]),
      "1. o **estagio** | supervisionado tem 200 h",
    );
    // uma faixa, do "O" ao "h", sem o anúncio oculto; os dois blocos se juntam sem espaço no DOM
    expect(faixas.map((f) => f.toString())).toEqual(["O Estágio supervisionadotem 200 h"]);
  } finally {
    raiz.remove();
  }
});

it("busca: sem acento nem caixa, espaços juntos, sem juntar blocos vizinhos e sem o anúncio oculto", () => {
  const raiz = document.createElement("div");
  raiz.innerHTML =
    "<p>A <strong>Lei nº</strong>  14.945/2024 trata do <em>ensino médio</em>.</p>" +
    "<p>Ensino</p><p>médio técnico; LEI Nº 14.945/2024.</p>" +
    '<p><span class="sr-only">Trecho citado: </span>fim</p>';
  document.body.append(raiz);
  try {
    const achar = (termo: string) => buscarNoTexto(textosDe([raiz]), termo).map((f) => f.toString());
    expect(achar("lei no")).toEqual([]);
    expect(achar("lei nº 14.945")).toEqual(["Lei nº  14.945", "LEI Nº 14.945"]);
    // entre parágrafos vizinhos, um espaço (como no Ctrl+F do navegador), e nunca as palavras juntas
    expect(achar("ENSINO MEDIO")).toEqual(["ensino médio", "Ensinomédio"]);
    expect(achar("ensinomédio")).toEqual([]);
    expect(achar("Trecho citado")).toEqual([]);
    expect(achar("a")).toEqual([]);
  } finally {
    raiz.remove();
  }
});

it("busca: o que está num <details> fechado não conta, salvo o <summary>", () => {
  const raiz = document.createElement("div");
  raiz.innerHTML =
    "<details><summary>Seções do texto</summary><ul><li>Justificativa</li></ul></details><p>Justificativa do curso</p>";
  document.body.append(raiz);
  try {
    const achar = (termo: string) => buscarNoTexto(textosDe([raiz]).filter(visivel), termo).map((f) => f.toString());
    expect(achar("justificativa")).toEqual(["Justificativa"]);
    expect(achar("seções")).toEqual(["Seções"]);
    raiz.querySelector("details")!.open = true;
    expect(achar("justificativa")).toHaveLength(2);
  } finally {
    raiz.remove();
  }
});

/** Uma norma de três títulos (o segundo com dois capítulos, o primeiro deles com duas seções) e nove artigos longos. */
function normaComDivisoes(): Pick<DadosDocumento, "markdown" | "ancoras" | "sumario"> & { link: string } {
  const linhas: string[] = [];
  const ancoras: Array<DadosDocumento["ancoras"][number]> = [];
  const sumario: Array<DadosDocumento["sumario"][number]> = [];
  let artigo = 0;
  const divisao = (tipo: "titulo" | "capitulo" | "secao", rotulo: string, nome: string, nivel: number) => {
    sumario.push({ tipo, rotulo, nome, nivel, linha: linhas.length + 1, linha_fim: linhas.length + 3, artigos: null });
    linhas.push(`${"#".repeat(nivel + 2)} ${rotulo}`, "", `${"#".repeat(nivel + 3)} ${nome}`, "");
  };
  const artigos = (quantos: number) => {
    for (let i = 0; i < quantos; i += 1) {
      artigo += 1;
      ancoras.push({
        id: `art${artigo}`,
        rotulo: `Art. ${artigo}`,
        tipo: "artigo",
        pai: null,
        linha_inicio: linhas.length + 1,
        linha_fim: linhas.length + 3,
        revogado: false,
      });
      linhas.push(`#### Art. ${artigo}`, "", `Caput do artigo ${artigo}. ${"texto ".repeat(250)}`, "");
    }
  };
  divisao("titulo", "TÍTULO I", "DAS FINALIDADES", 0);
  artigos(2);
  divisao("titulo", "TÍTULO II", "DO ACESSO", 0);
  divisao("capitulo", "CAPÍTULO I", "DAS FORMAS DE ACESSO", 1);
  artigos(1);
  divisao("secao", "Seção I", "Das Vagas", 2);
  artigos(1);
  divisao("secao", "Seção II", "Do Reingresso", 2);
  artigos(1);
  divisao("capitulo", "CAPÍTULO II", "DO REGISTRO", 1);
  artigos(2);
  divisao("titulo", "TÍTULO III", "DISPOSIÇÕES FINAIS", 0);
  artigos(2);
  return { markdown: linhas.join("\n"), ancoras, sumario, link: "ifpr://norma/teste/res/2026/1" };
}

it("índice da norma: rola até o item, marca o que está em leitura, abre as seções do capítulo e vai ao artigo", async () => {
  const documento = normaComDivisoes();
  const conteiner = montar(
    <article className="@container flex gap-6">
      <div className="min-w-0 flex-1">
        <Documento documento={documento} alvo={null} aoAbrirLink={() => {}} rotulo="Texto da norma" />
      </div>
      <aside className="sticky top-0 w-72 shrink-0 self-start">
        <Sumario documento={documento} modo="lateral" />
      </aside>
    </article>,
    400,
    1200,
  );
  const indice = page.getByRole("navigation", { name: "Neste documento" });
  const distancia = (id: string) =>
    document.getElementById(id)!.getBoundingClientRect().top - conteiner.getBoundingClientRect().top;
  const item = (linha: number) => `sumario-${linha}`;
  const [titulo1, titulo2, capitulo1, secao1, , , titulo3] = documento.sumario;

  // dois níveis de início; as seções ficam para quando o capítulo delas estiver em leitura
  await expect.element(indice.getByRole("button", { name: /Título I · DAS FINALIDADES/ })).toBeVisible();
  await expect.element(indice.getByRole("button", { name: /Cap\. I · DAS FORMAS DE ACESSO/ })).toBeVisible();
  expect(indice.getByRole("button", { name: /Seção I/ }).elements()).toHaveLength(0);
  // os cabeçalhos de divisão levam a classe, o rótulo e o nome
  await expect.poll(() => document.getElementById(item(titulo1!.linha))?.className).toBe("divisao");
  expect(document.getElementById(item(titulo1!.linha))?.nextElementSibling?.className).toBe("divisao");

  // o último título: o texto rola até ele, e o índice o marca
  await indice.getByRole("button", { name: /Título III/ }).click();
  await expect.poll(() => Math.abs(distancia(item(titulo3!.linha)))).toBeLessThan(40);
  await expect
    .poll(() =>
      indice
        .getByRole("button", { name: /Título III/ })
        .element()
        .getAttribute("aria-current"),
    )
    .toBe("location");

  // o capítulo com seções: elas aparecem no índice; a seção marcada quando o texto chega nela
  await indice.getByRole("button", { name: /Cap\. I · DAS FORMAS DE ACESSO/ }).click();
  await expect.poll(() => Math.abs(distancia(item(capitulo1!.linha)))).toBeLessThan(40);
  await expect.element(indice.getByRole("button", { name: /Seção I · Das Vagas/ })).toBeVisible();
  await indice.getByRole("button", { name: /Seção I · Das Vagas/ }).click();
  await expect.poll(() => Math.abs(distancia(item(secao1!.linha)))).toBeLessThan(40);
  await expect
    .poll(() =>
      indice
        .getByRole("button", { name: /Seção I · Das Vagas/ })
        .element()
        .getAttribute("aria-current"),
    )
    .toBe("location");
  expect(document.getElementById(item(titulo2!.linha))).not.toBeNull();

  // "Ir ao art.": o artigo no alto; o que a norma não tem, avisado
  const campo = indice.getByRole("textbox", { name: "Ir ao artigo" });
  await campo.fill("8");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => Math.abs(distancia("art8"))).toBeLessThan(40);
  await campo.fill("99");
  await userEvent.keyboard("{Enter}");
  await expect.element(indice.getByText("Não há art. 99 neste texto.")).toBeVisible();
});

it("norma sem divisões: o índice é a grade com os números dos artigos", async () => {
  const { markdown, ancoras, link } = normaComDivisoes();
  const documento = { markdown, ancoras, link, sumario: [] };
  const conteiner = montar(
    <article className="@container flex gap-6">
      <div className="min-w-0 flex-1">
        <Documento documento={documento} alvo={null} aoAbrirLink={() => {}} rotulo="Texto da norma" />
      </div>
      <aside className="sticky top-0 w-72 shrink-0 self-start">
        <Sumario documento={documento} modo="lateral" />
      </aside>
    </article>,
    400,
    1200,
  );
  const indice = page.getByRole("navigation", { name: "Neste documento" });
  expect(indice.getByRole("textbox").elements()).toHaveLength(0);
  await indice.getByRole("button", { name: "Artigo 7", exact: true }).click();
  await expect
    .poll(() =>
      Math.abs(document.getElementById("art7")!.getBoundingClientRect().top - conteiner.getBoundingClientRect().top),
    )
    .toBeLessThan(40);
  await expect
    .poll(() => indice.getByRole("button", { name: "Artigo 7", exact: true }).element().getAttribute("aria-current"))
    .toBe("location");
});
