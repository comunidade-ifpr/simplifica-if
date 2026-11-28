/**
 * O painel do app completo no Chromium, com o app inteiro conectado ao `apps/server` de verdade: abrir ao
 * lado no Explorar (⌥-clique, ⇧↵ na paleta, "Abrir ao lado"), a sobreposição abaixo do limiar com Esc, o
 * clique fora e "Prender ao lado", o teclado (a paleta, a busca no texto, a alça e as abas), o erro de
 * uma tela com o painel aberto, os documentos marcados e a conversa usando o painel do app (trocar de
 * conversa não o fecha; a aba Pasta).
 */
import { afterEach, beforeAll, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import type { ServidorTeste } from "../../vite.config.ts";
import { achadosDaTela, iniciarServidorTeste, montarApp } from "../../test/navegador.tsx";

// Uma tela que quebra quando o teste pede: "Todas as tarefas" usa o catálogo.
const falha = vi.hoisted(() => ({ ligada: false }));
vi.mock("../tarefas/catalogo.ts", async (original) => {
  const modulo = await original<typeof import("../tarefas/catalogo.ts")>();
  return {
    ...modulo,
    useCatalogo: () => {
      if (falha.ligada) throw new Error("falha de teste na tela");
      return modulo.useCatalogo();
    },
  };
});

let servidor: ServidorTeste;

beforeAll(async () => {
  servidor = await iniciarServidorTeste();
});

afterEach(() => {
  falha.ligada = false;
});

function semIngles() {
  expect(achadosDaTela()).toEqual([]);
}

const painelAoLado = () => page.getByRole("complementary", { name: "Painel ao lado" });
const linhaDaNorma = (nome: string) => page.getByRole("main").getByRole("link", { name: nome, exact: true });
const larguraDaTela = () => page.getByRole("main").element().getBoundingClientRect().width;

it("Explorar: ⌥-clique abre ao lado e a tela fica; o clique, ⇧↵ e “Abrir ao lado” trocam de lugar", async () => {
  await page.viewport(1600, 900);
  await using app = await montarApp(servidor, "/explorar/normas");
  const linha = linhaDaNorma("Resolução CNE/CP nº 2/2026");
  await expect.element(linha).toBeVisible();

  // ⌥-clique (Alt+clique): a norma no painel, e a lista continua na tela.
  await linha.click({ modifiers: ["Alt"] });
  const painel = painelAoLado();
  await expect.element(painel.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 2/2026" })).toBeVisible();
  expect(app.roteador.state.location.pathname).toBe("/explorar/normas");
  // com espaço, o painel é coluna, ao lado da tela
  expect(painel.element().closest("[data-painel-app]")?.hasAttribute("data-sobreposto")).toBe(false);
  semIngles();

  // O clique simples abre na tela, como sempre no Explorar.
  await linhaDaNorma("Resolução CNE/CP nº 1/2021").click();
  await expect.poll(() => app.roteador.state.location.pathname).toBe("/explorar/ver");
  expect(app.roteador.state.location.search).toMatchObject({ link: "ifpr://norma/br/cne-cp/res/2021/1" });

  // "Abrir ao lado" leva a página ao painel.
  await page.getByRole("button", { name: "Abrir ao lado" }).click();
  await expect.element(painel.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 1/2021" })).toBeVisible();

  // Na paleta do Explorar, ↵ abre na tela, e ⇧↵, ao lado; a linha diz qual é qual.
  await painel.getByRole("button", { name: "Fechar o painel" }).click();
  await expect.element(painel).not.toBeInTheDocument();
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Buscar na base" }).fill("Res. CNE/CP 1/2021, art. 20");
  const dialogo = page.getByRole("dialog", { name: "Buscar na base" });
  await expect.element(dialogo.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await expect.element(dialogo.getByText("↵ abre na tela · ⇧↵ ao lado")).toBeVisible();
  semIngles();
  await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
  await expect.element(dialogo).not.toBeInTheDocument();
  await expect.element(painel.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 1/2021" })).toBeVisible();
  expect(app.roteador.state.location.search).toMatchObject({ link: "ifpr://norma/br/cne-cp/res/2021/1" });

  // ⌘\ (Ctrl+\) esconde e mostra o painel, no mesmo documento.
  await userEvent.keyboard("{Control>}\\{/Control}");
  await expect.element(painel).not.toBeInTheDocument();
  await userEvent.keyboard("{Control>}\\{/Control}");
  await expect.element(painel.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 1/2021" })).toBeVisible();
});

it("tela estreita: o painel vem por cima; Esc e o clique fora o recolhem, e “Prender ao lado” o fixa como coluna", async () => {
  // O notebook de 1366 × 768 com o Windows em 125%.
  await page.viewport(1093, 614);
  {
    // "Prender ao lado" fica nas preferências do servidor, com o painel (a continuidade).
    await using _app = await montarApp(servidor, "/explorar/normas", { continuidade: true });
    const linha = linhaDaNorma("Resolução CNE/CP nº 2/2026");
    await expect.element(linha).toBeVisible();
    const larguraSemPainel = larguraDaTela();

    await linha.click({ modifiers: ["Alt"] });
    const painel = painelAoLado();
    await expect.element(painel.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 2/2026" })).toBeVisible();
    // por cima: a tela não se espreme
    expect(painel.element().closest("[data-painel-app]")?.hasAttribute("data-sobreposto")).toBe(true);
    expect(larguraDaTela()).toBe(larguraSemPainel);
    // o foco foi ao painel, sem prendê-lo (sem `aria-modal`)
    expect(painel.element().contains(document.activeElement)).toBe(true);
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
    semIngles();

    // Esc recolhe, e o foco volta ao link de onde o painel saiu.
    await userEvent.keyboard("{Escape}");
    await expect.element(painel).not.toBeInTheDocument();
    await expect.element(linha).toHaveFocus();

    // Reaberto (⌘\), um clique fora o recolhe, sem perder o documento.
    await userEvent.keyboard("{Control>}\\{/Control}");
    await expect.element(painel.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 2/2026" })).toBeVisible();
    await page.getByRole("region", { name: "As normas no tempo" }).click({ position: { x: 4, y: 4 } });
    await expect.element(painel).not.toBeInTheDocument();

    // "Prender ao lado": vira coluna, a tela cede espaço, e a escolha fica lembrada.
    await userEvent.keyboard("{Control>}\\{/Control}");
    const prender = painel.getByRole("button", { name: "Prender ao lado" });
    await expect.element(prender).toHaveAttribute("aria-pressed", "false");
    await prender.click();
    await expect.element(prender).toHaveAttribute("aria-pressed", "true");
    expect(painel.element().closest("[data-painel-app]")?.hasAttribute("data-sobreposto")).toBe(false);
    await expect.poll(larguraDaTela).toBeLessThan(larguraSemPainel);
    // presa, um clique fora não a recolhe
    await page.getByRole("region", { name: "As normas no tempo" }).click({ position: { x: 4, y: 4 } });
    await expect.element(painel).toBeVisible();
  }
  // O app reaberto lembra: o painel vem como coluna.
  await using _app = await montarApp(servidor, "/explorar/normas", { continuidade: true });
  await linhaDaNorma("Resolução CNE/CP nº 2/2026").click({ modifiers: ["Alt"] });
  await expect
    .element(painelAoLado().getByRole("button", { name: "Prender ao lado" }))
    .toHaveAttribute("aria-pressed", "true");
  expect(painelAoLado().element().closest("[data-painel-app]")?.hasAttribute("data-sobreposto")).toBe(false);
});

it("tela estreita, pelo teclado e pelo mouse: a paleta, a busca no texto, a alça, as abas e o clique fora", async () => {
  await page.viewport(1093, 614);
  await using app = await montarApp(servidor, "/explorar/normas");
  const linha = linhaDaNorma("Resolução CNE/CP nº 2/2026");
  await expect.element(linha).toBeVisible();
  const painel = painelAoLado();
  const dialogo = page.getByRole("dialog", { name: "Buscar na base" });
  const campo = page.getByRole("combobox", { name: "Buscar na base" });

  // Com a paleta aberta, ⌘\ (Ctrl+\) não abre o painel por baixo nem tira o foco dela.
  (linha.element() as HTMLElement).focus();
  await userEvent.keyboard("{Control>}k{/Control}");
  await expect.element(campo).toHaveFocus();
  await userEvent.keyboard("{Control>}\\{/Control}");
  await expect.element(campo).toHaveFocus();
  expect(painel.query()).toBeNull();

  // ⇧↵ abre ao lado; Esc o recolhe, e o foco volta à linha de onde a paleta saiu.
  await campo.fill("Res. CNE/CP 1/2021, art. 20");
  await expect.element(dialogo.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
  await expect.element(painel.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 1/2021" })).toBeVisible();
  expect(painel.element().closest("[data-painel-app]")?.hasAttribute("data-sobreposto")).toBe(true);
  await userEvent.keyboard("{Escape}");
  await expect.element(painel).not.toBeInTheDocument();
  await expect.element(linha).toHaveFocus();

  // "Buscar na base" do painel manda o resultado ao Ler, também fora de uma tela de trabalho.
  await userEvent.keyboard("{Control>}\\{/Control}");
  await painel.getByRole("button", { name: "Buscar na base" }).click();
  await campo.fill("Res. 2/2026");
  await expect.element(dialogo.getByText("↵ abre ao lado · ⇧↵ na tela")).toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect.element(painel.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 2/2026" })).toBeVisible();
  expect(app.roteador.state.location.pathname).toBe("/explorar/normas");

  // O clique que pede o que o painel já mostra não é um clique fora; nem a seleção que começou nele.
  await linha.click({ modifiers: ["Alt"] });
  await expect.element(painel).toBeVisible();
  const fora = page.getByRole("region", { name: "As normas no tempo" }).element();
  painel.element().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
  fora.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await expect.element(painel).toBeVisible();

  // Esc com o foco nos botões da busca no texto fecha a busca; o seguinte, o painel.
  await painel.getByRole("button", { name: "Buscar no texto" }).click();
  await painel.getByRole("searchbox", { name: "Buscar no texto" }).fill("curso");
  await painel.getByRole("button", { name: "Próximo resultado" }).click();
  await userEvent.keyboard("{Escape}");
  await expect.element(painel.getByRole("searchbox", { name: "Buscar no texto" })).not.toBeInTheDocument();
  await expect.element(painel).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(painel).not.toBeInTheDocument();

  // Esc na alça da largura também recolhe.
  await userEvent.keyboard("{Control>}\\{/Control}");
  (page.getByRole("separator", { name: "Largura do painel ao lado" }).element() as HTMLElement).focus();
  await userEvent.keyboard("{Escape}");
  await expect.element(painel).not.toBeInTheDocument();

  // As setas andam pelas abas, também ao voltar ao Ler, que não toma o foco delas.
  await userEvent.keyboard("{Control>}\\{/Control}");
  const aba = (nome: string) => painel.getByRole("tab", { name: nome });
  (aba("Ler").element() as HTMLElement).focus();
  for (const nome of ["Conversar", "Pasta", "Ler", "Conversar"]) {
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(aba(nome)).toHaveAttribute("aria-selected", "true");
    await expect.element(aba(nome)).toHaveFocus();
  }
  semIngles();
});

it("o erro de uma tela fica na área dela: o cabeçalho e o painel continuam de pé", async () => {
  await page.viewport(1600, 900);
  await using app = await montarApp(servidor, "/explorar/normas");
  await linhaDaNorma("Resolução CNE/CP nº 2/2026").click({ modifiers: ["Alt"] });
  const painel = painelAoLado();
  await expect.element(painel.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 2/2026" })).toBeVisible();

  falha.ligada = true;
  await app.roteador.navigate({ to: "/tarefas" });
  const aviso = page.getByRole("main").getByText("Algo deu errado nesta tela");
  await expect.element(aviso).toBeVisible();
  await expect.element(page.getByRole("navigation", { name: "Telas" })).toBeVisible();
  await expect.element(painel.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 2/2026" })).toBeVisible();
  semIngles();

  // "Tentar de novo" monta a tela outra vez.
  falha.ligada = false;
  await page.getByRole("button", { name: "Tentar de novo" }).click();
  await expect.element(page.getByRole("heading", { level: 1, name: "Todas as tarefas" })).toBeVisible();

  // E ir para outra tela tira o erro (o Início também usa o catálogo).
  falha.ligada = true;
  await page.getByRole("link", { name: "Início", exact: true }).click();
  await expect.element(aviso).toBeVisible();
  falha.ligada = false;
  await page.getByRole("link", { name: "Explorar o IFPR" }).click();
  await expect.element(aviso).not.toBeInTheDocument();
  await expect.element(painel).toBeVisible();
});

it("documentos abertos e fixados: cada documento vira aba, fixar leva ao início e fechar troca para a vizinha", async () => {
  await page.viewport(1600, 900);
  await using _app = await montarApp(servidor, "/explorar/normas");
  await linhaDaNorma("Resolução CNE/CP nº 2/2026").click({ modifiers: ["Alt"] });
  const painel = painelAoLado();
  await expect.element(painel.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 2/2026" })).toBeVisible();
  const abas = painel.getByRole("navigation", { name: "Documentos abertos" });
  await expect.element(abas.getByRole("button", { name: "Res. CNE/CP 2/2026" })).toBeVisible();

  // Outra norma no painel: as duas aparecem como abas abertas.
  await linhaDaNorma("Resolução CNE/CP nº 1/2021").click({ modifiers: ["Alt"] });
  await expect.element(painel.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 1/2021" })).toBeVisible();
  await expect.element(abas.getByRole("listitem")).toHaveLength(2);

  // Fixar a segunda norma leva a aba dela para o início, com o ícone de desafixar.
  const fixar = painel.getByRole("button", { name: "Fixar este documento" });
  await expect.element(fixar).toHaveAttribute("aria-pressed", "false");
  await fixar.click();
  await expect.element(fixar).toHaveAttribute("aria-pressed", "true");
  await expect.element(abas.getByRole("listitem").nth(0)).toHaveTextContent("Res. CNE/CP 1/2021");
  await expect.element(abas.getByRole("button", { name: "Desafixar Res. CNE/CP 1/2021" })).toBeVisible();
  semIngles();

  // Um clique na aba da primeira volta a ela.
  await abas.getByRole("button", { name: "Res. CNE/CP 2/2026" }).click();
  await expect.element(painel.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 2/2026" })).toBeVisible();
  await expect.element(fixar).toHaveAttribute("aria-pressed", "false");

  // Fechar a aba ativa volta para a outra aba aberta.
  await abas.getByRole("button", { name: "Fechar Res. CNE/CP 2/2026" }).click();
  await expect.element(abas.getByRole("listitem")).toHaveLength(1);
  await expect.element(painel.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 1/2021" })).toBeVisible();
  await expect.element(fixar).toHaveAttribute("aria-pressed", "true");

  // Desafixar pela aba mantém o documento aberto, agora com o botão de fechar.
  await abas.getByRole("button", { name: "Desafixar Res. CNE/CP 1/2021" }).click();
  await expect.element(fixar).toHaveAttribute("aria-pressed", "false");
  await expect.element(abas.getByRole("listitem")).toHaveLength(1);
  await expect.element(abas.getByRole("button", { name: "Fechar Res. CNE/CP 1/2021" })).toBeVisible();
});

it("conversa: os chips abrem no painel do app, que fica aberto ao trocar de conversa; a aba Pasta mostra a da tela", async () => {
  await page.viewport(1600, 900);
  await using app = await montarApp(servidor, "/");
  await page
    .getByRole("textbox", { name: "O que você precisa hoje?" })
    .fill("Abra no leitor o que a DCN pede sobre egressos");
  await page.getByRole("button", { name: "Enviar" }).click();
  const chip = page.getByRole("button", { name: "Res. CNE/CP nº 2/2026, art. 28, XVIII" });
  await chip.click();
  const painel = painelAoLado();
  const abaNorma = () =>
    painel.getByRole("navigation", { name: "Documentos abertos" }).getByRole("button", { name: "Res. CNE/CP 2/2026" });
  await expect.element(abaNorma()).toHaveAttribute("title", "Res. CNE/CP 2/2026, art. 28, XVIII");
  expect(app.roteador.state.location.pathname).toBe("/conversa");
  const primeira = app.roteador.state.location.search;

  // Outra conversa: o painel é do app e continua aberto, com a mesma norma.
  await page.getByRole("button", { name: "Nova tarefa" }).click();
  await page.getByRole("textbox", { name: "O que você precisa hoje?" }).fill("Quais normas tratam do estágio?");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect
    .element(page.getByRole("log", { name: "Mensagens" }).getByText("Quais normas tratam do estágio?"))
    .toBeVisible();
  await expect.element(abaNorma()).toHaveAttribute("title", "Res. CNE/CP 2/2026, art. 28, XVIII");

  // "Pasta da tarefa" abre a aba Pasta, com a pasta da conversa da tela.
  await page.getByRole("button", { name: "Pasta da tarefa" }).click();
  const pasta = page.getByRole("tabpanel", { name: "Pasta" });
  await expect.element(pasta.getByText("Documentos › Simplifica IF › Quais normas tratam do estágio")).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Pasta da tarefa" })).toHaveAttribute("aria-pressed", "true");
  // trocar de conversa pela barra troca a pasta, e o painel fica
  await page
    .getByRole("navigation", { name: "Conversas gravadas" })
    .getByRole("link", { name: /Abra no leitor o que a DCN pede/ })
    .click();
  await expect.poll(() => app.roteador.state.location.search).toEqual(primeira);
  await expect.element(pasta.getByText(/^Documentos › Simplifica IF › Abra no leitor/)).toBeVisible();
  // a aba Ler guardou a norma
  await painel.getByRole("tab", { name: "Ler" }).click();
  await expect.element(abaNorma()).toHaveAttribute("title", "Res. CNE/CP 2/2026, art. 28, XVIII");

  // ⌥-clique no chip abre na página do Explorar.
  await chip.click({ modifiers: ["Alt"] });
  await expect.poll(() => app.roteador.state.location.pathname).toBe("/explorar/ver");
  // fora da conversa, a aba Pasta diz como ver uma
  await painel.getByRole("tab", { name: "Pasta" }).click();
  await expect.element(painel.getByText(/^Abra uma conversa para ver aqui a pasta dela/)).toBeVisible();
  // e a aba Conversar, vazia, é o rascunho de uma conversa ao lado
  await painel.getByRole("tab", { name: "Conversar" }).click();
  await expect.element(painel.getByText(/^Pergunte à IA sem sair da tela/)).toBeVisible();
  semIngles();
});
