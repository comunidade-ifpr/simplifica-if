/**
 * O Explorar no Chromium, com o app inteiro conectado ao `apps/server` de verdade (banco de fixture com
 * `fixture-explorar.ts`): a paleta (Ctrl+K) com uma citação que cai no dispositivo destacado e com um
 * curso que abre a ficha (divergência PPC × SUAP marcada, Consepe, "Perguntar à IA sobre isto" sem
 * enviar); as coleções com os filtros; a busca no texto (⌘F/Ctrl+F) da página de uma norma; e, em cada
 * tela, nada em inglês nem jargão (M1.14).
 */
import { beforeAll, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import type { ServidorTeste } from "../../vite.config.ts";
import { NO_MAC } from "../components/BuscaPainel.tsx";
import { NOME_BUSCA, NOME_BUSCA_ATUAL } from "../leitor/busca.ts";
import { achadosDaTela, iniciarServidorTeste, montarApp } from "../../test/navegador.tsx";

let servidor: ServidorTeste;

// Sem `pararServidoresTeste` no fim: ele derrubaria os servidores dos outros arquivos de teste que
// rodam ao mesmo tempo. O `vite.config.ts` os encerra na saída.
beforeAll(async () => {
  servidor = await iniciarServidorTeste();
});

function semIngles() {
  expect(achadosDaTela()).toEqual([]);
}

async function abrirPaleta() {
  await userEvent.keyboard("{Control>}k{/Control}");
  const campo = page.getByRole("combobox", { name: "Buscar na base" });
  await expect.element(campo).toHaveFocus();
  return campo;
}

it("paleta: uma citação vai direto ao dispositivo destacado na norma", async () => {
  await using app = await montarApp(servidor, "/explorar");
  await expect.element(page.getByRole("heading", { level: 1, name: "Explorar o IFPR" })).toBeVisible();
  await expect
    .element(page.getByRole("link", { name: "Explorar", exact: true }))
    .toHaveAttribute("data-status", "active");
  semIngles();

  const campo = await abrirPaleta();
  const dialogo = page.getByRole("dialog", { name: "Buscar na base" });
  semIngles();
  await campo.fill("Res. CNE/CP 1/2021, art. 20");
  // o primeiro grupo é o trecho citado, já ativo (Enter abre)
  const grupo = dialogo.getByRole("group", { name: "Trechos de normas" });
  await expect.element(grupo.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await expect.element(grupo.getByText("Citação reconhecida", { exact: false })).toBeVisible();
  // o título traz o dispositivo inteiro, não só o rótulo
  await expect.element(grupo.getByText("Resolução CNE/CP nº 1/2021, art. 20", { exact: true })).toBeVisible();
  semIngles();
  await userEvent.keyboard("{Enter}");
  await expect.element(dialogo).not.toBeInTheDocument();

  expect(app.roteador.state.location.pathname).toBe("/explorar/ver");
  const norma = page.getByRole("article", { name: "Norma" });
  await expect.element(norma.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 1/2021" })).toBeVisible();
  await expect.element(norma.getByText(/Trecho citado: art\. 20, destacado no texto/)).toBeVisible();
  await expect.poll(() => document.getElementById("art20")?.querySelector("mark.trecho-citado")).toBeTruthy();
  await expect.element(page.getByRole("button", { name: "Perguntar à IA sobre isto" })).toBeVisible();
  semIngles();

  // Esc fecha a paleta e devolve o foco
  const botao = page.getByRole("button", { name: /^Buscar na base/ });
  await botao.click();
  await expect.element(page.getByRole("combobox", { name: "Buscar na base" })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("dialog", { name: "Buscar na base" })).not.toBeInTheDocument();
  await expect.element(botao).toHaveFocus();

  // um texto colado mais longo que o limite é cortado: busca, sem erro técnico
  const longo = await abrirPaleta();
  await longo.fill("estágio supervisionado ".repeat(30));
  expect((longo.element() as HTMLInputElement).value.length).toBeLessThanOrEqual(300);
  const janela = page.getByRole("dialog", { name: "Buscar na base" });
  await expect
    .poll(() => janela.element().textContent ?? "")
    .toMatch(/Nada encontrado|Trechos de normas|Seções de PPC/);
  expect(janela.element().querySelector('[role="alert"]')).toBeNull();
  semIngles();
  await userEvent.keyboard("{Escape}");
});

it("página de norma: ⌘F (macOS) ou Ctrl+F busca no texto, com a contagem, o passo e a volta ao botão", async () => {
  await using _app = await montarApp(servidor, "/explorar");
  await expect.element(page.getByRole("heading", { level: 1, name: "Explorar o IFPR" })).toBeVisible();
  const atalho = NO_MAC ? "{Meta>}f{/Meta}" : "{Control>}f{/Control}";
  const busca = page.getByRole("searchbox", { name: "Buscar no texto" });
  // fora de uma página, o atalho não abre nada
  await userEvent.keyboard(atalho);
  await expect.element(busca).not.toBeInTheDocument();

  const campo = await abrirPaleta();
  await campo.fill("Res. CNE/CP 1/2021, art. 20");
  const trechos = page
    .getByRole("dialog", { name: "Buscar na base" })
    .getByRole("group", { name: "Trechos de normas" });
  await expect.element(trechos.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{Enter}");
  const norma = page.getByRole("article", { name: "Norma" });
  await expect.element(norma.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 1/2021" })).toBeVisible();

  await userEvent.keyboard(atalho);
  await expect.element(busca).toHaveFocus();
  // sem acento nem caixa
  await busca.fill("EDUCACAO PROFISSIONAL");
  await expect.element(page.getByText(/^1 de \d+$/)).toBeVisible();
  expect(CSS.highlights.get(NOME_BUSCA)?.size).toBeGreaterThan(1);
  expect(CSS.highlights.get(NOME_BUSCA_ATUAL)?.size).toBe(1);
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByText(/^2 de \d+$/)).toBeVisible();
  // a atual fica à vista, abaixo da barra presa ao topo
  const barra = document.querySelector("search")!.getBoundingClientRect();
  const atual = [...CSS.highlights.get(NOME_BUSCA_ATUAL)!][0] as Range;
  expect(atual.getBoundingClientRect().top).toBeGreaterThanOrEqual(barra.bottom);
  await busca.fill("termo que não existe na norma");
  await expect.element(page.getByText("Nenhum resultado")).toBeVisible();
  semIngles();

  // Esc fecha, apaga os realces e devolve o foco ao botão sem rolar: a ocorrência fica onde estava na
  // tela (a barra que sai do fluxo é compensada pela ancoragem da rolagem); o botão reabre
  const antes = atual.getBoundingClientRect().top;
  await userEvent.keyboard("{Escape}");
  await expect.element(busca).not.toBeInTheDocument();
  expect(CSS.highlights.has(NOME_BUSCA)).toBe(false);
  const botao = page.getByRole("button", { name: /^Buscar no texto/ });
  await expect.element(botao).toHaveFocus();
  expect(Math.abs(atual.getBoundingClientRect().top - antes)).toBeLessThan(2);
  await botao.click();
  await expect.element(busca).toHaveFocus();
  await userEvent.keyboard("{Escape}");

  // com a paleta aberta por cima, o atalho não tira o foco dela
  const paleta = await abrirPaleta();
  await userEvent.keyboard(atalho);
  await expect.element(paleta).toHaveFocus();
  await expect.element(busca).not.toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
});

it("paleta: um curso abre a ficha, com a divergência marcada, o Consepe e Perguntar à IA", async () => {
  await using app = await montarApp(servidor, "/explorar");
  await expect.element(page.getByRole("heading", { level: 1, name: "Explorar o IFPR" })).toBeVisible();
  const campo = await abrirPaleta();
  await campo.fill("enferm");
  const dialogo = page.getByRole("dialog", { name: "Buscar na base" });
  const cursos = dialogo.getByRole("group", { name: "Cursos" });
  await expect.element(cursos.getByRole("option", { name: /Técnico em Enfermagem/ })).toBeVisible();
  // os grupos de PPC e de Consepe também respondem ao nome do curso
  await expect.element(dialogo.getByRole("group", { name: "PPCs" })).toBeVisible();
  await expect.element(dialogo.getByRole("group", { name: "Consepe" })).toBeVisible();
  // setas para baixo e para cima voltam ao curso, o primeiro
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(cursos.getByRole("option").first()).toHaveAttribute("aria-selected", "false");
  await userEvent.keyboard("{ArrowUp}");
  await expect.element(cursos.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{Enter}");

  const curso = page.getByRole("article", { name: "Curso" });
  await expect.element(curso.getByRole("heading", { level: 2, name: "Técnico em Enfermagem" })).toBeVisible();
  await expect.element(curso.getByText("2 divergências PPC × SUAP")).toBeVisible();
  const tabela = curso.getByRole("table", { name: "Comparação entre o PPC e o SUAP" });
  await expect.element(tabela.getByText("Diverge", { exact: true })).toBeVisible();
  await expect.element(tabela.getByText("Extraído, conferir")).toBeVisible();
  // o ano do documento, dos dados institucionais, ainda não revisado
  await expect.element(tabela.getByText("Precisa de revisão")).toBeVisible();
  await expect.element(curso.getByRole("button", { name: "Técnico em Enfermagem" })).toBeVisible(); // o CNCT
  await expect.element(curso.getByText("Processo Seletivo 2026: Matutino, 30 vagas")).toBeVisible();
  await expect.element(curso.getByRole("link", { name: "Consepe, reunião de 20/03/2026" })).toBeVisible();
  semIngles();

  // O CNCT do curso, pela própria ficha, e de volta
  await curso.getByRole("button", { name: "Técnico em Enfermagem" }).click();
  const cnct = page.getByRole("article", { name: "Curso do catálogo" });
  await expect.element(cnct.getByText("Ambiente e Saúde")).toBeVisible();
  await expect.element(cnct.getByRole("button", { name: "Técnico em Enfermagem" })).toBeVisible(); // o curso do IFPR
  semIngles();
  await page.getByRole("button", { name: "Voltar" }).click();
  await expect.element(page.getByRole("article", { name: "Curso" })).toBeVisible();

  // A reunião do Consepe
  await page.getByRole("link", { name: "Consepe, reunião de 20/03/2026" }).click();
  const reuniao = page.getByRole("article", { name: "Reunião do Consepe" });
  await expect.element(reuniao.getByRole("heading", { name: "Reunião Ordinária CONSEPE - 20/03/2026" })).toBeVisible();
  await expect.element(reuniao.getByText("Processo SEI 23411.000001/2026-01")).toBeVisible();
  semIngles();
  await page.getByRole("button", { name: "Voltar" }).click();

  // "Perguntar à IA sobre isto": o Início com o pedido escrito e o foco, sem enviar
  const conversas = () => app.contexto.api.chamar((cliente) => cliente["conversa.listar"]({}));
  const antes = await conversas();
  await page.getByRole("button", { name: "Perguntar à IA sobre isto" }).click();
  const caixa = page.getByRole("textbox", { name: "O que você precisa hoje?" });
  await expect.element(caixa).toHaveFocus();
  await expect
    .element(caixa)
    .toHaveValue(
      "Sobre o curso Técnico em Enfermagem, Campus Curitiba (ifpr://curso/curitiba/tecnico-em-enfermagem):\n",
    );
  expect(app.roteador.state.location.pathname).toBe("/");
  // nenhuma conversa foi criada: nada saiu para a IA
  expect(await conversas()).toEqual(antes);
  semIngles();
});

it("coleções: a linha do tempo, filtros de cursos, normas, CNCT e Consepe; campus e ficha de análise", async () => {
  await using app = await montarApp(servidor, "/explorar");
  // a entrada mostra as coleções
  await expect.element(page.getByRole("link", { name: /Cursos 2/ })).toBeVisible();
  await expect.element(page.getByRole("region", { name: "As normas no tempo" })).not.toBeInTheDocument();

  // a linha do tempo, na coleção de normas: um sinal por norma, com a situação no nome; o ano filtra a
  // lista e, de novo, tira o filtro
  await page
    .getByRole("navigation", { name: "Coleções" })
    .getByRole("link", { name: /^Normas/ })
    .click();
  const tempo = page.getByRole("region", { name: "As normas no tempo" });
  await expect.element(tempo.getByRole("link", { name: "Resolução CNE/CP nº 1/2021: Revogada" })).toBeVisible();
  semIngles();
  await tempo.getByRole("link", { name: /^Normas de 2021/ }).click();
  expect(app.roteador.state.location.search).toMatchObject({ ano: "2021" });
  await expect.element(page.getByRole("region", { name: "Normas de 2021" })).toBeVisible();
  await expect
    .element(page.getByRole("link", { name: "Resolução CNE/CP nº 2/2026", exact: true }))
    .not.toBeInTheDocument();
  await expect.element(tempo.getByRole("link", { name: /^Normas de 2021/ })).toHaveAttribute("aria-current", "page");
  await tempo.getByRole("link", { name: /^Normas de 2021/ }).click();
  expect(app.roteador.state.location.search).not.toHaveProperty("ano");
  await expect.element(page.getByRole("link", { name: "Resolução CNE/CP nº 2/2026", exact: true })).toBeVisible();

  // Cursos: campus, turno e limpar
  await page
    .getByRole("navigation", { name: "Coleções" })
    .getByRole("link", { name: /^Cursos/ })
    .click();
  const filtros = page.getByRole("group", { name: "Filtros" });
  await expect.element(page.getByText("2 cursos", { exact: true })).toBeVisible();
  await filtros.getByLabelText("Campus").selectOptions("curitiba");
  await expect.element(page.getByText("1 de 2 cursos")).toBeVisible();
  await filtros.getByLabelText("Turno").selectOptions("noturno");
  await expect.element(page.getByRole("link", { name: "Técnico em Enfermagem" })).toBeVisible();
  expect(app.roteador.state.location.search).toMatchObject({ campus: "curitiba", turno: "noturno" });
  await filtros.getByLabelText("Filtrar pelo nome").fill("física");
  await expect.element(page.getByText("Nada com esses filtros.")).toBeVisible();
  semIngles();
  await page.getByRole("button", { name: "Limpar os filtros" }).click();
  await expect.element(page.getByText("2 cursos", { exact: true })).toBeVisible();

  // PPCs: a coleção e o filtro de campus
  await page.getByRole("navigation", { name: "Coleções" }).getByRole("link", { name: /^PPCs/ }).click();
  await expect.element(page.getByRole("heading", { name: "Projetos Pedagógicos de Curso" })).toBeVisible();
  await expect.element(page.getByText("1 PPC", { exact: true })).toBeVisible();
  await page.getByRole("group", { name: "Filtros" }).getByLabelText("Campus").selectOptions("curitiba");
  await expect.element(page.getByRole("link", { name: "Técnico em Enfermagem" })).toBeVisible();
  semIngles();

  // Normas: a situação de vigência
  await page
    .getByRole("navigation", { name: "Coleções" })
    .getByRole("link", { name: /^Normas/ })
    .click();
  await page.getByRole("group", { name: "Filtros" }).getByLabelText("Situação de vigência").selectOptions("revogada");
  await expect.element(page.getByRole("link", { name: "Resolução CNE/CP nº 1/2021", exact: true })).toBeVisible();
  await expect
    .element(page.getByRole("link", { name: "Resolução CNE/CP nº 2/2026", exact: true }))
    .not.toBeInTheDocument();
  semIngles();

  // CNCT: só os que o IFPR oferta
  await page.getByRole("navigation", { name: "Coleções" }).getByRole("link", { name: /^CNCT/ }).click();
  await expect.element(page.getByText("2 cursos do catálogo", { exact: true })).toBeVisible();
  await page.getByRole("group", { name: "Filtros" }).getByLabelText("No IFPR").selectOptions("sim");
  await expect.element(page.getByText("1 de 2 cursos do catálogo")).toBeVisible();
  await expect.element(page.getByText("1 curso no IFPR")).toBeVisible();
  semIngles();

  // Campi: a ficha do campus, com os horários de aula e os cursos
  await page
    .getByRole("navigation", { name: "Coleções" })
    .getByRole("link", { name: /^Campi/ })
    .click();
  await page.getByRole("link", { name: "Campus Curitiba" }).click();
  const campus = page.getByRole("article", { name: "Campus" });
  await expect
    .element(campus.getByRole("link", { name: "Horários de aula" }))
    .toHaveAttribute("href", "https://ifpr.edu.br/curitiba/horarios/");
  await expect.element(campus.getByRole("button", { name: "Técnico em Enfermagem" })).toBeVisible();
  semIngles();

  // Consepe: o tipo de demanda
  await page
    .getByRole("navigation", { name: "Coleções" })
    .getByRole("link", { name: /^Consepe/ })
    .click();
  await page
    .getByRole("group", { name: "Filtros" })
    .getByLabelText("Tipo de demanda")
    .selectOptions("Ajuste curricular");
  await expect.element(page.getByRole("status").filter({ hasText: "1 item" })).toBeVisible();
  await expect.element(page.getByRole("link", { name: "Ficha do curso" })).toBeVisible();
  semIngles();

  // As fichas da revisão de PPC não são coleção nem resultado de busca; a página de uma abre pelo link
  await expect
    .element(page.getByRole("navigation", { name: "Coleções" }).getByRole("link", { name: /Ficha/ }))
    .not.toBeInTheDocument();
  await app.roteador.navigate({ to: "/explorar/ver", search: { link: "ifpr://ficha/CT-CURR-12" } });
  const ficha = page.getByRole("article", { name: "Ficha de análise" });
  await expect.element(ficha.getByText(/^A organização curricular deixa clara a progressão formativa/)).toBeVisible();
  await expect.element(ficha.getByText("Obrigatória")).toBeVisible();
  semIngles();
});

it("Perguntar à IA com o primeiro uso por fazer: o pedido atravessa as boas-vindas e volta ao Início", async () => {
  const novo = await iniciarServidorTeste({ primeiroUso: true });
  const pedido = "Sobre o Campus Curitiba (ifpr://campus/curitiba):\n";
  await using app = await montarApp(novo, `/?pedido=${encodeURIComponent(JSON.stringify(pedido))}`);
  await expect.element(page.getByRole("heading", { name: "Boas-vindas ao Simplifica IF" })).toBeVisible();
  expect(app.roteador.state.location.search).toMatchObject({ pedido });
  await page.getByRole("button", { name: "Entendi, continuar" }).click();
  await page.getByRole("button", { name: /^Pular/ }).click();
  await page.getByRole("button", { name: "Pular", exact: true }).click();
  await page.getByRole("button", { name: "Pular e ir para o Início" }).click();
  const caixa = page.getByRole("textbox", { name: "O que você precisa hoje?" });
  await expect.element(caixa).toHaveValue(pedido);
  expect(app.roteador.state.location.pathname).toBe("/");
});
