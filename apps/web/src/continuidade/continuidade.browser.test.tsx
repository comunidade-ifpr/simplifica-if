/**
 * A continuidade no Chromium, com o app inteiro conectado ao `apps/server` de verdade: reabrir o app (desmontar,
 * o que grava como o app fechando, e montar de novo no Início) volta à última rota e ao painel; a rota que não
 * existe mais vai ao Início; o `compacto=1` não volta; a revisão apagada sai da rota e do painel com "Esta
 * revisão foi apagada"; a revisão refeita com outro curso, que o painel segue (sem o falso "foi apagada"); o
 * painel reaberto que não toma o foco; a rolagem lembrada ao voltar de outra tela; e "Continuar de onde
 * parou" no Início.
 */
import type { PainelGuardado } from "@simplifica-if/contratos-app";
import type { JanelaDesktop } from "@simplifica-if/contratos-app/ponte";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import type { ServidorTeste } from "../../vite.config.ts";
import { achadosDaTela, iniciarServidorTeste, montarApp } from "../../test/navegador.tsx";
import { ponteTeste } from "../../test/ponte.ts";

let servidor: ServidorTeste;

beforeAll(async () => {
  servidor = await iniciarServidorTeste({ atrasoLogin: 120 });
});

const PAINEL_VAZIO: PainelGuardado = {
  aberto: false,
  aba: "ler",
  trilha: { links: [], posicao: -1 },
  marcados: [],
  preso: false,
};

/** O que está guardado agora, lido com a continuidade desligada (que não volta nem grava). */
async function guardada() {
  await using app = await montarApp(servidor, "/");
  return (await app.contexto.api.chamar((cliente) => cliente["preferencias.ler"]({}))).continuidade;
}

// Cada teste começa do Início, com o painel vazio guardado, sem depender do que o anterior deixou.
beforeEach(async () => {
  await using app = await montarApp(servidor, "/");
  await app.contexto.api.chamar((cliente) =>
    cliente["preferencias.guardarContinuidade"]({ continuidade: { rota: "/", painel: PAINEL_VAZIO } }),
  );
});

afterEach(() => {
  delete window.simplifica;
});

const LIGADA = { continuidade: true } as const;

/** Resolve quando a revisão chega ao resultado (a lista lida), sem prazo próprio: o do teste vale. */
function revisaoNoResultado(revisao: {
  readonly obter: () => { readonly fase: string };
  readonly observar: (aviso: () => void) => () => void;
}): Promise<void> {
  return new Promise((resolver) => {
    const conferir = () => {
      if (revisao.obter().fase !== "resultado") return;
      parar();
      resolver();
    };
    const parar = revisao.observar(conferir);
    conferir();
  });
}
const painelAoLado = () => page.getByRole("complementary", { name: "Painel ao lado" });
const NORMA_2026 = "ifpr://norma/br/cne-cp/res/2026/2";

it("reabrir volta à última rota e ao painel (a trilha, os marcados, a aba); “Continuar de onde parou” mostra o que ficou aberto", async () => {
  await page.viewport(1600, 900);
  {
    await using app = await montarApp(servidor, "/explorar/normas", LIGADA);
    const linha = page.getByRole("main").getByRole("link", { name: "Resolução CNE/CP nº 2/2026", exact: true });
    await linha.click({ modifiers: ["Alt"] });
    const painel = painelAoLado();
    await expect.element(painel.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 2/2026" })).toBeVisible();
    await painel.getByRole("button", { name: "Fixar este documento" }).click();
    await page.getByRole("main").getByRole("link", { name: "Resolução CNE/CP nº 1/2021", exact: true }).click();
    await expect.poll(() => app.roteador.state.location.pathname).toBe("/explorar/ver");
  }

  // Reaberto no Início: volta à página do Explorar e ao painel como estava.
  await using app = await montarApp(servidor, "/", LIGADA);
  await expect.poll(() => app.roteador.state.location.pathname).toBe("/explorar/ver");
  expect(app.roteador.state.location.search).toMatchObject({ link: "ifpr://norma/br/cne-cp/res/2021/1" });
  const painel = painelAoLado();
  await expect.element(painel.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 2/2026" })).toBeVisible();
  await expect.element(painel.getByRole("navigation", { name: "Documentos abertos" })).toBeVisible();
  expect(app.contexto.painel.obter().marcados).toEqual([NORMA_2026]);
  // Reaberto sem gesto da pessoa, o painel não toma o foco da tela.
  expect(painel.element().contains(document.activeElement)).toBe(false);

  // No Início, "Continuar de onde parou": o documento aberto no painel, que o painel mostra de novo.
  await painel.getByRole("button", { name: "Fechar o painel" }).click();
  await page.getByRole("navigation", { name: "Telas" }).getByRole("link", { name: "Início" }).click();
  const continuar = page.getByRole("region", { name: "Continuar de onde parou" });
  await expect.element(continuar).toBeVisible();
  await continuar.getByRole("button", { name: /aberto no painel/ }).click();
  await expect.element(painel.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 2/2026" })).toBeVisible();
  expect(achadosDaTela()).toEqual([]);
});

it("a rota que não existe mais vai ao Início", async () => {
  {
    await using app = await montarApp(servidor, "/", LIGADA);
    await expect.element(page.getByRole("heading", { name: "O que você precisa hoje?" })).toBeVisible();
    await app.roteador.navigate({ to: "/conversa", search: { id: "conversa-que-nao-existe" } });
    await expect.poll(() => app.roteador.state.location.search).toMatchObject({ id: "conversa-que-nao-existe" });
  }
  // Gravada; é a conferência ao reabrir que a descarta.
  expect((await guardada())?.rota).toBe("/conversa?id=conversa-que-nao-existe");
  await using app = await montarApp(servidor, "/", LIGADA);
  await expect.element(page.getByRole("heading", { name: "O que você precisa hoje?" })).toBeVisible();
  expect(app.roteador.state.location.pathname).toBe("/");
});

it("a revisão volta sem o compacto=1; apagada, sai da rota e do painel com “Esta revisão foi apagada”", async () => {
  const compacta = vi.fn(async (ligar: boolean) => ligar);
  const janela: JanelaDesktop = { ...ponteTeste().janela, plataforma: "darwin", compacta };
  window.simplifica = ponteTeste({
    conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
    escolherDocx: async () => servidor.ppc,
    abrirDocumento: async () => {},
    janela,
  });
  await page.viewport(1280, 900);
  let lista: string;
  {
    await using app = await montarApp(servidor, "/revisao-ppc", LIGADA);
    await page.getByRole("button", { name: "Escolher o PPC" }).click();
    // O nome do arquivo já aparece na leitura, antes de a lista existir: o sinal é a revisão no resultado
    // (com os testes em paralelo, a leitura passa de um segundo), e a URL a acompanha logo depois.
    await revisaoNoResultado(app.contexto.revisao);
    await expect.poll(() => app.roteador.state.location.search.id).toBeTypeOf("string");
    lista = String(app.roteador.state.location.search.id);
    // O PPC no painel (a trilha guarda o link `ifpr://revisao-ppc/<lista>/…`), e a coluna ao lado do Word.
    await page.getByRole("button", { name: "Ver PPC" }).click();
    await expect.element(page.getByRole("article", { name: "PPC em revisão" })).toBeVisible();
    await page.getByRole("button", { name: "Corrigir no Word" }).click();
    await vi.waitFor(() => expect(app.roteador.state.location.search).toMatchObject({ compacto: 1 }));
  }

  {
    // Reaberto: a revisão, na janela inteira; o PPC continua na trilha do painel.
    await using app = await montarApp(servidor, "/", LIGADA);
    await expect.poll(() => app.roteador.state.location.pathname).toBe("/revisao-ppc");
    expect(app.roteador.state.location.search).toEqual({ id: lista });
    expect(
      app.contexto.painel.obter().historico.links.some((link) => link.startsWith(`ifpr://revisao-ppc/${lista}/`)),
    ).toBe(true);
    await expect.element(page.getByText("PPC de teste.docx", { exact: true })).toBeVisible();
    // A revisão é apagada por fora desta tela (outra janela, um teste): a continuidade só vê ao reabrir.
    await app.contexto.api.chamar((cliente) => cliente["revisaoPpc.apagarLista"]({ lista }));
  }

  await using app = await montarApp(servidor, "/", LIGADA);
  await expect.element(page.getByText("Esta revisão foi apagada")).toBeVisible();
  expect(app.roteador.state.location.pathname).toBe("/");
  expect(app.contexto.painel.obter().historico.links.some((link) => link.startsWith("ifpr://revisao-ppc/"))).toBe(
    false,
  );
  expect(achadosDaTela()).toEqual([]);
  await page.getByRole("button", { name: "Fechar o aviso" }).click();
  await expect.element(page.getByText("Esta revisão foi apagada")).not.toBeInTheDocument();
});

it("'Qual é o curso?' com a conversa ao lado e o PPC no Ler: o painel segue a lista nova, e reabrir não diz que ela foi apagada", async () => {
  window.simplifica = ponteTeste({
    conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
    escolherDocx: async () => servidor.ppc,
  });
  await page.viewport(1440, 900);
  let nova: string;
  {
    await using app = await montarApp(servidor, "/revisao-ppc", LIGADA);
    const { painel } = app.contexto;
    await page.getByRole("button", { name: "Escolher o PPC" }).click();
    await revisaoNoResultado(app.contexto.revisao);
    await expect.poll(() => app.roteador.state.location.search.id).toBeTypeOf("string");
    const antiga = String(app.roteador.state.location.search.id);
    await page.getByRole("button", { name: "Ver PPC" }).click();
    await expect.element(page.getByRole("article", { name: "PPC em revisão" })).toBeVisible();
    await page.getByRole("button", { name: /O AEE aparece como componente/ }).click();
    await page.getByRole("button", { name: "Conversar sobre esta pendência" }).click();
    const aoLado = painelAoLado();
    const caixa = aoLado.getByRole("textbox", { name: "Pergunta à IA" });
    await caixa.fill("O que falta no AEE?");
    await userEvent.keyboard("{Enter}");
    const mensagens = aoLado.getByRole("log", { name: "Mensagens" });
    await mensagens.getByRole("button", { name: "Permitir" }).click();
    await expect.element(mensagens.getByRole("button", { name: "Res. CNE/CP nº 1/2021" })).toBeVisible();

    // "Qual é o curso?": a lista refeita ganha outro id, e a antiga sai.
    await page.getByRole("combobox", { name: "Qual é o curso?" }).fill("enferm");
    await page.getByRole("option", { name: /Técnico em Enfermagem/ }).click();
    await page.getByRole("button", { name: "Conferir com este curso" }).click();
    await expect.poll(() => app.roteador.state.location.search.id).not.toBe(antiga);
    nova = String(app.roteador.state.location.search.id);
    expect(painel.obter().conversa.origem?.chave).toBe(`revisao-ppc:${nova}`);
    const links = [...painel.obter().historico.links, ...painel.obter().marcados];
    expect(links.some((link) => link.startsWith(`ifpr://revisao-ppc/${nova}/`))).toBe(true);
    expect(links.some((link) => link.startsWith(`ifpr://revisao-ppc/${antiga}/`))).toBe(false);

    // A pergunta seguinte, escrita direto na aba, sai pela revisão nova (a antiga não existe mais).
    await caixa.fill("E com o curso certo?");
    await userEvent.keyboard("{Enter}");
    await expect.element(mensagens.getByText("E com o curso certo?")).toBeVisible();
    await expect.element(mensagens.getByRole("button", { name: "Res. CNE/CP nº 1/2021" }).nth(1)).toBeVisible();
    await expect.element(aoLado.getByText(/não existe mais/)).not.toBeInTheDocument();
  }

  // Reaberto: a revisão nova e a conversa ao lado dela, sem "Esta revisão foi apagada".
  await using app = await montarApp(servidor, "/", LIGADA);
  await expect.poll(() => app.roteador.state.location.search).toEqual({ id: nova });
  await expect.element(page.getByRole("heading", { name: "Revisar um PPC" })).toBeVisible();
  await expect.element(page.getByText("Esta revisão foi apagada")).not.toBeInTheDocument();
  expect(app.contexto.painel.obter().conversa.origem?.chave).toBe(`revisao-ppc:${nova}`);
  expect(achadosDaTela()).toEqual([]);
});

it("a rolagem do documento fica lembrada ao voltar de outra tela", async () => {
  await page.viewport(1280, 800);
  await using app = await montarApp(servidor, `/explorar/ver?link=${encodeURIComponent(NORMA_2026)}`);
  const rolagem = () => document.querySelector<HTMLElement>("[data-rolagem-explorar]");
  await expect.poll(() => rolagem()!.scrollHeight - rolagem()!.clientHeight).toBeGreaterThan(600);
  rolagem()!.scrollTop = 500;
  rolagem()!.dispatchEvent(new Event("scroll"));

  // Outra tela fora do Explorar (a rolagem dele sai da página), e de volta pelo histórico.
  await app.roteador.navigate({ to: "/" });
  await expect.element(page.getByRole("heading", { name: "O que você precisa hoje?" })).toBeVisible();
  expect(rolagem()).toBeNull();
  app.roteador.history.back();
  await expect.poll(() => app.roteador.state.location.pathname).toBe("/explorar/ver");
  await expect.poll(() => rolagem()?.scrollTop).toBe(500);

  // Outra norma começa do topo.
  await app.roteador.navigate({ to: "/explorar/ver", search: { link: "ifpr://norma/br/cne-cp/res/2021/1" } });
  await expect.poll(() => rolagem()?.scrollTop).toBe(0);
});
