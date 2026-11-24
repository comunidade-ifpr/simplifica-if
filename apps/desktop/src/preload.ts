/**
 * O preload da janela (com `sandbox` e `contextIsolation`, como no T3): expõe `window.simplifica`
 * (`PonteDesktop`) e nada mais. Cada função só chama o processo principal pelo IPC; quem confere o
 * pedido é ele.
 */
import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
  CANAIS,
  type CredenciaisServidor,
  type EstadoAtualizacaoApp,
  NOME_PONTE,
  type PonteDesktop,
} from "@simplifica-if/contratos-app/ponte";

const ponte: PonteDesktop = {
  conexao: () => ipcRenderer.invoke(CANAIS.conexao) as Promise<CredenciaisServidor>,
  abrirExterno: async (url: string) => {
    await ipcRenderer.invoke(CANAIS.abrirExterno, url);
  },
  escolherDocx: () => ipcRenderer.invoke(CANAIS.escolherDocx) as Promise<string | null>,
  // O caminho sai daqui, como no `anexarSoltos`: um `File` criado por script não tem caminho ("").
  soltarDocx: (arquivo: File) =>
    ipcRenderer.invoke(CANAIS.soltarDocx, webUtils.getPathForFile(arquivo)) as Promise<string | null>,
  abrirDocumento: async (caminho: string) => {
    await ipcRenderer.invoke(CANAIS.abrirDocumento, caminho);
  },
  mostrarNaPasta: async (caminho: string) => {
    await ipcRenderer.invoke(CANAIS.mostrarNaPasta, caminho);
  },
  reiniciarServidor: async () => {
    await ipcRenderer.invoke(CANAIS.reiniciarServidor);
  },
  registrarErro: async (texto: string) => {
    await ipcRenderer.invoke(CANAIS.registrarErro, texto);
  },
  atualizacaoApp: () => ipcRenderer.invoke(CANAIS.atualizacaoApp) as Promise<EstadoAtualizacaoApp>,
  procurarAtualizacaoApp: () => ipcRenderer.invoke(CANAIS.procurarAtualizacaoApp) as Promise<EstadoAtualizacaoApp>,
  instalarAtualizacaoApp: async () => {
    await ipcRenderer.invoke(CANAIS.instalarAtualizacaoApp);
  },
  escolherAnexo: (extensoes?: ReadonlyArray<string>) =>
    ipcRenderer.invoke(CANAIS.escolherAnexo, extensoes === undefined ? [] : [...extensoes]) as Promise<string | null>,
  // O caminho sai daqui, nunca da página: ela passa o `File`, e um `File` criado por script não tem caminho ("").
  anexarSoltos: (arquivos: ReadonlyArray<File>, extensoes?: ReadonlyArray<string>) =>
    ipcRenderer.invoke(
      CANAIS.anexarSoltos,
      arquivos.map((arquivo) => webUtils.getPathForFile(arquivo)),
      extensoes === undefined ? [] : [...extensoes],
    ) as Promise<ReadonlyArray<string | null>>,
  abrirArquivoTarefa: async (caminho: string) => {
    await ipcRenderer.invoke(CANAIS.abrirArquivoTarefa, caminho);
  },
  mostrarArquivoTarefa: async (caminho: string) => {
    await ipcRenderer.invoke(CANAIS.mostrarArquivoTarefa, caminho);
  },
  pastaParaLixeira: async (caminho: string) => {
    await ipcRenderer.invoke(CANAIS.pastaParaLixeira, caminho);
  },
  janela: {
    plataforma: process.platform,
    telaCheia: () => ipcRenderer.invoke(CANAIS.telaCheia) as Promise<boolean>,
    aoMudarTelaCheia: (ouvinte) => {
      const aoReceber = (_evento: unknown, telaCheia: unknown) => ouvinte(telaCheia === true);
      ipcRenderer.on(CANAIS.telaCheiaMudou, aoReceber);
      return () => {
        ipcRenderer.removeListener(CANAIS.telaCheiaMudou, aoReceber);
      };
    },
    temaDoApp: async (tema) => {
      await ipcRenderer.invoke(CANAIS.temaDoApp, tema);
    },
  },
};

contextBridge.exposeInMainWorld(NOME_PONTE, ponte);
