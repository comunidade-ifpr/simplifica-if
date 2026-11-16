/**
 * O app inteiro no Chromium, conectado por RPC ao `apps/server` de verdade com os drivers de
 * demonstração (`test/servidor-teste.ts`, num processo Node): Início com os três providers, instalar e
 * entrar, a conversa com aprovação, link `ifpr://` no painel de leitura, interromper e nova conversa, e
 * "Analisar um PPC" (a revisão prévia sem IA, com o Worker de verdade e a ponte do desktop simulada: o
 * diálogo devolve o PPC sintético do servidor de teste).
 */
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import type { ServidorTeste } from "../vite.config.ts";
import { iniciarServidorTeste, montarApp, pararServidoresTeste } from "../test/navegador.tsx";
import type { PonteDesktop } from "./ponte-desktop.ts";

let servidor: ServidorTeste;

beforeAll(async () => {
  servidor = await iniciarServidorTeste(1500);
});

afterAll(async () => {
  await pararServidoresTeste();
});

// A ponte do desktop simulada só vale no teste que a monta.
afterEach(() => {
  delete window.simplifica;
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
  // O app não faz o login do Codex: em vez de "Entrar", a orientação com o comando.
  await expect.element(codex.getByText("codex login", { exact: true })).toBeVisible();
  await expect.element(codex.getByRole("button", { name: "Entrar" })).not.toBeInTheDocument();

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
  const mensagens = page.getByRole("log", { name: "Mensagens" });
  await expect.element(mensagens.getByText("Pode escrever um resumo da DCN?")).toBeVisible();
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

  // A conversa ficou gravada: a lista lateral (só em tela larga) a reabre, com o histórico.
  await page.viewport(1280, 800);
  const lista = page.getByRole("navigation", { name: "Conversas gravadas" });
  await lista.getByRole("link", { name: /Pode escrever um resumo da DCN\?/ }).click();
  await expect.element(mensagens.getByText("Pode escrever um resumo da DCN?")).toBeVisible();
  await expect.element(mensagens.getByText("Resposta interrompida.")).toBeVisible();
});

it("Analisar um PPC: do Início à lista de pendências por tema e à cópia comentada", async () => {
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

  // O roteiro: uma parada por vez, com o aviso do que ainda não foi visto.
  await expect.element(page.getByRole("heading", { name: /^Parada 1 de \d+ · / })).toBeVisible();
  await expect.element(page.getByText(/Ainda não viu:/)).toBeVisible();

  // Tudo de uma vez: os temas na ordem do parecer, com estados em linguagem comum.
  await page.getByRole("button", { name: "Ver tudo de uma vez" }).click();
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

  // A cópia movida ou apagada: o desktop recusa, e a tela diz o que houve.
  abrirDocumento.mockRejectedValueOnce(new Error("a cópia comentada não foi encontrada"));
  await page.getByRole("button", { name: "Abrir o documento comentado" }).click();
  await expect.element(page.getByText(/Não foi possível abrir a cópia comentada/)).toBeVisible();

  // Apagar a lista pede confirmação: cancelar não apaga; confirmar volta à escolha do arquivo.
  await page.getByRole("button", { name: "Apagar esta lista" }).click();
  const confirmacao = page.getByRole("group", { name: "Apagar esta lista?" });
  await expect.element(confirmacao).toBeVisible();
  await confirmacao.getByRole("button", { name: "Cancelar" }).click();
  await expect.element(confirmacao).not.toBeInTheDocument();
  await expect.element(resultado).toBeVisible();
  await page.getByRole("button", { name: "Apagar esta lista" }).click();
  await page.getByRole("button", { name: "Apagar a lista" }).click();
  await expect.element(resultado).not.toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Escolher o PPC (.docx)…" })).toBeVisible();
});

it("Analisar um PPC: arquivo que não existe, com a mensagem do servidor em português", async () => {
  window.simplifica = {
    conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
    escolherDocx: async () => `${servidor.pasta}/não existe.docx`,
  } satisfies PonteDesktop;
  await using _app = await montarApp(servidor, "/revisao-ppc");
  await page.getByRole("button", { name: "Escolher o PPC (.docx)…" }).click();
  await expect.element(page.getByText("O arquivo não foi encontrado ou não pode ser lido.")).toBeVisible();
});
