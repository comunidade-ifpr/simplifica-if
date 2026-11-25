// @effect-diagnostics nodeBuiltinImport:off globalFetch:off -- processo principal do Electron, sem runtime Effect (ver README)
/**
 * O IPC entre o preload (`window.simplifica`) e o processo principal. Cada canal passa por `tratar`,
 * que só atende o quadro principal da janela do app, na origem da interface: é dele que sai o token, e
 * só ele abre diálogos e arquivos. O resto do pedido (o caminho, a URL, as extensões) chega como
 * `unknown` e é conferido pelas regras de `seguranca.ts`.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import {
  CAMINHO_LIBERAR_ARQUIVO,
  CANAIS,
  type CredenciaisServidor,
  cortarRegistro,
} from "@simplifica-if/contratos-app/ponte";
import { dialog, ipcMain, nativeTheme, shell, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import {
  anexoEscolhido,
  arquivoDeTarefaPermitido,
  copiaComentadaPermitida,
  docxEscolhido,
  pastaDeTarefaPermitida,
  extensoesAnexo,
  isSameOriginRendererNavigation,
  urlExternaSegura,
} from "./seguranca.ts";

/** Quantos arquivos um soltar libera de uma vez. */
const MAXIMO_SOLTOS = 20;

/** O que o IPC lê do processo principal, que guarda o estado (a janela, o servidor). */
export interface ContextoIpc {
  /** A origem da interface (`Configuracao.urlJanela`). */
  readonly urlJanela: string;
  /** A raiz das pastas de tarefa (`Documentos/Simplifica IF`). */
  readonly pastaTrabalhos: string;
  janela(): BrowserWindow | undefined;
  /** A conexão com o servidor desta execução; a janela a pediu, então a interface carregou. */
  conexao(): Promise<CredenciaisServidor>;
  /** A conexão atual, sem efeito colateral (para liberar arquivos no servidor). */
  conexaoAtual(): Promise<CredenciaisServidor> | undefined;
  /** O segredo do processo principal com o servidor desta execução (`EnvelopePartida.tokenDesktop`). */
  tokenDesktop(): string | undefined;
  reiniciarServidor(): Promise<void>;
  /** Grava no log do app um erro da interface (`PonteDesktop.registrarErro`), com um teto por minuto. */
  registrarInterface(texto: string): void;
}

/** Registra os canais do IPC. Chamado uma vez, na partida do processo principal. */
export function registrarIpc(contexto: ContextoIpc): void {
  /** Só a janela do app, no quadro principal e na origem da interface, recebe o token. */
  const remetenteConfiavel = (evento: IpcMainInvokeEvent): boolean => {
    const janela = contexto.janela();
    const quadro = evento.senderFrame;
    return (
      janela !== undefined &&
      !janela.isDestroyed() &&
      evento.sender === janela.webContents &&
      quadro !== null &&
      quadro === evento.sender.mainFrame &&
      isSameOriginRendererNavigation({ applicationUrl: contexto.urlJanela, navigationUrl: quadro.url })
    );
  };

  /** Atende o canal só para a janela do app; para outro remetente, recusa sem chamar `atender`. */
  const tratar = (canal: string, atender: (...argumentos: Array<unknown>) => unknown) => {
    ipcMain.handle(canal, async (evento, ...argumentos: Array<unknown>) => {
      if (!remetenteConfiavel(evento)) throw new Error("pedido recusado");
      return atender(...argumentos);
    });
  };

  /** A janela que é dona dos diálogos; o remetente já foi conferido, então ela existe. */
  const exigirJanela = (): BrowserWindow => {
    const janela = contexto.janela();
    if (janela === undefined) throw new Error("pedido recusado");
    return janela;
  };

  /* ---------------------------------------------------------- janela e servidor */

  tratar(CANAIS.telaCheia, () => contexto.janela()?.isFullScreen() ?? false);

  // O `nativeTheme` avisa a mudança, e o `main.ts` acerta o fundo da janela e os botões do sistema.
  tratar(CANAIS.temaDoApp, (tema) => {
    nativeTheme.themeSource = tema === "claro" ? "light" : tema === "escuro" ? "dark" : "system";
  });

  tratar(CANAIS.conexao, () => contexto.conexao());

  tratar(CANAIS.reiniciarServidor, async () => {
    await contexto.reiniciarServidor();
  });

  tratar(CANAIS.registrarErro, (texto) => {
    if (typeof texto === "string" && texto.length > 0) contexto.registrarInterface(cortarRegistro(texto));
  });

  /* ---------------------------------------------------------- navegador e pastas */

  tratar(CANAIS.abrirExterno, async (url) => {
    const segura = urlExternaSegura(url);
    if (segura === undefined) throw new Error("só links http, https e mailto abrem fora do app");
    await shell.openExternal(segura);
  });

  /* ---------------------------------------------------------- revisão prévia de PPC (M1.11) */

  /** Os `.docx` escolhidos no diálogo ou soltos nesta execução: só as cópias comentadas deles abrem pelo app. */
  const docxEscolhidos = new Set<string>();

  /** Libera no servidor o arquivo escolhido: sem isso, a revisão prévia o recusa. */
  const liberarNoServidor = async (arquivo: string): Promise<void> => {
    const conexao = contexto.conexaoAtual();
    const tokenDesktop = contexto.tokenDesktop();
    if (conexao === undefined || tokenDesktop === undefined) throw new Error("o servidor local não está pronto");
    const { urlServidor } = await conexao;
    const resposta = await fetch(`${urlServidor}${CAMINHO_LIBERAR_ARQUIVO}`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokenDesktop}`, "content-type": "application/json" },
      body: JSON.stringify({ arquivo }),
    });
    if (resposta.status !== 204) throw new Error(`o servidor não liberou o arquivo (${resposta.status})`);
  };

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

  /* ---------------------------------------------------------- pasta das tarefas (M1.9) */

  tratar(CANAIS.escolherAnexo, async (pedidas) => {
    const janela = exigirJanela();
    const aceitas = extensoesAnexo(pedidas);
    const escolha = await dialog.showOpenDialog(janela, {
      title: "Anexar arquivo",
      buttonLabel: "Anexar",
      properties: ["openFile"],
      filters: [{ name: "Documentos", extensions: aceitas.map((extensao) => extensao.slice(1)) }],
    });
    const arquivo = escolha.canceled ? undefined : anexoEscolhido(escolha.filePaths[0], aceitas);
    if (arquivo === undefined) return null;
    await liberarNoServidor(arquivo);
    return arquivo;
  });

  /** Os soltos na caixa de pedido: a regra do diálogo e, como o soltar aceita pasta, só arquivo comum. */
  tratar(CANAIS.anexarSoltos, async (caminhos, pedidas) => {
    if (!Array.isArray(caminhos) || caminhos.length > MAXIMO_SOLTOS) throw new Error("pedido recusado");
    const aceitas = extensoesAnexo(pedidas);
    const liberados: Array<string | null> = [];
    for (const caminho of caminhos) {
      const arquivo = anexoEscolhido(caminho, aceitas);
      const info = arquivo === undefined ? undefined : NodeFS.lstatSync(arquivo, { throwIfNoEntry: false });
      if (arquivo === undefined || info === undefined || !info.isFile()) {
        liberados.push(null);
        continue;
      }
      await liberarNoServidor(arquivo);
      liberados.push(arquivo);
    }
    return liberados;
  });

  /** Um arquivo de pasta de tarefa: a regra de `arquivoDeTarefaPermitido` e o caminho real dentro da raiz. */
  const arquivoDeTarefa = (caminho: unknown, abrir: boolean): string => {
    const permitido = arquivoDeTarefaPermitido(caminho, contexto.pastaTrabalhos, abrir);
    if (permitido === undefined) throw new Error("só arquivos das pastas de tarefa abrem por aqui");
    const info = NodeFS.lstatSync(permitido, { throwIfNoEntry: false });
    if (info === undefined || !info.isFile()) throw new Error("o arquivo não foi encontrado");
    const raizReal = NodeFS.realpathSync(contexto.pastaTrabalhos);
    if (!NodeFS.realpathSync(permitido).startsWith(raizReal + NodePath.sep)) throw new Error("arquivo fora da pasta");
    return permitido;
  };

  tratar(CANAIS.abrirArquivoTarefa, async (caminho) => {
    const erro = await shell.openPath(arquivoDeTarefa(caminho, true));
    if (erro !== "") throw new Error(`não foi possível abrir o arquivo: ${erro}`);
  });

  tratar(CANAIS.mostrarArquivoTarefa, (caminho) => {
    shell.showItemInFolder(arquivoDeTarefa(caminho, false));
  });

  // Só para a Lixeira, nunca `rm`: se a Lixeira falha (pasta em rede, OneDrive), a pasta fica. A regra vale
  // para o caminho pedido e de novo para o real (`realpath.native` expande os nomes curtos do Windows)
  // contra a raiz real: o servidor manda o caminho real, e a raiz pode estar atrás de um link.
  tratar(CANAIS.pastaParaLixeira, async (caminho) => {
    const raizReal = NodeFS.realpathSync.native(contexto.pastaTrabalhos);
    const pedida =
      pastaDeTarefaPermitida(caminho, contexto.pastaTrabalhos) ?? pastaDeTarefaPermitida(caminho, raizReal);
    if (pedida === undefined) throw new Error("só pastas de tarefa vão para a Lixeira por aqui");
    const info = NodeFS.lstatSync(pedida, { throwIfNoEntry: false });
    if (info === undefined) return;
    if (!info.isDirectory()) throw new Error("não é uma pasta de tarefa");
    const real = pastaDeTarefaPermitida(NodeFS.realpathSync.native(pedida), raizReal);
    if (real === undefined) throw new Error("só pastas de tarefa vão para a Lixeira por aqui");
    await shell.trashItem(real);
  });
}
