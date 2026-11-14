/**
 * O app inteiro no Chromium, conectado por RPC ao `apps/server` de verdade com os drivers de
 * demonstração (`test/servidor-teste.ts`, num processo Node): Início com os três providers, instalar e
 * entrar, e a conversa com aprovação, link `ifpr://` no painel de leitura, interromper e nova conversa.
 */
import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import type { ServidorTeste } from "../vite.config.ts";
import { iniciarServidorTeste, montarApp, pararServidoresTeste } from "../test/navegador.tsx";

let servidor: ServidorTeste;

beforeAll(async () => {
  servidor = await iniciarServidorTeste(1500);
});

afterAll(async () => {
  await pararServidoresTeste();
});

/** Textos em inglês dos componentes copiados do T3 e do roteador que não podem aparecer na tela. */
const TEXTOS_EM_INGLES = /\b(Loading|Close|Cancel|Submit|Not Found|Something went wrong|Back)\b/;

function semIngles() {
  const rotulos = [...document.querySelectorAll("[aria-label],[title],[placeholder]")].flatMap((elemento) =>
    ["aria-label", "title", "placeholder"].map((atributo) => elemento.getAttribute(atributo) ?? ""),
  );
  expect([document.body.innerText, ...rotulos].join("\n")).not.toMatch(TEXTOS_EM_INGLES);
}

it("Início: detecta os três providers, instala e entra", async () => {
  await using _app = await montarApp(servidor);

  await expect.element(page.getByRole("status").getByText("Conectado")).toBeVisible();
  const claude = page.getByRole("region", { name: "Claude" });
  await expect.element(claude.getByText("Conectado")).toBeVisible();
  await expect.element(claude.getByText("max")).toBeVisible();
  await expect.element(claude.getByText("2.1.30")).toBeVisible();

  // Codex: não instalado; "Instalar" mostra a barra de progresso e termina instalado.
  const codex = page.getByRole("region", { name: "ChatGPT (Codex)" });
  await expect.element(codex.getByText("Não instalado")).toBeVisible();
  await codex.getByRole("button", { name: "Instalar" }).click();
  await expect.element(codex.getByRole("progressbar")).toBeInTheDocument();
  await expect.element(codex.getByText("Instalação concluída")).toBeVisible();
  await expect.element(codex.getByText("Instalado", { exact: true })).toBeVisible();
  await expect.element(codex.getByRole("button", { name: "Entrar" })).toBeVisible();

  // Antigravity: "Entrar" mostra o link da página de login do Google enquanto espera, e conclui.
  const gemini = page.getByRole("region", { name: "Gemini (Antigravity)" });
  await expect.element(gemini.getByText("Sem login")).toBeVisible();
  await gemini.getByRole("button", { name: "Entrar" }).click();
  const link = gemini.getByRole("link", { name: "Abrir a página de login" });
  await expect.element(link).toBeVisible();
  await expect.element(link).toHaveAttribute("href", expect.stringMatching(/^https:\/\/accounts\.google\.com\//));
  await expect.element(gemini.getByText("Login concluído")).toBeVisible();
  await expect.element(gemini.getByText("Conectado")).toBeVisible();

  semIngles();
});

it("Conversa: aprovação, link ifpr:// no painel, interromper e nova conversa", async () => {
  await using _app = await montarApp(servidor, "/conversa");

  await page.getByRole("radio", { name: "Claude" }).click();
  await page.getByLabelText("Pasta de trabalho").fill(servidor.pasta);
  await page.getByRole("button", { name: "Começar conversa" }).click();
  const mensagem = page.getByRole("textbox", { name: "Mensagem" });
  await expect.element(mensagem).toBeVisible();

  // Com "escrev", o provider de demonstração pede aprovação.
  await mensagem.fill("Pode escrever um resumo da DCN?");
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByText("Pode escrever um resumo da DCN?")).toBeVisible();
  await expect.element(page.getByText("Buscar norma")).toBeVisible();
  await expect.element(page.getByText("A IA pede permissão: Escrever arquivo")).toBeVisible();
  await page.getByRole("button", { name: "Permitir" }).click();
  await expect.element(page.getByText("Permitido.")).toBeVisible();

  // O link ifpr:// da resposta abre o painel de leitura, com o texto lido da base.
  const citacao = page.getByRole("button", { name: "Res. CNE/CP nº 1/2021" });
  await expect.element(citacao).toBeVisible();
  await citacao.click();
  const painel = page.getByRole("complementary", { name: "Painel de leitura" });
  await expect.element(painel.getByText("ifpr://norma/br/cne-cp/res/2021/1")).toBeVisible();
  await expect.element(painel.getByRole("article", { name: "Norma" })).toBeVisible();
  semIngles();
  await painel.getByRole("button", { name: "Fechar o painel de leitura" }).click();
  await expect.element(painel).not.toBeInTheDocument();

  // Uma resposta que não termina: "Interromper" encerra o turno.
  await mensagem.fill("Uma resposta demorada");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect.element(page.getByText(/Esta resposta vai demorar/)).toBeVisible();
  await page.getByRole("button", { name: "Interromper" }).click();
  await expect.element(page.getByText("Resposta interrompida.")).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Enviar" })).toBeVisible();

  await page.getByRole("button", { name: "Nova conversa" }).click();
  await expect.element(page.getByRole("button", { name: "Começar conversa" })).toBeVisible();
  await expect.element(page.getByLabelText("Pasta de trabalho")).toHaveValue(servidor.pasta);
});
