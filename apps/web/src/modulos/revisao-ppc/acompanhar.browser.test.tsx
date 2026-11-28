/**
 * "Acompanhar no Word" no Chromium, conectado por RPC ao `apps/server` de verdade (`test/servidor-teste.ts`):
 * a cópia comentada abre no Word (a ponte simulada), o Word salva a versão corrigida por cima dela
 * (`salvarNoWord`) e a lista se atualiza sozinha, pelo vigia do servidor e sem IA, com a linha do que mudou e
 * a pendência resolvida riscada e realçada; "Abrir no Word" passa a abrir o arquivo acompanhado.
 */
import { afterEach, beforeAll, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
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

it("Acompanhar no Word: o salvamento é conferido sem IA, e a lista mostra o que mudou", async () => {
  const abrirDocumento = vi.fn(async (_caminho: string) => {});
  window.simplifica = ponteTeste({
    conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
    escolherDocx: async () => servidor.ppc,
    abrirDocumento,
  });
  await page.viewport(1280, 900);
  await using _app = await montarApp(servidor, "/revisao-ppc");
  await page.getByRole("button", { name: "Escolher o PPC" }).click();
  await expect.element(page.getByText("PPC de teste.docx", { exact: true })).toBeVisible();
  const aee = page.getByRole("button", { name: /O AEE aparece como componente/ });
  await expect.element(aee).toBeVisible();

  // "Corrigir no Word": a cópia comentada abre no Word, e a linha do acompanhamento aparece.
  await page.getByRole("button", { name: "Corrigir no Word" }).click();
  const copiaDaRevisao =
    /\/PPC de teste - revisão prévia \(Simplifica IF\) \d{4}-\d{2}-\d{2} \d{2}h\d{2}( \(\d+\))?\.docx$/;
  await vi.waitFor(() => expect(abrirDocumento).toHaveBeenCalledWith(expect.stringMatching(copiaDaRevisao)));
  const copia = abrirDocumento.mock.calls.at(-1)![0] as string;
  // No desktop, a revisão vira a coluna ao lado do Word (`compacta.browser.test.tsx`); ⤢ volta à tela inteira.
  await page.getByRole("button", { name: "Voltar ao app inteiro" }).click();
  const acompanhamento = page.getByRole("region", { name: "Acompanhamento no Word" });
  await expect.element(acompanhamento.getByText(/^Acompanhando “PPC de teste - revisão prévia/)).toBeVisible();
  await expect.element(acompanhamento.getByText("Salve no Word para conferir.")).toBeVisible();
  // Já acompanhando, o botão fica no cabeçalho, para voltar à coluna ao lado do Word.
  await expect.element(page.getByRole("button", { name: "Corrigir no Word" })).toBeVisible();

  // O Word salva a versão sem o AEE na matriz. Sem a volta à janela: quem vê o salvamento é o vigia do servidor
  // (o `fs.watch` da pasta, com a espera de 2 s).
  await salvarNoWord(servidor.ppcSalvo, copia);
  const linha = acompanhamento.getByRole("status");
  await vi.waitFor(() => expect(linha.element().textContent).toMatch(/^Salvo às \d{2}:\d{2} · 1 ponto resolvido/), {
    timeout: 20_000,
  });
  // A pendência que o salvamento resolveu sai riscada, com o realce.
  await expect.element(aee.getByText("Resolvido ao salvar")).toBeVisible();
  await vi.waitFor(() => expect(aee.element().querySelector(".line-through")).not.toBeNull());
  // O arquivo revisado continua o mesmo, no cabeçalho.
  await expect.element(page.getByText("PPC de teste.docx", { exact: true })).toBeVisible();

  // "Abrir cópia comentada" no ⋯ abre o arquivo acompanhado, sem gravar outra cópia.
  abrirDocumento.mockClear();
  await page.getByRole("button", { name: "Mais ações do documento" }).click();
  await page.getByRole("menuitem", { name: "Abrir cópia comentada" }).click();
  await vi.waitFor(() => expect(abrirDocumento).toHaveBeenCalledWith(copia));
  expect(achadosDaTela()).toEqual([]);
});
