/**
 * O app inteiro no Chromium, conectado por RPC ao `apps/server` de verdade com os drivers de
 * demonstração (`test/servidor-teste.ts`, num processo Node): o Modo Servidor (Início com a data da
 * base, os cartões e a caixa de pedido; o formulário da tarefa; a conversa com etapas, detalhes
 * técnicos, avaliação e a pasta com o Desfazer), Configurações com os três providers, instalar e
 * entrar, a conversa com aprovação, link `ifpr://` no painel de leitura, interromper e nova conversa, e
 * "Revisar um PPC" (a revisão prévia sem IA, com o Worker de verdade e a ponte do desktop simulada: o
 * diálogo devolve o PPC sintético do servidor de teste).
 */
import { NO_MAC } from "./components/BuscaPainel.tsx";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import type { ServidorTeste } from "../vite.config.ts";
import {
  achadosDaTela,
  editarArquivoDeTarefa,
  iniciarServidorTeste,
  montarApp,
  montarAppComOrigem,
  pararServidoresTeste,
  simularInstalacaoClaude,
} from "../test/navegador.tsx";
import { ALTURA_BARRA_TITULO } from "./barra-titulo.ts";
import type { PonteDesktop } from "@simplifica-if/contratos-app/ponte";

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

/**
 * Nenhum texto em inglês nem jargão técnico na tela (M1.14): o visível, o só para leitor de tela e os
 * atributos acessíveis (`achadosDaTela`, com a lista de palavras e as exceções em `test/ingles.ts`).
 */
function semIngles() {
  expect(achadosDaTela()).toEqual([]);
}

it("Configurações › Sua IA: o aviso de uso, os três providers, instalar, entrar e não usar no app", async () => {
  await using _app = await montarApp(servidor, "/configuracoes");

  // Conectado, o cabeçalho não mostra nada: a região de estado fica vazia, à espera de uma queda.
  await expect.poll(() => cabecalho().querySelector("[role=status]")?.getAttribute("data-fase")).toBe("conectada");
  expect(cabecalho().querySelector("[role=status]")?.textContent).toBe("");
  expect(cabecalho().textContent).not.toMatch(/Conectado/);
  await expect.element(page.getByRole("region", { name: "O que vai para a IA" })).toBeVisible();
  const claude = page.getByRole("region", { name: "Claude" });
  await expect.element(claude.getByText("Conectado")).toBeVisible();
  await expect.element(claude.getByText("max")).toBeVisible();
  // A marca de cada IA ao lado do nome, só decoração.
  for (const provider of ["claude", "codex", "antigravity"]) {
    const marca = document.querySelector(`section [data-marca-ia="${provider}"]`);
    expect(marca?.getAttribute("aria-hidden"), provider).toBe("true");
  }
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
  await page.getByLabelText("Pasta da tarefa").fill(servidor.pasta);
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

  // O erro do provider (M1.14): a frase pelo tipo, com o que fazer; o original em inglês só nos detalhes.
  await mensagem.fill("Chegou ao limite de uso?");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect.element(page.getByText(/^Sua conta do Claude chegou ao limite de uso\./)).toBeVisible();
  expect(document.body.innerText).not.toMatch(/usage limit/);
  semIngles();
  await page.getByText("Detalhes técnicos", { exact: true }).last().click();
  await expect.element(page.getByText(/You've hit your usage limit/)).toBeVisible();
  semIngles();

  await page.getByRole("button", { name: "Nova conversa" }).click();
  await expect.element(page.getByRole("button", { name: "Começar conversa" })).toBeVisible();
  await expect.element(page.getByLabelText("Pasta da tarefa")).toHaveValue(servidor.pasta);

  // A conversa ficou gravada: a lista lateral (só em tela larga) a reabre, com o histórico.
  await page.viewport(1280, 800);
  const lista = page.getByRole("navigation", { name: "Conversas gravadas" });
  await lista.getByRole("link", { name: /Pode escrever um resumo da DCN\?/ }).click();
  await expect.element(mensagens.getByText("Pode escrever um resumo da DCN?")).toBeVisible();
  await expect.element(mensagens.getByText("Resposta interrompida.")).toBeVisible();
});

it("Revisar um PPC: do Início ao resultado, com a régua, o bloqueio do curso, a lista por tema e a cópia comentada", async () => {
  const abrirDocumento = vi.fn(async (_caminho: string) => {});
  const mostrarNaPasta = vi.fn(async (_caminho: string) => {});
  window.simplifica = {
    conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
    escolherDocx: async () => servidor.ppc,
    abrirDocumento,
    mostrarNaPasta,
  } satisfies PonteDesktop;
  await page.viewport(1280, 900);
  await using _app = await montarApp(servidor);

  // O cartão da tarefa nativa leva à entrada: a frase e a área de soltar, com o botão.
  await page.getByRole("link", { name: /^Revisar um PPC/ }).click();
  await expect.element(page.getByRole("heading", { name: "Revisar um PPC" })).toBeVisible();
  await expect.element(page.getByText("Confira seu PPC contra as normas antes de enviar à PROENS.")).toBeVisible();
  await page.getByRole("button", { name: "Escolher o PPC" }).click();

  // A frase-resultado diz quanto foi lido; a régua tem um traço por critério, agrupados por tema.
  const frase = page.getByRole("heading", { name: /critérios que o app confere sozinho\.$/ });
  await expect.element(frase).toBeVisible();
  await expect.element(page.getByRole("group", { name: /^Régua de critérios\. \d+ critérios: / })).toBeVisible();
  await expect.element(page.getByText("PPC de teste.docx", { exact: true })).toBeVisible();

  // A faixa da IA já traz a estimativa, sem "etapas" nem "referência provisória".
  const faixa = page.getByRole("region", { name: "Leitura com IA" });
  await expect.element(faixa.getByText(/O Claude lê .* em cerca de \d+ minutos?, usando perto de/)).toBeVisible();
  await expect.element(faixa.getByRole("button", { name: "Ler com o Claude" })).toBeEnabled();
  expect(faixa.element().textContent).not.toMatch(/etapa|provisória/);

  // O curso não identificado vira um bloqueio só, com as pendências que dependem dele.
  await expect
    .element(page.getByRole("heading", { name: "Não reconhecemos o curso no Catálogo Nacional (CNCT)" }))
    .toBeVisible();
  await expect.element(page.getByRole("button", { name: /pendências? dependem? disso/ })).toBeVisible();
  semIngles();

  // A coluna de temas filtra a lista; a pendência abre com o que fazer, o trecho e a fonte pelo nome.
  await page
    .getByRole("navigation", { name: "Temas" })
    .getByRole("button", { name: /AEE e inclusão/ })
    .click();
  await expect.element(page.getByRole("heading", { name: "Acesso, permanência, AEE e inclusão" })).toBeVisible();
  const linha = page.getByRole("button", { name: /O AEE aparece como componente/ });
  await linha.click();
  await expect.element(page.getByText("O que fazer")).toBeVisible();
  await expect.element(page.getByText("Atendimento Educacional Especializado", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Nota Técnica PROENS/IFPR nº 1/2025" }).click();
  await expect.element(page.getByRole("complementary", { name: "Painel de leitura" })).toBeVisible();
  // "Ver no PPC": o texto convertido do arquivo, no painel, com o trecho da pendência destacado.
  await page.getByRole("button", { name: "Ver no PPC" }).click();
  const revisado = page.getByRole("article", { name: "PPC em revisão" });
  await expect.element(revisado.getByRole("heading", { level: 2, name: "PPC de teste.docx" })).toBeVisible();
  await expect.element(revisado.getByText(/Trecho citado: o trecho apontado, destacado no texto/)).toBeVisible();
  await expect
    .poll(() =>
      [...revisado.element().querySelectorAll("mark.trecho-citado")].map((m) => m.textContent ?? "").join(" "),
    )
    .toContain("Atendimento Educacional Especializado");
  // dentro do bloco, a frase exata do trecho, realçada
  await expect
    .poll(() => [...(CSS.highlights.get("trecho-exato") ?? [])].map((r) => (r as Range).toString()).join(" "))
    .toContain("Atendimento Educacional Especializado");
  // ⌘F (macOS) ou Ctrl+F busca no texto do painel: a contagem e a ocorrência atual realçada.
  await userEvent.keyboard(NO_MAC ? "{Meta>}f{/Meta}" : "{Control>}f{/Control}");
  const busca = page.getByRole("searchbox", { name: "Buscar no texto" });
  await expect.element(busca).toHaveFocus();
  await busca.fill("educacional especializado");
  await expect.element(page.getByText(/^1 de \d+$/)).toBeVisible();
  expect(CSS.highlights.get("busca-atual")?.size).toBe(1);
  await userEvent.keyboard("{Escape}");
  await expect.element(busca).not.toBeInTheDocument();
  expect(CSS.highlights.has("busca")).toBe(false);
  await page.getByRole("button", { name: "Fechar o painel de leitura" }).click();
  // "Abrir ao lado": o texto do PPC no painel, desde o começo.
  await page.getByRole("button", { name: "Abrir ao lado" }).click();
  await expect
    .element(page.getByRole("article", { name: "PPC em revisão" }).getByRole("heading", { name: "PPC de teste.docx" }))
    .toBeVisible();
  await page.getByRole("button", { name: "Fechar o painel de leitura" }).click();
  expect(document.body.innerText).not.toMatch(/nao_atende|a_conferir|ifpr:\/\/|CT-[A-Z]+-\d/);
  semIngles();

  // "Feito" esmaece a linha e conta; F, com o foco na linha, desfaz.
  await page.getByRole("button", { name: "Feito" }).click();
  await expect.element(page.getByText(/^1 de \d+ feitas?$/).first()).toBeInTheDocument();
  (linha.element() as HTMLElement).focus();
  await userEvent.keyboard("f");
  await expect.element(page.getByText(/^0 de \d+ feitas?$/).first()).toBeInTheDocument();

  // "Abrir no Word" regrava a cópia comentada e a abre; o ⋯ mostra na pasta.
  await page.getByRole("button", { name: "Abrir no Word" }).click();
  const comentado = `${servidor.pasta}/PPC de teste - revisão prévia (Simplifica IF).docx`;
  await vi.waitFor(() => expect(abrirDocumento).toHaveBeenCalledWith(comentado));
  await page.getByRole("button", { name: "Mais ações do documento" }).click();
  await page.getByRole("menuitem", { name: "Mostrar na pasta" }).click();
  await vi.waitFor(() => expect(mostrarNaPasta).toHaveBeenCalledWith(comentado));

  // "Qual é o curso?": a escolha no CNCT revisa de novo, e o bloqueio sai.
  await page.getByRole("combobox", { name: "Qual é o curso?" }).fill("enferm");
  await page.getByRole("option", { name: /Técnico em Enfermagem/ }).click();
  await page.getByRole("button", { name: "Conferir com este curso" }).click();
  await expect.element(page.getByText(/^Técnico em Enfermagem/)).toBeVisible();
  await expect
    .element(page.getByRole("heading", { name: "Não reconhecemos o curso no Catálogo Nacional (CNCT)" }))
    .not.toBeInTheDocument();

  // Apagar pede confirmação, com o que sai e o que fica: cancelar não apaga; confirmar volta à entrada.
  await page.getByRole("button", { name: "Mais ações do documento" }).click();
  await page.getByRole("menuitem", { name: "Apagar esta revisão" }).click();
  const confirmacao = page.getByRole("alertdialog", { name: "Apagar a revisão de “PPC de teste.docx”?" });
  await expect.element(confirmacao.getByText(/^A cópia comentada/)).toBeVisible();
  await expect.element(confirmacao.getByText(comentado)).toBeVisible();
  await confirmacao.getByRole("button", { name: "Cancelar" }).click();
  await expect.element(confirmacao).not.toBeInTheDocument();
  await page.getByRole("button", { name: "Mais ações do documento" }).click();
  await page.getByRole("menuitem", { name: "Apagar esta revisão" }).click();
  await page.getByRole("button", { name: "Apagar a revisão" }).click();
  await expect.element(page.getByRole("button", { name: "Escolher o PPC" })).toBeVisible();
  // A revisão apagada sai das revisões recentes.
  await expect.element(page.getByRole("heading", { name: "Revisões recentes" })).not.toBeInTheDocument();
  semIngles();
});

it("Revisar um PPC: arquivo que não existe, com a mensagem do servidor em português", async () => {
  window.simplifica = {
    conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
    escolherDocx: async () => `${servidor.pasta}/não existe.docx`,
  } satisfies PonteDesktop;
  await using app = await montarApp(servidor, "/revisao-ppc");
  await page.getByRole("button", { name: "Escolher o PPC" }).click();
  await expect.element(page.getByText("O arquivo não foi encontrado ou não pode ser lido.")).toBeVisible();
  semIngles();
  // Com o código do erro, "Detalhes técnicos" leva a Configurações › Diagnóstico.
  await page.getByText("Detalhes técnicos").click();
  await expect.element(page.getByText(/^[0-9A-F]{8}$/)).toBeVisible();
  await page.getByRole("link", { name: "Gerar diagnóstico" }).click();
  await expect.element(page.getByRole("region", { name: "Diagnóstico" })).toBeVisible();
  expect(app.roteador.state.location.pathname).toBe("/configuracoes");
  expect(app.roteador.state.location.hash).toBe("diagnostico");
});

it("Modo Servidor: do cartão à conversa com etapas, avaliação, pasta da tarefa e Desfazer", async () => {
  const abrirArquivoTarefa = vi.fn(async (_caminho: string) => {});
  const mostrarArquivoTarefa = vi.fn(async (_caminho: string) => {});
  const escolherAnexo = vi.fn(async (_extensoes?: ReadonlyArray<string>) => servidor.parecer);
  const pastaParaLixeira = vi.fn(async (_caminho: string) => {});
  window.simplifica = {
    conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
    escolherAnexo,
    abrirArquivoTarefa,
    mostrarArquivoTarefa,
    pastaParaLixeira,
  } satisfies PonteDesktop;
  await page.viewport(1280, 860);
  await using _app = await montarApp(servidor);

  // Início: a data da base, a caixa de pedido, os cartões (a tarefa nativa e a skill) e os recentes.
  await expect.element(page.getByText(/^Base de \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();
  await expect.element(page.getByRole("textbox", { name: "O que você precisa hoje?" })).toBeVisible();
  const tarefas = page.getByRole("region", { name: "Tarefas" });
  await expect.element(tarefas.getByRole("link", { name: /^Revisar um PPC/ })).toBeVisible();
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
  // A skill não limita o formato: o diálogo oferece todos os documentos que o app aceita.
  expect(escolherAnexo).toHaveBeenCalledWith(undefined);
  await expect.element(page.getByText(/^Aceita /)).not.toBeInTheDocument();
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
  // Seguido da nota dos anexos, com o nome que o arquivo ganhou na pasta.
  await expect
    .element(
      mensagens.getByText(
        /^Conferir a fundamentação normativa do parecer\.md, com atenção ao estágio\.\s+Arquivos na pasta:\s+- parecer\.md$/,
      ),
    )
    .toBeVisible();
  expect(mensagens.element().textContent).not.toMatch(/Siga a skill|verificar-fundamentacao-normativa/);
  await expect.element(mensagens.getByText("A IA pede permissão: Gravar arquivo")).toBeVisible();
  expect((mensagens.element() as HTMLElement).innerText).not.toMatch(/\bWrite\b/);
  await page.getByRole("button", { name: "Permitir" }).click();

  // As etapas: todas feitas no fim; as chamadas, recolhidas.
  const etapas = page.getByRole("region", { name: "Etapas: Conferir a fundamentação normativa" });
  await expect.element(etapas.getByText("Ler a fonte de cada alegação")).toBeVisible();
  expect(etapas.element().textContent).not.toMatch(/Andamento informado/);
  await expect.element(mensagens.getByRole("button", { name: "Res. CNE/CP nº 1/2021" })).toBeVisible();
  await expect.element(etapas.getByText("(feita)").nth(3)).toBeInTheDocument();
  await expect.element(mensagens.getByText(/^Detalhes técnicos · \d+ consultas$/)).toBeVisible();
  // As chamadas da ferramenta `etapa` ficam só nos detalhes técnicos, recolhidos.
  expect((mensagens.element() as HTMLElement).innerText).not.toMatch(/Etapa da tarefa/);

  // Avaliação: 👍 gravado; "Isto está errado" abre o relato. Sem o repositório da curadoria na política
  // (como na fábrica, até ele abrir), só salvar ou copiar; fechar não muda a avaliação.
  const util = mensagens.getByRole("button", { name: "Resposta útil" });
  await util.click();
  await expect.element(util).toHaveAttribute("aria-pressed", "true");
  await mensagens.getByRole("button", { name: "Isto está errado" }).click();
  const relato = mensagens.getByRole("region", { name: "Relatar um erro nesta resposta" });
  await expect.element(relato.getByText(/envio direto para a equipe da base ainda não está disponível/)).toBeVisible();
  await expect.element(relato.getByRole("button", { name: "Abrir no GitHub" })).not.toBeInTheDocument();
  await expect.element(relato.getByRole("button", { name: "Salvar o relato" })).toBeVisible();
  await expect.element(relato.getByText("No GitHub, o relato fica público.")).not.toBeInTheDocument();
  semIngles();
  await relato.getByRole("button", { name: "Fechar" }).click();
  await expect.element(relato).not.toBeInTheDocument();
  await expect.element(util).toHaveAttribute("aria-pressed", "true");
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

  // Apagar a conversa: o diálogo diz o que sai e o que fica; com a pasta marcada, ela vai à Lixeira pelo
  // desktop, e a conversa da tarefa volta ao Início, sem ela nos recentes.
  await page.getByRole("button", { name: "Mais ações da conversa", exact: true }).click();
  await page.getByRole("menuitem", { name: "Apagar a conversa…" }).click();
  const apagar = page.getByRole("alertdialog", {
    name: /^Apagar a conversa “Conferir a fundamentação normativa do parecer/,
  });
  await expect.element(apagar.getByText("As cópias que o app guardava para o Desfazer")).toBeVisible();
  await expect.element(apagar.getByText(/^A pasta da tarefa “/)).toBeVisible();
  await capturar("06-apagar-conversa");
  semIngles();
  await apagar.getByRole("checkbox", { name: /^Mandar também a pasta/ }).click();
  await apagar.getByRole("button", { name: "Apagar a conversa" }).click();
  await expect.element(page.getByRole("textbox", { name: "O que você precisa hoje?" })).toBeVisible();
  expect(pastaParaLixeira).toHaveBeenCalledTimes(1);
  expect(pastaParaLixeira.mock.calls[0]![0]).toMatch(/Conferir a fundamentação normativa/);
  await expect
    .element(page.getByRole("link", { name: /Conferir a fundamentação normativa do parecer/ }))
    .not.toBeInTheDocument();
});

it("“Isto está errado” (M1.12): do 👎 ao relato revisado, publicado no GitHub, salvo e copiado", async () => {
  const curadoria = await iniciarServidorTeste({ atrasoLogin: 100, curadoria: "exemplo/simplifica-if" });
  // A ordem: o relato é registrado no servidor antes de a página do GitHub abrir.
  const ordem: Array<string> = [];
  const abrirExterno = vi.fn(async (_url: string) => void ordem.push("abrir"));
  window.simplifica = {
    conexao: async () => ({ urlServidor: curadoria.urlServidor, token: curadoria.token }),
    abrirExterno,
  } satisfies PonteDesktop;
  const sendOriginal = WebSocket.prototype.send;
  WebSocket.prototype.send = function (dados) {
    if (typeof dados === "string" && dados.includes("relato.registrar")) ordem.push("registrar");
    return sendOriginal.call(this, dados);
  };
  const copiado = vi.fn(async (_texto: string) => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText: copiado }, configurable: true });
  try {
    await page.viewport(1280, 900);
    await using _app = await montarApp(curadoria);

    await page
      .getByRole("textbox", { name: "O que você precisa hoje?" })
      .fill("O estágio é obrigatório? Pergunte a @coordenacao, como na issue #4.");
    await page.getByRole("button", { name: "Enviar" }).click();

    const mensagens = page.getByRole("log", { name: "Mensagens" });
    await expect.element(mensagens.getByRole("button", { name: "Res. CNE/CP nº 1/2021" })).toBeVisible();
    await mensagens.getByRole("button", { name: "Isto está errado" }).click();
    const relato = mensagens.getByRole("region", { name: "Relatar um erro nesta resposta" });
    const previa = relato.getByRole("region", { name: "Prévia do relato" });
    const textoDaPrevia = () => previa.element().querySelector("pre")?.textContent ?? "";
    // A pergunta, com a menção e a referência entre crases; as versões; o rótulo da issue.
    await expect
      .element(previa.getByText(/> O estágio é obrigatório\? Pergunte a `@coordenacao`, como na issue `#4`\./))
      .toBeVisible();
    await expect.element(previa.getByText(/- IA: Claude \(Claude Code\) \(versão 2\.1\.30\)/)).toBeVisible();
    await expect.element(previa.getByText("relato-do-app", { exact: true })).toBeVisible();
    // Perto do botão, o texto fixo: a issue é pública.
    const publica = relato.getByRole("alert", { name: "O relato fica público" });
    await expect.element(publica.getByText("No GitHub, o relato fica público.")).toBeVisible();
    await expect.element(publica.getByText(/Não ponha nome de estudante nem de\s+servidor/)).toBeVisible();
    // Nenhum aviso de dado pessoal: o app não confere (o aviso de uso basta).
    await relato.getByLabelText("O que está errado?").fill("A norma citada não trata disso. CPF 529.982.247-25");
    await expect.element(relato.getByText(/dado pessoal/)).not.toBeInTheDocument();
    await relato.getByLabelText("O que está errado?").fill("A norma citada não trata do estágio obrigatório.");

    // Retirar o primeiro trecho da resposta, a fonte (da lista e do texto) e as versões.
    await relato.getByRole("checkbox", { name: "Incluir o trecho 1 de a resposta da ia" }).click();
    await relato.getByRole("checkbox", { name: "Incluir a fonte ifpr://norma/br/cne-cp/res/2021/1" }).click();
    await relato.getByRole("checkbox", { name: "Incluir as versões do app, da base, da tarefa e da IA" }).click();
    await expect.element(previa.getByText(/_\[trecho retirado por quem enviou\]_/)).toBeVisible();
    expect(textoDaPrevia()).not.toMatch(/Vou consultar a base|## Versões|ifpr:\/\/norma/);
    expect(textoDaPrevia()).toContain("_[fonte retirada por quem enviou]_");
    semIngles();
    await capturar("06-relato");

    // "Abrir no GitHub": registrado antes, depois a página issues/new com o relato da prévia.
    await relato.getByRole("button", { name: "Abrir no GitHub" }).click();
    await expect.element(relato.getByText(/Abrimos a página do GitHub no navegador/)).toBeVisible();
    expect(ordem).toEqual(["registrar", "abrir"]);
    const url = new URL(abrirExterno.mock.calls[0]![0]);
    expect(`${url.origin}${url.pathname}`).toBe("https://github.com/exemplo/simplifica-if/issues/new");
    expect(url.searchParams.get("title")).toBe("Isto está errado: A norma citada não trata do estágio obrigatório.");
    expect(url.searchParams.get("labels")).toBe("relato-do-app");
    expect(`# ${url.searchParams.get("title")}\n\n${url.searchParams.get("body")}`).toBe(textoDaPrevia());
    // O relato enviado marca o 👎.
    await expect
      .element(mensagens.getByRole("button", { name: "Resposta não ajudou" }))
      .toHaveAttribute("aria-pressed", "true");

    // Salvar (fora da pasta da tarefa) e copiar.
    await relato.getByRole("button", { name: "Salvar o relato" }).click();
    await expect
      .element(
        relato.getByText(/^Relato salvo em Documentos › Simplifica IF › Relatos de erro: .*\.md\. Ele fica fora/),
      )
      .toBeVisible();
    await relato.getByRole("button", { name: "Copiar o relato" }).click();
    await expect.element(relato.getByText(/^Relato copiado\./)).toBeVisible();
    expect(copiado).toHaveBeenCalledWith(textoDaPrevia());
  } finally {
    WebSocket.prototype.send = sendOriginal;
    delete (navigator as { clipboard?: unknown }).clipboard;
  }
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
  await expect.element(aviso.getByText(/Não anexe, cole ou deixe na pasta da tarefa/)).toBeVisible();
  await expect.element(aviso.getByText(/os arquivos da pasta da tarefa/)).toBeVisible();
  await expect.element(aviso.getByText(/também pode ficar guardado pelo serviço de IA/)).toBeVisible();
  expect(app.roteador.state.location.pathname).toBe("/boas-vindas");
  semIngles();
  await capturar("10-boas-vindas-aviso");
  await page.getByRole("button", { name: "Entendi, continuar" }).click();

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

  // Passo 2: o perfil, na ordem do SUAP (sem os cursos).
  await expect.element(page.getByRole("heading", { name: "Conte quem você é" })).toBeVisible();
  await expect.element(page.getByText(/fica só neste computador/)).toBeVisible();
  await expect.element(page.getByText("Seus cursos")).not.toBeInTheDocument();
  await userEvent.selectOptions(
    page.getByLabelText("Campus ou pró-reitoria").element() as HTMLSelectElement,
    "curitiba",
  );
  await expect.element(page.getByRole("option", { name: "Pró-Reitoria de Ensino (PROENS)" })).toBeInTheDocument();
  await page.getByRole("radio", { name: "Docente" }).click();
  // Docente: o cargo vem sugerido (professor EBTT).
  expect((page.getByLabelText("Cargo").element() as HTMLSelectElement).value).toBe("professor-ebtt");
  await page.getByRole("radio", { name: "Coordenação de Curso" }).click();
  semIngles();
  await capturar("13-boas-vindas-perfil");
  await page.getByRole("button", { name: "Salvar e continuar" }).click();

  // Passo 3: para a coordenação, revisar um PPC vem primeiro; a conversa de exemplo, depois.
  await expect.element(page.getByRole("heading", { name: "Experimente uma tarefa" })).toBeVisible();
  const ppc = page.getByRole("region", { name: "Revisar um PPC" });
  await expect.element(ppc.getByText("Sugerida")).toBeVisible();
  await expect.element(ppc.getByText(/não gasta a sua cota/)).toBeVisible();
  const conferir = page.getByRole("region", { name: "Conferir a fundamentação normativa de um trecho" });
  await expect.element(conferir.getByText(/Usa pouco da sua cota/)).toBeVisible();
  semIngles();
  await capturar("14-boas-vindas-exemplo");
  await conferir.getByRole("button", { name: "Fazer agora" }).click();
  const mensagens = page.getByRole("log", { name: "Mensagens" });
  await expect.element(mensagens.getByText(/Confira a fundamentação normativa deste trecho de PPC/)).toBeVisible();

  // O Início: a linha do perfil, sem voltar às boas-vindas; sem lembrete de dado pessoal ao lado do anexo
  // (o aviso de uso do primeiro uso basta).
  await app.roteador.navigate({ to: "/" });
  await expect.element(page.getByText("Coordenação de Curso · Campus Curitiba")).toBeVisible();
  await expect.element(page.getByText(/Não anexe/)).not.toBeInTheDocument();
  const tarefas = page.getByRole("region", { name: "Tarefas" });
  await expect.element(tarefas.getByRole("link", { name: /Revisar um PPC/ })).toBeVisible();
  await expect.element(tarefas.getByRole("link", { name: /Conferir a fundamentação normativa/ })).toBeVisible();
  await capturar("15-inicio-com-perfil");

  // Configurações › Seu perfil: o salvo, editar e apagar; "Rever as boas-vindas".
  await app.roteador.navigate({ to: "/configuracoes" });
  await expect.element(page.getByText("Salvo: Coordenação de Curso · Campus Curitiba.")).toBeVisible();
  await page.getByRole("radio", { name: "Técnico-administrativo" }).click();
  await userEvent.selectOptions(page.getByLabelText("Cargo").element() as HTMLSelectElement, "pedagogo");
  await page.getByRole("radio", { name: "Nenhuma das opções" }).click();
  await page.getByRole("button", { name: "Salvar o perfil" }).click();
  await expect.element(page.getByText("Salvo: Pedagogo · Campus Curitiba.")).toBeVisible();
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

it("Configurações › Diagnóstico: a prévia do pacote, gerar e mostrar na pasta", async () => {
  const mostrarArquivoTarefa = vi.fn(async (_caminho: string) => {});
  window.simplifica = {
    conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
    mostrarArquivoTarefa,
  } satisfies PonteDesktop;
  await using _app = await montarApp(servidor, "/configuracoes");
  const secao = page.getByRole("region", { name: "Diagnóstico" });
  await expect.element(secao.getByText(/anexe o arquivo ao relatar o problema/)).toBeVisible();
  // "Gerar diagnóstico" só depois de ver a prévia; a região viva já existe, vazia.
  await expect.element(secao.getByRole("button", { name: "Gerar diagnóstico" })).toBeDisabled();
  await expect.element(secao.getByRole("status")).toBeInTheDocument();

  await secao.getByRole("button", { name: "Ver o que vai no pacote" }).click();
  const arquivos = secao.getByRole("list", { name: "Arquivos do pacote" });
  await expect.element(arquivos.getByText("simplifica-if.log", { exact: true })).toBeVisible();
  await expect.element(arquivos.getByText("sistema.json", { exact: true })).toBeVisible();
  await expect.element(arquivos.getByText("LEIA-ME.txt", { exact: true })).toBeVisible();
  await secao.getByText("Ver o conteúdo de sistema.json").click();
  await expect.element(secao.getByText(/"plataforma":/)).toBeVisible();
  // O fim do registro, já saneado (o e-mail vira o marcador).
  await secao.getByText("Ver o fim de simplifica-if.log, como vai").click();
  await expect.element(secao.getByText(/conta=\[e-mail omitido\]/)).toBeVisible();
  await expect.element(secao.getByText(/montado na hora de gerar/)).toBeVisible();
  semIngles();

  await secao.getByRole("button", { name: "Gerar diagnóstico" }).click();
  await expect.element(secao.getByText(/^Diagnóstico gerado: diagnostico-\d{4}-\d{2}-\d{2}-\d{6}\.zip/)).toBeVisible();
  await secao.getByRole("button", { name: "Mostrar na pasta" }).click();
  expect(mostrarArquivoTarefa).toHaveBeenCalledTimes(1);
  expect(mostrarArquivoTarefa.mock.calls[0]![0]).toMatch(/[\\/]Diagnósticos[\\/]diagnostico-[\d-]+\.zip$/);
  semIngles();
});

it("Escolha da IA: só entram as IAs instaladas e com login", async () => {
  // Servidor novo: o Claude pronto, o ChatGPT sem instalar e o Gemini sem login.
  const novo = await iniciarServidorTeste({ atrasoLogin: 100 });
  await using _app = await montarApp(novo);
  const ia = page.getByRole("form", { name: "O que você precisa hoje?" }).getByRole("combobox", { name: "IA" });
  await expect.element(ia).toHaveTextContent("Claude");
  // O botão do modelo aparece quando a detecção termina: a lista das IAs já está filtrada.
  await expect.element(page.getByRole("button", { name: /^Modelo:/ })).toBeVisible();
  await ia.click();
  const opcoes = page.getByRole("listbox");
  await expect.element(opcoes.getByRole("option", { name: "Claude" })).toBeVisible();
  await expect.element(opcoes.getByRole("option", { name: "ChatGPT" })).not.toBeInTheDocument();
  await expect.element(opcoes.getByRole("option", { name: "Gemini" })).not.toBeInTheDocument();
});

it("Caixa de pedido: o cartão flutuante no Início e na conversa, Enter, Shift+Enter e o botão redondo", async () => {
  const escolherAnexo = vi.fn(async (_extensoes?: ReadonlyArray<string>) => servidor.parecer);
  // O preload libera o arquivo de verdade e recusa o resto (pasta, programa).
  const anexarSoltos = vi.fn(async (arquivos: ReadonlyArray<File>) =>
    arquivos.map((arquivo) => (arquivo.name === "parecer.md" ? servidor.parecer : null)),
  );
  window.simplifica = {
    conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
    escolherAnexo,
    anexarSoltos,
  } satisfies PonteDesktop;
  await page.viewport(1100, 760);
  await using _app = await montarApp(servidor);
  // Troca o tema e espera as transições de cor terminarem, para a captura não sair no meio delas.
  const escuro = async (ligado: boolean) => {
    document.documentElement.classList.toggle("dark", ligado);
    await Promise.all(document.getAnimations().map((animacao) => animacao.finished.catch(() => undefined)));
  };
  const nosDoisTemas = async (nome: string) => {
    await escuro(false);
    await capturar(`${nome}-claro`);
    await escuro(true);
    await capturar(`${nome}-escuro`);
    await escuro(false);
  };

  // Início: o campo, o clipe (só o ícone, sem lembrete), a IA com a marca e o botão de enviar apagado
  // com o campo vazio.
  const caixa = page.getByRole("textbox", { name: "O que você precisa hoje?" });
  await expect.element(caixa).toHaveAttribute("placeholder", "O que você precisa hoje?");
  await expect.element(caixa).toHaveAccessibleDescription(/Enter envia; Shift\+Enter quebra a linha/);
  const formulario = page.getByRole("form", { name: "O que você precisa hoje?" });
  const enviar = formulario.getByRole("button", { name: "Enviar" });
  await expect.element(enviar).toBeDisabled();
  const clipe = formulario.getByRole("button", { name: "Anexar arquivo", exact: true });
  await expect.element(clipe).toBeVisible();
  await expect.element(clipe).toHaveAttribute("title", "Anexar arquivo");
  expect(clipe.element().textContent).toBe("");
  expect(clipe.element().getBoundingClientRect().width).toBe(clipe.element().getBoundingClientRect().height);
  await expect.element(formulario.getByText(/Não anexe/)).not.toBeInTheDocument();
  // A escolha da IA: a marca ao lado do nome, no botão e em cada opção; o nome continua em texto.
  const ia = formulario.getByRole("combobox", { name: "IA" });
  await expect.element(ia).toHaveTextContent("Claude");
  expect(ia.element().querySelector('[data-marca-ia="claude"]')?.getAttribute("aria-hidden")).toBe("true");
  await ia.click();
  const opcoes = page.getByRole("listbox");
  await expect.element(opcoes.getByRole("option", { name: "ChatGPT" })).toBeVisible();
  for (const provider of ["claude", "codex", "antigravity"]) {
    expect(opcoes.element().querySelector(`[data-marca-ia="${provider}"]`), provider).not.toBeNull();
  }
  await nosDoisTemas("escolha-ia");
  await opcoes.getByRole("option", { name: "ChatGPT" }).click();
  await expect.element(ia).toHaveTextContent("ChatGPT");
  expect(ia.element().querySelector('[data-marca-ia="codex"]')).not.toBeNull();
  await ia.click();
  await page.getByRole("listbox").getByRole("option", { name: "Claude" }).click();
  await expect.element(ia).toHaveTextContent("Claude");
  // Pelo teclado: Enter abre a lista, as setas andam, Enter escolhe; Esc fecha e devolve o foco à escolha.
  (ia.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByRole("listbox")).toBeVisible();
  await userEvent.keyboard("{ArrowDown}{Enter}");
  await expect.element(ia).toHaveTextContent("ChatGPT");
  await expect.element(page.getByRole("listbox")).not.toBeInTheDocument();
  expect(document.activeElement).toBe(ia.element());
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByRole("listbox")).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("listbox")).not.toBeInTheDocument();
  expect(document.activeElement).toBe(ia.element());
  await expect.element(ia).toHaveTextContent("ChatGPT");
  await ia.click();
  await page.getByRole("listbox").getByRole("option", { name: "Claude" }).click();
  await expect.element(ia).toHaveTextContent("Claude");
  // O modelo, ao lado da IA: o padrão da conta pelo nome, sem "Automático"; o raciocínio só no modelo
  // que aceita.
  const modelo = formulario.getByRole("button", { name: /^Modelo:/ });
  await expect.element(modelo).toHaveTextContent("Sonnet");
  await modelo.click();
  const menu = page.getByRole("menu");
  await expect
    .element(menu.getByRole("menuitemradio", { name: /Sonnet.*recomendado/ }))
    .toHaveAttribute("aria-checked", "true");
  await expect.element(menu.getByRole("menuitemradio", { name: /Automático/ })).not.toBeInTheDocument();
  await expect.element(menu.getByRole("menuitemradio", { name: /Aprofundado/ })).toBeVisible();
  // O menu continua aberto depois da escolha: o raciocínio aparece para o modelo que o aceita.
  await menu.getByRole("menuitemradio", { name: /Opus/ }).click();
  await menu.getByRole("menuitemradio", { name: /Aprofundado/ }).click();
  await expect
    .element(menu.getByRole("menuitemradio", { name: /Aprofundado/ }))
    .toHaveAttribute("aria-checked", "true");
  await nosDoisTemas("escolha-modelo");
  await userEvent.keyboard("{Escape}");
  await expect.element(modelo).toHaveTextContent("Opus · Aprofundado");
  await modelo.click();
  await menu.getByRole("menuitemradio", { name: /Haiku/ }).click();
  await expect.element(menu.getByRole("menuitemradio", { name: /Aprofundado/ })).not.toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await expect.element(modelo).toHaveTextContent("Haiku");
  // Trocar de IA volta ao padrão da conta; a IA sem lista de modelos não mostra o botão.
  await ia.click();
  await page.getByRole("listbox").getByRole("option", { name: "ChatGPT" }).click();
  await expect.element(modelo).not.toBeInTheDocument();
  await ia.click();
  await page.getByRole("listbox").getByRole("option", { name: "Claude" }).click();
  await expect.element(modelo).toHaveTextContent("Sonnet");
  // Shift+Enter quebra a linha, sem enviar; o botão acende.
  await caixa.click();
  await userEvent.keyboard("Quais normas tratam{Shift>}{Enter}{/Shift}do estágio?");
  await expect.element(caixa).toHaveValue("Quais normas tratam\ndo estágio?");
  await expect.element(enviar).toBeEnabled();
  await clipe.click();
  await expect.element(formulario.getByRole("list", { name: "Arquivos anexados" })).toBeVisible();
  semIngles();
  await nosDoisTemas("caixa-inicio");

  // Enter envia e abre a conversa; a caixa da conversa é o mesmo cartão, com "Mensagem".
  await caixa.click();
  await userEvent.keyboard("{Enter}");
  const mensagens = page.getByRole("log", { name: "Mensagens" });
  await expect.element(mensagens.getByText(/Quais normas tratam/)).toBeVisible();
  const mensagem = page.getByRole("textbox", { name: "Mensagem" });
  await expect.element(mensagem).toHaveAttribute("placeholder", "O que você precisa?");
  const enviarNaConversa = page.getByRole("button", { name: "Enviar" });
  await expect.element(enviarNaConversa).toBeVisible();
  await expect.element(enviarNaConversa).toBeDisabled();
  for (const pergunta of ["E a carga horária mínima?", "E o estágio no integrado?"]) {
    await expect.element(page.getByRole("button", { name: "Interromper" })).not.toBeInTheDocument();
    await mensagem.fill(pergunta);
    await userEvent.keyboard("{Enter}");
    await expect.element(mensagens.getByText(pergunta)).toBeVisible();
  }
  await expect.element(page.getByRole("button", { name: "Interromper" })).not.toBeInTheDocument();
  await expect.element(mensagem).toHaveValue("");

  // Na conversa, o mesmo clipe e o arrastar e soltar; o anexo entra na pasta ao enviar, com o nome que
  // ganhou lá (o Início já tinha copiado o mesmo arquivo).
  const alvoSoltar = document.querySelector<HTMLElement>("[data-caixa-pedido]")!;
  await expect.element(page.getByRole("button", { name: "Anexar arquivo", exact: true })).toBeVisible();
  const arrasto = new DataTransfer();
  arrasto.items.add(new File(["# Nota"], "parecer.md", { type: "text/markdown" }));
  arrasto.items.add(new File(["MZ"], "instalar.exe"));
  alvoSoltar.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: arrasto }));
  await expect.element(page.getByText("Solte para anexar")).toBeVisible();
  expect(alvoSoltar.hasAttribute("data-arrastando")).toBe(true);
  alvoSoltar.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: arrasto }));
  await expect.element(page.getByText("Solte para anexar")).not.toBeInTheDocument();
  const anexadosConversa = page.getByRole("list", { name: "Arquivos anexados" });
  await expect.element(anexadosConversa.getByText("parecer.md")).toBeVisible();
  await expect.element(page.getByText(/^Não entrou: instalar\.exe\./)).toBeVisible();
  expect(anexarSoltos).toHaveBeenCalledOnce();
  semIngles();
  await mensagem.fill("Confira o parecer anexado");
  await userEvent.keyboard("{Enter}");
  await expect.element(mensagens.getByText(/Arquivos na pasta:\s+- parecer \(2\)\.md/)).toBeVisible();
  await expect.element(anexadosConversa).not.toBeInTheDocument();
  await expect.element(page.getByText(/^Não entrou/)).not.toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Interromper" })).not.toBeInTheDocument();

  // A conversa rola por baixo do cartão: rolada até o fim, a última mensagem fica acima dele.
  const cartao = document.querySelector<HTMLElement>("[data-caixa-pedido]")!;
  const ultima = mensagens.element().lastElementChild!;
  const rolagem = cartao.closest<HTMLElement>(".overflow-y-auto")!;
  expect(rolagem.scrollHeight).toBeGreaterThan(rolagem.clientHeight);
  rolagem.scrollTop = rolagem.scrollHeight;
  await vi.waitFor(() =>
    expect(ultima.getBoundingClientRect().bottom).toBeLessThanOrEqual(cartao.getBoundingClientRect().top),
  );
  // Flutuante: com margem dos lados e de baixo dentro da coluna.
  const area = rolagem.getBoundingClientRect();
  const caixaConversa = cartao.getBoundingClientRect();
  expect(area.bottom - caixaConversa.bottom).toBeGreaterThanOrEqual(12);
  expect(caixaConversa.left - area.left).toBeGreaterThanOrEqual(12);
  semIngles();
  await nosDoisTemas("caixa-conversa");

  // Na largura mínima da janela (800 × 560), o cartão cabe sem rolagem lateral.
  await page.viewport(800, 560);
  await vi.waitFor(() => expect(cartao.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth));
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  await nosDoisTemas("caixa-conversa-estreita");

  // Durante a resposta, o botão vira "Interromper".
  await mensagem.fill("Uma resposta demorada");
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByText(/Esta resposta vai demorar/)).toBeVisible();
  await page.getByRole("button", { name: "Interromper" }).click();
  await expect.element(page.getByText("Resposta interrompida.")).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Enviar" })).toBeVisible();
});

it("Tema: o menu do cabeçalho mostra as três escolhas pelo nome e guarda a escolhida", async () => {
  window.localStorage.removeItem("simplifica-if:tema");
  await using _app = await montarApp(servidor);
  const botao = page.getByRole("button", { name: "Tema: automático (como o sistema)" });
  await botao.click();
  await expect.element(page.getByRole("menuitemradio", { name: "Automático (como o sistema)" })).toBeChecked();
  await page.getByRole("menuitemradio", { name: "Escuro" }).click();
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(window.localStorage.getItem("simplifica-if:tema")).toBe("escuro");
  await page.getByRole("button", { name: "Tema: escuro" }).click();
  await page.getByRole("menuitemradio", { name: "Automático (como o sistema)" }).click();
  expect(window.localStorage.getItem("simplifica-if:tema")).toBeNull();
});

/* O cabeçalho como barra de título do desktop (sem a barra do sistema; `barra-titulo.ts`). */

function cabecalho(): HTMLElement {
  return document.querySelector("header")!;
}

it("Barra de título: no navegador, o cabeçalho não é barra de título", async () => {
  await using _app = await montarApp(servidor);
  await expect.element(page.getByRole("link", { name: "Configurações" })).toBeVisible();
  // Só o logo, sem o rótulo "IFPR" ao lado; o nome vai no texto alternativo.
  const inicio = cabecalho().querySelector("a")!;
  expect(inicio.textContent).toBe("");
  expect(inicio.querySelector("img")?.alt).toBe("Simplifica IF");
  expect(cabecalho().classList.contains("drag-region")).toBe(false);
  expect(getComputedStyle(cabecalho()).getPropertyValue("-webkit-app-region")).not.toBe("drag");
});

it("Barra de título: no desktop (macOS), o cabeçalho arrasta a janela e abre espaço para os semáforos, menos em tela cheia", async () => {
  let avisar: (telaCheia: boolean) => void = () => {};
  window.simplifica = {
    conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
    janela: {
      plataforma: "darwin",
      telaCheia: async () => false,
      aoMudarTelaCheia: (ouvinte) => {
        avisar = ouvinte;
        return () => {
          avisar = () => {};
        };
      },
    },
  } satisfies PonteDesktop;
  await using _app = await montarApp(servidor);

  const configuracoes = page.getByRole("link", { name: "Configurações" });
  await expect.element(configuracoes).toBeVisible();
  const header = cabecalho();
  const estilo = getComputedStyle(header);
  expect(estilo.getPropertyValue("-webkit-app-region")).toBe("drag");
  expect(header.getBoundingClientRect().height).toBe(ALTURA_BARRA_TITULO);
  expect(estilo.paddingLeft).toBe("88px");
  // Os links recebem o clique e o foco.
  expect(getComputedStyle(configuracoes.element()).getPropertyValue("-webkit-app-region")).toBe("no-drag");
  await userEvent.tab();
  expect(document.activeElement?.querySelector("img")?.alt).toBe("Simplifica IF");

  avisar(true);
  await expect.poll(() => getComputedStyle(cabecalho()).paddingLeft).toBe("16px");
  avisar(false);
  await expect.poll(() => getComputedStyle(cabecalho()).paddingLeft).toBe("88px");
});

it("Barra de título: no desktop (Windows e Linux), o cabeçalho deixa a direita para os botões do sistema", async () => {
  window.simplifica = {
    conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
    janela: { plataforma: "win32", telaCheia: async () => false, aoMudarTelaCheia: () => () => {} },
  } satisfies PonteDesktop;
  await using _app = await montarApp(servidor);
  await expect.element(page.getByRole("link", { name: "Configurações" })).toBeVisible();
  const estilo = getComputedStyle(cabecalho());
  expect(estilo.paddingLeft).toBe("16px");
  // Sem o overlay de verdade, vale a largura reservada de 138px, mais a folga.
  expect(Number.parseFloat(estilo.paddingRight)).toBeGreaterThan(138);
});

it("Cartão de tarefa: em janela estreita, o texto quebra, sem corte nem rolagem lateral", async () => {
  /** Cada cartão inteiro dentro da janela, sem conteúdo transbordando, e a página sem rolagem lateral. */
  const conferir = async () => {
    const cartao = page.getByRole("link", { name: /^Revisar um PPC/ }).first();
    await expect.element(cartao).toBeVisible();
    await vi.waitFor(() => {
      for (const elemento of document.querySelectorAll<HTMLElement>("[data-tarefa]")) {
        const caixa = elemento.getBoundingClientRect();
        expect(caixa.left).toBeGreaterThanOrEqual(0);
        expect(caixa.right).toBeLessThanOrEqual(document.documentElement.clientWidth);
        expect(elemento.scrollWidth).toBeLessThanOrEqual(elemento.clientWidth);
      }
    });
    for (const rolagem of document.querySelectorAll<HTMLElement>(".overflow-y-auto")) {
      expect(rolagem.scrollWidth).toBeLessThanOrEqual(rolagem.clientWidth);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
  };
  await page.viewport(1100, 760);
  {
    await using _app = await montarApp(servidor);
    await conferir();
    await capturar("cartao-revisar-ppc-largo");
    for (const largura of [800, 560, 360]) {
      await page.viewport(largura, 640);
      await conferir();
      await capturar(`cartao-revisar-ppc-${largura}`);
    }
  }
  {
    await using _app = await montarApp(servidor, "/tarefas");
    await conferir();
    await capturar("cartao-revisar-ppc-todas-360");
  }
  // No desktop (o cabeçalho é a barra de título e não quebra linha), na largura mínima da janela: com os
  // semáforos à esquerda (macOS) e com os botões do sistema à direita (Windows e Linux). O cabeçalho mais
  // largo que a janela dava rolagem lateral à página inteira, que cortava os cartões.
  await page.viewport(800, 560);
  for (const plataforma of ["darwin", "win32"] as const) {
    window.simplifica = {
      conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
      janela: { plataforma, telaCheia: async () => false, aoMudarTelaCheia: () => () => {} },
    } satisfies PonteDesktop;
    for (const rota of ["/", "/tarefas"] as const) {
      await using _app = await montarApp(servidor, rota);
      await conferir();
      expect(cabecalho().scrollWidth).toBeLessThanOrEqual(cabecalho().clientWidth);
      await capturar(`cartao-revisar-ppc-${plataforma}-800${rota === "/" ? "" : "-todas"}`);
    }
  }
  // Com a conexão caída, o cabeçalho ganha "Sem conexão…" e "Tentar agora": no Windows, com a folga dos
  // botões do sistema, ainda cabe na largura mínima.
  window.simplifica = {
    conexao: async () => ({ urlServidor: "http://127.0.0.1:9", token: "x" }),
    janela: { plataforma: "win32", telaCheia: async () => false, aoMudarTelaCheia: () => () => {} },
  } satisfies PonteDesktop;
  {
    await using _app = await montarAppComOrigem(
      { tipo: "navegador", fonte: "url", credenciais: { urlServidor: "http://127.0.0.1:9", token: "x" } },
      "/",
      { atraso: () => 50 },
    );
    const tentar = page.getByRole("button", { name: "Tentar agora" });
    await expect.element(tentar).toBeVisible();
    // A frase vai para o leitor de tela (e para a dica); o botão fica inteiro, dentro do cabeçalho.
    expect(cabecalho().querySelector('[role="status"][data-fase]')?.textContent).toMatch(/Sem conexão/);
    const botao = tentar.element().getBoundingClientRect();
    expect(tentar.element().scrollWidth).toBeLessThanOrEqual(tentar.element().clientWidth);
    expect(botao.right).toBeLessThanOrEqual(cabecalho().getBoundingClientRect().right);
    // Nenhum item do cabeçalho passa por cima do seguinte (o botão sobre a escolha de tema, por exemplo).
    const itens = [...cabecalho().children].map((item) => item.getBoundingClientRect());
    itens.slice(1).forEach((item, i) => expect(item.left).toBeGreaterThanOrEqual(itens[i]!.right));
    expect(botao.right).toBeLessThanOrEqual(itens.at(-1)!.left);
    expect(cabecalho().scrollWidth).toBeLessThanOrEqual(cabecalho().clientWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
    await capturar("cabecalho-win32-800-sem-conexao");
  }
  await page.viewport(1100, 760);
});

it("Ver todas as tarefas e os avisos de conexão, sem inglês nem jargão (M1.14)", async () => {
  {
    await using app = await montarApp(servidor, "/tarefas");
    await expect.element(page.getByRole("link", { name: /^Revisar um PPC/ }).first()).toBeVisible();
    expect(app.roteador.state.location.pathname).toBe("/tarefas");
    semIngles();
  }

  // Sem servidor configurado: o aviso diz o que fazer, e o técnico fica em "Detalhes técnicos".
  {
    await using _app = await montarAppComOrigem({ tipo: "ausente" });
    await expect
      .element(page.getByText("O Simplifica IF não achou a parte do app que roda no seu computador."))
      .toBeVisible();
    await expect.element(page.getByRole("status").getByText("Sem conexão")).toBeVisible();
    await expect.element(page.getByText("Detalhes técnicos")).toBeVisible();
    semIngles();
  }

  // Um endereço que não responde: depois da segunda tentativa, o aviso da queda.
  {
    await using _app = await montarAppComOrigem(
      { tipo: "navegador", fonte: "url", credenciais: { urlServidor: "http://127.0.0.1:9", token: "x" } },
      "/",
      { atraso: () => 50 },
    );
    // "Não foi possível falar com…" (sem resposta) ou "perdeu o contato com…" (a conexão não abriu).
    await expect.element(page.getByText(/a parte do app que roda no seu computador/).first()).toBeVisible();
    await expect.element(page.getByText("O app continua tentando.", { exact: false })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Tentar agora" })).toBeVisible();
    semIngles();
  }
});

it("Conversa com busca web: rótulos em português, consulta/domínio no lugar do resumo bruto e link externo marcado", async () => {
  await using _app = await montarApp(servidor);
  const caixa = page.getByRole("textbox", { name: "O que você precisa hoje?" });
  await caixa.fill("Confira em fonte externa a Lei 7.498/1986");
  await userEvent.keyboard("{Enter}");
  const mensagens = page.getByRole("log", { name: "Mensagens" });
  const linkExterno = mensagens.getByRole("link", { name: "Lei nº 7.498/1986" });
  await expect.element(linkExterno).toBeVisible();
  expect(linkExterno.element().hasAttribute("data-fonte-externa")).toBe(true);
  expect(linkExterno.element().getAttribute("title")).toBe("Abrir no navegador: www.planalto.gov.br");
  // Abre o bloco recolhido de consultas para conferir os rótulos e o detalhe web.
  await mensagens.getByText("3 consultas", { exact: false }).click();
  await expect.element(mensagens.getByText("Pesquisar na internet")).toBeVisible();
  await expect.element(mensagens.getByText("Lei 7498 1986 exercicio profissional enfermagem")).toBeVisible();
  await expect.element(mensagens.getByText("Ler página na internet")).toBeVisible();
  await expect.element(mensagens.getByText("www.planalto.gov.br/ccivil_03/leis/l7498.htm")).toBeVisible();
  // O resumo bruto em inglês da página não aparece na tela.
  expect(mensagens.element().textContent).not.toContain("Fetched page content");
  semIngles();
});
