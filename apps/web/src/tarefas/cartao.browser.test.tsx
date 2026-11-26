/**
 * O cartão de uma tarefa de link no Chromium, sem servidor: ele diz que abre o navegador, mostra o
 * domínio de destino e abre pelo caminho de link externo do app (a ponte do desktop), sem navegar a
 * janela do app; se o link não abre, o cartão diz e a falha vai para o log.
 */
import type { ResumoTarefa } from "@simplifica-if/contratos-app";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { palavrasSuspeitas } from "../../test/ingles.ts";
import { ponteTeste } from "../../test/ponte.ts";
import "../index.css";
import { CartaoTarefa } from "./CartaoTarefa.tsx";

const montados: Array<() => void> = [];
afterEach(() => {
  for (const desmontar of montados.splice(0)) desmontar();
  delete window.simplifica;
});

function montar(elemento: React.ReactNode) {
  const conteiner = document.createElement("div");
  document.body.append(conteiner);
  const raiz = createRoot(conteiner);
  raiz.render(elemento);
  montados.push(() => {
    raiz.unmount();
    conteiner.remove();
  });
}

const tarefaDeLink = (requerLogin: boolean): ResumoTarefa => ({
  id: "calendario-academico",
  titulo: "Consultar o calendário acadêmico",
  resumo: "Abre o calendário letivo do campus no sistema da instituição.",
  area: "ensino",
  publico: [],
  situacao: "estavel",
  mantenedor: { nome: "Pessoa de Teste", github: "pessoa-de-teste" },
  abre: { tipo: "link", url: "https://calendario.example.org/letivo?ano=2026", requerLogin },
});

it("o cartão de link diz que abre o navegador, mostra o domínio e abre pela ponte do desktop", async () => {
  const abrirExterno = vi.fn(async (_url: string) => {});
  window.simplifica = ponteTeste({ abrirExterno });
  const endereco = window.location.href;
  montar(<CartaoTarefa tarefa={tarefaDeLink(true)} />);

  const cartao = page.getByRole("link", { name: /^Consultar o calendário acadêmico/ });
  await expect.element(cartao).toBeVisible();
  await expect
    .element(cartao.getByText("Abre no navegador: calendario.example.org (pede o seu login de lá)"))
    .toBeVisible();
  expect(palavrasSuspeitas(cartao.element().textContent ?? "")).toEqual([]);

  await cartao.click();
  expect(abrirExterno).toHaveBeenCalledExactlyOnceWith("https://calendario.example.org/letivo?ano=2026");
  // O link não troca a página do app.
  expect(window.location.href).toBe(endereco);
});

it("sem login no destino, o cartão não fala em login", async () => {
  montar(<CartaoTarefa tarefa={tarefaDeLink(false)} />);
  const cartao = page.getByRole("link", { name: /^Consultar o calendário acadêmico/ });
  await expect.element(cartao.getByText("Abre no navegador: calendario.example.org", { exact: true })).toBeVisible();
  expect(cartao.element().textContent).not.toMatch(/login/);
});

it("link que não abre: o cartão diz, e a falha vai para o log do app só com o destino", async () => {
  const registrarErro = vi.fn(async (_linha: string) => {});
  window.simplifica = ponteTeste({
    abrirExterno: async () => {
      throw new Error("sem navegador padrão");
    },
    registrarErro,
  });
  montar(<CartaoTarefa tarefa={tarefaDeLink(false)} />);
  const cartao = page.getByRole("link", { name: /^Consultar o calendário acadêmico/ });
  await expect.element(cartao).toBeVisible();
  expect(document.querySelector("[data-erro-link]")).toBeNull();

  await cartao.click();
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("Não foi possível abrir calendario.example.org no navegador. Tente de novo.");
  expect(registrarErro).toHaveBeenCalledOnce();
  const linha = registrarErro.mock.calls[0]![0];
  expect(linha).toContain("tarefa de link: não abriu calendario.example.org");
  expect(linha).toContain("sem navegador padrão");
  // A consulta da URL não vai para o log.
  expect(linha).not.toContain("ano=2026");
});
