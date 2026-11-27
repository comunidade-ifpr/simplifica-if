/**
 * "Em andamento" e o limite da assinatura no Chromium, com o app inteiro conectado ao `apps/server` de
 * verdade e os drivers de demonstração (`test/drivers-demonstracao.ts`): duas conversas em segundo plano,
 * uma respondendo e outra pedindo para gravar; a bandeja do cabeçalho (`aria-expanded`, setas, o anúncio
 * `aria-live`) com o mesmo texto do pedido e Permitir, a resposta pronta até a conversa ser vista, o aviso e
 * o selo do sistema pela ponte; e o cartão do limite, que continua a conversa com outra IA levando o
 * histórico numa ficha e a última pergunta escrita na caixa. Também: a resposta que termina com a janela
 * sem foco fica pronta até a pessoa voltar; o aviso desligado não sai numa tela que não lê as preferências;
 * a bandeja que esvaziou aberta não reabre sozinha; o cartão de um limite antigo não oferece outra IA; e a
 * ficha tirada da caixa da continuação não volta.
 */
import type { AvisoSistema, JanelaDesktop } from "@simplifica-if/contratos-app/ponte";
import { afterEach, beforeAll, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import type { ServidorTeste } from "../../vite.config.ts";
import type { Api } from "../conexao/api.ts";
import { achadosDaTela, iniciarServidorTeste, montarApp } from "../../test/navegador.tsx";
import { ponteTeste } from "../../test/ponte.ts";
import { avisosDoSistemaLigados } from "../tarefas/perfil.ts";

let servidor: ServidorTeste;

beforeAll(async () => {
  servidor = await iniciarServidorTeste({ atrasoLogin: 50 });
});

afterEach(() => {
  delete window.simplifica;
  vi.restoreAllMocks();
});

function semIngles() {
  expect(achadosDaTela()).toEqual([]);
}

/** A ponte do desktop com o aviso e o selo do sistema guardados para o teste. */
function ponteComAvisos() {
  const avisos: Array<AvisoSistema> = [];
  const selos: Array<number> = [];
  const janela: JanelaDesktop = {
    plataforma: "darwin",
    continuidade: "completa",
    abrirJanela: async () => {},
    telaCheia: async () => false,
    aoMudarTelaCheia: () => () => {},
    temaDoApp: async () => {},
    aoAtalhoDoMenu: () => () => {},
    avisar: async (aviso) => void avisos.push(aviso),
    selo: async (contagem) => void selos.push(contagem),
    aoAbrirRota: () => () => {},
    compacta: async () => false,
    naFrente: async () => {},
    antesDeSair: () => () => {},
  };
  window.simplifica = ponteTeste({ janela });
  return { avisos, selos };
}

/** O Gemini de demonstração entra na conta: passa a ser outra IA pronta. */
function entrarNoGemini(api: Api): Promise<void> {
  return new Promise<void>((pronto, falha) => {
    const login = api.acompanhar(
      (c) => c["providers.entrar"]({ provider: "antigravity" }),
      () => {},
    );
    login.fim.then(() => pronto(), falha);
  });
}

/** Uma conversa livre numa pasta nova, com a primeira mensagem já enviada. */
async function conversaComMensagem(api: Api, texto: string): Promise<string> {
  const { pasta } = await api.chamar((c) => c["pasta.criar"]({ titulo: texto }));
  const { sessao } = await api.chamar((c) => c["conversa.iniciar"]({ provider: "claude", pastaTrabalho: pasta }));
  await api.chamar((c) => c["conversa.enviar"]({ sessao, texto }));
  return sessao;
}

it("a bandeja: duas conversas em segundo plano, a aprovação pela bandeja e a resposta pronta até ser vista", async () => {
  const { avisos, selos } = ponteComAvisos();
  await page.viewport(1440, 900);
  await using app = await montarApp(servidor, "/explorar");
  const { api } = app.contexto;

  // Uma conversa que demora e outra que pede para escrever, sem sair do Explorar.
  const demorada = await conversaComMensagem(api, "Esta resposta demora");
  const escreve = await conversaComMensagem(api, "Pode escrever o resumo?");

  const botao = page.getByRole("button", { name: "Em andamento: 2" });
  await expect.element(botao).toBeVisible();
  await expect.element(botao).toHaveAttribute("aria-expanded", "false");
  // O pedido de permissão é anunciado ao leitor de tela e vai ao aviso do sistema, sem o título da conversa.
  await expect
    .poll(() => document.querySelector("[data-anuncio-atividades]")?.textContent)
    .toBe("A IA pede permissão: Conversa “Pode escrever o resumo?”");
  await expect.poll(() => avisos).toContainEqual({ tipo: "permissao", rota: `/conversa?id=${escreve}` });
  await expect.poll(() => selos.at(-1)).toBe(1);

  await botao.click();
  await expect.element(botao).toHaveAttribute("aria-expanded", "true");
  const bandeja = page.getByRole("list", { name: "Em andamento" });
  const itemDemorada = bandeja.getByRole("button", { name: /Conversa “Esta resposta demora”/ });
  const itemEscreve = bandeja.getByRole("button", { name: /Conversa “Pode escrever o resumo\?”/ });
  await expect.element(itemDemorada).toBeVisible();
  expect(itemDemorada.element().textContent).toMatch(/respondendo há \d+ s$/);
  await expect.poll(() => itemEscreve.element().textContent).toMatch(/pede permissão$/);
  // O mesmo texto do pedido na conversa.
  await expect.element(bandeja.getByText("A IA pede permissão: Alterar arquivos")).toBeVisible();
  await expect.element(bandeja.getByText("Escrever resumo.md na pasta de trabalho")).toBeVisible();
  semIngles();

  // As setas passam de um item a outro.
  (itemDemorada.element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(itemEscreve).toHaveFocus();
  await userEvent.keyboard("{ArrowUp}");
  await expect.element(itemDemorada).toHaveFocus();
  // A partir de Permitir, a seta parte do item dele, não do primeiro.
  (bandeja.getByRole("button", { name: "Permitir" }).element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(itemEscreve).toHaveFocus();

  // Permitir pela bandeja: a conversa termina e fica "resposta pronta", sem trocar de tela.
  await bandeja.getByRole("button", { name: "Permitir" }).click();
  await expect.poll(() => itemEscreve.element().textContent).toMatch(/resposta pronta$/);
  await expect.poll(() => avisos).toContainEqual({ tipo: "resposta", rota: `/conversa?id=${escreve}` });
  expect(app.roteador.state.location.pathname).toBe("/explorar");
  const conversa = await api.chamar((c) => c["conversa.carregar"]({ sessao: escreve }));
  expect(conversa.itens.some((item) => item._tag === "DecisaoAprovacao" && item.decisao === "permitir")).toBe(true);

  // O clique leva à conversa, que, vista, sai da bandeja; a demorada continua.
  await itemEscreve.click();
  await expect.element(page.getByRole("log", { name: "Mensagens" }).getByText("Escrevi o resumo.md.")).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Em andamento: 1" })).toBeVisible();
  // A lista de conversas diz o que a demorada faz.
  const lista = page.getByRole("list", { name: "Conversas" });
  await expect
    .poll(() => lista.getByRole("link", { name: /Esta resposta demora/ }).element().textContent)
    .toMatch(/Respondendo/);

  await api.chamar((c) => c["conversa.interromper"]({ sessao: demorada }));
  await expect.element(page.getByRole("button", { name: /^Em andamento/ })).not.toBeInTheDocument();
  await expect.poll(() => selos.at(-1)).toBe(0);
});

it("o limite da assinatura: o cartão continua com outra IA, com o histórico numa ficha e a pergunta na caixa", async () => {
  await using app = await montarApp(servidor, "/");
  const { api } = app.contexto;
  await entrarNoGemini(api);

  const sessao = await conversaComMensagem(api, "O que diz a DCN?");
  await app.roteador.navigate({ to: "/conversa", search: { id: sessao } });
  const mensagens = page.getByRole("log", { name: "Mensagens" });
  await expect.element(mensagens.getByRole("button", { name: "Res. CNE/CP nº 1/2021" })).toBeVisible();
  const caixa = page.getByRole("textbox", { name: "Mensagem" });
  await caixa.fill("Chegou ao limite de uso?");
  await page.getByRole("button", { name: "Enviar" }).click();

  const cartao = mensagens.getByRole("alert").filter({ hasText: "O Claude chegou ao limite da sua assinatura" });
  await expect.element(cartao).toBeVisible();
  expect(document.body.innerText).not.toMatch(/usage limit/);
  semIngles();
  await cartao.getByRole("button", { name: "Continuar com Gemini" }).click();

  // A conversa nova, com o Gemini: o histórico numa ficha à vista e removível, e a pergunta escrita, não enviada.
  await expect.element(page.getByText("· Gemini (Antigravity)")).toBeVisible();
  const fichas = page.getByRole("region", { name: "Vai junto com a pergunta" });
  await expect.element(fichas.getByText("Histórico da conversa com o Claude (2 mensagens)")).toBeVisible();
  await expect.element(page.getByRole("textbox", { name: "Mensagem" })).toHaveValue("Chegou ao limite de uso?");
  const nova = (app.roteador.state.location.search as { readonly id?: string }).id;
  expect(nova).not.toBe(sessao);
  expect((await api.chamar((c) => c["conversa.carregar"]({ sessao: nova! }))).itens).toEqual([]);
  semIngles();

  // A antiga diz com que IA continuou, com o link.
  await app.roteador.navigate({ to: "/conversa", search: { id: sessao } });
  await expect.element(page.getByText(/^Continuada com o Gemini\./)).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Abrir a conversa" })).toBeVisible();
  await expect.element(cartao.getByRole("button", { name: "Continuar com Gemini" })).not.toBeInTheDocument();

  // Enviada na nova, a pergunta vai com o histórico.
  await page.getByRole("button", { name: "Abrir a conversa" }).click();
  await page.getByRole("button", { name: "Enviar" }).click();
  const foi = page.getByRole("log", { name: "Mensagens" }).getByRole("list", { name: "Foi junto" });
  await expect.element(foi.getByText("Histórico da conversa com o Claude (2 mensagens)")).toBeVisible();
});

it("a conversa ao lado levada à tela cheia e continuada com outra IA: o painel passa à nova, aberta na tela cheia", async () => {
  await page.viewport(1440, 900);
  await using app = await montarApp(servidor, "/explorar");
  const { api, painel } = app.contexto;
  await entrarNoGemini(api);
  const sessao = await conversaComMensagem(api, "O que diz a DCN?");
  // A conversa ao lado, levada à tela cheia (⤢) a partir do Explorar.
  painel.conversar({});
  painel.enviada(sessao, { texto: "", chaves: [] });
  painel.fechar();
  painel.levarATelaCheia("/explorar");
  await app.roteador.navigate({ to: "/conversa", search: { id: sessao } });
  const mensagens = page.getByRole("main").getByRole("log", { name: "Mensagens" });
  await expect.element(mensagens.getByRole("button", { name: "Res. CNE/CP nº 1/2021" })).toBeVisible();
  await page.getByRole("textbox", { name: "Mensagem" }).fill("Chegou ao limite de uso?");
  await page.getByRole("button", { name: "Enviar" }).click();
  const cartao = mensagens.getByRole("alert").filter({ hasText: "O Claude chegou ao limite da sua assinatura" });
  await cartao.getByRole("button", { name: "Continuar com Gemini" }).click();
  await expect.element(page.getByText("· Gemini (Antigravity)")).toBeVisible();
  const nova = (app.roteador.state.location.search as { readonly id?: string }).id;
  expect(nova).not.toBe(sessao);

  // O painel segue a conversa nova: a aba não reabre a antiga ao lado da nova, e "Trazer de volta" vale.
  expect(painel.obter().conversa).toMatchObject({ id: nova, voltarPara: "/explorar" });
  painel.mostrar("conversar");
  const aoLado = page.getByRole("complementary", { name: "Painel ao lado" });
  await expect.element(aoLado.getByText("Aberta na tela cheia.")).toBeVisible();
  semIngles();
  await aoLado.getByRole("button", { name: "Trazer de volta" }).click();
  await expect.poll(() => app.roteador.state.location.pathname).toBe("/explorar");
  await expect.element(aoLado.getByRole("textbox", { name: "Pergunta à IA" })).toBeVisible();
});

it("a resposta que termina com a janela sem foco fica pronta até a pessoa voltar à janela", async () => {
  const { selos } = ponteComAvisos();
  await using app = await montarApp(servidor, "/");
  const { api } = app.contexto;
  const { pasta } = await api.chamar((c) => c["pasta.criar"]({ titulo: "Foco" }));
  const { sessao } = await api.chamar((c) => c["conversa.iniciar"]({ provider: "claude", pastaTrabalho: pasta }));
  await app.roteador.navigate({ to: "/conversa", search: { id: sessao } });
  const foco = vi.spyOn(document, "hasFocus").mockReturnValue(false);
  await page.getByRole("textbox", { name: "Mensagem" }).fill("O que diz a DCN?");
  await page.getByRole("button", { name: "Enviar" }).click();
  const mensagens = page.getByRole("log", { name: "Mensagens" });
  await expect.element(mensagens.getByRole("button", { name: "Res. CNE/CP nº 1/2021" })).toBeVisible();
  // Na tela, mas com a pessoa em outra janela: a bandeja e o selo dizem que a resposta está pronta.
  const situacao = () =>
    app.contexto.atividades.obter().atividades.find((a) => a.id === `conversa:${sessao}`)?.situacao;
  await expect.poll(situacao).toBe("pronta");
  const comPronta = selos.at(-1)!;
  expect(comPronta).toBeGreaterThan(0);

  foco.mockReturnValue(true);
  window.dispatchEvent(new Event("focus"));
  await expect.poll(situacao).toBeUndefined();
  await expect.poll(() => selos.at(-1)).toBe(comPronta - 1);
});

it("o aviso desligado não sai numa tela que não lê as preferências, e a bandeja que esvaziou aberta não reabre", async () => {
  const { avisos } = ponteComAvisos();
  await using app = await montarApp(servidor, "/explorar");
  const { api } = app.contexto;
  await api.chamar((c) => c["preferencias.avisarNoSistema"]({ ligar: false }));
  try {
    const escreve = await conversaComMensagem(api, "Pode escrever outro resumo?");
    await expect
      .poll(() => document.querySelector("[data-anuncio-atividades]")?.textContent)
      .toBe("A IA pede permissão: Conversa “Pode escrever outro resumo?”");
    // A tela não lê as preferências: o aviso as carregou antes de decidir (e decidiu antes desta leitura).
    expect(await avisosDoSistemaLigados(api)).toBe(false);
    expect(avisos).toEqual([]);

    // As respostas prontas dos testes anteriores saem (vistas): a bandeja fica só com o pedido.
    for (const atividade of app.contexto.atividades.obter().atividades) {
      const id = atividade.id.replace(/^conversa:/, "");
      if (id !== escreve) await api.chamar((c) => c["conversa.marcarVista"]({ sessao: id }));
    }
    const botao = page.getByRole("button", { name: "Em andamento: 1" });
    await botao.click();
    await expect.element(botao).toHaveAttribute("aria-expanded", "true");
    // Apagada com o pedido pendente, sai da bandeja aberta, que fica vazia.
    await api.chamar((c) => c["conversa.apagar"]({ sessao: escreve }));
    await expect.element(page.getByRole("button", { name: /^Em andamento/ })).not.toBeInTheDocument();

    // Outra conversa começa: o botão volta, fechado, sem abrir a bandeja sozinho.
    const demorada = await conversaComMensagem(api, "Outra resposta que demora");
    const deNovo = page.getByRole("button", { name: "Em andamento: 1" });
    await expect.element(deNovo).toBeVisible();
    await expect.element(deNovo).toHaveAttribute("aria-expanded", "false");
    await expect.element(page.getByRole("list", { name: "Em andamento" })).not.toBeInTheDocument();
    await api.chamar((c) => c["conversa.interromper"]({ sessao: demorada }));
  } finally {
    await api.chamar((c) => c["preferencias.avisarNoSistema"]({ ligar: true }));
  }
});

it("o cartão de um limite antigo não oferece outra IA; a ficha tirada da caixa da continuação não volta", async () => {
  await using app = await montarApp(servidor, "/");
  const { api } = app.contexto;
  const sessao = await conversaComMensagem(api, "Chegou ao limite de uso de novo?");
  await app.roteador.navigate({ to: "/conversa", search: { id: sessao } });
  const mensagens = page.getByRole("log", { name: "Mensagens" });
  const cartao = mensagens.getByRole("alert").filter({ hasText: "O Claude chegou ao limite da sua assinatura" });
  await expect.element(cartao.getByRole("button", { name: "Continuar com Gemini" })).toBeVisible();

  // O limite passou e a conversa seguiu com o Claude: o cartão antigo fica sem a troca.
  await page.getByRole("textbox", { name: "Mensagem" }).fill("E a carga horária?");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect.element(mensagens.getByRole("button", { name: "Res. CNE/CP nº 1/2021" })).toBeVisible();
  await expect.element(cartao.getByRole("button", { name: "Continuar com Gemini" })).not.toBeInTheDocument();

  // Outra no limite, continuada com o Gemini: a ficha do histórico sai pelo teclado e não volta.
  await page.getByRole("textbox", { name: "Mensagem" }).fill("Chegou ao limite de uso agora?");
  await page.getByRole("button", { name: "Enviar" }).click();
  const ultimo = mensagens.getByRole("alert").filter({ hasText: "O Claude chegou ao limite da sua assinatura" }).last();
  await ultimo.getByRole("button", { name: "Continuar com Gemini" }).click();
  await expect.element(page.getByText("· Gemini (Antigravity)")).toBeVisible();
  const nova = (app.roteador.state.location.search as { readonly id?: string }).id!;
  const fichas = page.getByRole("region", { name: "Vai junto com a pergunta" });
  const tirar = fichas.getByRole("button", { name: /^Tirar “Histórico da conversa com o Claude/ });
  (tirar.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(fichas).not.toBeInTheDocument();
  await expect.element(page.getByRole("textbox", { name: "Mensagem" })).toHaveFocus();

  await app.roteador.navigate({ to: "/" });
  await app.roteador.navigate({ to: "/conversa", search: { id: nova } });
  await expect.element(page.getByRole("textbox", { name: "Mensagem" })).toHaveValue("Chegou ao limite de uso agora?");
  expect(page.getByRole("region", { name: "Vai junto com a pergunta" }).elements()).toEqual([]);
});
