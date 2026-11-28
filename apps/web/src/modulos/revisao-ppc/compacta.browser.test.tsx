/**
 * A revisão na janela compacta, ao lado do Word, no Chromium conectado ao `apps/server` de verdade
 * (`test/servidor-teste.ts`) e com a ponte do desktop simulada: "Acompanhar no Word" abre a cópia comentada
 * e liga o modo; a moldura compacta (título, alfinete, ⤢), a dica, o filtro por gravidade, "Feito", a
 * norma no painel que cobre a coluna e volta, o salvamento conferido sem IA ("Resolvido ao salvar"), a
 * caixa curta da conversa com a resposta na coluna, e ⤢ de volta ao app inteiro. O painel aberto que
 * recolhe ao entrar, o rascunho de outra conversa que fica, a ficha do PPC tirada que não volta, a
 * navegação para fora (e Voltar no histórico) que desliga o modo, e o desktop que recusa ligá-lo. A página
 * que abre com `compacto=1` sem a janela compacta (recarregada) volta à tela inteira; sem o desktop, não há
 * modo.
 */
import type { JanelaDesktop } from "@simplifica-if/contratos-app/ponte";
import { afterEach, beforeAll, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import type { ServidorTeste } from "../../../vite.config.ts";
import { achadosDaTela, iniciarServidorTeste, montarApp, salvarNoWord } from "../../../test/navegador.tsx";
import { ponteTeste } from "../../../test/ponte.ts";

let servidor: ServidorTeste;

beforeAll(async () => {
  servidor = await iniciarServidorTeste({ atrasoLogin: 120 });
});

afterEach(() => {
  delete window.simplifica;
});

/**
 * A ponte com a janela compacta simulada: guarda os pedidos de ligar, desligar e do alfinete. `liga` diz se
 * o desktop liga o modo (falso: a janela que não saiu da tela cheia a tempo).
 */
function ponteComJanela(
  plataforma: "darwin" | "win32",
  abrirDocumento: (caminho: string) => Promise<void>,
  liga = true,
) {
  const compacta = vi.fn(async (ligar: boolean) => ligar && liga);
  const naFrente = vi.fn(async (_sempre: boolean) => {});
  const janela: JanelaDesktop = { ...ponteTeste().janela, plataforma, compacta, naFrente };
  window.simplifica = ponteTeste({
    conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
    escolherDocx: async () => servidor.ppc,
    abrirDocumento,
    janela,
  });
  return { compacta, naFrente };
}

it("Acompanhar no Word: a coluna ao lado do Word, com a lista, o salvamento, a conversa e ⤢", async () => {
  const abrirDocumento = vi.fn(async (_caminho: string) => {});
  const { compacta, naFrente } = ponteComJanela("win32", abrirDocumento);
  await page.viewport(1280, 900);
  await using app = await montarApp(servidor, "/revisao-ppc");
  await page.getByRole("button", { name: "Escolher o PPC" }).click();
  await expect.element(page.getByText("PPC de teste.docx", { exact: true })).toBeVisible();

  // "Acompanhar no Word": a cópia comentada abre no Word, e a janela vira a coluna (o desktop encolhe a janela;
  // aqui, a página).
  await page.getByRole("button", { name: "Corrigir no Word" }).click();
  await vi.waitFor(() => expect(compacta).toHaveBeenCalledWith(true));
  expect(abrirDocumento).toHaveBeenCalledTimes(1);
  const copia = abrirDocumento.mock.calls[0]![0];
  await page.viewport(380, 760);
  await vi.waitFor(() => expect(app.roteador.state.location.search).toMatchObject({ compacto: 1 }));

  // A moldura compacta: só o título, o alfinete e ⤢, com o lugar dos botões do Windows à direita.
  const barra = page.getByRole("banner");
  await expect.element(barra.getByText("Acompanhando o PPC")).toBeVisible();
  expect(barra.element().getAttribute("data-botoes")).toBe("overlay");
  await expect.element(page.getByRole("link", { name: "Explorar o IFPR" })).not.toBeInTheDocument();
  const alfinete = page.getByRole("button", { name: "Sempre por cima" });
  await expect.element(alfinete).toHaveAttribute("aria-pressed", "true");
  await alfinete.click();
  await expect.element(alfinete).toHaveAttribute("aria-pressed", "false");
  expect(naFrente).toHaveBeenLastCalledWith(false);

  // A dica, com o atalho do Windows, e o que a coluna mostra.
  await expect.element(page.getByText(/^Deixe o Word à esquerda \(⊞\+←\)/)).toBeVisible();
  await page.getByRole("button", { name: "Entendi" }).click();
  await expect.element(page.getByText(/^Deixe o Word à esquerda/)).not.toBeInTheDocument();
  await expect.element(page.getByText("Salve no Word para conferir.")).toBeVisible();
  // A coluna não rola para o lado.
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(380);

  // O filtro por gravidade: só as de corrigir, depois todas.
  const pendencias = page.getByRole("list", { name: "Pendências" });
  const linhas = () => [...pendencias.element().querySelectorAll("li[data-chave]")];
  const todas = linhas().length;
  expect(todas).toBeGreaterThan(1);
  // O glifo é só visual; a contagem é a das linhas que o filtro mostra.
  const corrigir = page.getByRole("button", { name: /^Corrigir \d+$/ });
  await corrigir.click();
  await vi.waitFor(() => expect(linhas().length).toBeLessThan(todas));
  expect(linhas().every((li) => li.textContent?.includes("Corrigir"))).toBe(true);
  expect(corrigir.element().textContent).toBe(`●Corrigir ${linhas().length}`);
  expect(linhas()[0]!.querySelector("button")!.getAttribute("aria-keyshortcuts")).toBe("F");
  await page.getByRole("button", { name: /^Tudo/ }).click();
  await vi.waitFor(() => expect(linhas()).toHaveLength(todas));

  // Uma pendência aberta: o trecho, "Feito" e a norma, que abre no painel por cima da coluna, com "Voltar".
  const aee = pendencias.getByRole("button", { name: /O AEE aparece como componente/ });
  await aee.click();
  const aberta = pendencias.getByRole("region", { name: /O AEE aparece como componente/ });
  await expect.element(aberta.getByRole("button", { name: "Copiar trecho" })).toBeVisible();
  // "Feito" fecha a linha, que fica marcada.
  await aberta.getByRole("button", { name: "Feito" }).click();
  await expect.element(aee.getByText("Feito")).toBeVisible();
  await aee.click();
  await aberta.getByRole("button", { name: "Desfazer" }).click();
  await expect.element(aberta.getByRole("button", { name: "Feito" })).toBeVisible();
  const norma = aberta.getByRole("button", { name: /^Normas?$/ });
  await norma.click();
  const itemNorma = page.getByRole("menuitem").first();
  if ((await itemNorma.query()) !== null) await itemNorma.click();
  const painel = page.getByRole("complementary", { name: "Painel ao lado" });
  await expect.element(painel).toBeVisible();
  // O painel cobre a coluna: a lista embaixo sai do teclado e do leitor de tela, e a barra cabe na coluna.
  expect(document.querySelector("main")!.inert).toBe(true);
  const barraDoPainel = painel.element().querySelector("header")!;
  expect(barraDoPainel.scrollWidth).toBeLessThanOrEqual(barraDoPainel.clientWidth);
  await page.viewport(320, 760);
  await vi.waitFor(() => expect(barraDoPainel.clientWidth).toBeLessThanOrEqual(320));
  expect(barraDoPainel.scrollWidth).toBeLessThanOrEqual(barraDoPainel.clientWidth);
  await page.viewport(380, 760);
  await painel.getByRole("button", { name: "Voltar", exact: true }).click();
  await expect.element(painel).not.toBeInTheDocument();
  expect(document.querySelector("main")!.inert).toBe(false);
  await expect.element(aberta).toBeVisible();

  // O Word salva a versão corrigida: a coluna diz que conferiu sem IA, e a pendência saiu resolvida.
  await salvarNoWord(servidor.ppcSalvo, copia);
  const conferencia = page.getByRole("region", { name: "Conferência ao salvar" }).getByRole("status");
  // Uma linha por parágrafo: o leitor de tela não as junta numa palavra só.
  await vi.waitFor(
    () =>
      expect([...conferencia.element().querySelectorAll("p")].map((p) => p.textContent)).toEqual([
        expect.stringMatching(/^Salvo às \d{2}:\d{2} · conferido sem IA$/),
        expect.stringMatching(/^1 ponto resolvido/),
      ]),
    { timeout: 20_000 },
  );
  await expect.element(aee.getByText("Resolvido ao salvar")).toBeVisible();
  expect(achadosDaTela()).toEqual([]);

  // A caixa curta pergunta com o PPC e a pendência aberta; a resposta abre na coluna, e "Voltar" volta à lista.
  await aee.click();
  await aee.click();
  const conversa = page.getByRole("region", { name: "Conversa sobre esta revisão" });
  const fichas = conversa.getByRole("region", { name: "Vai junto com a pergunta" });
  await expect.element(fichas.getByText("PPC de teste", { exact: true })).toBeVisible();
  await expect.element(fichas.getByText(/^Pendência: O AEE aparece como componente/)).toBeVisible();
  await conversa.getByRole("textbox", { name: "Pergunta à IA" }).fill("O que falta no AEE?");
  await userEvent.keyboard("{Enter}");
  const mensagens = painel.getByRole("log", { name: "Mensagens" });
  await expect.element(mensagens.getByText("O que falta no AEE?")).toBeVisible();
  await mensagens.getByRole("button", { name: "Permitir" }).click();
  await expect.element(mensagens.getByRole("button", { name: "Res. CNE/CP nº 1/2021" })).toBeVisible();
  await painel.getByRole("button", { name: "Voltar", exact: true }).click();
  await expect.element(pendencias).toBeVisible();

  // ⤢: a janela volta ao tamanho de antes, e a revisão, à tela inteira.
  await page.getByRole("button", { name: "Voltar ao app inteiro" }).click();
  await vi.waitFor(() => expect(compacta).toHaveBeenLastCalledWith(false));
  await page.viewport(1280, 900);
  await vi.waitFor(() => expect(app.roteador.state.location.search).not.toHaveProperty("compacto"));
  await expect.element(page.getByRole("heading", { name: "Revisar um PPC" })).toBeVisible();
  await expect.element(page.getByRole("link", { name: "Explorar o IFPR" })).toBeVisible();
  // Já acompanhando, "Acompanhar no Word" abre o mesmo arquivo e volta à coluna, sem outra cópia.
  abrirDocumento.mockClear();
  await page.getByRole("button", { name: "Corrigir no Word" }).click();
  await vi.waitFor(() => expect(abrirDocumento).toHaveBeenCalledWith(copia));
  await vi.waitFor(() => expect(app.roteador.state.location.search).toMatchObject({ compacto: 1 }));
  await expect.element(page.getByText(/^Deixe o Word à esquerda: /)).not.toBeInTheDocument();
  await expect.element(page.getByText(/^Deixe o Word à esquerda \(⊞\+←\)/)).toBeVisible();
  await page.getByRole("button", { name: "Voltar ao app inteiro" }).click();
});

it("no compacto: a bandeja na moldura leva à conversa ao lado no painel, sem sair; ⌥-clique no Ler fica no painel; ⤢ guarda a volta sem o compacto", async () => {
  const { compacta } = ponteComJanela("darwin", async () => {});
  await page.viewport(1280, 900);
  await using app = await montarApp(servidor, "/revisao-ppc");
  await page.getByRole("button", { name: "Escolher o PPC" }).click();
  await expect.element(page.getByText("PPC de teste.docx", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Corrigir no Word" }).click();
  await vi.waitFor(() => expect(app.roteador.state.location.search).toMatchObject({ compacto: 1 }));
  await page.viewport(380, 760);
  const id = String(app.roteador.state.location.search.id);

  // A pergunta pela caixa curta, com a pendência aberta (a IA de demonstração pede para gravar); a pessoa
  // volta à lista antes do pedido.
  await page
    .getByRole("list", { name: "Pendências" })
    .getByRole("button", { name: /O AEE aparece como componente/ })
    .click();
  const conversa = page.getByRole("region", { name: "Conversa sobre esta revisão" });
  await conversa.getByRole("textbox", { name: "Pergunta à IA" }).fill("O que falta?");
  await userEvent.keyboard("{Enter}");
  const painel = page.getByRole("complementary", { name: "Painel ao lado" });
  const mensagens = painel.getByRole("log", { name: "Mensagens" });
  await expect.element(mensagens.getByText("O que falta?")).toBeVisible();
  await painel.getByRole("button", { name: "Voltar", exact: true }).click();
  await expect.element(painel).not.toBeInTheDocument();

  // Com o alfinete preso não há aviso do sistema: a moldura compacta mostra o pedido, e o clique abre a
  // conversa no painel, na coluna.
  const bandeja = page.getByRole("banner").getByRole("button", { name: /^Em andamento: \d+$/ });
  await bandeja.click();
  const pedido = page.getByRole("list", { name: "Em andamento" }).getByRole("button", { name: /pede permissão/ });
  await pedido.click();
  await expect.element(mensagens.getByRole("button", { name: "Permitir" })).toBeVisible();
  expect(app.roteador.state.location.pathname).toBe("/revisao-ppc");
  expect(app.roteador.state.location.search).toMatchObject({ compacto: 1 });
  expect(compacta).not.toHaveBeenCalledWith(false);
  expect(achadosDaTela()).toEqual([]);
  await mensagens.getByRole("button", { name: "Permitir" }).click();

  // A norma da resposta abre no Ler; o ⌥-clique na aba fixada fica no painel, na coluna.
  await mensagens.getByRole("button", { name: "Res. CNE/CP nº 1/2021" }).click();
  await painel.getByRole("button", { name: "Fixar este documento" }).click();
  const abas = painel.getByRole("navigation", { name: "Documentos abertos" });
  await abas.getByRole("button", { name: "Res. CNE/CP 1/2021" }).click({ modifiers: ["Alt"] });
  await expect.element(painel.getByRole("tab", { name: "Ler" })).toHaveAttribute("aria-selected", "true");
  expect(app.roteador.state.location.pathname).toBe("/revisao-ppc");
  expect(compacta).not.toHaveBeenCalledWith(false);

  // ⤢ da aba Conversar sai do compacto; "Trazer de volta" volta à revisão na tela inteira.
  await painel.getByRole("tab", { name: "Conversar" }).click();
  await painel.getByRole("button", { name: "Abrir a conversa na tela cheia" }).click();
  await vi.waitFor(() => expect(app.roteador.state.location.pathname).toBe("/conversa"));
  expect(app.contexto.painel.obter().conversa.voltarPara).toBe(`/revisao-ppc?id=${id}`);
});

it("ao entrar, o painel recolhe e o rascunho de outra conversa fica; a ficha do PPC tirada não volta; sair da revisão desliga o modo", async () => {
  const { compacta } = ponteComJanela("darwin", async () => {});
  await page.viewport(1280, 900);
  await using app = await montarApp(servidor, "/");
  // Uma conversa livre com rascunho, no painel aberto.
  app.contexto.painel.conversar({ texto: "Rascunho da conversa livre" });
  await app.roteador.navigate({ to: "/revisao-ppc" });
  await page.getByRole("button", { name: "Escolher o PPC" }).click();
  await expect.element(page.getByText("PPC de teste.docx", { exact: true })).toBeVisible();
  const painel = page.getByRole("complementary", { name: "Painel ao lado" });
  await expect.element(painel).toBeVisible();

  await page.getByRole("button", { name: "Corrigir no Word" }).click();
  await vi.waitFor(() => expect(app.roteador.state.location.search).toMatchObject({ compacto: 1 }));
  await page.viewport(380, 760);
  // O painel que estava aberto recolheu: a lista fica à vista.
  await expect.element(painel).not.toBeInTheDocument();
  const pendencias = page.getByRole("list", { name: "Pendências" });
  await expect.element(pendencias).toBeVisible();

  // A caixa curta guarda o rascunho da conversa livre e oferece a da revisão.
  const conversa = page.getByRole("region", { name: "Conversa sobre esta revisão" });
  const caixa = conversa.getByRole("textbox", { name: "Pergunta à IA" });
  await expect.element(caixa).toHaveValue("Rascunho da conversa livre");
  await conversa.getByRole("button", { name: "Conversar sobre esta revisão" }).click();
  const fichas = conversa.getByRole("region", { name: "Vai junto com a pergunta" });
  await expect.element(fichas.getByText("PPC de teste", { exact: true })).toBeVisible();
  await expect.element(caixa).toHaveValue("");
  await expect.element(conversa.getByRole("button", { name: "Conversar sobre esta revisão" })).not.toBeInTheDocument();

  // A ficha do PPC tirada não volta ao abrir uma pendência: só a da pendência entra.
  await fichas.getByRole("button", { name: "Tirar o PPC do contexto" }).click();
  const linhas = pendencias.element().querySelectorAll<HTMLElement>("li[data-chave] > div > button");
  linhas[0]!.click();
  await expect.element(fichas.getByText(/^Pendência: /)).toBeVisible();
  await expect.element(fichas.getByText("PPC de teste", { exact: true })).not.toBeInTheDocument();
  // Outra pendência troca a ficha da pendência.
  const primeira = fichas.getByText(/^Pendência: /).element().textContent;
  linhas[1]!.click();
  await vi.waitFor(() => expect(fichas.getByText(/^Pendência: /).element().textContent).not.toBe(primeira));
  await expect.element(fichas.getByText(/^Pendência: /)).toBeVisible();

  // A conversa que a pessoa troca no painel não é puxada de volta ao abrir outra pendência.
  app.contexto.painel.novaConversa();
  linhas[0]!.click();
  await expect.element(conversa.getByRole("button", { name: "Conversar sobre esta revisão" })).toBeVisible();
  await expect.element(fichas).not.toBeInTheDocument();

  // Ir a outra tela (o aviso do sistema, um link na tela) desliga o modo antes.
  await app.roteador.navigate({ to: "/" });
  await vi.waitFor(() => expect(compacta).toHaveBeenLastCalledWith(false));
  expect(app.contexto.janela.obter().ligada).toBe(false);
  await expect.element(page.getByRole("link", { name: "Explorar o IFPR" })).toBeVisible();
});

it("a janela que não sai da tela cheia: o modo não liga e avisa; Voltar no histórico sai da revisão e do modo", async () => {
  const { compacta } = ponteComJanela("darwin", async () => {}, false);
  await page.viewport(1280, 900);
  await using app = await montarApp(servidor, "/");
  await app.roteador.navigate({ to: "/revisao-ppc" });
  await page.getByRole("button", { name: "Escolher o PPC" }).click();
  await expect.element(page.getByText("PPC de teste.docx", { exact: true })).toBeVisible();
  const acompanhar = page.getByRole("button", { name: "Corrigir no Word" });

  await acompanhar.click();
  await expect.element(page.getByRole("alert").getByText(/^A janela não virou a coluna/)).toBeVisible();
  expect(compacta).toHaveBeenCalledWith(true);
  expect(app.roteador.state.location.search).not.toHaveProperty("compacto");
  await expect.element(page.getByRole("button", { name: "Voltar ao app inteiro" })).not.toBeInTheDocument();

  // Agora a janela sai da tela cheia a tempo; o `compacto=1` troca a entrada do histórico, sem outra.
  compacta.mockImplementation(async (ligar) => ligar);
  const entradas = app.roteador.history.length;
  await acompanhar.click();
  await vi.waitFor(() => expect(app.roteador.state.location.search).toMatchObject({ compacto: 1 }));
  await expect.element(page.getByText(/^A janela não virou a coluna/)).not.toBeInTheDocument();
  expect(app.roteador.history.length).toBe(entradas);

  // Voltar leva à entrada de antes da revisão aberta: o modo desliga, e a janela volta ao normal.
  app.roteador.history.back();
  await vi.waitFor(() => expect(app.roteador.state.location.search).toEqual({}));
  await vi.waitFor(() => expect(compacta).toHaveBeenLastCalledWith(false));
  expect(app.contexto.janela.obter().ligada).toBe(false);
  await expect.element(page.getByRole("link", { name: "Explorar o IFPR" })).toBeVisible();
});

it("a página recarregada com compacto=1, sem a janela compacta, volta à tela inteira", async () => {
  const { compacta } = ponteComJanela("darwin", async () => {});
  await page.viewport(1280, 900);
  // Uma revisão que existe, aberta direto pela rota lembrada com `compacto=1`.
  let id: string;
  {
    await using app = await montarApp(servidor, "/revisao-ppc");
    await page.getByRole("button", { name: "Escolher o PPC" }).click();
    // A revisão lida (o nome do arquivo também aparece nas revisões recentes, do teste anterior).
    id = await vi.waitFor(() => {
      const lista = app.contexto.revisao.obter().lista;
      expect(lista).toBeDefined();
      return lista!.id;
    });
  }
  await using app = await montarApp(servidor, `/revisao-ppc?id=${id}&compacto=1`);
  await vi.waitFor(() => expect(app.roteador.state.location.search).toEqual({ id }));
  await expect.element(page.getByRole("heading", { name: "Revisar um PPC" })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Voltar ao app inteiro" })).not.toBeInTheDocument();
  expect(compacta).not.toHaveBeenCalled();
});

it("no navegador, sem o desktop, não há modo compacto", async () => {
  await using app = await montarApp(servidor, "/revisao-ppc");
  expect(app.contexto.janela.disponivel).toBe(false);
  expect(await app.contexto.janela.ligar("Acompanhando o PPC", () => true)).toBe("recusada");
  expect(app.contexto.janela.obter().ligada).toBe(false);
});
