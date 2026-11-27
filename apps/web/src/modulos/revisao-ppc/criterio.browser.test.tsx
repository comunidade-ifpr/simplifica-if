/**
 * A ficha do critério no Chromium (`docs/plans/tarefas.md`, "Os critérios são da tarefa, não da base"),
 * com o app inteiro conectado ao `apps/server` de verdade (o servidor de teste tem a ficha do AEE,
 * CT-CURR-22): aberta no painel pelo código da pendência, pela marca da régua (também a de um critério sem
 * pendência) e pelo "Detalhes"; o "Neste PPC" com "Ir à pendência"; as normas com o selo de vigência; e
 * a revisão apagada, que tira os links de critério dela do painel. O "Neste PPC" acompanha a pendência
 * marcada como feita, e "Ir à pendência" vale de outra tela, sem a revisão aberta e na coluna compacta.
 */
import type { JanelaDesktop } from "@simplifica-if/contratos-app/ponte";
import { afterEach, beforeAll, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import type { ServidorTeste } from "../../../vite.config.ts";
import { achadosDaTela, iniciarServidorTeste, montarApp } from "../../../test/navegador.tsx";
import { ponteTeste } from "../../../test/ponte.ts";

let servidor: ServidorTeste;

beforeAll(async () => {
  servidor = await iniciarServidorTeste({ atrasoLogin: 120 });
});

afterEach(() => {
  delete window.simplifica;
});

function semIngles() {
  expect(achadosDaTela()).toEqual([]);
}

const painelAoLado = () => page.getByRole("complementary", { name: "Painel ao lado" });

it("a ficha do critério: pela pendência, pela régua e pelo Detalhes; Ir à pendência; some com a revisão apagada", async () => {
  window.simplifica = ponteTeste({
    conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
    escolherDocx: async () => servidor.ppc,
  });
  await page.viewport(1440, 900);
  await using app = await montarApp(servidor, "/revisao-ppc");
  await page.getByRole("button", { name: "Escolher o PPC" }).click();
  const linha = page.getByRole("button", { name: /O AEE aparece como componente/ });
  await linha.click();

  // O código da pendência abre a ficha no painel; a revisão fica na tela.
  await page.getByRole("button", { name: "CT-CURR-22 · O que este critério confere" }).click();
  const painel = painelAoLado();
  const ficha = painel.getByRole("article", { name: "Critério da revisão" });
  await expect
    .element(
      ficha.getByRole("heading", { name: "AEE não incorporado como componente curricular da matriz ou do histórico" }),
    )
    .toBeVisible();
  await expect.element(ficha.getByText("Critério da tarefa “Revisar um PPC”")).toBeVisible();
  await expect.element(ficha.getByText(/Bloqueia a submissão/)).toBeVisible();
  await expect.element(ficha.getByText(/o app confere sozinho, sem IA\./)).toBeVisible();
  const neste = ficha.getByRole("region", { name: "Neste PPC" });
  await expect.element(neste.getByText("Para corrigir")).toBeVisible();
  await expect.element(neste.getByText(/^O AEE aparece como componente/)).toBeVisible();
  await expect.element(ficha.getByText("O que confere")).toBeVisible();
  await expect.element(ficha.getByText("Conta como atendido")).toBeVisible();
  await expect.element(ficha.getByText(/Não atendido$/)).toBeVisible();
  await expect.element(ficha.getByText("Quando fica “a conferir”")).toBeVisible();
  // As normas do "Por que" são da base: abrem no Ler.
  const porQue = ficha.getByRole("region", { name: "Por que" });
  await expect.element(porQue.getByRole("button", { name: /^Nota/ })).toBeVisible();
  const lista = app.contexto.revisao.obter().lista!.id;
  expect(app.contexto.painel.obter().historico.links).toContain(`ifpr://revisao-ppc/${lista}/criterio/CT-CURR-22`);
  expect(page.getByRole("heading", { name: "Revisar um PPC" }).element()).toBeTruthy();
  semIngles();

  // "Ir à pendência" volta à linha dela, aberta, com o foco.
  await neste.getByRole("button", { name: "Ir à pendência" }).click();
  await expect.element(linha).toHaveAttribute("aria-expanded", "true");
  await expect.element(linha).toHaveFocus();

  // A marca da régua abre a ficha também do critério sem pendência (o servidor de teste tem a CT-CURR-12).
  const regua = page.getByRole("group", { name: /^Régua de critérios\./ });
  await regua.getByRole("button", { name: /^CT-CURR-12 · .*: ainda não lido\. Ver o critério$/ }).click();
  await expect
    .element(painel.getByRole("article", { name: "Critério da revisão" }).getByText(/^CT-CURR-12$/))
    .toBeVisible();
  await expect.element(painel.getByRole("region", { name: "Neste PPC" }).getByText("Ainda não lido")).toBeVisible();
  await expect.element(painel.getByRole("button", { name: "Ir à pendência" })).not.toBeInTheDocument();
  semIngles();

  // O "Detalhes" da pendência: o critério pelo nome abre a ficha.
  await page.getByRole("button", { name: "Mais ações", exact: true }).click();
  await page.getByRole("menuitem", { name: "Detalhes" }).click();
  await page
    .getByRole("group", { name: "Detalhes" })
    .getByRole("button", { name: "AEE não incorporado como componente curricular da matriz ou do histórico" })
    .click();
  await expect
    .element(painel.getByRole("article", { name: "Critério da revisão" }).getByText(/^CT-CURR-22$/))
    .toBeVisible();

  // A revisão apagada leva junto os links de critério dela.
  await page.getByRole("button", { name: "Mais ações do documento" }).click();
  await page.getByRole("menuitem", { name: "Apagar esta revisão" }).click();
  await page.getByRole("button", { name: "Apagar a revisão" }).click();
  await expect.element(page.getByRole("button", { name: "Escolher o PPC" })).toBeVisible();
  expect(
    app.contexto.painel.obter().historico.links.some((link) => link.startsWith(`ifpr://revisao-ppc/${lista}/`)),
  ).toBe(false);
  expect(app.contexto.painel.obter().marcados.some((link) => link.startsWith(`ifpr://revisao-ppc/${lista}/`))).toBe(
    false,
  );
});

it("Neste PPC: a pendência feita; Ir à pendência de outra tela, sem a revisão aberta e na coluna compacta", async () => {
  const compacta = vi.fn(async (ligar: boolean) => ligar);
  const janela: JanelaDesktop = { ...ponteTeste().janela, compacta };
  window.simplifica = ponteTeste({
    conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
    escolherDocx: async () => servidor.ppc,
    abrirDocumento: async () => {},
    janela,
  });
  await page.viewport(1440, 900);
  await using app = await montarApp(servidor, "/revisao-ppc");
  await page.getByRole("button", { name: "Escolher o PPC" }).click();
  const linha = page.getByRole("button", { name: /O AEE aparece como componente/ });
  await linha.click();
  const lista = app.contexto.revisao.obter().lista!.id;

  // Marcada como feita com a ficha aberta, a pendência passa a dizer "Feito" no "Neste PPC".
  await page.getByRole("button", { name: "CT-CURR-22 · O que este critério confere" }).click();
  const neste = painelAoLado().getByRole("region", { name: "Neste PPC" });
  await expect.element(neste.getByText("Para corrigir")).toBeVisible();
  await expect.element(neste.getByText("· Feito")).not.toBeInTheDocument();
  await page.getByRole("button", { name: "Feito", exact: true }).click();
  await expect.element(neste.getByText("· Feito")).toBeVisible();
  semIngles();

  // De outra tela, "Ir à pendência" volta à revisão, com a pendência aberta e o foco nela.
  await app.roteador.navigate({ to: "/" });
  await expect.element(linha).not.toBeInTheDocument();
  await neste.getByRole("button", { name: "Ir à pendência" }).click();
  await vi.waitFor(() => expect(app.roteador.state.location.pathname).toBe("/revisao-ppc"));
  await expect.element(linha).toHaveAttribute("aria-expanded", "true");
  await expect.element(linha).toHaveFocus();

  // Sem a revisão aberta (outra tela, a revisão fechada), ela abre a do critério.
  app.contexto.revisao.sair();
  await app.roteador.navigate({ to: "/" });
  await neste.getByRole("button", { name: "Ir à pendência" }).click();
  await vi.waitFor(() => expect(app.roteador.state.location.search).toMatchObject({ id: lista }));
  await expect.element(linha).toHaveAttribute("aria-expanded", "true");
  await expect.element(linha).toHaveFocus();

  // Na coluna compacta, o painel que a cobre se fecha, e a linha da coluna fica aberta, com o foco.
  app.contexto.revisao.alternarPendencia(app.contexto.revisao.obter().aberta!);
  app.contexto.painel.fechar();
  await page.getByRole("button", { name: "Acompanhar no Word" }).click();
  await vi.waitFor(() => expect(app.roteador.state.location.search).toMatchObject({ compacto: 1 }));
  await page.viewport(380, 760);
  app.contexto.painel.abrirLink(`ifpr://revisao-ppc/${lista}/criterio/CT-CURR-22`);
  await neste.getByRole("button", { name: "Ir à pendência" }).click();
  await expect.element(painelAoLado()).not.toBeInTheDocument();
  const naColuna = page.getByRole("button", { name: /O AEE aparece como componente/ });
  await expect.element(naColuna).toHaveAttribute("aria-expanded", "true");
  await expect.element(naColuna).toHaveFocus();
  expect(naColuna.element().id).toMatch(/^compacta-/);
});
