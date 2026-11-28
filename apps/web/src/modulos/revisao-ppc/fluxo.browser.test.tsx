/**
 * "Revisar um PPC" no Chromium, conectado por RPC ao `apps/server` de verdade (`test/servidor-teste.ts`):
 * a revisão prévia sem IA, com o Worker de verdade e a ponte do desktop simulada (o diálogo devolve o PPC
 * sintético do servidor de teste), do cartão do Início ao resultado, e o arquivo que não existe.
 */
import { afterEach, beforeAll, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import type { ServidorTeste } from "../../../vite.config.ts";
import { achadosDaTela, iniciarServidorTeste, montarApp } from "../../../test/navegador.tsx";
import { ponteTeste } from "../../../test/ponte.ts";
import { NO_MAC } from "../../lib/teclado.ts";

let servidor: ServidorTeste;

beforeAll(async () => {
  servidor = await iniciarServidorTeste({ atrasoLogin: 120 });
});

// A ponte do desktop simulada só vale no teste que a monta.
afterEach(() => {
  delete window.simplifica;
});

/** Nenhum texto em inglês nem jargão técnico na tela (M1.14; `achadosDaTela`, em `test/ingles.ts`). */
function semIngles() {
  expect(achadosDaTela()).toEqual([]);
}

it("Revisar um PPC: do Início ao resultado, com a régua, o bloqueio do curso, a lista por tema e a cópia comentada", async () => {
  const abrirDocumento = vi.fn(async (_caminho: string) => {});
  const mostrarNaPasta = vi.fn(async (_caminho: string) => {});
  window.simplifica = ponteTeste({
    conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
    escolherDocx: async () => servidor.ppc,
    abrirDocumento,
    mostrarNaPasta,
  });
  await page.viewport(1280, 900);
  await using app = await montarApp(servidor);

  // O cartão da tarefa de módulo leva à entrada: a frase e a área de soltar, com o botão.
  await page.getByRole("navigation", { name: "Telas" }).getByRole("link", { name: "Tarefas", exact: true }).click();
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
  const faixa = page.getByRole("region", { name: "Conferência com IA" });
  await expect.element(faixa.getByText(/O Claude confere .* em cerca de \d+ minutos?, usando perto de/)).toBeVisible();
  await expect.element(faixa.getByRole("button", { name: "Conferir com o Claude" })).toBeEnabled();
  // E o modelo, fixo por IA, antes de começar.
  await expect.element(faixa.getByText(/^Modelo: .+, o mesmo em toda conferência com o Claude\.$/)).toBeVisible();
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
  // ⌥-clique (Alt+clique) na fonte abre no outro lugar, a página do Explorar; o clique, no painel.
  const fonte = page.getByRole("button", { name: "Nota Técnica PROENS/IFPR nº 1/2025" });
  await fonte.click({ modifiers: ["Alt"] });
  await expect.poll(() => app.roteador.state.location.pathname).toBe("/explorar/ver");
  app.roteador.history.back();
  await fonte.click();
  await expect.element(page.getByRole("complementary", { name: "Painel ao lado" })).toBeVisible();
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
  await page.getByRole("button", { name: "Fechar o painel" }).click();
  // "Ver PPC": o texto do PPC no painel, desde o começo.
  await page.getByRole("button", { name: "Ver PPC" }).click();
  await expect
    .element(page.getByRole("article", { name: "PPC em revisão" }).getByRole("heading", { name: "PPC de teste.docx" }))
    .toBeVisible();
  await page.getByRole("button", { name: "Fechar o painel" }).click();
  // O código do critério só aparece no link da ficha dele ("CT-CURR-22 · O que este critério confere").
  expect(document.body.innerText.replace(/CT-[A-Z]+-\d+ · O que este critério confere/g, "")).not.toMatch(
    /nao_atende|a_conferir|ifpr:\/\/|CT-[A-Z]+-\d/,
  );
  semIngles();

  // "Feito" esmaece a linha e conta; F, com o foco na linha, desfaz.
  await page.getByRole("button", { name: "Feito" }).click();
  await expect.element(page.getByText(/^1 de \d+ feitas?$/).first()).toBeInTheDocument();
  (linha.element() as HTMLElement).focus();
  await userEvent.keyboard("f");
  await expect.element(page.getByText(/^0 de \d+ feitas?$/).first()).toBeInTheDocument();

  // "Abrir cópia comentada" no ⋯ regrava a cópia comentada e a abre; "Mostrar na pasta" a exibe.
  await page.getByRole("button", { name: "Mais ações do documento" }).click();
  await page.getByRole("menuitem", { name: "Abrir cópia comentada" }).click();
  // A cópia é desta revisão: o nome leva a data e a hora em que ela foi feita.
  const copiaDaRevisao = new RegExp(
    `^${servidor.pasta.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/PPC de teste - revisão prévia \\(Simplifica IF\\) \\d{4}-\\d{2}-\\d{2} \\d{2}h\\d{2}\\.docx$`,
  );
  await vi.waitFor(() => expect(abrirDocumento).toHaveBeenCalledWith(expect.stringMatching(copiaDaRevisao)));
  const comentado = abrirDocumento.mock.calls.at(-1)![0] as string;
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
  // Com o PPC no painel, apagar o tira de lá também.
  await page.getByRole("button", { name: "Ver PPC" }).click();
  const painelLeitura = page.getByRole("complementary", { name: "Painel ao lado" });
  await expect.element(painelLeitura.getByRole("article", { name: "PPC em revisão" })).toBeVisible();
  await page.getByRole("button", { name: "Mais ações do documento" }).click();
  await page.getByRole("menuitem", { name: "Apagar esta revisão" }).click();
  await page.getByRole("button", { name: "Apagar a revisão" }).click();
  await expect.element(page.getByRole("button", { name: "Escolher o PPC" })).toBeVisible();
  await expect.element(painelLeitura).not.toBeInTheDocument();
  // A revisão apagada sai das revisões recentes.
  await expect.element(page.getByRole("heading", { name: "Revisões recentes" })).not.toBeInTheDocument();
  semIngles();
});

it("Revisar um PPC: buscar na base (⌘K) abre a norma no painel, ao lado, e a revisão fica na tela", async () => {
  window.simplifica = ponteTeste({
    conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
    escolherDocx: async () => servidor.ppc,
  });
  await page.viewport(1366, 768);
  await using app = await montarApp(servidor, "/revisao-ppc");
  await page.getByRole("button", { name: "Escolher o PPC" }).click();
  const frase = page.getByRole("heading", { name: /critérios que o app confere sozinho\.$/ });
  await expect.element(frase).toBeVisible();

  await userEvent.keyboard("{Control>}k{/Control}");
  const campo = page.getByRole("combobox", { name: "Buscar na base" });
  await expect.element(campo).toHaveFocus();
  await campo.fill("Res. 2/2026");
  const dialogo = page.getByRole("dialog", { name: "Buscar na base" });
  await expect.element(dialogo.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  // a dica diz onde Enter abre, e como abrir na tela
  await expect.element(dialogo.getByText("↵ abre ao lado · ⇧↵ na tela")).toBeVisible();
  semIngles();
  await userEvent.keyboard("{Enter}");
  await expect.element(dialogo).not.toBeInTheDocument();

  // A norma no painel do app; a revisão continua na tela, na mesma rota.
  const painel = page.getByRole("complementary", { name: "Painel ao lado" });
  await expect.element(painel.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 2/2026" })).toBeVisible();
  expect(app.roteador.state.location.pathname).toBe("/revisao-ppc");
  await expect.element(frase).toBeVisible();
  semIngles();

  // O painel é do app: sai da revisão e segue aberto no Início; volta e ele está lá.
  await page.getByRole("link", { name: "Início", exact: true }).click();
  await expect.element(painel.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 2/2026" })).toBeVisible();
  app.roteador.history.back();
  await expect.element(frase).toBeVisible();
  await expect.element(painel).toBeVisible();

  // Shift+Enter abre na página do Explorar, como fora da revisão.
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Buscar na base" }).fill("Res. CNE/CP 1/2021, art. 20");
  await expect.element(dialogo.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
  await expect.poll(() => app.roteador.state.location.pathname).toBe("/explorar/ver");
});

it("Revisar um PPC: arquivo que não existe, com a mensagem do servidor em português", async () => {
  window.simplifica = ponteTeste({
    conexao: async () => ({ urlServidor: servidor.urlServidor, token: servidor.token }),
    escolherDocx: async () => `${servidor.pasta}/não existe.docx`,
  });
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
