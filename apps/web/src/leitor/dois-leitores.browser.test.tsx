/**
 * Dois leitores na janela (`leitor/instancia.ts`), no Chromium e com o `apps/server` de verdade: a mesma
 * norma na página do Explorar e no painel do app. Cada um com os seus `id`, a faixa do trecho, o índice
 * (o "Ir ao artigo" das alterações), as âncoras do texto (a nota de rodapé), a busca no texto pelo leitor
 * em foco, os realces somados e a impressão só do que pediu ou, no ⌘P, do leitor em foco.
 */
import type { DadosDocumento } from "@simplifica-if/contratos-app";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import type { ServidorTeste } from "../../vite.config.ts";
import { achadosDaTela, iniciarServidorTeste, montarApp } from "../../test/navegador.tsx";
import { NO_MAC } from "../lib/teclado.ts";
import { NOME_BUSCA } from "./busca.ts";
import { pintar } from "./destaques.ts";
import { Documento } from "./Documento.tsx";
import { ContextoInstancia, InstanciaLeitor } from "./instancia.ts";

let servidor: ServidorTeste;

beforeAll(async () => {
  servidor = await iniciarServidorTeste();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const LINK = "ifpr://norma/br/cne-cp/res/2026/2#art28-xviii";
const ATALHO = NO_MAC ? "{Meta>}f{/Meta}" : "{Control>}f{/Control}";

it("destaques: as faixas de cada leitor se somam sob o mesmo nome, e tirar as de um deixa as do outro", () => {
  const texto = document.createElement("p");
  texto.textContent = "um dois três";
  document.body.append(texto);
  const faixa = (inicio: number, fim: number) => {
    const r = new Range();
    r.setStart(texto.firstChild!, inicio);
    r.setEnd(texto.firstChild!, fim);
    return r;
  };
  const tirarA = pintar("teste-destaque", [faixa(0, 2)]);
  const tirarB = pintar("teste-destaque", [faixa(3, 7), faixa(8, 12)], 1);
  expect(CSS.highlights.get("teste-destaque")?.size).toBe(3);
  expect(CSS.highlights.get("teste-destaque")?.priority).toBe(1);
  tirarB();
  tirarB();
  expect(CSS.highlights.get("teste-destaque")?.size).toBe(1);
  tirarA();
  expect(CSS.highlights.has("teste-destaque")).toBe(false);
  texto.remove();
});

it("a mesma norma na tela e no painel: id, faixa do trecho, índice, ⌘F e impressão de cada um", async () => {
  await page.viewport(1366, 768);
  await using app = await montarApp(servidor, `/explorar/ver?link=${encodeURIComponent(LINK)}`);
  app.contexto.painel.abrirLink(LINK);

  const painel = page.getByRole("complementary", { name: "Painel ao lado" });
  const naTela = page.getByRole("main").getByRole("article", { name: "Norma" });
  const noPainel = painel.getByRole("article", { name: "Norma" });
  await expect.element(noPainel.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 2/2026" })).toBeVisible();

  // Cada leitor com os seus `id`: nenhum se repete, e cada um destaca o inciso no seu texto.
  await expect.poll(() => document.getElementById("art28-xviii")?.querySelector("mark.trecho-citado")).toBeTruthy();
  await expect
    .poll(() => document.getElementById("painel-art28-xviii")?.querySelector("mark.trecho-citado"))
    .toBeTruthy();
  const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
  expect(ids.length).toBe(new Set(ids).size);
  expect(painel.element().contains(document.getElementById("painel-art28-xviii"))).toBe(true);
  expect(painel.element().contains(document.getElementById("art28-xviii"))).toBe(false);

  const rolagemTela = document.querySelector<HTMLElement>("[data-rolagem-explorar]")!;
  const rolagemPainel = painel.element().querySelector<HTMLElement>(".overflow-y-auto")!;
  await expect.poll(() => rolagemPainel.scrollTop).toBeGreaterThan(0);
  await expect.poll(() => rolagemTela.scrollTop).toBeGreaterThan(0);

  // A faixa do trecho: "Ir ao trecho" rola só o leitor dela.
  rolagemPainel.scrollTop = 0;
  rolagemTela.scrollTop = 0;
  await noPainel.getByRole("button", { name: "Ir ao trecho" }).click();
  await expect.poll(() => rolagemPainel.scrollTop).toBeGreaterThan(0);
  expect(rolagemTela.scrollTop).toBe(0);
  await naTela.getByRole("button", { name: "Ir ao trecho" }).click();
  // a rolagem é suave: espera o inciso chegar ao alto da página
  const inciso = document.getElementById("art28-xviii")!;
  const lugarNaTela = () => inciso.getBoundingClientRect().top - rolagemTela.getBoundingClientRect().top;
  await expect.poll(() => Math.abs(lugarNaTela())).toBeLessThan(40);

  // O índice ("Ir ao artigo 28", das alterações): o pedido vai só ao `Documento` do mesmo leitor.
  rolagemPainel.scrollTop = 0;

  await noPainel.getByText("Alterada por (1)").click();
  await noPainel.getByRole("button", { name: "Ir ao artigo 28" }).click();
  await expect.poll(() => rolagemPainel.scrollTop).toBeGreaterThan(0);
  const artigo = document.getElementById("painel-art28")!;
  await expect
    .poll(() => Math.abs(artigo.getBoundingClientRect().top - rolagemPainel.getBoundingClientRect().top))
    .toBeLessThan(40);
  // na tela, o inciso segue no alto: o pedido do painel não a levou ao artigo
  expect(Math.abs(lugarNaTela())).toBeLessThan(40);

  // ⌘F vale para o leitor em foco: primeiro o painel, depois a tela; os realces das duas buscas se somam.
  (painel.element() as HTMLElement).focus();
  await userEvent.keyboard(ATALHO);
  const buscaPainel = painel.getByRole("searchbox", { name: "Buscar no texto" });
  await expect.element(buscaPainel).toHaveFocus();
  expect(document.querySelectorAll("search")).toHaveLength(1);
  await buscaPainel.fill("egressos");
  await expect.element(painel.getByText(/^1 de \d+$/)).toBeVisible();
  const doPainel = CSS.highlights.get(NOME_BUSCA)?.size ?? 0;
  expect(doPainel).toBeGreaterThan(0);

  await naTela.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 2/2026" }).click();
  await userEvent.keyboard(ATALHO);
  const buscaTela = page.getByRole("main").getByRole("searchbox", { name: "Buscar no texto" });
  await expect.element(buscaTela).toHaveFocus();
  expect(painel.element().contains(buscaTela.element())).toBe(false);
  expect(document.querySelectorAll("search")).toHaveLength(2);
  await buscaTela.fill("egressos");
  await expect.poll(() => CSS.highlights.get(NOME_BUSCA)?.size).toBe(doPainel * 2);
  // fechar a da tela deixa os realces do painel
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => CSS.highlights.get(NOME_BUSCA)?.size).toBe(doPainel);
  expect(achadosDaTela()).toEqual([]);
});

it("âncoras do texto com dois leitores: o link `#…` e a nota de rodapé rolam só o leitor em que estão", async () => {
  // Um bloco só (a nota do GFM precisa da chamada e do texto no mesmo bloco), mais alto que a rolagem.
  const recheio = Array.from({ length: 30 }, (_, i) => `Parágrafo ${i + 1}. ${"texto ".repeat(30)}`);
  const linhas = ["Ver a nota[^1] e a [seção final](#secao-final).", "", ...recheio.flatMap((p) => [p, ""])];
  const linhaFinal = linhas.length + 1;
  linhas.push("## Seção final", "", "Fim.", "", "[^1]: O texto da nota.");
  const documento: DadosDocumento = {
    tipo: "ppc",
    id: "teste/ancoras/2024",
    titulo: "Âncoras",
    link: "ifpr://ppc/teste/ancoras/2024",
    path: "x.md",
    markdown: linhas.join("\n"),
    ancoras: [
      {
        id: "secao-final",
        rotulo: "Seção final",
        tipo: "outros",
        pai: null,
        linha_inicio: linhaFinal,
        linha_fim: linhaFinal + 2,
        revogado: false,
      },
    ],
    sumario: [],
    alvo: null,
  };
  const leitor = (instancia: InstanciaLeitor) => (
    <div data-leitor="" style={{ height: 300, overflowY: "auto" }}>
      {/* espaço depois do texto, para a nota do fim poder subir ao alto */}
      <div style={{ paddingBottom: 400 }}>
        <ContextoInstancia value={instancia}>
          <Documento documento={documento} alvo={null} aoAbrirLink={() => {}} rotulo="Texto" />
        </ContextoInstancia>
      </div>
    </div>
  );
  const conteiner = document.createElement("div");
  document.body.append(conteiner);
  const raiz = createRoot(conteiner);
  raiz.render(
    <>
      {leitor(new InstanciaLeitor(""))}
      {leitor(new InstanciaLeitor("painel-"))}
    </>,
  );
  try {
    await expect.poll(() => document.getElementById("painel-user-content-fn-1")).toBeTruthy();
    const [tela, painel] = [...conteiner.querySelectorAll<HTMLElement>("[data-leitor]")] as [HTMLElement, HTMLElement];
    // cada nota com o prefixo do seu leitor, e nenhum `id` repetido
    expect(tela.contains(document.getElementById("user-content-fn-1"))).toBe(true);
    expect(painel.contains(document.getElementById("painel-user-content-fn-1"))).toBe(true);
    expect(painel.contains(document.getElementById("painel-secao-final"))).toBe(true);
    expect(document.getElementById("painel-footnote-label")?.textContent).toBe("Notas de rodapé");
    const ids = [...conteiner.querySelectorAll("[id]")].map((e) => e.id);
    expect(ids.length).toBe(new Set(ids).size);

    const noAlto = (rolagem: HTMLElement, id: string) =>
      Math.abs(document.getElementById(id)!.getBoundingClientRect().top - rolagem.getBoundingClientRect().top);
    // a chamada da nota, no painel: só ele rola, até a nota dele (o `href` já traz o prefixo); a rolagem
    // é suave: espera ela terminar
    const parou = new Promise((pronto) => painel.addEventListener("scrollend", pronto, { once: true }));
    painel.querySelector<HTMLAnchorElement>("sup a")!.click();
    await parou;
    expect(noAlto(painel, "painel-user-content-fn-1")).toBeLessThan(40);
    expect(tela.scrollTop).toBe(0);
    // o link `#secao-final`, na tela: só ela rola
    const doPainel = painel.scrollTop;
    tela.querySelector<HTMLAnchorElement>('a[href="#secao-final"]')!.click();
    await expect.poll(() => noAlto(tela, "secao-final")).toBeLessThan(40);
    expect(painel.scrollTop).toBe(doPainel);
    // e no painel, até a seção do painel
    painel.scrollTop = 0;
    painel.querySelector<HTMLAnchorElement>('a[href="#secao-final"]')!.click();
    await expect.poll(() => noAlto(painel, "painel-secao-final")).toBeLessThan(40);
  } finally {
    raiz.unmount();
    conteiner.remove();
  }
});
