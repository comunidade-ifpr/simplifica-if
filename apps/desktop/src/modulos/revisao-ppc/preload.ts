/**
 * A parte do módulo `revisao-ppc` em `window.simplifica` (`PonteDesktop`): escolher e soltar o `.docx`,
 * abrir e mostrar a cópia comentada. Cada função só chama o processo principal pelo IPC; quem confere o
 * pedido é ele (`./ipc.ts`). O `preload.ts` do núcleo a junta à ponte (arquivo de composição).
 */
import { ipcRenderer, webUtils } from "electron";
import { CANAIS, type PonteDesktop } from "@simplifica-if/contratos-app/ponte";

export const ponteRevisaoPpc: Pick<PonteDesktop, "escolherDocx" | "soltarDocx" | "abrirDocumento" | "mostrarNaPasta"> =
  {
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
  };
