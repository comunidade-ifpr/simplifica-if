// @effect-diagnostics nodeBuiltinImport:off globalFetch:off -- processo principal do Electron, sem runtime Effect (ver README)
/**
 * O IPC entre o preload (`window.simplifica`) e o processo principal. Cada canal passa por `tratar`,
 * que só atende o quadro principal de uma janela do app (`janelas.ts`), na origem da interface: é dele que
 * sai o token, e só ele abre diálogos e arquivos. A janela que pediu (`BrowserWindow.fromWebContents`) vai
 * a quem atende: os diálogos ficam presos a ela, e o modo compacto e a tela cheia são dela. O resto do pedido (o caminho, a URL, as extensões) chega como
 * `unknown` e é conferido pelas regras de `seguranca.ts`. Os canais de um módulo ficam com ele
 * (`modulos/revisao-ppc/ipc.ts`), registrados daqui, com o mesmo `tratar` (arquivo de composição).
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import {
  CAMINHO_ARQUIVOS_LIBERADOS,
  CAMINHO_LIBERAR_ARQUIVO,
  CANAIS,
  type CredenciaisServidor,
  cortarRegistro,
} from "@simplifica-if/contratos-app/ponte";
import { BrowserWindow, dialog, ipcMain, nativeTheme, shell, type IpcMainInvokeEvent } from "electron";
import {
  type ConjuntoJanelas,
  MAXIMO_ROTA_JANELA,
  remetenteConfiavel,
  remetenteDoEvento,
  rotaValida,
} from "./janelas.ts";
import {
  anexoEscolhido,
  arquivoDeTarefaPermitido,
  pastaDeTarefaPermitida,
  extensoesAnexo,
  isSameOriginRendererNavigation,
  urlExternaSegura,
} from "./seguranca.ts";
import { registrarIpcRevisaoPpc } from "./modulos/revisao-ppc/ipc.ts";

/** Quantos arquivos um soltar libera de uma vez. */
const MAXIMO_SOLTOS = 20;

/** O que o IPC lê do processo principal, que guarda o estado (as janelas, o servidor). */
export interface ContextoIpc {
  /** A origem da interface (`Configuracao.urlJanela`). */
  readonly urlJanela: string;
  /** A raiz das pastas de tarefa (`Documentos/Simplifica IF`). */
  readonly pastaTrabalhos: string;
  /** As janelas abertas: só elas são atendidas. */
  readonly janelas: Pick<ConjuntoJanelas<BrowserWindow>, "tem">;
  /** A conexão com o servidor desta execução; a janela a pediu, então a interface dela carregou. */
  conexao(remetente: BrowserWindow): Promise<CredenciaisServidor>;
  /** A conexão atual, sem efeito colateral (para liberar arquivos no servidor). */
  conexaoAtual(): Promise<CredenciaisServidor> | undefined;
  /** O segredo do processo principal com o servidor desta execução (`EnvelopePartida.tokenDesktop`). */
  tokenDesktop(): string | undefined;
  reiniciarServidor(): Promise<void>;
  /** Grava no log do app um erro da interface (`PonteDesktop.registrarErro`), com um teto por minuto. */
  registrarInterface(texto: string): void;
  /** O aviso do sistema pedido pela interface de uma janela (`avisos.ts`, que confere o pedido e o foco). */
  avisar(pedido: unknown): void;
  /** O selo com a contagem (`avisos.ts`, `contagemValida`). */
  selo(pedido: unknown): void;
  /** O modo compacto da janela que pediu (`compacta.ts`). */
  compactar(janela: BrowserWindow, ligada: boolean): Promise<boolean>;
  /** O alfinete do modo compacto da janela que pediu (`compacta.ts`). */
  naFrente(janela: BrowserWindow, sempre: boolean): Promise<void>;
  /** Abre uma janela nova na rota, já conferida, a partir da que pediu (`janelas.ts`). */
  abrirJanela(rota: string, referencia: BrowserWindow): void;
  /** A janela gravou o que pedia antes de fechar (`antesDeSair.ts`); só vale a resposta da que recebeu o pedido. */
  prontoParaSair(janela: BrowserWindow, pedido: unknown): void;
}

/** Registra os canais do IPC. Chamado uma vez, na partida do processo principal. */
export function registrarIpc(contexto: ContextoIpc): void {
  /** A janela que mandou, se é uma janela do app, no quadro principal e na origem da interface. */
  const remetente = (evento: IpcMainInvokeEvent): BrowserWindow | undefined => {
    const dados = remetenteDoEvento(evento, (conteudo) => BrowserWindow.fromWebContents(conteudo));
    return dados !== undefined &&
      remetenteConfiavel(dados, contexto.janelas, (url) =>
        isSameOriginRendererNavigation({ applicationUrl: contexto.urlJanela, navigationUrl: url }),
      )
      ? dados.janela
      : undefined;
  };

  /** Atende o canal só para uma janela do app, que vai a `atender`; para outro remetente, recusa sem chamá-lo. */
  const tratar = (canal: string, atender: (janela: BrowserWindow, ...argumentos: Array<unknown>) => unknown) => {
    ipcMain.handle(canal, async (evento, ...argumentos: Array<unknown>) => {
      const janela = remetente(evento);
      if (janela === undefined) throw new Error("pedido recusado");
      return atender(janela, ...argumentos);
    });
  };

  /* ---------------------------------------------------------- janela e servidor */

  tratar(CANAIS.telaCheia, (janela) => janela.isFullScreen());

  // O `nativeTheme` avisa a mudança, e o `main.ts` acerta o fundo e os botões do sistema de todas as janelas.
  tratar(CANAIS.temaDoApp, (_janela, tema) => {
    nativeTheme.themeSource = tema === "claro" ? "light" : tema === "escuro" ? "dark" : "system";
  });

  tratar(CANAIS.conexao, (janela) => contexto.conexao(janela));

  tratar(CANAIS.reiniciarServidor, async () => {
    await contexto.reiniciarServidor();
  });

  tratar(CANAIS.avisar, (_janela, pedido) => {
    contexto.avisar(pedido);
  });

  tratar(CANAIS.selo, (_janela, pedido) => {
    contexto.selo(pedido);
  });

  tratar(CANAIS.janelaCompacta, async (janela, ligar) => {
    if (typeof ligar !== "boolean") throw new Error("pedido recusado");
    return await contexto.compactar(janela, ligar);
  });

  tratar(CANAIS.prontoParaSair, (janela, pedido) => {
    contexto.prontoParaSair(janela, pedido);
  });

  tratar(CANAIS.janelaNaFrente, async (janela, sempre) => {
    if (typeof sempre !== "boolean") throw new Error("pedido recusado");
    await contexto.naFrente(janela, sempre);
  });

  // A janela nova sai só por aqui (o `window.open` é negado), numa rota do app.
  tratar(CANAIS.abrirJanela, (janela, rota) => {
    const valida = rotaValida(rota, MAXIMO_ROTA_JANELA);
    if (valida === undefined) throw new Error("pedido recusado");
    contexto.abrirJanela(valida, janela);
  });

  tratar(CANAIS.registrarErro, (_janela, texto) => {
    if (typeof texto === "string" && texto.length > 0) contexto.registrarInterface(cortarRegistro(texto));
  });

  /* ---------------------------------------------------------- navegador e pastas */

  tratar(CANAIS.abrirExterno, async (_janela, url) => {
    const segura = urlExternaSegura(url);
    if (segura === undefined) throw new Error("só links http, https e mailto abrem fora do app");
    await shell.openExternal(segura);
  });

  /* ---------------------------------------------------------- arquivos escolhidos */

  /** Libera no servidor o arquivo escolhido: sem isso, o servidor o recusa (a revisão prévia, o "Anexar"). */
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

  /** Prazo de resposta para consultar os caminhos das revisões ativas no servidor local. */
  const PRAZO_LIBERADOS_MS = 5_000;
  /** Cache por conexão do servidor: no máximo um GET por ciclo de vida do servidor. */
  let cacheLiberados: { readonly conexao: Promise<CredenciaisServidor>; readonly dados: unknown } | undefined;

  /** Consulta no servidor os caminhos das revisões ativas (inclusive de execuções anteriores, no banco). */
  const listarLiberadosNoServidor = async (): Promise<unknown> => {
    const conexao = contexto.conexaoAtual();
    const tokenDesktop = contexto.tokenDesktop();
    if (conexao === undefined || tokenDesktop === undefined) return null;
    if (cacheLiberados?.conexao === conexao) return cacheLiberados.dados;
    try {
      const { urlServidor } = await conexao;
      const resposta = await fetch(`${urlServidor}${CAMINHO_ARQUIVOS_LIBERADOS}`, {
        method: "GET",
        headers: { authorization: `Bearer ${tokenDesktop}` },
        signal: AbortSignal.timeout(PRAZO_LIBERADOS_MS),
      });
      if (!resposta.ok) return null;
      const dados: unknown = await resposta.json();
      cacheLiberados = { conexao, dados };
      return dados;
    } catch {
      return null;
    }
  };

  /* ---------------------------------------------------------- módulos */

  // Composição: a ponte do módulo `revisao-ppc` (escolher e soltar o `.docx`, abrir e mostrar a cópia comentada).
  registrarIpcRevisaoPpc({ tratar, liberarNoServidor, listarLiberadosNoServidor });

  /* ---------------------------------------------------------- pasta das tarefas (M1.9) */

  tratar(CANAIS.escolherAnexo, async (janela, pedidas) => {
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
  tratar(CANAIS.anexarSoltos, async (_janela, caminhos, pedidas) => {
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

  tratar(CANAIS.abrirArquivoTarefa, async (_janela, caminho) => {
    const erro = await shell.openPath(arquivoDeTarefa(caminho, true));
    if (erro !== "") throw new Error(`não foi possível abrir o arquivo: ${erro}`);
  });

  tratar(CANAIS.mostrarArquivoTarefa, (_janela, caminho) => {
    shell.showItemInFolder(arquivoDeTarefa(caminho, false));
  });

  // Só para a Lixeira, nunca `rm`: se a Lixeira falha (pasta em rede, OneDrive), a pasta fica. A regra vale
  // para o caminho pedido e de novo para o real (`realpath.native` expande os nomes curtos do Windows)
  // contra a raiz real: o servidor manda o caminho real, e a raiz pode estar atrás de um link.
  tratar(CANAIS.pastaParaLixeira, async (_janela, caminho) => {
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
