/**
 * O preload da janela (com `sandbox` e `contextIsolation`, como no T3): expõe `window.simplifica`
 * (`PonteDesktop`) e nada mais. Cada função só chama o processo principal pelo IPC; quem confere o
 * pedido é ele.
 */
import { contextBridge, ipcRenderer } from "electron";
import { CANAIS, NOME_PONTE, type Conexao, type EstadoAtualizacaoApp, type PonteDesktop } from "./ponteDesktop.ts";

const ponte: PonteDesktop = {
  conexao: () => ipcRenderer.invoke(CANAIS.conexao) as Promise<Conexao>,
  abrirExterno: async (url: string) => {
    await ipcRenderer.invoke(CANAIS.abrirExterno, url);
  },
  escolherPasta: () => ipcRenderer.invoke(CANAIS.escolherPasta) as Promise<string | null>,
  escolherDocx: () => ipcRenderer.invoke(CANAIS.escolherDocx) as Promise<string | null>,
  abrirDocumento: async (caminho: string) => {
    await ipcRenderer.invoke(CANAIS.abrirDocumento, caminho);
  },
  mostrarNaPasta: async (caminho: string) => {
    await ipcRenderer.invoke(CANAIS.mostrarNaPasta, caminho);
  },
  reiniciarServidor: async () => {
    await ipcRenderer.invoke(CANAIS.reiniciarServidor);
  },
  atualizacaoApp: () => ipcRenderer.invoke(CANAIS.atualizacaoApp) as Promise<EstadoAtualizacaoApp>,
  procurarAtualizacaoApp: () => ipcRenderer.invoke(CANAIS.procurarAtualizacaoApp) as Promise<EstadoAtualizacaoApp>,
  instalarAtualizacaoApp: async () => {
    await ipcRenderer.invoke(CANAIS.instalarAtualizacaoApp);
  },
};

contextBridge.exposeInMainWorld(NOME_PONTE, ponte);
