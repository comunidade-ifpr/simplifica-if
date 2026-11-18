/**
 * O `Documento` e o `useCarga` no Chromium, sem servidor: um documento de vários blocos (espaços
 * reservados, rolagem até o trecho, ancoragem da rolagem enquanto o texto de cima aparece e
 * `content-visibility`), a imagem do Markdown que não se carrega, os links que não são `http`, e a
 * leitura que termina entre a renderização e o efeito.
 */
import type { DadosDocumento } from "@simplifica-if/contratos-app";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import "../index.css";
import { ContextoMemoria, MemoriaLeitor, useCarga } from "./carga.ts";
import { Documento } from "./Documento.tsx";

const montados: Array<() => void> = [];
afterEach(() => {
  for (const desmontar of montados.splice(0)) desmontar();
  delete window.simplifica;
});

function montar(elemento: React.ReactNode, altura = 400) {
  const conteiner = document.createElement("div");
  conteiner.style.cssText = `height:${altura}px;width:500px;overflow-y:auto`;
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
