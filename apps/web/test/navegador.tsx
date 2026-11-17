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
import { inicializar } from "../src/inicializar.ts";
import { criarRoteador } from "../src/router.ts";
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
  const iniciado = await inicializar({
    tipo: "navegador",
    fonte: "url",
    credenciais: { urlServidor: servidor.urlServidor, token: servidor.token },
  });
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
