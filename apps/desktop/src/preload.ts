/**
 * O preload da janela (com `sandbox` e `contextIsolation`, como no T3): expõe `window.simplifica`
 * (`PonteDesktop`) e nada mais. Cada função só chama o processo principal pelo IPC; quem confere o
 * pedido é ele. A parte de cada módulo vem dele (`modulos/revisao-ppc/preload.ts`): este arquivo é de
 * composição.
 */
import { contextBridge, ipcRenderer, webUtils } from "electron";
import { CANAIS, type CredenciaisServidor, NOME_PONTE, type PonteDesktop } from "@simplifica-if/contratos-app/ponte";
import { continuidadeDoArgv } from "./janelas.ts";
import { ponteRevisaoPpc } from "./modulos/revisao-ppc/preload.ts";

const ponte: PonteDesktop = {
  conexao: () => ipcRenderer.invoke(CANAIS.conexao) as Promise<CredenciaisServidor>,
  abrirExterno: async (url: string) => {
    await ipcRenderer.invoke(CANAIS.abrirExterno, url);
  },
  // Composição: a parte do módulo `revisao-ppc`.
  ...ponteRevisaoPpc,
  reiniciarServidor: async () => {
    await ipcRenderer.invoke(CANAIS.reiniciarServidor);
  },
  registrarErro: async (texto: string) => {
    await ipcRenderer.invoke(CANAIS.registrarErro, texto);
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
    continuidade: continuidadeDoArgv(process.argv),
    abrirJanela: async (rota) => {
      await ipcRenderer.invoke(CANAIS.abrirJanela, rota);
    },
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
    aoAtalhoDoMenu: (ouvinte) => {
      const aoReceber = (_evento: unknown, atalho: unknown) => {
        if (atalho === "buscar" || atalho === "painel" || atalho === "conversar" || atalho === "novaJanela")
          ouvinte(atalho);
      };
      ipcRenderer.on(CANAIS.atalhoDoMenu, aoReceber);
      return () => {
        ipcRenderer.removeListener(CANAIS.atalhoDoMenu, aoReceber);
      };
    },
    avisar: async (aviso) => {
      await ipcRenderer.invoke(CANAIS.avisar, { tipo: aviso.tipo, rota: aviso.rota });
    },
    selo: async (contagem) => {
      await ipcRenderer.invoke(CANAIS.selo, contagem);
    },
    aoAbrirRota: (ouvinte) => {
      const aoReceber = (_evento: unknown, rota: unknown) => {
        if (typeof rota === "string") ouvinte(rota);
      };
      ipcRenderer.on(CANAIS.abrirRota, aoReceber);
      return () => {
        ipcRenderer.removeListener(CANAIS.abrirRota, aoReceber);
      };
    },
    compacta: async (ligar) => (await ipcRenderer.invoke(CANAIS.janelaCompacta, ligar)) === true,
    naFrente: async (sempre) => {
      await ipcRenderer.invoke(CANAIS.janelaNaFrente, sempre);
    },
    antesDeSair: (gravar) => {
      const aoReceber = (_evento: unknown, pedido: unknown) => {
        if (typeof pedido !== "number") return;
        void gravar()
          .catch(() => undefined)
          .finally(() => void ipcRenderer.invoke(CANAIS.prontoParaSair, pedido).catch(() => undefined));
      };
      ipcRenderer.on(CANAIS.antesDeSair, aoReceber);
      return () => {
        ipcRenderer.removeListener(CANAIS.antesDeSair, aoReceber);
      };
    },
  },
};

contextBridge.exposeInMainWorld(NOME_PONTE, ponte);
