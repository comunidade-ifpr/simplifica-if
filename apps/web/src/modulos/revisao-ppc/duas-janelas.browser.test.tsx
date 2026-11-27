/**
 * A mesma revisão em duas janelas do desktop ("Várias janelas", `docs/plans/multitarefa.md`): cada janela tem
 * a sua conexão com o `apps/server` de verdade, e o servidor não muda. Uma janela (a tela) e outra conexão (o
 * `ControleRevisao` de uma segunda janela) acompanham a revisão no Word; o "Feito" de uma chega à outra pelo
 * `revisaoPpc.acompanharLista`, nos dois sentidos. A revisão apagada numa janela sai da outra, que avisa.
 */
import { afterEach, beforeAll, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import type { ServidorTeste } from "../../../vite.config.ts";
import { achadosDaTela, iniciarServidorTeste, montarApp } from "../../../test/navegador.tsx";
import { ponteTeste } from "../../../test/ponte.ts";
import { inicializar } from "../../inicializar.ts";

let servidor: ServidorTeste;

beforeAll(async () => {
  servidor = await iniciarServidorTeste({ atrasoLogin: 120 });
});

afterEach(() => {
  delete window.simplifica;
});

it("duas janelas na mesma revisão acompanhada: o Feito de uma aparece na outra", async () => {
  window.simplifica = ponteTeste({
    conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
    escolherDocx: async () => servidor.ppc,
    abrirDocumento: async () => {},
  });
  await page.viewport(1280, 900);
  await using app = await montarApp(servidor, "/revisao-ppc");
  await page.getByRole("button", { name: "Escolher o PPC" }).click();
  const aee = page.getByRole("button", { name: /O AEE aparece como componente/ });
  await expect.element(aee).toBeVisible();
  await page.getByRole("button", { name: "Acompanhar no Word" }).click();
  await page.getByRole("button", { name: "Voltar ao app inteiro" }).click();
  await expect.element(page.getByRole("region", { name: "Acompanhamento no Word" })).toBeVisible();
  const lista = app.contexto.revisao.obter().lista;
  expect(lista?.arquivoAcompanhado).not.toBeNull();

  // A segunda janela: outra conexão, que abre a mesma revisão (e a acompanha, porque ela está no Word).
  const segunda = await inicializar(
    { tipo: "navegador", credenciais: { urlServidor: servidor.urlServidor, token: servidor.token } },
    undefined,
    { continuidade: false },
  );
  try {
    const revisao = segunda.contexto.revisao;
    await revisao.abrir(lista!.id);
    const resolvidasNaSegunda = () =>
      revisao
        .obter()
        .lista?.pendencias.filter((p) => p.situacao === "resolvida")
        .map((p) => p.chave) ?? [];
    await vi.waitFor(() => expect(revisao.obter().lista?.id).toBe(lista!.id));
    expect(resolvidasNaSegunda()).toEqual([]);

    // A primeira marca Feito; a segunda vê.
    await aee.click();
    await page.getByRole("button", { name: "Feito", exact: true }).click();
    await expect.element(page.getByText(/^1 de \d+ feitas?$/).first()).toBeInTheDocument();
    await vi.waitFor(() => expect(resolvidasNaSegunda()).toHaveLength(1));

    // A segunda desfaz; a tela da primeira volta a zero.
    await revisao.marcar(resolvidasNaSegunda()[0]!, "aberta");
    await expect.element(page.getByText(/^0 de \d+ feitas?$/).first()).toBeInTheDocument();
    expect(app.contexto.revisao.obter().lista?.pendencias.every((p) => p.situacao === "aberta")).toBe(true);
  } finally {
    await segunda.encerrar();
  }
});

it("a revisão apagada em outra janela: esta sai dela, com o aviso, e o PPC sai do painel", async () => {
  window.simplifica = ponteTeste({
    conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
    escolherDocx: async () => servidor.ppc,
    abrirDocumento: async () => {},
  });
  await page.viewport(1280, 900);
  await using app = await montarApp(servidor, "/revisao-ppc");
  await page.getByRole("button", { name: "Escolher o PPC" }).click();
  await expect.element(page.getByRole("button", { name: /O AEE aparece como componente/ })).toBeVisible();
  await page.getByRole("button", { name: "Acompanhar no Word" }).click();
  await page.getByRole("button", { name: "Voltar ao app inteiro" }).click();
  await expect.element(page.getByRole("region", { name: "Acompanhamento no Word" })).toBeVisible();
  const lista = app.contexto.revisao.obter().lista!.id;
  await page.getByRole("button", { name: "Mais ações do documento" }).click();
  await page.getByRole("menuitem", { name: "Abrir o PPC ao lado" }).click();
  await expect.element(page.getByRole("article", { name: "PPC em revisão" })).toBeVisible();

  const segunda = await inicializar(
    { tipo: "navegador", credenciais: { urlServidor: servidor.urlServidor, token: servidor.token } },
    undefined,
    { continuidade: false },
  );
  try {
    await segunda.contexto.api.chamar((c) => c["revisaoPpc.apagarLista"]({ lista }));
  } finally {
    await segunda.encerrar();
  }
  await expect.element(page.getByText("Esta revisão foi apagada.")).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Escolher o PPC" })).toBeVisible();
  const { painel } = app.contexto;
  expect(painel.obter().historico.links.some((link) => link.startsWith(`ifpr://revisao-ppc/${lista}/`))).toBe(false);
  await expect.element(page.getByRole("article", { name: "PPC em revisão" })).not.toBeInTheDocument();
  expect(achadosDaTela()).toEqual([]);
});
