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
 *
 * Este arquivo guarda o estado (o servidor, a janela, a atualização) e o ciclo de vida; os canais do
 * IPC ficam em `ipc.ts`, o protocolo `simplifica://` em `protocolo.ts` e o menu em `menu.ts`.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { app, BrowserWindow, dialog, Menu, nativeTheme, session, shell, type WebContents } from "electron";
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
import { resolverConfiguracao, VARIAVEIS, type Configuracao } from "./configuracao.ts";
import { registrarIpc } from "./ipc.ts";
import { VARIAVEL_SEM_REINICIO, vigiarCodigoDoServidor } from "./vigiaDev.ts";
import { corFundoJanela, opcoesBarraTitulo } from "./janela.ts";
import { CANAIS, type CredenciaisServidor } from "@simplifica-if/contratos-app/ponte";
import { menuAplicacao } from "./menu.ts";
import { registrarPrivilegiosEsquema, registrarProtocolo } from "./protocolo.ts";
import { abrirLog, limitarRegistros, linhaDaInterface } from "./registro.ts";
import { serializar } from "./reinicio.ts";
import { isSameOriginRendererNavigation, urlExternaSegura } from "./seguranca.ts";
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
  copyright: "© 2026 Gustavo Rahal e contribuidores do Simplifica IF",
});
app.setPath("userData", NodePath.join(app.getPath("appData"), DESENVOLVIMENTO ? `${NOME} (dev)` : NOME));

/** A pasta de logs: a do app e do servidor (`registro.ts`) e a dos traces do servidor (`--pasta-logs`). */
const pastaLogs = DESENVOLVIMENTO ? NodePath.join(app.getPath("userData"), "logs") : app.getPath("logs");

/** O log do app e do servidor (`registro.ts`), além do stderr. */
const log = abrirLog(pastaLogs);

/** Copia para o arquivo de log o que vai para o stderr. */
const paraStderrELog = (texto: string) => {
  process.stderr.write(texto);
  log.escrever(texto);
};

const registrar = (mensagem: string) => paraStderrELog(`${new Date().toISOString()} [desktop] ${mensagem}\n`);

registrarPrivilegiosEsquema();

/** A raiz do checkout no desenvolvimento: o main.cjs fica em apps/desktop/dist/app. */
const RAIZ_REPOSITORIO = NodePath.resolve(__dirname, "..", "..", "..", "..");

const configuracao: Configuracao = resolverConfiguracao({
  empacotado: app.isPackaged,
  raizRepositorio: RAIZ_REPOSITORIO,
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
let conexaoAtual: Promise<CredenciaisServidor> | undefined;
/** O segredo do processo principal com o servidor desta execução (`EnvelopePartida.tokenDesktop`). */
let tokenDesktop: string | undefined;
let janela: BrowserWindow | undefined;
/** O app está saindo: a queda do servidor não é erro. */
let saindo = false;
/** Para o vigia do código do servidor (só no desenvolvimento). */
let pararVigia: (() => void) | undefined;
let encerrado = false;

function descreverSaida(saida: Saida): string {
  return saida.sinal === null ? `código ${saida.codigo ?? "?"}` : `sinal ${saida.sinal}`;
}

/**
 * A proxy da rede para o servidor baixar a base (M1.10) e as CLIs gerenciadas dos providers:
 * a que o Electron resolve como o navegador do sistema. Se a resolução falhar, nada muda.
 */
async function ambienteComProxy(): Promise<NodeJS.ProcessEnv> {
  const feed = process.env[VARIAVEIS.feed]?.trim() || ATUALIZACAO_FABRICA.feed;
  const url =
    configuracao.pastaAtualizacao !== undefined && feed !== null
      ? new URL("x", feedDoCanal(feed, canalGravado())).href
      : "https://storage.googleapis.com/";
  try {
    const proxy = proxyParaServidor(await session.defaultSession.resolveProxy(url), process.env);
    if (Object.keys(proxy).length > 0)
      registrar(`proxy do sistema para downloads: ${proxy.HTTPS_PROXY ?? proxy.HTTP_PROXY}`);
    return { ...process.env, ...proxy };
  } catch (erro) {
    registrar(`não foi possível resolver a proxy do sistema: ${String(erro)}`);
    return process.env;
  }
}

/** Inicia o servidor e guarda a conexão. A janela recebe a conexão quando ele fica pronto. */
function subirServidor(ambiente: NodeJS.ProcessEnv): Promise<CredenciaisServidor> {
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
    pastaLogs,
    traces: configuracao.traces,
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
    return { urlServidor: `http://127.0.0.1:${iniciado.linha.porta}`, token } satisfies CredenciaisServidor;
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

/** Erro do servidor: mostra o motivo e oferece reiniciar (ou só sair quando o banco é incompatível). */
async function aoCairServidor(mensagem: string, detalhe: string): Promise<void> {
  if (saindo) return;
  const combinado = `${mensagem}\n${detalhe}`;
  const erroBanco = /BancoIncompativel|MigracaoViolouIntegridade|MigrationError/.test(combinado);
  const opcoes = erroBanco
    ? {
        type: "error" as const,
        title: NOME,
        message: "Não foi possível abrir o banco de dados local do Simplifica IF.",
        detail: [
          "O banco pode ter sido atualizado por uma versão mais nova do app ou falhou ao atualizar. Se houver uma cópia .bak na pasta de dados do app, ela foi preservada. Atualize o Simplifica IF ou peça ajuda com os detalhes abaixo.",
          `Detalhes técnicos:\n${[mensagem, detalhe.trim().slice(-1_500)].filter(Boolean).join("\n\n")}`,
        ].join("\n\n"),
        buttons: ["Sair"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      }
    : {
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
  if (erroBanco || response !== 0) {
    app.quit();
    return;
  }
  await reinicio.pedir();
}

/**
 * Sobe o servidor e mostra a janela; na falha, o diálogo de erro, sem esperá-lo: o "Reiniciar" dele pede
 * outra troca (`reinicio`), e esta precisa ter acabado. Só pelo `reinicio`.
 */
async function iniciar(): Promise<void> {
  try {
    await subirServidor(await ambienteComProxy());
  } catch (erro) {
    void aoCairServidor(erro instanceof Error ? erro.message : String(erro), "");
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
    // Sem a barra de título do sistema: o cabeçalho da interface é a barra (`janela.ts`).
    ...opcoesBarraTitulo(process.platform, nativeTheme.shouldUseDarkColors),
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
  const { titleBarOverlay } = opcoesBarraTitulo(process.platform, nativeTheme.shouldUseDarkColors);
  if (titleBarOverlay !== undefined) janela.setTitleBarOverlay(titleBarOverlay);
}

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
      pararVigia?.();
      await reinicio.ocioso();
      const atual = servidor;
      if (atual !== undefined) registrar(`servidor encerrado para instalar (${await atual.encerrar()})`);
      encerrado = true;
    },
  });
}

/** Encerra o servidor atual, se houver, e sobe outro (a troca da base acontece na abertura dele). */
async function trocarServidor(): Promise<void> {
  if (saindo) return;
  const atual = servidor;
  if (atual !== undefined) {
    servidor = undefined;
    registrar(`servidor encerrado para reiniciar (${await atual.encerrar()})`);
  }
  if (saindo) return;
  await iniciar();
}

/**
 * Toda subida do servidor passa por aqui, uma de cada vez (`reinicio.ts`): a partida, a troca da base, o
 * vigia do desenvolvimento e o "Reiniciar" do diálogo de erro. Duas em paralelo deixavam um órfão.
 */
const reinicio = serializar(trocarServidor, (erro) => registrar(`falha ao reiniciar o servidor: ${String(erro)}`));

/** Reinicia o servidor; a janela recarrega. */
const reiniciarServidor = (): Promise<void> => reinicio.pedir();

/* ============================================================ IPC (`ipc.ts`) */

registrarIpc({
  urlJanela: configuracao.urlJanela,
  pastaTrabalhos: configuracao.pastaTrabalhos,
  janela: () => janela,
  conexao: () => {
    tentativasCarga = 0;
    if (conexaoAtual === undefined) throw new Error("o servidor local ainda não foi iniciado");
    return conexaoAtual;
  },
  conexaoAtual: () => conexaoAtual,
  tokenDesktop: () => tokenDesktop,
  reiniciarServidor,
  atualizacaoApp: () => atualizacaoApp,
  // Um teto defensivo: a interface já limita, mas uma janela em laço não enche o log.
  registrarInterface: limitarRegistros({
    maximo: 120,
    janelaMs: 60_000,
    agora: () => Date.now(),
    gravar: (texto) => paraStderrELog(linhaDaInterface(new Date().toISOString(), texto)),
    suprimidos: (n) => `${n} registros da interface suprimidos no último minuto (teto do processo principal)`,
  }),
});

/* ============================================================ ciclo de vida */

/** Encerra o servidor (stdin fechado, depois SIGTERM e SIGKILL) e sai. */
function sair(): void {
  if (saindo) return;
  saindo = true;
  pararVigia?.();
  // Uma troca em curso termina antes (a seguinte não começa: `saindo`), para o servidor dela não ficar órfão.
  const fim = reinicio.ocioso().then(() => {
    const atual = servidor;
    return atual === undefined ? ("ja-saira" as const) : atual.encerrar();
  });
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
    if (configuracao.interface.tipo === "pasta")
      registrarProtocolo(configuracao.interface.pasta, { portaAtual, registrar });
    Menu.setApplicationMenu(menuAplicacao({ nome: NOME, desenvolvimento: DESENVOLVIMENTO }));
    nativeTheme.on("updated", sincronizarAparencia);
    registrar(
      `interface: ${configuracao.urlJanela}; base: ${configuracao.banco}; estado: ${configuracao.pastaEstado}; ` +
        `skills: ${configuracao.pastaSkills ?? "nenhuma"}; atualização: ${configuracao.pastaAtualizacao ?? "desligada"}`,
    );
    await reinicio.pedir();
    ligarAtualizacaoApp();
    if (DESENVOLVIMENTO && process.env[VARIAVEL_SEM_REINICIO] !== "1" && !saindo)
      pararVigia = vigiarCodigoDoServidor({
        raizRepositorio: RAIZ_REPOSITORIO,
        registrar,
        aoMudar: (arquivo) => {
          if (saindo) return;
          registrar(`código do servidor mudou (${arquivo}); reiniciando o servidor`);
          void reiniciarServidor();
        },
      });
  });
}
