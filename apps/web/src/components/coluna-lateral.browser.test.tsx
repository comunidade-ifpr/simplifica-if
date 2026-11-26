/**
 * A coluna do painel ao lado no Chromium: as setas na alça alargam e estreitam, a largura fica guardada
 * para a próxima vez, o duplo clique volta à padrão, e a largura nunca sai dos limites.
 */
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "../index.css";
import { ColunaLateral, limitarLargura } from "./ColunaLateral.tsx";

const CHAVE = "simplifica-if:teste-largura";
const montados: Array<() => void> = [];
afterEach(() => {
  for (const desmontar of montados.splice(0)) desmontar();
  window.localStorage.removeItem(CHAVE);
});

function montar() {
  const conteiner = document.createElement("div");
  conteiner.style.cssText = "display:flex;height:300px;width:1200px";
  document.body.append(conteiner);
  const raiz = createRoot(conteiner);
  raiz.render(
    <ColunaLateral chave={CHAVE} classePadrao="w-[400px]" rotulo="Largura do painel">
      <p>Texto do painel</p>
    </ColunaLateral>,
  );
  montados.push(() => {
    raiz.unmount();
    conteiner.remove();
  });
}

const largura = () => page.getByText("Texto do painel").element().parentElement!.getBoundingClientRect().width;

it("as setas ajustam a largura, que fica guardada; o duplo clique volta à padrão", async () => {
  // Uma janela de monitor grande: na padrão do teste (414px), o limite de 75% já fica abaixo de 400px.
  await page.viewport(1600, 900);
  montar();
  const alca = page.getByRole("separator", { name: "Largura do painel" });
  await expect.poll(largura).toBe(400);

  await userEvent.click(alca);
  await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
  await expect.poll(largura).toBe(464);
  expect(window.localStorage.getItem(CHAVE)).toBe("464");

  // Montada de novo (a outra tela, ou o app reaberto), a coluna vem com a largura guardada.
  for (const desmontar of montados.splice(0)) desmontar();
  montar();
  await expect.poll(largura).toBe(464);

  await userEvent.dblClick(page.getByRole("separator", { name: "Largura do painel" }));
  await expect.poll(largura).toBe(400);
  expect(window.localStorage.getItem(CHAVE)).toBeNull();
});

it("a largura fica entre 20rem e 75% da janela", () => {
  expect(limitarLargura(100, 1600)).toBe(320);
  expect(limitarLargura(1500, 1600)).toBe(1200);
  expect(limitarLargura(700, 1600)).toBe(700);
  expect(limitarLargura(500, 300)).toBe(320);
});
