// @effect-diagnostics nodeBuiltinImport:off -- processo principal do Electron, sem runtime Effect (ver README)
/**
 * Os canais do IPC do módulo `revisao-ppc` (M1.11): escolher e soltar o `.docx` do PPC, abrir a cópia
 * comentada (ou o `.docx` acompanhado no Word) e mostrar a cópia na pasta. O `ipc.ts` do núcleo os
 * registra (arquivo de composição) com o mesmo `tratar`, que só atende uma janela do app e passa a que
 * pediu: o diálogo fica preso a ela. As regras ficam em `./seguranca.ts`.
 */
import * as NodeFS from "node:fs";
import { CANAIS } from "@simplifica-if/contratos-app/ponte";
import { dialog, shell, type BrowserWindow } from "electron";
import { copiaComentadaPermitida, docxEscolhido, documentoPermitido } from "./seguranca.ts";

/** O que o módulo usa do IPC do núcleo. */
export interface IpcDoNucleo {
  /** Atende o canal só para uma janela do app (`ipc.ts`), que vai a `atender`: a dona dos diálogos. */
  readonly tratar: (canal: string, atender: (janela: BrowserWindow, ...argumentos: Array<unknown>) => unknown) => void;
  /** Libera no servidor o arquivo que a pessoa escolheu. */
  readonly liberarNoServidor: (arquivo: string) => Promise<void>;
}

export function registrarIpcRevisaoPpc({ tratar, liberarNoServidor }: IpcDoNucleo): void {
  /** Os `.docx` escolhidos no diálogo ou soltos nesta execução: só as cópias comentadas deles abrem pelo app. */
  const docxEscolhidos = new Set<string>();

  tratar(CANAIS.escolherDocx, async (janela) => {
    const escolha = await dialog.showOpenDialog(janela, {
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
  tratar(CANAIS.soltarDocx, async (_janela, caminho) => {
    const arquivo = docxEscolhido(caminho);
    const info = arquivo === undefined ? undefined : NodeFS.lstatSync(arquivo, { throwIfNoEntry: false });
    if (arquivo === undefined || info === undefined || !info.isFile()) return null;
    docxEscolhidos.add(arquivo);
    await liberarNoServidor(arquivo);
    return arquivo;
  });

  /** O arquivo pedido, se a regra o permite e ele é arquivo comum (não link nem pasta). */
  const permitido = (caminho: unknown, regra: typeof copiaComentadaPermitida, recusa: string): string => {
    const arquivo = regra(caminho, docxEscolhidos);
    if (arquivo === undefined) throw new Error(recusa);
    const info = NodeFS.lstatSync(arquivo, { throwIfNoEntry: false });
    if (info === undefined || !info.isFile()) throw new Error("o documento não foi encontrado");
    return arquivo;
  };

  tratar(CANAIS.abrirDocumento, async (_janela, caminho) => {
    const arquivo = permitido(
      caminho,
      documentoPermitido,
      "só a cópia comentada pelo Simplifica IF ou o documento acompanhado abrem por aqui",
    );
    const erro = await shell.openPath(arquivo);
    if (erro !== "") throw new Error(`não foi possível abrir o documento: ${erro}`);
  });

  tratar(CANAIS.mostrarNaPasta, (_janela, caminho) => {
    shell.showItemInFolder(
      permitido(caminho, copiaComentadaPermitida, "só a cópia comentada pelo Simplifica IF abre por aqui"),
    );
  });
}
