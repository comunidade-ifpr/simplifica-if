// @effect-diagnostics nodeBuiltinImport:off -- processo principal do Electron, sem runtime Effect (ver README)
/**
 * Os canais do IPC do módulo `revisao-ppc` (M1.11): escolher e soltar o `.docx` do PPC, abrir e mostrar a
 * cópia comentada. O `ipc.ts` do núcleo os registra (arquivo de composição) com o mesmo `tratar`, que só
 * atende a janela do app; as regras ficam em `./seguranca.ts`.
 */
import * as NodeFS from "node:fs";
import { CANAIS } from "@simplifica-if/contratos-app/ponte";
import { dialog, shell, type BrowserWindow } from "electron";
import { copiaComentadaPermitida, docxEscolhido } from "./seguranca.ts";

/** O que o módulo usa do IPC do núcleo. */
export interface IpcDoNucleo {
  /** Atende o canal só para a janela do app (`ipc.ts`). */
  readonly tratar: (canal: string, atender: (...argumentos: Array<unknown>) => unknown) => void;
  /** A janela que é dona dos diálogos. */
  readonly exigirJanela: () => BrowserWindow;
  /** Libera no servidor o arquivo que a pessoa escolheu. */
  readonly liberarNoServidor: (arquivo: string) => Promise<void>;
}

export function registrarIpcRevisaoPpc({ tratar, exigirJanela, liberarNoServidor }: IpcDoNucleo): void {
  /** Os `.docx` escolhidos no diálogo ou soltos nesta execução: só as cópias comentadas deles abrem pelo app. */
  const docxEscolhidos = new Set<string>();

  tratar(CANAIS.escolherDocx, async () => {
    const escolha = await dialog.showOpenDialog(exigirJanela(), {
      title: "Escolher o PPC (.docx)",
      buttonLabel: "Revisar",
      properties: ["openFile"],
      filters: [{ name: "Documento do Word", extensions: ["docx"] }],
    });
    // O filtro do diálogo pode ser contornado em alguns sistemas ("Todos os arquivos"): confere de novo.
    const arquivo = escolha.canceled ? undefined : docxEscolhido(escolha.filePaths[0]);
    if (arquivo === undefined) return null;
    docxEscolhidos.add(arquivo);
    await liberarNoServidor(arquivo);
    return arquivo;
  });

  /**
   * O `.docx` solto na área de soltar da revisão: a regra do diálogo e, como o soltar aceita pasta, só
   * arquivo comum. Liberado como o escolhido (a cópia comentada dele também abre pelo app).
   */
  tratar(CANAIS.soltarDocx, async (caminho) => {
    const arquivo = docxEscolhido(caminho);
    const info = arquivo === undefined ? undefined : NodeFS.lstatSync(arquivo, { throwIfNoEntry: false });
    if (arquivo === undefined || info === undefined || !info.isFile()) return null;
    docxEscolhidos.add(arquivo);
    await liberarNoServidor(arquivo);
    return arquivo;
  });

  /** A cópia comentada pedida, se é de um `.docx` escolhido e é arquivo comum (não link nem pasta). */
  const copiaComentada = (caminho: unknown): string => {
    const permitido = copiaComentadaPermitida(caminho, docxEscolhidos);
    if (permitido === undefined) throw new Error("só a cópia comentada pelo Simplifica IF abre por aqui");
    const info = NodeFS.lstatSync(permitido, { throwIfNoEntry: false });
    if (info === undefined || !info.isFile()) throw new Error("a cópia comentada não foi encontrada");
    return permitido;
  };

  tratar(CANAIS.abrirDocumento, async (caminho) => {
    const erro = await shell.openPath(copiaComentada(caminho));
    if (erro !== "") throw new Error(`não foi possível abrir o documento: ${erro}`);
  });

  tratar(CANAIS.mostrarNaPasta, (caminho) => {
    shell.showItemInFolder(copiaComentada(caminho));
  });
}
