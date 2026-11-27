/**
 * A moldura com o leitor aberto num documento longo: a janela nunca rola e o cabeçalho fica no topo;
 * quem rola é cada coluna (a lista de conversas, a conversa, o painel do leitor, a página do Explorar).
 * O destaque do trecho tem o anúncio oculto `sr-only` (posição absoluta): sem um ancestral posicionado
 * que o contenha, ele escapava da área de rolagem do leitor, esticava a página, e a rolagem até o
 * trecho levava a janela junto, com o cabeçalho para cima.
 */
import { beforeAll, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import type { ServidorTeste } from "../../vite.config.ts";
import { iniciarServidorTeste, montarApp } from "../../test/navegador.tsx";

let servidor: ServidorTeste;

beforeAll(async () => {
  servidor = await iniciarServidorTeste();
});

/** Com `VITE_CAPTURAS=<pasta dentro do checkout>`, grava a tela; sem a variável, nada. */
const CAPTURAS = import.meta.env.VITE_CAPTURAS as string | undefined;
async function capturar(nome: string) {
  if (CAPTURAS === undefined || CAPTURAS === "") return;
  // `target: "page"`, do provedor do Playwright e fora do tipo público: a tela como está, com a rolagem
  // da janela (sem ele, sai o `body` inteiro, do topo).
  const opcoes: Parameters<typeof page.screenshot>[0] & { readonly target: "page" } = {
    path: `${CAPTURAS}/${nome}.png`,
    target: "page",
  };
  await page.screenshot(opcoes);
}

/** A janela não rola: nem a roda do mouse sobre a tela (aqui, rolar a janela até o fim) a tira do lugar. */
function conferirJanelaParada() {
  const janela = document.scrollingElement!;
  janela.scrollTop = janela.scrollHeight;
  expect(janela.scrollHeight).toBeLessThanOrEqual(window.innerHeight);
  expect(janela.scrollTop).toBe(0);
  expect(document.querySelector("header")!.getBoundingClientRect().top).toBe(0);
}

it.each([
  { largura: 1280, altura: 800 },
  { largura: 800, altura: 600 },
])(
  "com o leitor aberto na conversa ($largura px), a janela não rola e o painel rola sozinho",
  async ({ largura, altura }) => {
    await page.viewport(largura, altura);
    await using _app = await montarApp(servidor, "/");

    await page
      .getByRole("textbox", { name: "O que você precisa hoje?" })
      .fill("Abra no leitor o que a DCN pede sobre egressos");
    await page.getByRole("button", { name: "Enviar" }).click();
    await page.getByRole("button", { name: "Res. CNE/CP nº 2/2026, art. 28, XVIII" }).click();
    const painel = page.getByRole("complementary", { name: "Painel ao lado" });
    await expect
      .poll(() => document.getElementById("painel-art28-xviii")?.querySelector("mark.trecho-citado"))
      .toBeTruthy();
    // a rolagem até o trecho já aconteceu
    await expect.poll(() => painel.element().querySelector(".overflow-y-auto")!.scrollTop).toBeGreaterThan(0);
    // a roda do mouse sobre a conversa, como no relato: a janela não pode sair do lugar
    window.scrollBy(0, 300);
    if (largura === 1280) await capturar("leitor-overflow");
    conferirJanelaParada();

    // O painel rola até o fim, e a janela continua parada.
    const rolagem = painel.element().querySelector<HTMLElement>(".overflow-y-auto")!;
    expect(rolagem.scrollHeight).toBeGreaterThan(rolagem.clientHeight);
    rolagem.scrollTop = rolagem.scrollHeight;
    await expect.poll(() => rolagem.scrollTop + rolagem.clientHeight).toBeGreaterThanOrEqual(rolagem.scrollHeight - 1);
    conferirJanelaParada();
    // o painel cabe na janela
    expect(painel.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
  },
);

it("com a norma aberta no Explorar, a janela não rola e a página do Explorar rola sozinha", async () => {
  await page.viewport(1280, 800);
  await using _app = await montarApp(
    servidor,
    `/explorar/ver?link=${encodeURIComponent("ifpr://norma/br/cne-cp/res/2026/2#art28-xviii")}`,
  );
  await expect.poll(() => document.getElementById("art28-xviii")?.querySelector("mark.trecho-citado")).toBeTruthy();
  const rolagem = document.querySelector<HTMLElement>("[data-rolagem-explorar]")!;
  await expect.poll(() => rolagem.scrollTop).toBeGreaterThan(0);
  conferirJanelaParada();
  rolagem.scrollTop = rolagem.scrollHeight;
  conferirJanelaParada();
});
