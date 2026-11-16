/**
 * "Analisar um PPC" no Chromium, contra o `apps/server` de verdade (o Worker da revisão prévia roda de
 * fato): do botão no Início à lista de pendências por tema e aos botões da cópia comentada, com a
 * ponte do desktop simulada (o diálogo devolve o PPC sintético do servidor de teste).
 */
import { afterAll, beforeAll, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import type { ServidorTeste } from "../vite.config.ts";
import { iniciarServidorTeste, montarApp, pararServidoresTeste } from "../test/navegador.tsx";
import type { PonteDesktop } from "./ponte-desktop.ts";

let servidor: ServidorTeste;

beforeAll(async () => {
  servidor = await iniciarServidorTeste(0);
});

afterAll(async () => {
  delete window.simplifica;
  await pararServidoresTeste();
});

it("do Início à lista de pendências e à cópia comentada", async () => {
  const abrirDocumento = vi.fn(async (_caminho: string) => {});
  const mostrarNaPasta = vi.fn(async (_caminho: string) => {});
  window.simplifica = {
    conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
    escolherDocx: async () => servidor.ppc,
    abrirDocumento,
    mostrarNaPasta,
  } satisfies PonteDesktop;
  await using _app = await montarApp(servidor);

  await page.getByRole("link", { name: "Analisar um PPC" }).click();
  await expect.element(page.getByRole("heading", { name: "Analisar um PPC" })).toBeVisible();
  await page.getByRole("button", { name: "Escolher o PPC (.docx)…" }).click();

  // O resumo: contagem em palavras, o curso, o que foi e o que não foi conferido, a cópia.
  const resultado = page.getByRole("heading", { name: /precisam? de ajuste/ });
  await expect.element(resultado).toBeVisible();
  await expect.element(page.getByText(/critérios conferidos automaticamente; os demais exigem leitura/)).toBeVisible();
  await expect.element(page.getByText(/Não identificamos o curso no Catálogo Nacional/)).toBeVisible();
  await expect.element(page.getByText("PPC de teste - revisão prévia (Simplifica IF).docx")).toBeVisible();

  // Os temas na ordem do parecer, com estados em linguagem comum.
  const temas = [...document.querySelectorAll("section[aria-label] > h3")].map((h) => h.textContent);
  expect(temas.indexOf("Matriz e estrutura curricular")).toBeLessThan(temas.indexOf("Fundamentos legais e normativos"));
  const aee = page.getByRole("region", { name: "Acesso, permanência, AEE e inclusão" });
  await expect.element(aee.getByText("Precisa de ajuste")).toBeVisible();
  await expect.element(aee.getByText("“Atendimento Educacional Especializado”", { exact: false })).toBeVisible();
  await expect.element(aee.getByText("Comentado no trecho, na cópia do documento.")).toBeVisible();
  expect(document.body.innerText).not.toMatch(/nao_atende|a_conferir|ifpr:\/\//);

  await page.getByRole("button", { name: "Abrir o documento comentado" }).click();
  await page.getByRole("button", { name: "Mostrar na pasta" }).click();
  const comentado = `${servidor.pasta}/PPC de teste - revisão prévia (Simplifica IF).docx`;
  expect(abrirDocumento).toHaveBeenCalledWith(comentado);
  expect(mostrarNaPasta).toHaveBeenCalledWith(comentado);
});

it("arquivo que não é DOCX: a mensagem do servidor, em português", async () => {
  window.simplifica = {
    conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
    escolherDocx: async () => `${servidor.pasta}/não existe.docx`,
  } satisfies PonteDesktop;
  await using _app = await montarApp(servidor, "/revisao-ppc");
  await page.getByRole("button", { name: "Escolher o PPC (.docx)…" }).click();
  await expect.element(page.getByText("O arquivo não foi encontrado ou não pode ser lido.")).toBeVisible();
});
