// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off -- processo principal do Electron, sem runtime Effect (ver README)
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
  protocol,
  session,
  shell,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";
import { ESQUEMA, HOST_APP, resolverConfiguracao, type Configuracao } from "./configuracao.ts";
import { CANAIS, type Conexao } from "./ponteDesktop.ts";
import { abrirLog } from "./registro.ts";
import {
  copiaComentadaPermitida,
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

/** Inicia o servidor e guarda a conexão. A janela recebe a conexão quando ele fica pronto. */
function subirServidor(): Promise<Conexao> {
  const token = gerarToken();
  const inicio = montarInicio({
    executor: configuracao.executor,
    banco: configuracao.banco,
    pastaEstado: configuracao.pastaEstado,
    pastaSkills: configuracao.pastaSkills,
    origens: configuracao.origens,
    token,
    ambiente: process.env,
    cwd: configuracao.cwd,
  });
  registrar(`iniciando o servidor: ${inicio.comando} ${inicio.argumentos.join(" ")}`);
  const conexao = iniciarServidor(inicio, { aoStderr: paraStderrELog }).then((iniciado) => {
    servidor = iniciado;
    registrar(`servidor pronto (pid ${iniciado.pid}, porta ${iniciado.linha.porta})`);
    void iniciado.saida.then((saida) => {
      if (servidor === iniciado) servidor = undefined;
      if (!saindo) void aoCairServidor(`O servidor saiu (${descreverSaida(saida)}).`, iniciado.stderr());
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
    message: "O servidor local do Simplifica IF parou.",
    detail: [mensagem, detalhe.trim().slice(-1_500)].filter(Boolean).join("\n\n"),
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
    await subirServidor();
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
    backgroundColor: "#ffffff",
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

/* ============================================================ IPC */

ipcMain.handle(CANAIS.conexao, async (evento) => {
  if (!remetenteConfiavel(evento)) throw new Error("pedido recusado");
  tentativasCarga = 0;
  if (conexaoAtual === undefined) throw new Error("o servidor local ainda não foi iniciado");
  return conexaoAtual;
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
    registrar(
      `interface: ${configuracao.urlJanela}; base: ${configuracao.banco}; estado: ${configuracao.pastaEstado}; ` +
        `skills: ${configuracao.pastaSkills ?? "nenhuma"}`,
    );
    await iniciar();
  });
}
