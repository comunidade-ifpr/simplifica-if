/**
 * A conversa ao lado no Chromium, com o app inteiro conectado ao `apps/server` de verdade e os drivers de
 * demonstração (`test/drivers-demonstracao.ts`): da revisão de PPC ("Conversar sobre esta pendência"), com a
 * ficha do PPC tirada pelo teclado (nada dele vai à pasta, e o foco vai à ficha seguinte), a mesma conversa
 * retomada com a ficha nova (a instrução de leitura à vista na mensagem), "⤢" e "Trazer de volta", e a
 * conversa apagada; a barra da seleção no leitor (pelo teclado também, na primeira linha e com a cópia que
 * falha) e a paleta (⌘J); a aba Pasta que diz de qual conversa é; a conversa apagada em outra janela; e o
 * aviso de uso não aceito, que não perde o texto nem as fichas, nem cria pasta.
 */
import { afterEach, beforeAll, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import type { ServidorTeste } from "../../vite.config.ts";
import type { Api } from "../conexao/api.ts";
import { achadosDaTela, iniciarServidorTeste, montarApp } from "../../test/navegador.tsx";
import { ponteTeste } from "../../test/ponte.ts";
import { inicializar } from "../inicializar.ts";

let servidor: ServidorTeste;
let semAviso: ServidorTeste;

beforeAll(async () => {
  [servidor, semAviso] = await Promise.all([
    iniciarServidorTeste({ atrasoLogin: 120 }),
    iniciarServidorTeste({ atrasoLogin: 120, primeiroUso: true }),
  ]);
});

afterEach(() => {
  delete window.simplifica;
});

function semIngles() {
  expect(achadosDaTela()).toEqual([]);
}

const painelAoLado = () => page.getByRole("complementary", { name: "Painel ao lado" });
const DCN_2026 = "ifpr://norma/br/cne-cp/res/2026/2";

it("da revisão: a ficha tirada não vai à pasta; a mesma conversa volta com a ficha nova; ⤢, voltar e apagar", async () => {
  window.simplifica = ponteTeste({
    conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
    escolherDocx: async () => servidor.ppc,
  });
  await page.viewport(1440, 900);
  await using app = await montarApp(servidor, "/revisao-ppc");
  const { api } = app.contexto;
  await page.getByRole("button", { name: "Escolher o PPC" }).click();
  const linha = page.getByRole("button", { name: /O AEE aparece como componente/ });
  await linha.click();
  await page.getByRole("button", { name: "Conversar sobre esta pendência" }).click();

  // As fichas da revisão, já incluídas: o PPC e a pendência; o .docx é oferta.
  const painel = painelAoLado();
  const fichas = painel.getByRole("region", { name: "Vai junto com a pergunta" });
  await expect.element(fichas.getByText("PPC de teste", { exact: true })).toBeVisible();
  await expect.element(fichas.getByText(/^Pendência: O AEE aparece como componente/)).toBeVisible();
  await expect.element(fichas.getByRole("button", { name: "Anexar o .docx" })).toBeVisible();
  const caixa = painel.getByRole("textbox", { name: "Pergunta à IA" });
  await expect.element(caixa).toHaveFocus();
  semIngles();

  // O PPC sai do contexto pelo teclado; a pergunta vai só com a pendência.
  (fichas.getByRole("button", { name: "Tirar o PPC do contexto" }).element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(fichas.getByText("PPC de teste", { exact: true })).not.toBeInTheDocument();
  // O foco vai à ficha seguinte, não ao corpo da página.
  await expect.element(fichas.getByRole("button", { name: "Tirar a pendência do contexto" })).toHaveFocus();
  // O que vai junto abre na ficha, pelo teclado também.
  const pendencia = fichas.getByText(/^Pendência: O AEE aparece como componente/);
  (pendencia.element().closest("summary") as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(fichas.getByText(/Critério da revisão:/)).toBeVisible();
  await caixa.fill("O que falta no AEE?");
  await userEvent.keyboard("{Enter}");
  const mensagens = painel.getByRole("log", { name: "Mensagens" });
  await expect.element(mensagens.getByText("O que falta no AEE?")).toBeVisible();
  const foi = mensagens.getByRole("list", { name: "Foi junto" });
  await expect.element(foi.getByText(/^Pendência: O AEE aparece como componente/)).toBeVisible();
  // A IA de demonstração pede para gravar (a pendência fala em "descreva"): a aprovação, no painel, vai ao
  // controle desta conversa. Depois, a resposta chega, com o link da base.
  await mensagens.getByRole("button", { name: "Permitir" }).click();
  await expect.element(mensagens.getByText("Permitido.")).toBeVisible();
  await expect.element(mensagens.getByRole("button", { name: "Res. CNE/CP nº 1/2021" })).toBeVisible();

  // A conversa é da revisão, com a pasta dela, e nada do PPC foi para lá.
  const listaId = app.contexto.revisao.obter().lista!.id;
  const ligada = await vi.waitFor(async () => {
    const lista = await api.chamar((c) => c["revisaoPpc.lista"]({ lista: listaId }));
    expect(lista.conversaAoLado).not.toBeNull();
    return lista.conversaAoLado!;
  });
  const arquivos = async () =>
    (await api.chamar((c) => c["pasta.ver"]({ sessao: ligada.conversa }))).arquivos.map((a) => a.nome);
  expect(await arquivos()).toEqual([]);
  const conversas = await api.chamar((c) => c["conversa.listar"]({}));
  expect(conversas.find((c) => c.id === ligada.conversa)?.origem).toEqual({
    rotulo: "da revisão de “PPC de teste”",
    rota: `/revisao-ppc?id=${listaId}`,
  });

  // "Nova conversa" esvazia a aba; "Conversar sobre esta pendência" retoma a da revisão, com as fichas de novo.
  await painel.getByRole("button", { name: "Nova conversa" }).click();
  await expect.element(mensagens).not.toBeInTheDocument();
  await page.getByRole("button", { name: "Conversar sobre esta pendência" }).click();
  await expect.element(mensagens.getByText("O que falta no AEE?")).toBeVisible();
  await expect.element(fichas.getByText("PPC de teste", { exact: true })).toBeVisible();
  await fichas.getByRole("button", { name: "Anexar o .docx" }).click();
  await caixa.fill("E agora, com o PPC?");
  await userEvent.keyboard("{Enter}");
  await expect.element(mensagens.getByText("E agora, com o PPC?")).toBeVisible();
  const foiAgora = mensagens.getByRole("list", { name: "Foi junto" }).last();
  await expect.element(foiAgora.getByText("PPC de teste")).toBeVisible();
  // A instrução de leitura que foi com o PPC fica à vista na mensagem gravada.
  await foiAgora.getByText("PPC de teste").click();
  await expect.element(foiAgora.getByText(/Leia o arquivo inteiro antes de responder/)).toBeVisible();
  await mensagens.getByRole("button", { name: "Permitir" }).click();
  await expect.element(mensagens.getByRole("button", { name: "Res. CNE/CP nº 1/2021" }).last()).toBeVisible();
  // O Markdown do PPC, a nota e a cópia do .docx entraram na pasta só agora.
  await vi.waitFor(async () =>
    expect(await arquivos()).toEqual(
      expect.arrayContaining(["PPC de teste.docx", "PPC em revisão.md", "Sobre o PPC.md"]),
    ),
  );
  semIngles();

  // ⤢: a conversa vai à tela cheia, e a aba diz isso; "Trazer de volta" volta à revisão.
  await painel.getByRole("button", { name: "Abrir a conversa na tela cheia" }).click();
  await expect.poll(() => app.roteador.state.location.search).toEqual({ id: ligada.conversa });
  await expect.element(page.getByRole("main").getByText("E agora, com o PPC?")).toBeVisible();
  await expect.element(painel.getByText("Aberta na tela cheia.")).toBeVisible();
  await painel.getByRole("button", { name: "Trazer de volta" }).click();
  await expect.poll(() => app.roteador.state.location.pathname).toBe("/revisao-ppc");
  await expect.element(mensagens.getByText("E agora, com o PPC?")).toBeVisible();

  // Apagada (pela tela cheia), a conversa sai do painel, que diz "Conversa apagada".
  await painel.getByRole("button", { name: "Abrir a conversa na tela cheia" }).click();
  await page.getByRole("button", { name: "Mais ações da conversa" }).click();
  await page.getByRole("menuitem", { name: "Apagar a conversa…" }).click();
  await page.getByRole("button", { name: "Apagar a conversa" }).click();
  await expect.poll(() => app.roteador.state.location.pathname).toBe("/");
  await expect.element(painel.getByText("Conversa apagada.")).toBeVisible();
  semIngles();
});

it("no leitor: a barra da seleção leva o trecho, com o dispositivo; a paleta leva a pergunta (⌘J)", async () => {
  await page.viewport(1440, 900);
  await using app = await montarApp(servidor, `/explorar/ver?link=${encodeURIComponent(DCN_2026)}`);
  const texto = page.getByRole("document", { name: "Texto da norma" });
  await expect.element(texto).toBeVisible();

  // A seleção (do mouse ou do teclado, a mesma `Selection`) num inciso do art. 28.
  const alvo = await vi.waitFor(() => {
    const inciso = texto.element().querySelector('[id="art28-xviii"]');
    expect(inciso).not.toBeNull();
    return inciso!.closest("p, li") ?? inciso!;
  });
  window.getSelection()!.selectAllChildren(alvo);
  const barra = page.getByRole("toolbar", { name: "Trecho selecionado" });
  await expect.element(barra).toBeVisible();
  // Dentro da borda do leitor.
  const caixaBarra = barra.element().getBoundingClientRect();
  const caixaTexto = texto.element().getBoundingClientRect();
  expect(caixaBarra.left).toBeGreaterThanOrEqual(caixaTexto.left - 1);
  expect(caixaBarra.right).toBeLessThanOrEqual(caixaTexto.right + 1);
  semIngles();

  // Pelo teclado: Tab leva à barra, e Esc a fecha.
  await userEvent.keyboard("{Tab}");
  await expect.element(barra.getByRole("button", { name: "Perguntar sobre este trecho" })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(barra).not.toBeInTheDocument();

  // A cópia que falha diz isso.
  window.getSelection()!.selectAllChildren(alvo);
  await expect.element(barra).toBeVisible();
  const escrever = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("negado"));
  await barra.getByRole("button", { name: "Copiar citação" }).click();
  await expect.element(barra.getByRole("button", { name: "Não foi possível copiar" })).toBeVisible();
  expect(escrever.mock.calls[0]![0]).toMatch(
    /\(Res\. CNE\/CP 2\/2026, art\. 28, XVIII, ifpr:\/\/norma\/br\/cne-cp\/res\/2026\/2#art28-xviii\)$/,
  );
  escrever.mockRestore();

  // Na primeira linha do leitor, a barra vai abaixo da seleção, sem sair pelo topo.
  const primeiro = texto.element().querySelector("h1, h2, p")!;
  primeiro.scrollIntoView({ block: "start" });
  window.getSelection()!.selectAllChildren(primeiro);
  await expect.element(barra).toBeVisible();
  await vi.waitFor(() =>
    expect(barra.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(
      primeiro.getBoundingClientRect().bottom - 1,
    ),
  );

  window.getSelection()!.selectAllChildren(alvo);
  await expect.element(barra).toBeVisible();
  await barra.getByRole("button", { name: "Perguntar sobre este trecho" }).click();
  const fichas = painelAoLado().getByRole("region", { name: "Vai junto com a pergunta" });
  await expect.element(fichas.getByText(/^Trecho \(Res\. CNE\/CP 2\/2026, art\. 28, XVIII\): “XVIII – /)).toBeVisible();
  // O documento aberto também vai, como ficha de link da base.
  await expect.element(fichas.getByRole("button", { name: "Tirar “Res. CNE/CP 2/2026” do contexto" })).toBeVisible();
  expect(app.roteador.state.location.pathname).toBe("/explorar/ver");

  // A paleta: o texto digitado vira a pergunta da conversa ao lado.
  await userEvent.keyboard("{Control>}k{/Control}");
  const campo = page.getByRole("combobox", { name: "Buscar na base" });
  await campo.fill("egressos");
  await expect.element(page.getByRole("dialog").getByRole("group", { name: "Perguntar à IA" })).toBeVisible();
  await userEvent.keyboard("{Control>}j{/Control}");
  const caixa = painelAoLado().getByRole("textbox", { name: "Pergunta à IA" });
  await expect.element(caixa).toHaveValue("egressos");
  await expect.element(caixa).toHaveFocus();
  semIngles();
});

it("a aba Pasta diz de qual conversa é a pasta; a conversa ao lado apagada em outra janela sai da aba", async () => {
  await page.viewport(1440, 900);
  await using app = await montarApp(servidor, `/explorar/ver?link=${encodeURIComponent(DCN_2026)}`);
  const { api, painel: controle } = app.contexto;
  await expect.element(page.getByRole("document", { name: "Texto da norma" })).toBeVisible();
  await userEvent.keyboard("{Control>}j{/Control}");
  const painel = painelAoLado();
  await painel.getByRole("textbox", { name: "Pergunta à IA" }).fill("O que diz esta norma?");
  await userEvent.keyboard("{Enter}");
  const mensagens = painel.getByRole("log", { name: "Mensagens" });
  await expect.element(mensagens.getByRole("button", { name: "Res. CNE/CP nº 1/2021" })).toBeVisible();
  const aoLado = controle.obter().conversa.id!;

  // Outra conversa na tela cheia: "Pasta da tarefa" abre a pasta dela, dizendo de qual é, e leva à outra.
  const { pasta } = await api.chamar((c) => c["pasta.criar"]({ titulo: "Outra tarefa" }));
  const { sessao } = await api.chamar((c) => c["conversa.iniciar"]({ provider: "claude", pastaTrabalho: pasta }));
  await app.roteador.navigate({ to: "/conversa", search: { id: sessao } });
  await page.getByRole("button", { name: "Pasta da tarefa" }).click();
  await expect.element(painel.getByText("Pasta da conversa da tela")).toBeVisible();
  expect(controle.obter().pastaDe).toBe(sessao);
  await painel.getByRole("button", { name: "Ver a da conversa ao lado" }).click();
  await expect.element(painel.getByText("Pasta da conversa ao lado")).toBeVisible();
  semIngles();

  // Outra janela (outra conexão) apaga a conversa ao lado: esta fica sabendo pelo fim do acompanhamento.
  await painel.getByRole("tab", { name: "Conversar" }).click();
  await expect.element(mensagens).toBeVisible();
  const outra = await inicializar(
    { tipo: "navegador", credenciais: { urlServidor: servidor.urlServidor, token: servidor.token } },
    undefined,
    { continuidade: false },
  );
  try {
    await outra.contexto.api.chamar((c) => c["conversa.apagar"]({ sessao: aoLado }));
  } finally {
    await outra.encerrar();
  }
  await expect.element(painel.getByText("Conversa apagada.")).toBeVisible();
  expect(app.contexto.conversas.foiApagada(aoLado)).toBe(true);
  semIngles();
});

it("o aviso de uso não aceito aparece na aba, sem perder o texto nem as fichas", async () => {
  await page.viewport(1440, 900);
  await using app = await montarApp(semAviso, `/explorar/ver?link=${encodeURIComponent(DCN_2026)}`);
  await expect.element(page.getByRole("document", { name: "Texto da norma" })).toBeVisible();
  // ⌘J (Ctrl+J): a página vai à conversa ao lado.
  await userEvent.keyboard("{Control>}j{/Control}");
  const painel = painelAoLado();
  const fichas = painel.getByRole("region", { name: "Vai junto com a pergunta" });
  await expect.element(fichas.getByRole("button", { name: /^Tirar “.+” do contexto$/ })).toBeVisible();
  const caixa = painel.getByRole("textbox", { name: "Pergunta à IA" });
  // Quais chamadas a caixa faz ao servidor: a recusa não cria a pasta da conversa.
  const { api } = app.contexto;
  const chamadas: Array<string> = [];
  const chamar = api.chamar;
  const anotar = <C extends object>(cliente: C): C =>
    new Proxy(cliente, {
      get: (alvo, nome, receptor) => {
        chamadas.push(String(nome));
        return Reflect.get(alvo, nome, receptor);
      },
    });
  const espiada: Api["chamar"] = (chamada) => chamar((cliente) => chamada(anotar(cliente)));
  Object.defineProperty(api, "chamar", { value: espiada, configurable: true });
  await caixa.fill("Qual o prazo?");
  await userEvent.keyboard("{Enter}");
  await expect.element(painel.getByText(/^Antes de usar a IA, leia o aviso de uso/)).toBeVisible();
  expect(chamadas).toContain("preferencias.ler");
  expect(chamadas).not.toContain("pasta.criar");
  Object.defineProperty(api, "chamar", { value: chamar, configurable: true });
  await expect.element(caixa).toHaveValue("Qual o prazo?");
  await expect.element(fichas.getByRole("button", { name: /^Tirar “.+” do contexto$/ })).toBeVisible();
  // Nada foi à IA: nenhuma conversa.
  expect(await app.contexto.api.chamar((c) => c["conversa.listar"]({}))).toEqual([]);
  semIngles();
});
