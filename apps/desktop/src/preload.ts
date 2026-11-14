/**
 * O preload da janela (com `sandbox` e `contextIsolation`, como no T3): expõe `window.simplifica`
 * (`PonteDesktop`) e nada mais. Cada função só chama o processo principal pelo IPC; quem confere o
 * pedido é ele.
 */
import { contextBridge, ipcRenderer } from "electron";
import { CANAIS, NOME_PONTE, type Conexao, type PonteDesktop } from "./ponteDesktop.ts";

const ponte: PonteDesktop = {
  conexao: () => ipcRenderer.invoke(CANAIS.conexao) as Promise<Conexao>,
  abrirExterno: async (url: string) => {
    await ipcRenderer.invoke(CANAIS.abrirExterno, url);
  },
  escolherPasta: () => ipcRenderer.invoke(CANAIS.escolherPasta) as Promise<string | null>,
};

contextBridge.exposeInMainWorld(NOME_PONTE, ponte);
