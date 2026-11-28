/**
 * As várias conversas de uma revisão de PPC (`docs/plans/multitarefa.md`, decisão 12) no Chromium, com o
 * `apps/server` de verdade e os drivers de demonstração: a aba Conversar escolhida pelas setas com o painel
 * vazio traz o PPC, sem tirar o foco da aba; duas pendências abrem duas conversas, cada uma na sua pasta com
 * o PPC; "Conversar sobre esta pendência" de novo volta à conversa dela; e "Conversas desta revisão" as
 * lista pelo título.
 */
import { afterEach, beforeAll, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import type { ServidorTeste } from "../../../vite.config.ts";
import { achadosDaTela, iniciarServidorTeste, montarApp } from "../../../test/navegador.tsx";
import { ponteTeste } from "../../../test/ponte.ts";
import { principais } from "./lista.ts";

let servidor: ServidorTeste;

beforeAll(async () => {
  servidor = await iniciarServidorTeste({ atrasoLogin: 120 });
});

afterEach(() => {
  delete window.simplifica;
});

it("a aba com o painel vazio traz o PPC; duas pendências, duas conversas em duas pastas; a mesma pendência volta à dela", async () => {
  window.simplifica = ponteTeste({
    conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
    escolherDocx: async () => servidor.ppc,
  });
  await page.viewport(1440, 900);
  await using app = await montarApp(servidor, "/revisao-ppc");
  const { api, painel: controle, revisao } = app.contexto;
  await page.getByRole("button", { name: "Escolher o PPC" }).click();
  await expect.element(page.getByRole("region", { name: "Conversas desta revisão" })).toBeVisible();

  // O painel vazio, aberto no Ler: a aba Conversar (pelas setas, como pelo clique) traz o PPC (uma conversa
  // geral, sem pendência), e o foco fica na aba.
  controle.mostrar("ler");
  const painel = page.getByRole("complementary", { name: "Painel ao lado" });
  const abaConversar = painel.getByRole("tab", { name: "Conversar" });
  const abaLer = painel.getByRole("tab", { name: "Ler" });
  await expect.element(abaLer).toBeVisible();
  (abaLer.element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowRight}");
  const fichas = painel.getByRole("region", { name: "Vai junto com a pergunta" });
  await expect.element(fichas.getByText("PPC de teste", { exact: true })).toBeVisible();
  await expect.element(abaConversar).toHaveFocus();
  expect(controle.obter().conversa.origem?.chave).toMatch(/~/);
  // O rascunho com o contexto da tela pode virar o de uma conversa livre antes de enviar.
  await expect.element(painel.getByRole("button", { name: "Nova conversa" })).toBeEnabled();
  expect(achadosDaTela()).toEqual([]);

  // Duas pendências: cada uma com a sua conversa.
  const lista = revisao.obter().lista!;
  const [a, b] = principais(lista);
  const conversarSobre = page.getByRole("main").getByRole("button", { name: "Conversar sobre esta pendência" });
  const caixa = painel.getByRole("textbox", { name: "Pergunta à IA" });
  const mensagens = painel.getByRole("log", { name: "Mensagens" });
  const perguntar = async (chave: string, pergunta: string) => {
    revisao.alternarPendencia(chave);
    await conversarSobre.click();
    await expect.element(fichas.getByText(/^Pendência: /)).toBeVisible();
    await caixa.fill(pergunta);
    await userEvent.keyboard("{Enter}");
    await expect.element(mensagens.getByText(pergunta)).toBeVisible();
    return controle.obter().conversa.id!;
  };
  const primeira = await perguntar(a!.chave, "Sobre a primeira?");
  const segunda = await perguntar(b!.chave, "Sobre a segunda?");
  expect(segunda).not.toBe(primeira);

  const ligadas = await vi.waitFor(async () => {
    const atual = await api.chamar((c) => c["revisaoPpc.lista"]({ lista: lista.id }));
    expect(atual.conversas).toHaveLength(2);
    return atual.conversas;
  });
  expect(ligadas.map((l) => [l.conversa, l.pendencia])).toEqual([
    [primeira, a!.chave],
    [segunda, b!.chave],
  ]);
  expect(new Set(ligadas.map((l) => l.pasta)).size).toBe(2);
  for (const { conversa } of ligadas) {
    const arquivos = (await api.chamar((c) => c["pasta.ver"]({ sessao: conversa }))).arquivos.map((f) => f.nome);
    expect(arquivos).toEqual(expect.arrayContaining(["PPC em revisão.md", "Sobre o PPC.md"]));
  }

  // De novo na primeira: a conversa dela, com as mensagens.
  revisao.alternarPendencia(a!.chave);
  await conversarSobre.click();
  await expect.element(mensagens.getByText("Sobre a primeira?")).toBeVisible();
  expect(controle.obter().conversa.id).toBe(primeira);

  // "Conversas desta revisão" lista as duas, e cada uma abre no painel.
  const daRevisao = page.getByRole("main").getByRole("region", { name: "Conversas desta revisão" });
  // As duas conversas, pelo título que a primeira mensagem deu (a tela relê a lista depois do envio), e
  // "Nova conversa sobre esta revisão".
  await vi.waitFor(() => expect(daRevisao.getByRole("button").elements()).toHaveLength(3));
  await expect.element(daRevisao.getByRole("button", { name: /^Sobre a primeira\?/ })).toBeVisible();
  await expect.element(daRevisao.getByRole("button", { name: /^Sobre a segunda\?/ })).toBeVisible();
  await daRevisao.getByRole("button").nth(1).click();
  await expect.element(mensagens.getByText("Sobre a segunda?")).toBeVisible();
  expect(achadosDaTela()).toEqual([]);
});
