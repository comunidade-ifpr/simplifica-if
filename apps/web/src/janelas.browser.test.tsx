/**
 * "Abrir em nova janela" (`docs/plans/multitarefa.md`, "Várias janelas") no Chromium, com o app conectado ao
 * `apps/server` de verdade e a ponte do desktop simulada: ⇧⌘-clique (Ctrl+Shift+clique) num link `ifpr://` e
 * num resultado da paleta, ⇧⌘N e o menu Arquivo pedem a janela nova pela ponte, com a rota do app, e a tela
 * fica; a tecla segurada não abre outra. A janela extra não volta nem grava a continuidade; a que virou a
 * principal grava sem voltar. A preferência dos avisos mudada em outra janela vale nesta. Sem o desktop, a
 * opção não existe, e o ⇧⌘-clique é o clique comum.
 */
import { afterEach, beforeAll, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import type { PainelGuardado } from "@simplifica-if/contratos-app";
import type { AtalhoMenu, ContinuidadeDaJanela } from "@simplifica-if/contratos-app/ponte";
import type { ServidorTeste } from "../vite.config.ts";
import { achadosDaTela, iniciarServidorTeste, montarApp } from "../test/navegador.tsx";
import { ponteTeste } from "../test/ponte.ts";
import { inicializar } from "./inicializar.ts";
import { NO_MAC } from "./lib/teclado.ts";
import { ondeDoClique } from "./painel/abrirLink.ts";
import { avisosDoSistemaLigados } from "./tarefas/perfil.ts";

let servidor: ServidorTeste;

beforeAll(async () => {
  servidor = await iniciarServidorTeste();
});

afterEach(() => {
  delete window.simplifica;
});

/** A ponte com a janela nova e o menu guardados para o teste. */
function ponteComJanelas(continuidade: ContinuidadeDaJanela = "completa") {
  const abrirJanela = vi.fn(async (_rota: string) => {});
  const menu: { ouvinte: ((atalho: AtalhoMenu) => void) | undefined } = { ouvinte: undefined };
  window.simplifica = ponteTeste({
    conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
  });
  window.simplifica.janela = {
    ...window.simplifica.janela,
    continuidade,
    abrirJanela,
    aoAtalhoDoMenu: (ouvinte) => {
      menu.ouvinte = ouvinte;
      return () => {
        menu.ouvinte = undefined;
      };
    },
  };
  return { abrirJanela, menu };
}

const COMANDO = NO_MAC ? "Meta" : "Control";
const LINK_NORMA = "ifpr://norma/br/cne-cp/res/2021/1";

it("⇧⌘-clique num link da base, num resultado da paleta, ⇧⌘N e o menu abrem a janela nova pela ponte", async () => {
  const { abrirJanela, menu } = ponteComJanelas();
  await page.viewport(1600, 900);
  await using app = await montarApp(servidor, "/explorar/normas");
  const linha = page.getByRole("main").getByRole("link", { name: "Resolução CNE/CP nº 1/2021", exact: true });
  await expect.element(linha).toBeVisible();

  // ⇧⌘-clique: a norma numa janela nova, com a rota do Explorar; a tela fica.
  await linha.click({ modifiers: ["Shift", COMANDO] });
  await vi.waitFor(() => expect(abrirJanela).toHaveBeenCalledTimes(1));
  const rota = abrirJanela.mock.calls[0]![0];
  expect(rota.startsWith("/explorar/ver?")).toBe(true);
  expect(new URLSearchParams(rota.slice(rota.indexOf("?"))).get("link")).toBe(LINK_NORMA);
  expect(app.roteador.state.location.pathname).toBe("/explorar/normas");

  // Na paleta, ⇧⌘-clique num resultado também.
  await userEvent.keyboard(`{${COMANDO}>}k{/${COMANDO}}`);
  await page.getByRole("combobox", { name: "Buscar na base" }).fill("Res. CNE/CP 1/2021, art. 20");
  const dialogo = page.getByRole("dialog", { name: "Buscar na base" });
  await dialogo
    .getByRole("option")
    .first()
    .click({ modifiers: ["Shift", COMANDO] });
  await expect.element(dialogo).not.toBeInTheDocument();
  await vi.waitFor(() => expect(abrirJanela).toHaveBeenCalledTimes(2));
  expect(abrirJanela.mock.calls[1]![0].startsWith("/explorar/ver?link=")).toBe(true);
  expect(app.roteador.state.location.pathname).toBe("/explorar/normas");

  // ⇧⌘N e "Abrir em nova janela" do menu Arquivo: a tela atual numa janela nova.
  await userEvent.keyboard(`{Shift>}{${COMANDO}>}n{/${COMANDO}}{/Shift}`);
  await vi.waitFor(() => expect(abrirJanela).toHaveBeenCalledTimes(3));
  expect(abrirJanela.mock.calls[2]![0]).toBe("/explorar/normas");
  menu.ouvinte?.("novaJanela");
  expect(abrirJanela).toHaveBeenCalledTimes(4);
  expect(abrirJanela.mock.calls[3]![0]).toBe("/explorar/normas");

  // A tecla segurada (a repetição do sistema) não abre uma janela por repetição.
  const segurada = { key: "N", shiftKey: true, metaKey: NO_MAC, ctrlKey: !NO_MAC, bubbles: true };
  document.body.dispatchEvent(new KeyboardEvent("keydown", { ...segurada, repeat: true }));
  document.body.dispatchEvent(new KeyboardEvent("keydown", { ...segurada, repeat: true }));
  expect(abrirJanela).toHaveBeenCalledTimes(4);
  expect(achadosDaTela()).toEqual([]);
});

const PAINEL_ABERTO: PainelGuardado = {
  aberto: true,
  aba: "ler",
  trilha: { links: ["ifpr://norma/br/cne-cp/res/2021/1"], posicao: 0 },
  marcados: [],
  preso: false,
};

/** Guarda a continuidade (a da principal que fechou), por uma conexão sem a continuidade. */
async function guardarContinuidade(rota: string) {
  await using app = await montarApp(servidor, "/");
  await app.contexto.api.chamar((cliente) =>
    cliente["preferencias.guardarContinuidade"]({ continuidade: { rota, painel: PAINEL_ABERTO } }),
  );
}

async function continuidadeGuardada() {
  await using app = await montarApp(servidor, "/");
  return (await app.contexto.api.chamar((cliente) => cliente["preferencias.ler"]({}))).continuidade;
}

it("a janela extra não volta nem grava onde a pessoa estava", async () => {
  await guardarContinuidade("/explorar/normas");
  ponteComJanelas("nenhuma");
  {
    await using app = await montarApp(servidor, "/", { continuidade: true });
    expect(app.contexto.continuidade.obter().restaurando).toBe(false);
    await expect.element(page.getByRole("heading", { name: "O que você precisa hoje?" })).toBeVisible();
    // Nem a rota nem o painel da principal voltam.
    expect(app.roteador.state.location.pathname).toBe("/");
    expect(app.contexto.painel.obter().aberto).toBe(false);
    // Navega e grava já (como ao fechar): nada gravado.
    await app.roteador.navigate({ to: "/explorar" });
    await app.contexto.continuidade.gravarAgora();
  }
  expect((await continuidadeGuardada())?.rota).toBe("/explorar/normas");
});

it("fechada a principal, a janela nova que vira a principal abre na rota pedida, sem voltar, e grava", async () => {
  await guardarContinuidade("/explorar/normas");
  ponteComJanelas("so-grava");
  {
    await using app = await montarApp(servidor, "/", { continuidade: true });
    expect(app.contexto.continuidade.obter().restaurando).toBe(false);
    await expect.element(page.getByRole("heading", { name: "O que você precisa hoje?" })).toBeVisible();
    expect(app.roteador.state.location.pathname).toBe("/");
    expect(app.contexto.painel.obter().aberto).toBe(false);
    await app.roteador.navigate({ to: "/explorar" });
    await expect.poll(() => app.roteador.state.location.pathname).toBe("/explorar");
  }
  // Ao fechar, gravou onde a pessoa estava nesta janela.
  const guardada = await continuidadeGuardada();
  expect(guardada?.rota).toBe("/explorar");
  expect(guardada?.painel.aberto).toBe(false);
});

it("os avisos do sistema desligados em outra janela não saem por esta", async () => {
  ponteComJanelas();
  await using app = await montarApp(servidor, "/");
  const { api } = app.contexto;
  await api.chamar((cliente) => cliente["preferencias.avisarNoSistema"]({ ligar: true }));
  expect(await avisosDoSistemaLigados(api)).toBe(true);
  // A outra janela: outra conexão, com a sua cópia das preferências.
  const outra = await inicializar(
    { tipo: "navegador", credenciais: { urlServidor: servidor.urlServidor, token: servidor.token } },
    undefined,
    { continuidade: false },
  );
  try {
    await outra.contexto.api.chamar((cliente) => cliente["preferencias.avisarNoSistema"]({ ligar: false }));
    expect(await avisosDoSistemaLigados(api)).toBe(false);
    await outra.contexto.api.chamar((cliente) => cliente["preferencias.avisarNoSistema"]({ ligar: true }));
    expect(await avisosDoSistemaLigados(api)).toBe(true);
  } finally {
    await outra.encerrar();
  }
});

it("sem o desktop, o ⇧⌘-clique é o clique comum; com ele, a janela nova", () => {
  const clique = { altKey: false, shiftKey: true, metaKey: NO_MAC, ctrlKey: !NO_MAC };
  expect(ondeDoClique(clique)).toBe("padrao");
  expect(ondeDoClique({ ...clique, altKey: true })).toBe("outro");
  ponteComJanelas();
  expect(ondeDoClique(clique)).toBe("janela");
});

it("sem o desktop, a opção não existe: ⇧⌘-clique num resultado da paleta abre como o clique comum", async () => {
  await page.viewport(1600, 900);
  await using app = await montarApp(servidor, "/explorar/normas");
  await expect.element(page.getByRole("main").getByRole("link", { name: "Resolução CNE/CP nº 1/2021" })).toBeVisible();
  await userEvent.keyboard(`{${COMANDO}>}k{/${COMANDO}}`);
  await page.getByRole("combobox", { name: "Buscar na base" }).fill("Res. CNE/CP 1/2021, art. 20");
  const dialogo = page.getByRole("dialog", { name: "Buscar na base" });
  await dialogo
    .getByRole("option")
    .first()
    .click({ modifiers: ["Shift", COMANDO] });
  // No Explorar, o clique comum abre na tela.
  await expect.poll(() => app.roteador.state.location.pathname).toBe("/explorar/ver");
  expect(String(app.roteador.state.location.search.link).startsWith(LINK_NORMA)).toBe(true);
});
