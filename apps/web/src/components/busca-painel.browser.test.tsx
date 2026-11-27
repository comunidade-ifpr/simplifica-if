/**
 * A barra de busca do painel no Chromium, sem servidor: a contagem, Enter e Shift+Enter, e a busca
 * refeita quando o texto da área muda (o documento que termina de carregar), com o mesmo termo.
 */
import { createRoot } from "react-dom/client";
import { useRef, useState } from "react";
import { afterEach, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "../index.css";
import { BuscaPainel } from "./BuscaPainel.tsx";

const montados: Array<() => void> = [];
afterEach(() => {
  for (const desmontar of montados.splice(0)) desmontar();
});

let trocarTexto: (texto: string) => void = () => {};

function Painel() {
  const area = useRef<HTMLDivElement>(null);
  const [texto, setTexto] = useState("Carregando…");
  trocarTexto = setTexto;
  return (
    <>
      <BuscaPainel area={area} pedido={1} aoFechar={() => {}} montarTudo={() => {}} />
      <div ref={area} style={{ height: 200, overflowY: "auto" }}>
        <p>{texto}</p>
      </div>
    </>
  );
}

it("conta, navega e refaz a busca quando o texto chega depois", async () => {
  const conteiner = document.createElement("div");
  document.body.append(conteiner);
  const raiz = createRoot(conteiner);
  raiz.render(<Painel />);
  montados.push(() => {
    raiz.unmount();
    conteiner.remove();
  });
  const campo = page.getByRole("searchbox", { name: "Buscar no texto" });
  await expect.element(campo).toHaveFocus();
  await campo.fill("estagio");
  await expect.element(page.getByText("Nenhum resultado")).toBeVisible();

  trocarTexto("O estágio é obrigatório. Estágio supervisionado. ESTAGIO.");
  await expect.element(page.getByText("1 de 3")).toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByText("2 de 3")).toBeVisible();
  await userEvent.keyboard("{Shift>}{Enter}{/Shift}{Shift>}{Enter}{/Shift}");
  await expect.element(page.getByText("3 de 3")).toBeVisible();
  expect([...CSS.highlights.get("busca-atual")!].map((r) => (r as Range).toString())).toEqual(["ESTAGIO"]);
});
