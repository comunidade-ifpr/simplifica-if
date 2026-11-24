// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off -- processo principal do Electron, sem runtime Effect (ver README)
/**
 * A atualização do app (M1.10), pelo `electron-updater`, como no T3 (`DesktopUpdates.ts`), reduzida ao
 * que o app faz: um feed `generic` (nunca o provider `github`, que consulta a API do GitHub, limitada
 * a 60 consultas por hora por IP), download em segundo plano e "Reiniciar para atualizar".
 *
 * - **Feed:** o da política de fábrica (`ATUALIZACAO_FABRICA.feed`, com `{canal}`), ou
 *   `SIMPLIFICA_ATUALIZACAO_FEED`. No GitHub Releases, o release fixo do canal (`canal-beta/`) tem o
 *   `latest-mac.yml` e o `latest.yml`, que apontam para os instaladores no release da versão
 *   (`../app-v0.2.0/...`); o `electron-updater` resolve a URL relativa ao feed.
 * - **Canal:** um feed por canal, então o `electron-updater` usa sempre o canal `latest` dentro dele.
 * - **Desligado** (`motivoDesligado`, a regra do `getAutoUpdateDisabledReason` do T3): fora do app
 *   empacotado, sem feed, com `SIMPLIFICA_SEM_ATUALIZACAO_APP`, e, enquanto a política diz
 *   `se-assinado`, num app sem assinatura de código. O macOS não instala atualização de um app sem
 *   Developer ID (o Squirrel.Mac confere a assinatura do app novo contra a do instalado); sem
 *   certificado (decisão em aberto 1), o app não procura nada e a seção explica por quê.
 */
import type { EstadoAtualizacaoApp } from "@simplifica-if/contratos-app/ponte";

export interface EntradaMotivo {
  readonly empacotado: boolean;
  readonly plataforma: NodeJS.Platform;
  readonly feed: string | null;
  readonly modo: "se-assinado" | "nunca";
  readonly assinado: boolean;
  readonly desligadaPorAmbiente: boolean;
}

/** Por que a atualização do app está desligada; `null` se está ligada. */
export function motivoDesligado(entrada: EntradaMotivo): string | null {
  if (entrada.modo === "nunca") return "A atualização do app está desligada na política do app.";
  if (entrada.feed === null) return "O endereço das atualizações do app ainda não foi configurado.";
  if (!entrada.empacotado) return "A atualização do app só funciona no app instalado.";
  if (entrada.desligadaPorAmbiente) return "A atualização do app foi desligada por SIMPLIFICA_SEM_ATUALIZACAO_APP.";
  if (entrada.plataforma !== "darwin" && entrada.plataforma !== "win32") {
    return "A atualização automática do app existe só no macOS e no Windows.";
  }
  if (!entrada.assinado) {
    return entrada.plataforma === "darwin"
      ? "Este app ainda não tem assinatura de código da Apple, e o macOS não instala atualização sem ela. Baixe a versão nova pelo instalador."
      : "Este app ainda não tem assinatura de código. Baixe a versão nova pelo instalador.";
  }
  return null;
}

/** A URL do feed do app num canal: o `{canal}` trocado e a barra no fim. */
export function feedDoCanal(feed: string, canal: string): string {
  const url = feed.replaceAll("{canal}", canal);
  return url.endsWith("/") ? url : `${url}/`;
}

/** O pedaço do `autoUpdater` que o app usa (o do `electron-updater`, ou um falso nos testes). */
export interface Atualizador {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  setFeedURL(opcoes: { provider: "generic"; url: string }): void;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
  on(evento: string, ouvinte: (...argumentos: never[]) => void): unknown;
}

export interface ControleAtualizacaoApp {
  estado(): EstadoAtualizacaoApp;
  procurar(): Promise<EstadoAtualizacaoApp>;
  instalar(): void;
  parar(): void;
}

const UM_DIA = 24 * 60 * 60 * 1000;

/** Liga o `electron-updater` quando `motivoDesligado` deixa; senão, só responde o estado. */
export function iniciarAtualizacaoApp(opcoes: {
  readonly versao: string;
  readonly motivo: string | null;
  readonly feed: string | null;
  readonly canal: string;
  readonly atualizador: () => Atualizador;
  readonly registrar: (linha: string) => void;
  /** Antes de instalar: encerra o servidor (como o T3 para os backends antes do `quitAndInstall`). */
  readonly antesDeInstalar: () => Promise<void>;
}): ControleAtualizacaoApp {
  let estado: EstadoAtualizacaoApp = {
    versao: opcoes.versao,
    desligada: opcoes.motivo,
    situacao: "parada",
    nova: null,
    progresso: null,
    erro: null,
  };
  if (opcoes.motivo !== null || opcoes.feed === null) {
    return { estado: () => estado, procurar: async () => estado, instalar: () => undefined, parar: () => undefined };
  }
  const atualizador = opcoes.atualizador();
  const mudar = (parcial: Partial<EstadoAtualizacaoApp>) => {
    estado = { ...estado, ...parcial };
  };
  atualizador.autoDownload = true;
  atualizador.autoInstallOnAppQuit = true;
  atualizador.setFeedURL({ provider: "generic", url: feedDoCanal(opcoes.feed, opcoes.canal) });
  atualizador.on("checking-for-update", () => mudar({ situacao: "procurando", erro: null }));
  atualizador.on("update-available", (info: { version?: string }) =>
    mudar({ situacao: "baixando", nova: info.version ?? null, progresso: 0 }),
  );
  atualizador.on("update-not-available", () => mudar({ situacao: "em-dia", progresso: null }));
  atualizador.on("download-progress", (progresso: { percent?: number }) =>
    mudar({ progresso: Math.round(progresso.percent ?? 0) }),
  );
  atualizador.on("update-downloaded", (info: { version?: string }) => {
    mudar({ situacao: "pronta", nova: info.version ?? estado.nova, progresso: 100 });
    opcoes.registrar(`app ${info.version ?? "?"} baixado; instala ao sair ou em "Reiniciar para atualizar"`);
  });
  atualizador.on("error", (erro: Error) => {
    mudar({ situacao: "erro", erro: "Não foi possível procurar ou baixar a versão nova do app." });
    opcoes.registrar(`atualização do app falhou: ${erro?.message ?? String(erro)}`);
  });
  const procurar = async () => {
    try {
      await atualizador.checkForUpdates();
    } catch {
      // o evento `error` já registrou
    }
    return estado;
  };
  void procurar();
  const intervalo = setInterval(() => void procurar(), UM_DIA);
  return {
    estado: () => estado,
    procurar,
    instalar: () => {
      if (estado.situacao !== "pronta") return;
      void opcoes.antesDeInstalar().finally(() => atualizador.quitAndInstall());
    },
    parar: () => clearInterval(intervalo),
  };
}

/**
 * A proxy que o Electron resolve para o feed (`session.resolveProxy`: a configuração do sistema, o
 * PAC e o WPAD) como as variáveis que o servidor lê (`HTTP_PROXY`, `HTTPS_PROXY`), para o download da
 * base passar pela proxy institucional como o navegador do sistema. Só a primeira regra conta;
 * `DIRECT` e SOCKS (que o `undici` não usa) não dão variável. As que o ambiente já tem não mudam.
 */
export function proxyParaServidor(
  resolvida: string,
  ambiente: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const primeira = resolvida.split(";")[0]?.trim() ?? "";
  const partes = /^(PROXY|HTTPS)\s+(\S+)$/i.exec(primeira);
  if (partes === null) return {};
  const url = `${partes[1]!.toUpperCase() === "HTTPS" ? "https" : "http"}://${partes[2]}`;
  const definida = (nome: string) => (ambiente[nome] ?? ambiente[nome.toLowerCase()] ?? "") !== "";
  const saida: Record<string, string> = {};
  if (!definida("HTTPS_PROXY")) saida.HTTPS_PROXY = url;
  if (!definida("HTTP_PROXY")) saida.HTTP_PROXY = url;
  return saida;
}
