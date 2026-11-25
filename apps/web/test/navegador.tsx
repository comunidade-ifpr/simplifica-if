/**
 * Apoio dos testes de navegador: os comandos do `vite.config.ts` (que rodam no Node) e a montagem do
 * app inteiro numa `div`, com o histórico na memória.
 */
import { createMemoryHistory } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { commands } from "vite-plus/test/browser";
import type { OpcoesServidorTeste, ServidorTeste } from "../vite.config.ts";
import { App } from "../src/App.tsx";
import type { OpcoesConexao } from "../src/conexao/Conexao.ts";
import type { OrigemConexao } from "../src/conexao/origem.ts";
import { inicializar } from "../src/inicializar.ts";
import { criarRoteador } from "../src/router.ts";
import { type Achado, palavrasSuspeitas } from "./ingles.ts";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/source-serif-4";
import "../src/index.css";

declare module "vite-plus/test/browser" {
  interface BrowserCommands {
    /** Sobe o `test/servidor-teste.ts` aceitando a origem da página; definido no `vite.config.ts`. */
    iniciarServidorTeste: (opcoes: OpcoesServidorTeste) => Promise<ServidorTeste>;
    pararServidoresTeste: () => Promise<void>;
    /** Grava `texto` num arquivo de uma pasta de tarefa, como a pessoa editando fora da conversa. */
    editarArquivoDeTarefa: (caminho: string, texto: string) => Promise<void>;
    /** Faz o Claude Code do servidor de teste "aparecer" (instalado e com login). */
    simularInstalacaoClaude: (sinal: string) => Promise<void>;
  }
}

export const iniciarServidorTeste = (opcoes: OpcoesServidorTeste = {}) => commands.iniciarServidorTeste(opcoes);
export const pararServidoresTeste = () => commands.pararServidoresTeste();
export const simularInstalacaoClaude = (sinal: string) => commands.simularInstalacaoClaude(sinal);
export const editarArquivoDeTarefa = (caminho: string, texto: string) => commands.editarArquivoDeTarefa(caminho, texto);

/** Monta o app conectado ao servidor; `Symbol.asyncDispose` desmonta e fecha a conexão. */
export async function montarApp(servidor: ServidorTeste, rota = "/") {
  return montarAppComOrigem(
    { tipo: "navegador", credenciais: { urlServidor: servidor.urlServidor, token: servidor.token } },
    rota,
  );
}

/**
 * Monta o app com uma origem qualquer: sem servidor (`ausente`), ou um endereço que não responde, para
 * ver os avisos de conexão.
 */
export async function montarAppComOrigem(origem: OrigemConexao, rota = "/", opcoes?: OpcoesConexao) {
  const iniciado = await inicializar(origem, opcoes);
  const roteador = criarRoteador(createMemoryHistory({ initialEntries: [rota] }));
  const elemento = document.createElement("div");
  document.body.append(elemento);
  const raiz = createRoot(elemento);
  raiz.render(
    <StrictMode>
      <App contexto={iniciado.contexto} roteador={roteador} />
    </StrictMode>,
  );
  return {
    contexto: iniciado.contexto,
    roteador,
    async [Symbol.asyncDispose]() {
      raiz.unmount();
      elemento.remove();
      await iniciado.encerrar();
    },
  };
}

/** Os atributos acessíveis cujo texto a pessoa ouve ou vê (leitor de tela, dica, campo vazio, imagem). */
const ATRIBUTOS_ACESSIVEIS = [
  "aria-label",
  "aria-description",
  "aria-roledescription",
  "aria-valuetext",
  "aria-placeholder",
  "title",
  "placeholder",
  "alt",
] as const;

/**
 * Texto técnico de propósito, que não se confere: "Detalhes técnicos" (menos o `summary`), comandos e
 * caminhos em `code`, `kbd` e `pre`.
 */
const TECNICO =
  "[data-texto-tecnico] > :not(summary), [data-texto-tecnico] > :not(summary) *, code, code *, kbd, pre, pre *";

/**
 * O texto da tela (M1.14): o visível (inclusive o só para leitor de tela, `sr-only`) e os atributos
 * acessíveis, mais o título da janela. Cada pedaço diz se é conteúdo (`[data-conteudo]`: a resposta
 * da IA, o texto da base, a mensagem da pessoa), onde só se confere o inglês, não o jargão.
 */
export function textosDaTela(): ReadonlyArray<{ readonly texto: string; readonly conteudo: boolean }> {
  const textos: Array<{ texto: string; conteudo: boolean }> = [{ texto: document.title, conteudo: false }];
  const caminhante = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let no = caminhante.nextNode(); no !== null; no = caminhante.nextNode()) {
    const pai = no.parentElement;
    const texto = no.textContent?.trim() ?? "";
    if (pai === null || texto === "" || pai.closest("script, style") !== null || pai.matches(TECNICO)) continue;
    if (!pai.checkVisibility({ visibilityProperty: true })) continue;
    textos.push({ texto, conteudo: pai.closest("[data-conteudo]") !== null });
  }
  for (const elemento of document.body.querySelectorAll("*")) {
    if (elemento.matches(TECNICO)) continue;
    for (const atributo of ATRIBUTOS_ACESSIVEIS) {
      const valor = elemento.getAttribute(atributo);
      if (valor !== null && valor.trim() !== "")
        textos.push({ texto: valor, conteudo: elemento.closest("[data-conteudo]") !== null });
    }
  }
  return textos;
}

/** Os achados de inglês e jargão da tela atual (vazio se está tudo em português). */
export function achadosDaTela(): ReadonlyArray<Achado> {
  return textosDaTela().flatMap(({ texto, conteudo }) =>
    palavrasSuspeitas(texto).filter((achado) => !conteudo || achado.motivo === "inglês"),
  );
}
