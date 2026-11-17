// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off globalFetch:off -- processo principal do Electron, sem runtime Effect (ver README)
/**
 * O processo principal do Simplifica IF (Electron). Desenho do `apps/desktop` do T3 Code, reduzido ao
 * que o app faz:
 *
 * 1. gera um token, inicia o servidor local (`servidor.ts`) com a base, a pasta de estado e a origem
 *    da janela, e espera a linha de partida;
 * 2. abre a janela (`sandbox`, `contextIsolation`, CSP, navegação externa bloqueada) com a interface:
 *    o dev server do `apps/web` em desenvolvimento, o build empacotado pelo protocolo `simplifica://`;
 * 3. entrega à janela, pelo preload, a URL do servidor e o token (`window.simplifica.conexao()`);
 * 4. ao sair, fecha o stdin do servidor e espera; se ele não sair, mata-o. Se o servidor cair, mostra
 *    o erro e oferece reiniciar.
 *
 * O token nunca vai para log, linha de comando nem ambiente: só no stdin do servidor e na resposta do
 * IPC à janela do app.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  protocol,
  session,
  shell,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";
import { ATUALIZACAO_FABRICA } from "@simplifica-if/motor/politica-atualizacao";
import { autoUpdater } from "electron-updater";
import {
  feedDoCanal,
  iniciarAtualizacaoApp,
  lerAssinado,
  motivoDesligado,
  proxyParaServidor,
  type ControleAtualizacaoApp,
} from "./atualizacaoApp.ts";
import { ESQUEMA, HOST_APP, resolverConfiguracao, VARIAVEIS, type Configuracao } from "./configuracao.ts";
import { corFundoJanela, opcoesBarraTitulo } from "./janela.ts";
import { CANAIS, type Conexao } from "./ponteDesktop.ts";
import { abrirLog } from "./registro.ts";
import {
  CAMINHO_LIBERAR_ARQUIVO,
  anexoEscolhido,
  arquivoDeTarefaPermitido,
  copiaComentadaPermitida,
  extensoesAnexo,
  docxEscolhido,
  hashesScriptsInline,
  isSameOriginRendererNavigation,
  politicaConteudo,
  resolverArquivo,
  tipoConteudo,
  urlExternaSegura,
} from "./seguranca.ts";
import { gerarToken, iniciarServidor, montarInicio, type Saida, type ServidorEmExecucao } from "./servidor.ts";

const NOME = "Simplifica IF";
const DESENVOLVIMENTO = !app.isPackaged;

// T3: apps/desktop/src/main.ts — um pipe fechado no stdout ou no stderr não derruba o processo.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code !== "EPIPE") throw err;
  });
}

// A pasta do app: separada no desenvolvimento, para não misturar o login dos providers e o estado.
app.setName(NOME);
// O app só fala português (M1.14): o Chromium em pt-BR (`navigator.language`, o `Intl` padrão, os textos
// próprios do Chromium e do Electron), seja qual for a língua do sistema. Os textos do macOS (Cancelar
// nos diálogos, os itens que o sistema põe no menu Editar, o painel Sobre) seguem as localizações do
// pacote, que o empacotamento deixa só em pt-BR (`scripts/empacotar.ts`).
app.commandLine.appendSwitch("lang", "pt-BR");
app.setAboutPanelOptions({
  applicationName: NOME,
  copyright: "Instituto Federal do Paraná",
});
app.setPath("userData", NodePath.join(app.getPath("appData"), DESENVOLVIMENTO ? `${NOME} (dev)` : NOME));

/** O log do app e do servidor (`registro.ts`), além do stderr. */
const log = abrirLog(DESENVOLVIMENTO ? NodePath.join(app.getPath("userData"), "logs") : app.getPath("logs"));

/** Copia para o arquivo de log o que vai para o stderr. */
const paraStderrELog = (texto: string) => {
  process.stderr.write(texto);
  log.escrever(texto);
};

const registrar = (mensagem: string) => paraStderrELog(`${new Date().toISOString()} [desktop] ${mensagem}\n`);

// T3: apps/desktop/src/electron/ElectronProtocol.ts (registerDesktopSchemePrivilegesSync) — antes do `ready`.
protocol.registerSchemesAsPrivileged([
  {
    scheme: ESQUEMA,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
]);

const configuracao: Configuracao = resolverConfiguracao({
  empacotado: app.isPackaged,
  // main.cjs fica em apps/desktop/dist/app no desenvolvimento.
  raizRepositorio: NodePath.resolve(__dirname, "..", "..", "..", ".."),
  pastaRecursos: process.resourcesPath,
  pastaAplicacao: app.getAppPath(),
  pastaApp: app.getPath("userData"),
  pastaDocumentos: app.getPath("documents"),
  executavel: process.execPath,
  ambiente: process.env,
  existe: (caminho) => NodeFS.existsSync(caminho),
});

/* ============================================================ servidor */

let servidor: ServidorEmExecucao | undefined;
let conexaoAtual: Promise<Conexao> | undefined;
let janela: BrowserWindow | undefined;
/** O app está saindo: a queda do servidor não é erro. */
let saindo = false;
let encerrado = false;

function descreverSaida(saida: Saida): string {
  return saida.sinal === null ? `código ${saida.codigo ?? "?"}` : `sinal ${saida.sinal}`;
}

/**
 * A proxy da rede para o servidor baixar a base (M1.10): a que o Electron resolve para o feed, como o
 * navegador do sistema. Sem feed, ou se a resolução falhar, nada muda.
 */
async function ambienteComProxy(): Promise<NodeJS.ProcessEnv> {
  const feed = process.env[VARIAVEIS.feed]?.trim() || ATUALIZACAO_FABRICA.feed;
  if (configuracao.pastaAtualizacao === undefined || feed === null) return process.env;
  try {
    const url = new URL("x", feedDoCanal(feed, canalGravado())).href;
    const proxy = proxyParaServidor(await session.defaultSession.resolveProxy(url), process.env);
    if (Object.keys(proxy).length > 0)
      registrar(`proxy do sistema para a atualização: ${proxy.HTTPS_PROXY ?? proxy.HTTP_PROXY}`);
    return { ...process.env, ...proxy };
  } catch (erro) {
    registrar(`não foi possível resolver a proxy do sistema: ${String(erro)}`);
    return process.env;
  }
}

/** Inicia o servidor e guarda a conexão. A janela recebe a conexão quando ele fica pronto. */
function subirServidor(ambiente: NodeJS.ProcessEnv): Promise<Conexao> {
  const token = gerarToken();
  // Só do processo principal: a janela recebe o `token`, nunca este.
  tokenDesktop = gerarToken();
  const inicio = montarInicio({
    tokenDesktop,
    executor: configuracao.executor,
    banco: configuracao.banco,
    pastaEstado: configuracao.pastaEstado,
    pastaSkills: configuracao.pastaSkills,
    pastaAtualizacao: configuracao.pastaAtualizacao,
    versaoApp: app.getVersion(),
    pastaTrabalhos: configuracao.pastaTrabalhos,
    origens: configuracao.origens,
    token,
    ambiente,
    cwd: configuracao.cwd,
  });
  registrar(`iniciando o servidor: ${inicio.comando} ${inicio.argumentos.join(" ")}`);
  const conexao = iniciarServidor(inicio, { aoStderr: paraStderrELog }).then((iniciado) => {
    servidor = iniciado;
    registrar(`servidor pronto (pid ${iniciado.pid}, porta ${iniciado.linha.porta})`);
    void iniciado.saida.then((saida) => {
      // Um servidor trocado de propósito (`reiniciarServidor`) já não é o atual: a saída dele não é queda.
      const eraAtual = servidor === iniciado;
      if (eraAtual) servidor = undefined;
      if (!saindo && eraAtual) void aoCairServidor(`O servidor saiu (${descreverSaida(saida)}).`, iniciado.stderr());
    });
    return { urlServidor: `http://127.0.0.1:${iniciado.linha.porta}`, token } satisfies Conexao;
  });
  // A falha se trata em quem espera; aqui só não fica sem tratamento.
  conexao.catch(() => undefined);
  conexaoAtual = conexao;
  return conexao;
}

/** A porta do servidor em execução, para a CSP. */
function portaAtual(): number | undefined {
  return servidor?.linha.porta;
}

/** Erro do servidor: mostra o motivo e oferece reiniciar (ou sair). */
async function aoCairServidor(mensagem: string, detalhe: string): Promise<void> {
  if (saindo) return;
  const opcoes = {
    type: "error" as const,
    title: NOME,
    message: "O Simplifica IF parou de funcionar por um problema interno.",
    // A frase para a pessoa primeiro; o texto técnico (em inglês, às vezes) depois, para quem for ajudar.
    detail: [
      "Clique em Reiniciar para continuar. Se o problema se repetir, feche o app e abra de novo.",
      `Detalhes técnicos:\n${[mensagem, detalhe.trim().slice(-1_500)].filter(Boolean).join("\n\n")}`,
    ].join("\n\n"),
    buttons: ["Reiniciar", "Sair"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
  const { response } =
    janela && !janela.isDestroyed() ? await dialog.showMessageBox(janela, opcoes) : await dialog.showMessageBox(opcoes);
  if (response !== 0) {
    app.quit();
    return;
  }
  await iniciar();
}

/** Sobe o servidor e mostra a janela; na falha, o diálogo de erro. */
async function iniciar(): Promise<void> {
  try {
    await subirServidor(await ambienteComProxy());
  } catch (erro) {
    await aoCairServidor(erro instanceof Error ? erro.message : String(erro), "");
    return;
  }
  if (janela && !janela.isDestroyed()) {
    // A interface pede a conexão de novo (o token e a porta mudaram).
    janela.webContents.reload();
  } else {
    criarJanela();
  }
}

/* ============================================================ janela */

/** Só a janela do app, no quadro principal e na origem da interface, recebe o token. */
function remetenteConfiavel(evento: IpcMainInvokeEvent): boolean {
  const quadro = evento.senderFrame;
  return (
    janela !== undefined &&
    !janela.isDestroyed() &&
    evento.sender === janela.webContents &&
    quadro !== null &&
    quadro === evento.sender.mainFrame &&
    isSameOriginRendererNavigation({ applicationUrl: configuracao.urlJanela, navigationUrl: quadro.url })
  );
}

function abrirNoNavegador(url: string): void {
  const segura = urlExternaSegura(url);
  if (segura !== undefined) void shell.openExternal(segura);
}

/** As defesas de todo `WebContents`, como no T3: sem `<webview>`, sem janelas novas, sem navegar para fora. */
function protegerConteudo(conteudo: WebContents): void {
  conteudo.on("will-attach-webview", (evento) => evento.preventDefault());
  conteudo.setWindowOpenHandler(({ url }) => {
    abrirNoNavegador(url);
    return { action: "deny" };
  });
  conteudo.on("will-navigate", (evento, url) => {
    if (isSameOriginRendererNavigation({ applicationUrl: configuracao.urlJanela, navigationUrl: url })) return;
    evento.preventDefault();
    abrirNoNavegador(url);
  });
  conteudo.on("will-redirect", (evento, url) => {
    if (isSameOriginRendererNavigation({ applicationUrl: configuracao.urlJanela, navigationUrl: url })) return;
    evento.preventDefault();
  });
}

// T3: apps/desktop/src/window/DesktopWindow.ts (DEVELOPMENT_RETRYABLE_LOAD_ERROR_CODES) — o dev server
// pode ainda não estar de pé quando a janela abre.
const ERROS_CARGA_REPETIVEIS = new Set([-2, -7, -9, -102, -105, -106, -118]);
const ESPERAS_CARGA_MS = [100, 250, 500, 1_000, 2_000, 2_000, 2_000, 2_000];
/**
 * Tentativas de carga da janela atual. Volta a zero só quando a interface pede a conexão (carregou de
 * verdade): o `did-finish-load` também dispara para a página de erro do Chromium, e zerar ali repetia
 * para sempre.
 */
let tentativasCarga = 0;

function criarJanela(): void {
  const nova = new BrowserWindow({
    title: NOME,
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 560,
    show: false,
    // Sem a barra de título do sistema: o cabeçalho verde da interface é a barra (`janela.ts`).
    ...opcoesBarraTitulo(process.platform),
    backgroundColor: corFundoJanela(nativeTheme.shouldUseDarkColors),
    webPreferences: {
      preload: NodePath.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: true,
    },
  });
  janela = nova;
  nova.once("ready-to-show", () => nova.show());
  nova.on("closed", () => {
    if (janela === nova) janela = undefined;
  });
  // No macOS, em tela cheia os semáforos somem: a interface tira o recuo deles.
  const avisarTelaCheia = (telaCheia: boolean) => {
    if (!nova.isDestroyed()) nova.webContents.send(CANAIS.telaCheiaMudou, telaCheia);
  };
  nova.on("enter-full-screen", () => avisarTelaCheia(true));
  nova.on("leave-full-screen", () => avisarTelaCheia(false));

  tentativasCarga = 0;
  nova.webContents.on("did-fail-load", (_evento, codigo, descricao, url, quadroPrincipal) => {
    if (!quadroPrincipal || !ERROS_CARGA_REPETIVEIS.has(codigo)) return;
    if (!isSameOriginRendererNavigation({ applicationUrl: configuracao.urlJanela, navigationUrl: url })) return;
    const espera = ESPERAS_CARGA_MS[tentativasCarga];
    if (espera === undefined) {
      registrar(
        `a interface não carregou (${descricao}) em ${configuracao.urlJanela}; desisti depois de ${ESPERAS_CARGA_MS.length} tentativas`,
      );
      if (DESENVOLVIMENTO) {
        registrar(
          "em desenvolvimento, use `pnpm --filter @simplifica-if/desktop dev`, que inicia a interface, ou rode `pnpm --filter @simplifica-if/web dev` antes",
        );
      }
      return;
    }
    tentativasCarga += 1;
    setTimeout(() => {
      if (!nova.isDestroyed()) void nova.loadURL(configuracao.urlJanela);
    }, espera);
  });
  void nova.loadURL(configuracao.urlJanela).catch(() => undefined);
}

// T3: apps/desktop/src/window/DesktopWindow.ts (syncWindowAppearance) — o tema do sistema mudou: o
// fundo da janela e o overlay dos botões acompanham.
function sincronizarAparencia(): void {
  if (janela === undefined || janela.isDestroyed()) return;
  janela.setBackgroundColor(corFundoJanela(nativeTheme.shouldUseDarkColors));
  const { titleBarOverlay } = opcoesBarraTitulo(process.platform);
  if (titleBarOverlay !== undefined) janela.setTitleBarOverlay(titleBarOverlay);
}

/* ============================================================ IPC */

ipcMain.handle(CANAIS.telaCheia, (evento) => {
  if (!remetenteConfiavel(evento)) throw new Error("pedido recusado");
  return janela?.isFullScreen() ?? false;
});

ipcMain.handle(CANAIS.conexao, async (evento) => {
  if (!remetenteConfiavel(evento)) throw new Error("pedido recusado");
  tentativasCarga = 0;
  if (conexaoAtual === undefined) throw new Error("o servidor local ainda não foi iniciado");
  return conexaoAtual;
});

/* ============================================================ atualização (M1.10) */

let atualizacaoApp: ControleAtualizacaoApp | undefined;

/** O canal gravado pela seção "Atualizações" (o servidor grava em `atualizacao.json` da pasta do app). */
function canalGravado(): string {
  try {
    const lido = JSON.parse(
      NodeFS.readFileSync(NodePath.join(app.getPath("userData"), "atualizacao.json"), "utf8"),
    ) as {
      canal?: unknown;
    };
    return lido.canal === "estavel" ? "estavel" : ATUALIZACAO_FABRICA.canal;
  } catch {
    return ATUALIZACAO_FABRICA.canal;
  }
}

function ligarAtualizacaoApp(): void {
  const feed = process.env[VARIAVEIS.feed]?.trim() || ATUALIZACAO_FABRICA.feed;
  const motivo = motivoDesligado({
    empacotado: app.isPackaged,
    plataforma: process.platform,
    feed,
    modo: ATUALIZACAO_FABRICA.app,
    assinado: app.isPackaged && lerAssinado(process.resourcesPath),
    desligadaPorAmbiente: (process.env.SIMPLIFICA_SEM_ATUALIZACAO_APP ?? "") !== "",
  });
  registrar(`atualização do app: ${motivo ?? "ligada"}`);
  atualizacaoApp = iniciarAtualizacaoApp({
    versao: app.getVersion(),
    motivo,
    feed,
    canal: canalGravado(),
    atualizador: () => autoUpdater,
    registrar,
    antesDeInstalar: async () => {
      saindo = true;
      const atual = servidor;
      if (atual !== undefined) registrar(`servidor encerrado para instalar (${await atual.encerrar()})`);
      encerrado = true;
    },
  });
}

/** Reinicia o servidor (a troca da base acontece na abertura dele); a janela recarrega. */
async function reiniciarServidor(): Promise<void> {
  const atual = servidor;
  if (atual !== undefined) {
    servidor = undefined;
    registrar(`servidor encerrado para reiniciar (${await atual.encerrar()})`);
  }
  await iniciar();
}

ipcMain.handle(CANAIS.reiniciarServidor, async (evento) => {
  if (!remetenteConfiavel(evento)) throw new Error("pedido recusado");
  await reiniciarServidor();
});

ipcMain.handle(CANAIS.atualizacaoApp, async (evento) => {
  if (!remetenteConfiavel(evento)) throw new Error("pedido recusado");
  if (atualizacaoApp === undefined) throw new Error("a atualização do app ainda não começou");
  return atualizacaoApp.estado();
});

ipcMain.handle(CANAIS.procurarAtualizacaoApp, async (evento) => {
  if (!remetenteConfiavel(evento)) throw new Error("pedido recusado");
  if (atualizacaoApp === undefined) throw new Error("a atualização do app ainda não começou");
  return atualizacaoApp.procurar();
});

ipcMain.handle(CANAIS.instalarAtualizacaoApp, async (evento) => {
  if (!remetenteConfiavel(evento)) throw new Error("pedido recusado");
  atualizacaoApp?.instalar();
});

ipcMain.handle(CANAIS.abrirExterno, async (evento, url: unknown) => {
  if (!remetenteConfiavel(evento)) throw new Error("pedido recusado");
  const segura = urlExternaSegura(url);
  if (segura === undefined) throw new Error("só links http e https abrem no navegador");
  await shell.openExternal(segura);
});

ipcMain.handle(CANAIS.escolherPasta, async (evento) => {
  if (!remetenteConfiavel(evento) || janela === undefined) throw new Error("pedido recusado");
  const escolha = await dialog.showOpenDialog(janela, {
    title: "Escolher pasta",
    buttonLabel: "Escolher",
    properties: ["openDirectory", "createDirectory"],
  });
  return escolha.canceled ? null : (escolha.filePaths[0] ?? null);
});

/** Os `.docx` escolhidos no diálogo nesta execução: só as cópias comentadas deles abrem pelo app. */
const docxEscolhidos = new Set<string>();

/** O segredo do processo principal com o servidor desta execução (`EnvelopePartida.tokenDesktop`). */
let tokenDesktop: string | undefined;

/** Libera no servidor o arquivo escolhido: sem isso, a revisão prévia o recusa. */
async function liberarNoServidor(arquivo: string): Promise<void> {
  if (conexaoAtual === undefined || tokenDesktop === undefined) throw new Error("o servidor local não está pronto");
  const { urlServidor } = await conexaoAtual;
  const resposta = await fetch(`${urlServidor}${CAMINHO_LIBERAR_ARQUIVO}`, {
    method: "POST",
    headers: { authorization: `Bearer ${tokenDesktop}`, "content-type": "application/json" },
    body: JSON.stringify({ arquivo }),
  });
  if (resposta.status !== 204) throw new Error(`o servidor não liberou o arquivo (${resposta.status})`);
}

ipcMain.handle(CANAIS.escolherDocx, async (evento) => {
  if (!remetenteConfiavel(evento) || janela === undefined) throw new Error("pedido recusado");
  const escolha = await dialog.showOpenDialog(janela, {
    title: "Escolher o PPC (.docx)",
    buttonLabel: "Analisar",
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

/** A cópia comentada pedida, se é de um `.docx` escolhido e é arquivo comum (não link nem pasta). */
function copiaComentada(caminho: unknown): string {
  const permitido = copiaComentadaPermitida(caminho, docxEscolhidos);
  if (permitido === undefined) throw new Error("só a cópia comentada pelo Simplifica IF abre por aqui");
  const info = NodeFS.lstatSync(permitido, { throwIfNoEntry: false });
  if (info === undefined || !info.isFile()) throw new Error("a cópia comentada não foi encontrada");
  return permitido;
}

ipcMain.handle(CANAIS.abrirDocumento, async (evento, caminho: unknown) => {
  if (!remetenteConfiavel(evento)) throw new Error("pedido recusado");
  const erro = await shell.openPath(copiaComentada(caminho));
  if (erro !== "") throw new Error(`não foi possível abrir o documento: ${erro}`);
});

ipcMain.handle(CANAIS.mostrarNaPasta, async (evento, caminho: unknown) => {
  if (!remetenteConfiavel(evento)) throw new Error("pedido recusado");
  shell.showItemInFolder(copiaComentada(caminho));
});

/* ============================================================ pasta das tarefas (M1.9) */

ipcMain.handle(CANAIS.escolherAnexo, async (evento, pedidas: unknown) => {
  if (!remetenteConfiavel(evento) || janela === undefined) throw new Error("pedido recusado");
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

/** Um arquivo de pasta de tarefa: a regra de `arquivoDeTarefaPermitido` e o caminho real dentro da raiz. */
function arquivoDeTarefa(caminho: unknown, abrir: boolean): string {
  const permitido = arquivoDeTarefaPermitido(caminho, configuracao.pastaTrabalhos, abrir);
  if (permitido === undefined) throw new Error("só arquivos das pastas de tarefa abrem por aqui");
  const info = NodeFS.lstatSync(permitido, { throwIfNoEntry: false });
  if (info === undefined || !info.isFile()) throw new Error("o arquivo não foi encontrado");
  const raizReal = NodeFS.realpathSync(configuracao.pastaTrabalhos);
  if (!NodeFS.realpathSync(permitido).startsWith(raizReal + NodePath.sep)) throw new Error("arquivo fora da pasta");
  return permitido;
}

ipcMain.handle(CANAIS.abrirArquivoTarefa, async (evento, caminho: unknown) => {
  if (!remetenteConfiavel(evento)) throw new Error("pedido recusado");
  const erro = await shell.openPath(arquivoDeTarefa(caminho, true));
  if (erro !== "") throw new Error(`não foi possível abrir o arquivo: ${erro}`);
});

ipcMain.handle(CANAIS.mostrarArquivoTarefa, async (evento, caminho: unknown) => {
  if (!remetenteConfiavel(evento)) throw new Error("pedido recusado");
  shell.showItemInFolder(arquivoDeTarefa(caminho, false));
});

/* ============================================================ protocolo */

/** Serve o build da interface em `simplifica://app/`, com a CSP. */
function registrarProtocolo(pasta: string): void {
  // O build não muda enquanto o app roda: os hashes dos scripts inline do index.html, uma vez.
  let hashes: Array<string> = [];
  try {
    hashes = hashesScriptsInline(NodeFS.readFileSync(NodePath.join(pasta, "index.html"), "utf-8"));
  } catch {
    registrar(`sem o index.html da interface em ${pasta}`);
  }
  protocol.handle(ESQUEMA, async (pedido) => {
    const arquivo = resolverArquivo({
      url: pedido.url,
      method: pedido.method,
      accept: pedido.headers.get("accept"),
      host: HOST_APP,
      assetDirectory: pasta,
      isFile: (caminho) => {
        try {
          return NodeFS.statSync(caminho).isFile();
        } catch {
          return false;
        }
      },
    });
    if (arquivo.tipo === "erro") return new Response(null, { status: arquivo.status });
    let conteudo: Buffer;
    try {
      conteudo = await NodeFS.promises.readFile(arquivo.caminho);
    } catch {
      return new Response(null, { status: 404 });
    }
    return new Response(pedido.method === "HEAD" ? null : new Uint8Array(conteudo), {
      headers: {
        "content-type": tipoConteudo(arquivo.caminho),
        "content-security-policy": politicaConteudo(portaAtual(), hashes),
        "x-content-type-options": "nosniff",
      },
    });
  });
}

/* ============================================================ menu */

function menuAplicacao(): Menu {
  const mac = process.platform === "darwin";
  const modelo: Array<MenuItemConstructorOptions> = [
    ...(mac
      ? [
          {
            label: NOME,
            submenu: [
              { role: "about", label: `Sobre o ${NOME}` },
              { type: "separator" },
              { role: "hide", label: `Ocultar o ${NOME}` },
              { role: "hideOthers", label: "Ocultar os outros" },
              { role: "unhide", label: "Mostrar tudo" },
              { type: "separator" },
              { role: "quit", label: `Sair do ${NOME}` },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: "Arquivo",
      submenu: [mac ? { role: "close", label: "Fechar janela" } : { role: "quit", label: "Sair" }],
    },
    {
      label: "Editar",
      submenu: [
        { role: "undo", label: "Desfazer" },
        { role: "redo", label: "Refazer" },
        { type: "separator" },
        { role: "cut", label: "Recortar" },
        { role: "copy", label: "Copiar" },
        { role: "paste", label: "Colar" },
        { role: "selectAll", label: "Selecionar tudo" },
      ],
    },
    {
      label: "Ver",
      submenu: [
        { role: "reload", label: "Recarregar" },
        ...(DESENVOLVIMENTO
          ? [{ role: "toggleDevTools", label: "Ferramentas do desenvolvedor" } satisfies MenuItemConstructorOptions]
          : []),
        { type: "separator" },
        { role: "resetZoom", label: "Tamanho real" },
        { role: "zoomIn", label: "Aumentar" },
        { role: "zoomOut", label: "Diminuir" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Tela cheia" },
      ],
    },
    {
      label: "Janela",
      role: "window",
      submenu: [
        { role: "minimize", label: "Minimizar" },
        { role: "zoom", label: "Zoom" },
      ],
    },
  ];
  return Menu.buildFromTemplate(modelo);
}

/* ============================================================ ciclo de vida */

/** Encerra o servidor (stdin fechado, depois SIGTERM e SIGKILL) e sai. */
function sair(): void {
  if (saindo) return;
  saindo = true;
  const atual = servidor;
  const fim = atual === undefined ? Promise.resolve("ja-saira" as const) : atual.encerrar();
  void fim
    .then((como) => registrar(`servidor encerrado (${como})`))
    .catch(() => undefined)
    .finally(() => {
      encerrado = true;
      app.quit();
    });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (janela && !janela.isDestroyed()) {
      if (janela.isMinimized()) janela.restore();
      janela.focus();
    }
  });

  app.on("web-contents-created", (_evento, conteudo) => protegerConteudo(conteudo));

  app.on("before-quit", (evento) => {
    if (encerrado) return;
    evento.preventDefault();
    sair();
  });

  // O app tem uma janela só; fechada, o app sai e leva o servidor junto.
  app.on("window-all-closed", () => app.quit());

  // Ctrl+C no terminal do desenvolvimento: sai pelo mesmo caminho.
  for (const sinal of ["SIGINT", "SIGTERM"] as const) process.on(sinal, () => app.quit());

  void app.whenReady().then(async () => {
    // Nenhuma permissão do navegador (câmera, notificações…), salvo escrever na área de transferência.
    const permitidas = new Set(["clipboard-sanitized-write"]);
    session.defaultSession.setPermissionRequestHandler((_conteudo, permissao, responder) =>
      responder(permitidas.has(permissao)),
    );
    session.defaultSession.setPermissionCheckHandler((_conteudo, permissao) => permitidas.has(permissao));
    if (configuracao.interface.tipo === "pasta") registrarProtocolo(configuracao.interface.pasta);
    Menu.setApplicationMenu(menuAplicacao());
    nativeTheme.on("updated", sincronizarAparencia);
    registrar(
      `interface: ${configuracao.urlJanela}; base: ${configuracao.banco}; estado: ${configuracao.pastaEstado}; ` +
        `skills: ${configuracao.pastaSkills ?? "nenhuma"}; atualização: ${configuracao.pastaAtualizacao ?? "desligada"}`,
    );
    await iniciar();
    ligarAtualizacaoApp();
  });
}
