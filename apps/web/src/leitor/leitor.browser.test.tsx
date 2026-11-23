/**
 * O leitor `ifpr://` (M1.6) no Chromium, com o app inteiro conectado ao `apps/server` de verdade
 * (drivers de demonstração e banco de fixture do MCP): do chip de citação na resposta ao dispositivo
 * destacado no texto da norma, "Copiar citação", a navegação entre normas pelas relações com voltar e
 * avançar, e o PPC aberto na seção, sem o HTML cru do arquivo.
 */
import { beforeAll, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import type { ServidorTeste } from "../../vite.config.ts";
import { achadosDaTela, iniciarServidorTeste, montarApp } from "../../test/navegador.tsx";

let servidor: ServidorTeste;

// Sem `pararServidoresTeste` no fim: ele derruba todos os servidores de teste, inclusive o do
// `app.browser.test.tsx`, que pode estar rodando ao mesmo tempo. O `vite.config.ts` os encerra na saída.
beforeAll(async () => {
  servidor = await iniciarServidorTeste();
});

declare global {
  interface Window {
    __invasao?: boolean;
  }
}

/** O elemento está dentro da área visível do painel de leitura (a área de rolagem). */
function visivelNoPainel(elemento: Element): boolean {
  let rolagem = elemento.parentElement;
  while (rolagem !== null && getComputedStyle(rolagem).overflowY !== "auto") rolagem = rolagem.parentElement;
  if (rolagem === null) return false;
  const caixa = elemento.getBoundingClientRect();
  const area = rolagem.getBoundingClientRect();
  return caixa.top >= area.top - 1 && caixa.top < area.bottom;
}

it("do chip ao dispositivo destacado, copiar citação, navegar entre normas e abrir o PPC na seção", async () => {
  await using _app = await montarApp(servidor, "/conversa");

  await page.getByRole("radio", { name: "Claude" }).click();
  await page.getByLabelText("Pasta da tarefa").fill(servidor.pasta);
  await page.getByRole("button", { name: "Começar conversa" }).click();
  const mensagem = page.getByRole("textbox", { name: "Mensagem" });
  await mensagem.fill("Abra no leitor o que a DCN pede sobre egressos");
  await userEvent.keyboard("{Enter}");

  // O chip do dispositivo abre o leitor na norma, com o inciso destacado e à vista.
  const chip = page.getByRole("button", { name: "Res. CNE/CP nº 2/2026, art. 28, XVIII" });
  await expect.element(chip).toBeVisible();
  await chip.click();
  const painel = page.getByRole("complementary", { name: "Painel de leitura" });
  await expect.element(painel.getByText("Res. CNE/CP 2/2026, art. 28, XVIII", { exact: true })).toBeVisible();
  const norma = painel.getByRole("article", { name: "Norma" });
  await expect.element(norma.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 2/2026" })).toBeVisible();
  await expect
    .element(norma.getByRole("group", { name: "Situação" }).getByText("Em vigor", { exact: true }))
    .toBeVisible();
  // o foco foi para o painel, que um chip da conversa abriu
  expect(document.activeElement).toBe(painel.element());
  // a data do ato e a publicação registrada, cada uma com o seu nome
  await expect.element(norma.getByText("Ato de 11/11/2026")).toBeVisible();
  await expect.element(norma.getByText("Publicação no DOU: 12/11/2026")).toBeVisible();
  await expect.element(norma.getByText(/Trecho citado: art\. 28, XVIII, destacado no texto/)).toBeVisible();
  const texto = norma.getByRole("document", { name: "Texto da norma" });
  await expect.element(texto).toBeVisible();
  await expect.poll(() => document.getElementById("art28-xviii")?.querySelector("mark.trecho-citado")).toBeTruthy();
  const inciso = document.getElementById("art28-xviii")!;
  // o destaque começa com o anúncio oculto, para o leitor de tela
  expect(inciso.textContent).toMatch(/^Trecho citado: XVIII – /);
  expect(inciso.querySelector(".sr-only")?.textContent).toBe("Trecho citado: ");
  // só o inciso: o caput e os outros incisos ficam sem destaque
  expect(texto.element().querySelectorAll("mark.trecho-citado")).toHaveLength(1);
  await expect.poll(() => visivelNoPainel(inciso)).toBe(true);
  // o texto não traz os links crus
  expect(painel.element().textContent).not.toMatch(/ifpr:\/\//);

  // os metadados da curadoria ficam fora do texto, recolhidos e com o aviso de que não são o texto oficial
  const pontos = norma.getByText("Pontos-chave (1)");
  await expect.element(pontos).toBeInTheDocument();
  await pontos.click();
  await expect.element(norma.getByText("O PPC descreve o acompanhamento de egressos (art. 28, XVIII).")).toBeVisible();
  await expect.element(norma.getByText(/Não faz parte do texto oficial/)).toBeVisible();
  await expect.element(norma.getByText("Notas da fonte (1)")).toBeVisible();
  // quem alterou a norma, pelas notas de redação do texto, com o artigo atingido
  const alterada = norma.getByText("Alterada por (1)");
  await alterada.click();
  await expect.element(norma.getByText("Resolução CNE/CP nº 3/2026")).toBeVisible();
  await expect.element(norma.getByRole("button", { name: "Ir ao artigo 28" })).toBeVisible();

  // "Copiar citação": o texto do inciso com o caput e a referência formal.
  const escrever = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  await norma.getByRole("button", { name: "Copiar citação" }).click();
  await expect.element(norma.getByRole("button", { name: "Citação copiada" })).toBeVisible();
  const copiado = escrever.mock.calls[0]?.[0] ?? "";
  expect(copiado).toMatch(/^“Art\. 28\. .* \[…\]\nXVIII – /s);
  expect(copiado).toContain("(Res. CNE/CP 2/2026, art. 28, XVIII)");
  expect(copiado).toContain("BRASIL. Resolução CNE/CP nº 2/2026, de 11 de novembro de 2026.");
  expect(copiado).toContain("Disponível em: https://www.in.gov.br/dcnept-2026.");
  escrever.mockRestore();
  // Nada em inglês nem jargão no leitor (M1.14).
  expect(achadosDaTela()).toEqual([]);

  // Pelas relações, a norma revogada: outro selo; voltar e avançar.
  const relacoes = norma.getByRole("region", { name: "Relações com outras normas" });
  await relacoes.getByRole("button", { name: "Res. CNE/CP 1/2021" }).click();
  const anterior = painel.getByRole("article", { name: "Norma" });
  await expect.element(anterior.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 1/2021" })).toBeVisible();
  await expect.element(anterior.getByLabelText("Situação").getByText("Revogada", { exact: true })).toBeVisible();
  await expect
    .element(anterior.getByLabelText("Situação").getByText("Vigência a confirmar", { exact: true }))
    .toBeVisible();
  await expect.element(anterior.getByText("Publicação no DOU: a confirmar")).toBeVisible();
  await expect.element(painel.getByRole("button", { name: "Avançar para o próximo link" })).toBeDisabled();

  await painel.getByRole("button", { name: "Voltar ao link anterior" }).click();
  await expect.element(painel.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 2/2026" })).toBeVisible();
  await expect.poll(() => document.getElementById("art28-xviii")?.querySelector("mark.trecho-citado")).toBeTruthy();
  await painel.getByRole("button", { name: "Avançar para o próximo link" }).click();
  await expect.element(painel.getByRole("heading", { level: 2, name: "Resolução CNE/CP nº 1/2021" })).toBeVisible();

  // O PPC na seção: o texto inteiro do arquivo (com a tabela fora das seções), a seção destacada e
  // nada do HTML cru do arquivo.
  await page.getByRole("button", { name: "PPC de Enfermagem" }).click();
  const ppc = painel.getByRole("article", { name: "PPC" });
  await expect.element(ppc.getByRole("heading", { level: 2, name: "Técnico em Enfermagem" })).toBeVisible();
  await expect.poll(() => document.getElementById("avaliacao-1")?.querySelector("mark.trecho-citado")).toBeTruthy();
  await expect.element(ppc.getByRole("cell", { name: "1.600 horas" })).toBeVisible();
  const textoPpc = ppc.getByRole("document", { name: "Texto do PPC" }).element();
  expect(textoPpc.querySelector("script, img, [onerror]")).toBeNull();
  expect(window.__invasao).toBeUndefined();
  // a seção vizinha, pelo índice, na mesma área de rolagem
  await ppc.getByText("Seções do índice (3)").click();
  await ppc.getByRole("button", { name: "estagio-2" }).click();
  await expect.poll(() => document.getElementById("estagio-2")?.querySelector("mark.trecho-citado")).toBeTruthy();
  expect(document.getElementById("avaliacao-1")?.querySelector("mark.trecho-citado")).toBeNull();
  expect(achadosDaTela()).toEqual([]);
});
