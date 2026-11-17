/**
 * O app inteiro no Chromium, conectado por RPC ao `apps/server` de verdade com os drivers de
 * demonstração (`test/servidor-teste.ts`, num processo Node): o Modo Servidor (Início com a data da
 * base, os cartões e a caixa de pedido; o formulário da tarefa; a conversa com etapas, detalhes
 * técnicos, avaliação e a pasta com o Desfazer), Configurações com os três providers, instalar e
 * entrar, a conversa com aprovação, link `ifpr://` no painel de leitura, interromper e nova conversa, e
 * "Analisar um PPC" (a revisão prévia sem IA, com o Worker de verdade e a ponte do desktop simulada: o
 * diálogo devolve o PPC sintético do servidor de teste).
 */
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import type { ServidorTeste } from "../vite.config.ts";
import {
  editarArquivoDeTarefa,
  iniciarServidorTeste,
  montarApp,
  pararServidoresTeste,
  simularInstalacaoClaude,
} from "../test/navegador.tsx";
import type { PonteDesktop } from "./ponte-desktop.ts";

let servidor: ServidorTeste;

/**
 * Capturas de tela para a revisão: com `VITE_CAPTURAS=<pasta>` no ambiente, cada etapa do Modo Servidor
 * vira um PNG lá. Sem a variável, nada se grava.
 */
const CAPTURAS = import.meta.env.VITE_CAPTURAS as string | undefined;
async function capturar(nome: string) {
  if (CAPTURAS !== undefined && CAPTURAS !== "") await page.screenshot({ path: `${CAPTURAS}/${nome}.png` });
}

beforeAll(async () => {
  servidor = await iniciarServidorTeste({ atrasoLogin: 1500 });
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

it("Configurações › Sua IA: o aviso de uso, os três providers, instalar, entrar e não usar no app", async () => {
  await using _app = await montarApp(servidor, "/configuracoes");

  await expect.element(page.getByRole("status").getByText("Conectado")).toBeVisible();
  await expect.element(page.getByRole("region", { name: "O que vai para a IA" })).toBeVisible();
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
  // O app faz o login do Codex (M1.8): "Entrar" mostra a página de login da OpenAI e conclui.
  await codex.getByRole("button", { name: "Entrar" }).click();
  const linkCodex = codex.getByRole("link", { name: "Abrir a página de login" });
  await expect.element(linkCodex).toHaveAttribute("href", expect.stringMatching(/^https:\/\/auth\.openai\.com\//));
  await expect.element(codex.getByText("Conectado")).toBeVisible();
  // Em Configurações, cada IA pode sair da escolha das conversas sem sair da conta.
  await codex.getByRole("button", { name: "Não usar no app" }).click();
  await expect.element(codex.getByText("Fora da escolha das conversas.", { exact: false })).toBeVisible();
  await codex.getByRole("button", { name: "Voltar a usar no app" }).click();

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
  await expect.element(page.getByText("A IA pede permissão: Gravar arquivo")).toBeVisible();
  // As chamadas de ferramenta ficam recolhidas em "Detalhes técnicos".
  await page.getByText("Detalhes técnicos · 1 consulta").click();
  await expect.element(page.getByText("Buscar norma")).toBeVisible();
  await page.getByRole("button", { name: "Permitir" }).click();
  await expect.element(page.getByText("Permitido.")).toBeVisible();

  // O link ifpr:// da resposta abre o painel de leitura, com o texto lido da base.
  const citacao = page.getByRole("button", { name: "Res. CNE/CP nº 1/2021" });
  await expect.element(citacao).toBeVisible();
  await citacao.click();
  const painel = page.getByRole("complementary", { name: "Painel de leitura" });
  // O cabeçalho do painel diz o nome curto da norma, não o link.
  await expect.element(painel.getByText("Res. CNE/CP 1/2021", { exact: true })).toBeVisible();
  expect(painel.element().textContent).not.toMatch(/ifpr:\/\//);
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

  // O cartão da tarefa nativa leva ao fluxo da revisão prévia.
  await page.getByRole("link", { name: /^Analisar um PPC/ }).click();
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

it("Modo Servidor: do cartão à conversa com etapas, avaliação, pasta da tarefa e Desfazer", async () => {
  const abrirArquivoTarefa = vi.fn(async (_caminho: string) => {});
  const mostrarArquivoTarefa = vi.fn(async (_caminho: string) => {});
  const escolherAnexo = vi.fn(async (_extensoes?: ReadonlyArray<string>) => servidor.parecer);
  window.simplifica = {
    conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
    escolherAnexo,
    abrirArquivoTarefa,
    mostrarArquivoTarefa,
  } satisfies PonteDesktop;
  await page.viewport(1280, 860);
  await using _app = await montarApp(servidor);

  // Início: a data da base, a caixa de pedido, os cartões (a tarefa nativa e a skill) e os recentes.
  await expect.element(page.getByText(/^Base de \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();
  await expect.element(page.getByRole("textbox", { name: "O que você precisa hoje?" })).toBeVisible();
  const tarefas = page.getByRole("region", { name: "Tarefas" });
  await expect.element(tarefas.getByRole("link", { name: /^Analisar um PPC/ })).toBeVisible();
  const cartao = tarefas.getByRole("link", { name: /^Conferir a fundamentação normativa/ });
  await expect.element(cartao).toBeVisible();
  await expect.element(page.getByRole("heading", { name: "Recentes" })).toBeVisible();
  // O botão provisório de antes não existe mais: só o cartão.
  expect(document.querySelectorAll("a[href$='/revisao-ppc']").length).toBe(1);
  semIngles();
  await capturar("01-inicio");

  // A tarefa: o formulário das entradas do manifesto, a frase do tempo e o pedido editável.
  await cartao.click();
  await expect.element(page.getByRole("heading", { name: "Conferir a fundamentação normativa" })).toBeVisible();
  await expect.element(page.getByText("Leva cerca de 10 minutos.")).toBeVisible();
  const comecar = page.getByRole("button", { name: "Começar" });
  await expect.element(comecar).toBeDisabled();
  await expect.element(page.getByText("Falta: Documento a conferir.")).toBeVisible();
  await page.getByRole("button", { name: "Escolher arquivo…" }).click();
  expect(escolherAnexo).toHaveBeenCalledWith([".md", ".txt", ".pdf"]);
  const pedido = page.getByLabelText("O pedido que vai para a IA");
  await expect
    .element(pedido)
    .toHaveValue("Conferir a fundamentação normativa.\nDocumento a conferir: parecer.md (está na pasta da tarefa).");
  await pedido.fill("Conferir a fundamentação normativa do parecer.md, com atenção ao estágio.");
  semIngles();
  await capturar("02-tarefa");
  await comecar.click();

  // A conversa: o pedido como a pessoa o escreveu (sem a indicação da skill, que só vai à IA).
  const mensagens = page.getByRole("log", { name: "Mensagens" });
  await expect
    .element(mensagens.getByText("Conferir a fundamentação normativa do parecer.md, com atenção ao estágio."))
    .toBeVisible();
  expect(mensagens.element().textContent).not.toMatch(/Siga a skill|verificar-fundamentacao-normativa/);
  await expect.element(mensagens.getByText("A IA pede permissão: Gravar arquivo")).toBeVisible();
  expect((mensagens.element() as HTMLElement).innerText).not.toMatch(/\bWrite\b/);
  await page.getByRole("button", { name: "Permitir" }).click();

  // As etapas: todas feitas no fim; as chamadas, recolhidas.
  const etapas = page.getByRole("region", { name: "Etapas: Conferir a fundamentação normativa" });
  await expect.element(etapas.getByText("Ler a fonte de cada alegação")).toBeVisible();
  await expect.element(etapas.getByText("Andamento informado pela IA.")).toBeVisible();
  await expect.element(mensagens.getByRole("button", { name: "Res. CNE/CP nº 1/2021" })).toBeVisible();
  await expect.element(etapas.getByText("(feita)").nth(3)).toBeInTheDocument();
  await expect.element(mensagens.getByText(/^Detalhes técnicos · \d+ consultas$/)).toBeVisible();
  // As chamadas da ferramenta `etapa` ficam só nos detalhes técnicos, recolhidos.
  expect((mensagens.element() as HTMLElement).innerText).not.toMatch(/Etapa da tarefa/);

  // Avaliação: 👍 gravado; "Isto está errado" avisa que vem em breve.
  const util = mensagens.getByRole("button", { name: "Resposta útil" });
  await util.click();
  await expect.element(util).toHaveAttribute("aria-pressed", "true");
  await mensagens.getByRole("button", { name: "Isto está errado" }).click();
  await expect.element(mensagens.getByText(/Em breve você vai poder apontar o trecho errado/)).toBeVisible();
  semIngles();
  await capturar("03-conversa-etapas");

  // A pasta da tarefa: o que entrou, o que a IA gravou, Abrir e Mostrar na pasta.
  await page.getByRole("button", { name: "Pasta da tarefa" }).click();
  const pasta = page.getByRole("complementary", { name: "Pasta da tarefa" });
  const trouxe = pasta.getByRole("region", { name: "Você trouxe" });
  await expect.element(trouxe.getByText("parecer.md")).toBeVisible();
  const mudados = pasta.getByRole("region", { name: "Criados ou mudados na conversa" });
  await expect.element(mudados.getByText("relatorio.md")).toBeVisible();
  await pasta.getByRole("button", { name: "Abrir relatorio.md" }).click();
  // Um arquivo que não é documento só tem "Mostrar na pasta".
  await editarArquivoDeTarefa(
    `${servidor.pastaTrabalhos}/Conferir a fundamentação normativa/rodar.command`,
    "echo oi\n",
  );
  await pasta.getByRole("button", { name: "Fechar a pasta da tarefa" }).click();
  await page.getByRole("button", { name: "Pasta da tarefa" }).click();
  await expect.element(pasta.getByRole("button", { name: "Mostrar rodar.command na pasta" })).toBeVisible();
  await expect.element(pasta.getByRole("button", { name: "Abrir rodar.command" })).not.toBeInTheDocument();
  await pasta.getByRole("button", { name: "Mostrar relatorio.md na pasta" }).click();
  expect(abrirArquivoTarefa).toHaveBeenCalledWith(
    expect.stringMatching(/Simplifica IF\/Conferir a fundamentação normativa\/relatorio\.md$/),
  );
  expect(mostrarArquivoTarefa).toHaveBeenCalledTimes(1);
  await capturar("04-pasta");

  // Desfazer: pede confirmação e diz o que muda; cancelar não muda nada; confirmar tira o relatório.
  await pasta.getByRole("button", { name: "Desfazer o que a IA fez nesta pasta" }).click();
  const confirmacao = pasta.getByRole("group", { name: "Desfazer o que a IA fez nesta pasta?" });
  await expect.element(confirmacao.getByText("Saem: relatorio.md")).toBeVisible();
  await capturar("05-desfazer");
  await confirmacao.getByRole("button", { name: "Cancelar" }).click();
  await expect.element(mudados.getByText("relatorio.md")).toBeVisible();
  // A pessoa edita o relatório fora da conversa: a confirmação avisa e só o desfaz se ela marcar.
  const relatorio = abrirArquivoTarefa.mock.calls[0]![0];
  await editarArquivoDeTarefa(relatorio, "# Relatório\n\nCom a minha revisão.\n");
  await pasta.getByRole("button", { name: "Fechar a pasta da tarefa" }).click();
  await page.getByRole("button", { name: "Pasta da tarefa" }).click();
  await pasta.getByRole("button", { name: "Desfazer o que a IA fez nesta pasta" }).click();
  await expect
    .element(confirmacao.getByText(/Este arquivo também foi mudado fora da conversa depois: relatorio\.md/))
    .toBeVisible();
  await expect.element(confirmacao.getByText("Saem: relatorio.md")).not.toBeInTheDocument();
  await confirmacao.getByRole("checkbox", { name: /Desfazer também esses arquivos/ }).click();
  await expect.element(confirmacao.getByText("Saem: relatorio.md")).toBeVisible();
  await pasta.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect.element(pasta.getByText("Pronto: a pasta voltou ao que era antes da mensagem.")).toBeVisible();
  // Sai o que a IA criou; o arquivo posto na pasta fora da conversa fica.
  await expect.element(mudados.getByText("relatorio.md")).not.toBeInTheDocument();
  await expect.element(mudados.getByText("rodar.command")).toBeVisible();
  await expect.element(trouxe.getByText("parecer.md")).toBeVisible();
  semIngles();

  // A avaliação ficou no servidor: reabrir a conversa a mostra.
  await page.getByRole("button", { name: "Nova tarefa" }).click();
  await expect.element(page.getByRole("textbox", { name: "O que você precisa hoje?" })).toBeVisible();
  await page
    .getByRole("link", { name: /Conferir a fundamentação normativa do parecer/ })
    .first()
    .click();
  await expect.element(page.getByRole("button", { name: "Resposta útil" })).toHaveAttribute("aria-pressed", "true");
});

it("Modo Servidor: a caixa do Início abre uma conversa numa pasta nova", async () => {
  await using _app = await montarApp(servidor);
  const caixa = page.getByRole("textbox", { name: "O que você precisa hoje?" });
  await caixa.fill("Quais normas tratam do estágio?");
  await userEvent.keyboard("{Enter}");
  const mensagens = page.getByRole("log", { name: "Mensagens" });
  await expect.element(mensagens.getByText("Quais normas tratam do estágio?")).toBeVisible();
  // Sem tarefa de skill, nada de etapas; a pasta existe, vazia, com o nome do pedido.
  await expect.element(mensagens.getByRole("region", { name: /^Etapas/ })).not.toBeInTheDocument();
  await page.getByRole("button", { name: "Pasta da tarefa" }).click();
  await expect.element(page.getByText("Documentos › Simplifica IF › Quais normas tratam do estágio")).toBeVisible();
  await expect.element(page.getByText("A pasta está vazia.")).toBeVisible();
});

it("Primeiro uso: aviso, conectar a IA (Claude guiado e Codex), perfil, tarefa de exemplo e Configurações", async () => {
  // Um servidor só deste teste: o primeiro uso por fazer e o Claude Code ausente até a pessoa
  // "instalar" (`simularInstalacaoClaude`), enquanto o app espera o "Já fiz, conferir".
  const novo = await iniciarServidorTeste({ atrasoLogin: 300, primeiroUso: true, claudeAusente: true });
  await using app = await montarApp(novo, "/");

  // O Início leva às boas-vindas; o aviso de uso vem antes dos passos.
  await expect.element(page.getByRole("heading", { name: "Boas-vindas ao Simplifica IF" })).toBeVisible();
  const aviso = page.getByRole("region", { name: "O que vai para a IA" });
  await expect.element(aviso.getByText(/Não anexe, não cole e não deixe na pasta da tarefa/)).toBeVisible();
  await expect.element(aviso.getByText(/os arquivos que estiverem na pasta da tarefa/)).toBeVisible();
  await expect.element(aviso.getByText(/também fica guardado na empresa dela/)).toBeVisible();
  expect(app.roteador.state.location.pathname).toBe("/boas-vindas");
  semIngles();
  await capturar("10-boas-vindas-aviso");
  await page.getByRole("button", { name: "Entendi" }).click();

  // Passo 1, Claude: o passo guiado, sem baixar nada pelo app.
  await expect.element(page.getByRole("heading", { name: "Conecte a sua IA" })).toBeVisible();
  const claude = page.getByRole("region", { name: "Claude" });
  await expect.element(claude.getByRole("button", { name: "Abrir a página de instalação" })).toBeVisible();
  expect(claude.getByLabelText("Comando de instalação").element().textContent).toMatch(/^curl .*claude\.ai\/install/);
  expect(claude.getByLabelText("Comando de login").element().textContent).toBe("claude");
  // "Já fiz, conferir" antes de instalar: diz o que falta.
  await claude.getByRole("button", { name: "Já fiz, conferir" }).click();
  await expect.element(claude.getByText(/Ainda não encontramos o Claude Code/)).toBeVisible();
  await capturar("11-boas-vindas-claude");
  // A pessoa instala e entra; o app confere e segue.
  await simularInstalacaoClaude(novo.sinalClaude);
  await claude.getByRole("button", { name: "Já fiz, conferir" }).click();
  await expect.element(page.getByText("Pronto: Claude conectado.")).toBeVisible();
  await expect.element(claude.getByText("Conectado")).toBeVisible();

  // Passo 1, ChatGPT: o app instala e faz o login.
  await page.getByRole("radio", { name: /ChatGPT \(Codex\)/ }).click();
  const codex = page.getByRole("region", { name: "ChatGPT (Codex)" });
  await codex.getByRole("button", { name: "Instalar" }).click();
  await codex.getByRole("button", { name: "Entrar" }).click();
  await expect.element(page.getByText("Pronto: ChatGPT (Codex) conectado.")).toBeVisible();
  semIngles();
  await capturar("12-boas-vindas-ia");
  await page.getByRole("button", { name: "Continuar" }).click();

  // Passo 2: o perfil, com os campi e os cursos da base.
  await expect.element(page.getByRole("heading", { name: "Conte quem você é" })).toBeVisible();
  await expect.element(page.getByText(/fica só neste computador/)).toBeVisible();
  await userEvent.selectOptions(page.getByLabelText("Campus").element() as HTMLSelectElement, "curitiba");
  await page.getByRole("radio", { name: "Coordenação de Curso" }).click();
  await page.getByRole("checkbox", { name: /Técnico em Enfermagem/ }).click();
  semIngles();
  await capturar("13-boas-vindas-perfil");
  await page.getByRole("button", { name: "Salvar e continuar" }).click();

  // Passo 3: para a coordenação, analisar o PPC do curso vem primeiro; a conversa de exemplo, depois.
  await expect.element(page.getByRole("heading", { name: "Experimente uma tarefa" })).toBeVisible();
  const ppc = page.getByRole("region", { name: "Analisar o PPC de Técnico em Enfermagem" });
  await expect.element(ppc.getByText("Sugerida")).toBeVisible();
  await expect.element(ppc.getByText(/não gasta a sua cota/)).toBeVisible();
  const conferir = page.getByRole("region", { name: "Conferir a fundamentação normativa de um trecho" });
  await expect.element(conferir.getByText(/Usa pouco da sua cota/)).toBeVisible();
  semIngles();
  await capturar("14-boas-vindas-exemplo");
  await conferir.getByRole("button", { name: "Fazer agora" }).click();
  const mensagens = page.getByRole("log", { name: "Mensagens" });
  await expect.element(mensagens.getByText(/Confira a fundamentação normativa deste trecho de PPC/)).toBeVisible();

  // O Início: a linha do perfil, sem voltar às boas-vindas, e o lembrete ao lado do anexo.
  await app.roteador.navigate({ to: "/" });
  await expect.element(page.getByText("Coordenação de Curso · Campus Curitiba")).toBeVisible();
  await expect.element(page.getByText("Não anexe documento com dado pessoal ou de acesso restrito.")).toBeVisible();
  const tarefas = page.getByRole("region", { name: "Tarefas" });
  await expect.element(tarefas.getByRole("link", { name: /Analisar um PPC/ })).toBeVisible();
  await expect.element(tarefas.getByRole("link", { name: /Conferir a fundamentação normativa/ })).toBeVisible();
  await capturar("15-inicio-com-perfil");

  // Configurações › Seu perfil: o salvo, editar e apagar; "Rever as boas-vindas".
  await app.roteador.navigate({ to: "/configuracoes" });
  await expect.element(page.getByText("Salvo: Coordenação de Curso · Campus Curitiba.")).toBeVisible();
  await page.getByRole("radio", { name: "Pedagogia" }).click();
  await page.getByRole("button", { name: "Salvar o perfil" }).click();
  await expect.element(page.getByText("Salvo: Pedagogia · Campus Curitiba.")).toBeVisible();
  await expect.element(page.getByRole("link", { name: "Rever as boas-vindas" })).toBeVisible();
  semIngles();
  await capturar("16-configuracoes");
  await page.getByRole("button", { name: "Apagar o perfil" }).click();
  await expect.element(page.getByText("Nenhum perfil salvo.")).toBeVisible();
  await app.roteador.navigate({ to: "/" });
  await expect.element(page.getByRole("link", { name: /Preencha seu perfil/ })).toBeVisible();
});

it('Configurações antes do aviso aceito: sem "Entrar" até o "Entendi"', async () => {
  const novo = await iniciarServidorTeste({ atrasoLogin: 300, primeiroUso: true });
  await using _app = await montarApp(novo, "/configuracoes");
  const aviso = page.getByRole("region", { name: "O que vai para a IA" });
  const gemini = page.getByRole("region", { name: "Gemini (Antigravity)" });
  await expect.element(gemini.getByText(/Para entrar, leia o aviso de uso acima/)).toBeVisible();
  await expect.element(gemini.getByRole("button", { name: "Entrar" })).not.toBeInTheDocument();
  await aviso.getByRole("button", { name: "Entendi" }).click();
  await expect.element(gemini.getByRole("button", { name: "Entrar" })).toBeVisible();
  await expect.element(aviso.getByRole("button", { name: "Entendi" })).not.toBeInTheDocument();
});
