/**
 * A rolagem lembrada (`rolagem.ts`) no Chromium, sem servidor: reaplica enquanto o texto chega e para quando
 * a pessoa mexe em qualquer lugar da janela ou quando outro link do mesmo documento é pedido; lembra onde a
 * rolagem foi reaplicada; esquecida com o documento montado, não volta ao desmontar; e a `Pagina` que troca
 * de chave começa do topo. Cada teste tem as suas chaves (a memória é do módulo).
 */
import { type ReactNode, useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import "../index.css";
import { Pagina } from "../components/Pagina.tsx";
import { esquecerRolagens, useRolagemLembrada } from "./rolagem.ts";

const montados: Array<() => void> = [];
afterEach(() => {
  for (const desmontar of montados.splice(0)) desmontar();
});

function montar(): (no: ReactNode) => void {
  const conteiner = document.createElement("div");
  document.body.append(conteiner);
  const raiz = createRoot(conteiner);
  montados.push(() => {
    raiz.unmount();
    conteiner.remove();
  });
  return (no) => flushSync(() => raiz.render(no));
}

function Rolagem({
  chave,
  link,
  altura,
}: {
  readonly chave: string;
  readonly link?: string | undefined;
  readonly altura: number;
}) {
  const rolante = useRef<HTMLDivElement>(null);
  useRolagemLembrada(chave, () => rolante.current, { link, topo: true });
  return (
    <div ref={rolante} data-rolagem style={{ height: 200, overflowY: "auto" }}>
      <div style={{ height: altura }} />
    </div>
  );
}

const rolagem = () => document.querySelector<HTMLElement>("[data-rolagem]")!;

function rolarPara(topo: number): void {
  rolagem().scrollTop = topo;
  rolagem().dispatchEvent(new Event("scroll"));
}

/**
 * Muda o tamanho do texto e espera os `ResizeObserver` avisarem: um do teste, criado depois do da rolagem
 * lembrada, avisa depois dele na mesma volta (a ordem de criação).
 */
async function crescerEEsperar(mudar: () => void): Promise<void> {
  let avisos = 0;
  const medidor = new ResizeObserver(() => void (avisos += 1));
  medidor.observe(rolagem().firstElementChild!);
  await vi.waitFor(() => expect(avisos).toBe(1));
  mudar();
  await vi.waitFor(() => expect(avisos).toBe(2));
  medidor.disconnect();
}

/** Sai do documento em `topo` e volta com o texto ainda curto; o texto chega e a rolagem volta a `topo`. */
async function voltarComOTextoChegando(desenhar: (no: ReactNode) => void, chave: string, link?: string) {
  desenhar(<Rolagem chave={chave} link={link} altura={2_000} />);
  rolarPara(500);
  desenhar(null);
  desenhar(<Rolagem chave={chave} link={link} altura={100} />);
  expect(rolagem().scrollTop).toBe(0);
  desenhar(<Rolagem chave={chave} link={link} altura={2_000} />);
  await expect.poll(() => rolagem().scrollTop).toBe(500);
}

it("uma tecla fora da rolagem (a busca, ⌘F) para de reaplicar", async () => {
  const desenhar = montar();
  await voltarComOTextoChegando(desenhar, "teclas");
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true }));
  rolarPara(80);
  await crescerEEsperar(() => desenhar(<Rolagem chave="teclas" altura={3_000} />));
  expect(rolagem().scrollTop).toBe(80);
});

it("outro link do mesmo documento (um chip da conversa) para de reaplicar", async () => {
  const desenhar = montar();
  await voltarComOTextoChegando(desenhar, "links", "ifpr://norma/x");
  desenhar(<Rolagem chave="links" link="ifpr://norma/x#art-10" altura={2_000} />);
  rolarPara(80);
  await crescerEEsperar(() => desenhar(<Rolagem chave="links" link="ifpr://norma/x#art-10" altura={3_000} />));
  expect(rolagem().scrollTop).toBe(80);
});

it("o clique no texto depois de reaplicar lembra a rolagem reaplicada, não a de antes do texto chegar", async () => {
  const desenhar = montar();
  await voltarComOTextoChegando(desenhar, "clique");
  rolagem().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  desenhar(null);
  desenhar(<Rolagem chave="clique" altura={2_000} />);
  expect(rolagem().scrollTop).toBe(500);
});

it("esquecida com o documento montado (a revisão apagada), não volta ao desmontar", () => {
  const desenhar = montar();
  desenhar(<Rolagem chave="revisao:apagada" altura={2_000} />);
  rolarPara(500);
  esquecerRolagens((chave) => chave === "revisao:apagada");
  desenhar(null);
  desenhar(<Rolagem chave="revisao:apagada" altura={2_000} />);
  expect(rolagem().scrollTop).toBe(0);
});

it("a página que troca de chave (outra revisão) começa do topo", () => {
  const desenhar = montar();
  const pagina = (chave: string) => (
    <div style={{ height: 200 }}>
      <Pagina largura="larga" rolagem={chave}>
        <div style={{ height: 2_000 }} />
      </Pagina>
    </div>
  );
  desenhar(pagina("revisao:uma"));
  const rolante = () => document.querySelector<HTMLElement>(".overflow-y-auto")!;
  rolante().scrollTop = 500;
  rolante().dispatchEvent(new Event("scroll"));
  desenhar(pagina("revisao:outra"));
  expect(rolante().scrollTop).toBe(0);
});
