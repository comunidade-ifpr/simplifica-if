// @effect-diagnostics nodeBuiltinImport:off globalTimers:off extendsNativeError:off -- processo principal do Electron, sem runtime Effect (ver README)
/**
 * O servidor local (`apps/server`) como processo filho do app, como o `DesktopBackendManager` do T3:
 *
 * - **Partida:** o token (32 bytes aleatórios) e as origens da janela vão no `EnvelopePartida`, na
 *   primeira linha do stdin (`DesktopBackendBootstrap` do T3, entregue no stdin, como o T3 faz no WSL).
 *   Nunca pela linha de comando, que outros processos da máquina leem (`ps`), nem pelo ambiente, que os
 *   providers herdariam se o servidor não o limpasse.
 * - **Pronto:** a única linha do stdout é a `LinhaPartida` em JSON; o resto (logs, erros) vai no stderr.
 * - **Encerramento:** o stdin aberto é o cordão; fechá-lo encerra o servidor (as conversas, os
 *   providers e o MCP). Se ele não sair no prazo, recebe SIGTERM e, por fim, SIGKILL.
 *
 * Este módulo não importa o Electron: os testes o rodam com o Node.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import type * as NodeStream from "node:stream";

/** A variável com o token (`VARIAVEL_TOKEN` do `@simplifica-if/contratos-app`); o app não a usa. */
export const VARIAVEL_TOKEN = "SIMPLIFICA_SERVIDOR_TOKEN";

/** Bytes aleatórios do token; em base64url, 43 caracteres (o servidor pede 32 ou mais). */
export const BYTES_TOKEN = 32;

/** Quanto o app espera pela linha de partida. A primeira abertura do `kb.sqlite` pode demorar. */
export const PRAZO_PARTIDA_MS = 60_000;

/** Quanto o servidor tem para sair depois do stdin fechado (o T3 dá 5 s ao backend). */
export const PRAZO_ENCERRAMENTO_MS = 5_000;

/** Depois do SIGTERM, quanto falta até o SIGKILL. */
export const PRAZO_SIGTERM_MS = 2_000;

/** Quanto do stderr se guarda para explicar uma falha. */
const LIMITE_STDERR = 4_000;

/** Um token novo para o RPC do servidor: 32 bytes aleatórios em base64url. */
export function gerarToken(): string {
  return NodeCrypto.randomBytes(BYTES_TOKEN).toString("base64url");
}

/** A linha que o servidor imprime quando está pronto (`LinhaPartida` do `@simplifica-if/contratos-app`). */
export interface LinhaPartida {
  readonly servidor: "simplifica-if";
  readonly pid: number;
  readonly porta: number;
  readonly rpc: string;
  readonly mcp: string;
}

export class FalhaServidor extends Error {
  override readonly name = "FalhaServidor";
}

const ehInteiroPositivo = (valor: unknown): valor is number =>
  typeof valor === "number" && Number.isInteger(valor) && valor > 0;

/**
 * Decodifica a linha de partida. Confere o que o app usa (a porta, a URL do RPC em `127.0.0.1`) e
 * recusa o resto; a mensagem de erro não repete a linha.
 */
export function decodificarLinhaPartida(texto: string): LinhaPartida {
  let valor: unknown;
  try {
    valor = JSON.parse(texto);
  } catch {
    throw new FalhaServidor("a primeira linha do servidor não é JSON");
  }
  if (typeof valor !== "object" || valor === null) throw new FalhaServidor("a linha de partida não é um objeto");
  const linha = valor as Record<string, unknown>;
  if (linha.servidor !== "simplifica-if")
    throw new FalhaServidor("a linha de partida não é do servidor do Simplifica IF");
  if (!ehInteiroPositivo(linha.pid) || !ehInteiroPositivo(linha.porta) || linha.porta > 65_535) {
    throw new FalhaServidor("a linha de partida não traz o pid e a porta");
  }
  if (linha.rpc !== `ws://127.0.0.1:${linha.porta}/rpc`) {
    throw new FalhaServidor("a URL do RPC da linha de partida não é a de 127.0.0.1 na porta anunciada");
  }
  if (typeof linha.mcp !== "string") throw new FalhaServidor("a linha de partida não traz a URL do MCP");
  return { servidor: "simplifica-if", pid: linha.pid, porta: linha.porta, rpc: linha.rpc, mcp: linha.mcp };
}

/** Como rodar o servidor: o Node com o `bin.ts` (desenvolvimento) ou o Electron como Node com o bundle. */
export type Executor =
  | { readonly tipo: "node"; readonly node: string; readonly bin: string }
  | { readonly tipo: "electron"; readonly electron: string; readonly bundle: string };

export interface OpcoesInicio {
  readonly executor: Executor;
  /** `--banco`: o `kb.sqlite`. */
  readonly banco: string;
  /** `--pasta-estado`: as CLIs gerenciadas e o perfil do Antigravity. */
  readonly pastaEstado: string;
  /** `--pasta-skills`: as skills do app; sem ela, o servidor sobe sem skills. */
  readonly pastaSkills?: string | undefined;
  /** `--pasta-atualizacao`: liga a atualização da base e das skills (M1.10). */
  readonly pastaAtualizacao?: string | undefined;
  /** `--versao-app`: a versão do app, para o `app_minimo` do manifesto. */
  readonly versaoApp?: string | undefined;
  /** `--pasta-trabalhos`: a raiz das pastas de tarefa (`Documentos/Simplifica IF`). */
  readonly pastaTrabalhos?: string | undefined;
  /** Origens da janela aceitas no WebSocket e no `POST /ingresso`. */
  readonly origens: ReadonlyArray<string>;
  readonly token: string;
  /** O segredo do processo principal (`EnvelopePartida.tokenDesktop`), que a janela nunca recebe. */
  readonly tokenDesktop?: string;
  /** O ambiente do processo do app, que o servidor herda (o PATH e o HOME dos providers). */
  readonly ambiente: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
}

/** O que se passa ao `spawn`: o token só no `envelope`, que vai no stdin. */
export interface Inicio {
  readonly comando: string;
  readonly argumentos: ReadonlyArray<string>;
  readonly ambiente: Record<string, string>;
  readonly cwd: string | undefined;
  /** A primeira linha do stdin, com o `\n`. */
  readonly envelope: string;
}

/** Monta o comando, os argumentos, o ambiente e o envelope. */
export function montarInicio(opcoes: OpcoesInicio): Inicio {
  const ambiente: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(opcoes.ambiente)) {
    if (valor !== undefined) ambiente[chave] = valor;
  }
  // Um token herdado passaria a valer no lugar do envelope.
  delete ambiente[VARIAVEL_TOKEN];
  delete ambiente.ELECTRON_RUN_AS_NODE;
  const script = opcoes.executor.tipo === "node" ? opcoes.executor.bin : opcoes.executor.bundle;
  if (opcoes.executor.tipo === "electron") {
    // Como o T3: o executável do app roda como Node.
    ambiente.ELECTRON_RUN_AS_NODE = "1";
  }
  return {
    comando: opcoes.executor.tipo === "node" ? opcoes.executor.node : opcoes.executor.electron,
    argumentos: [
      script,
      "--banco",
      opcoes.banco,
      "--pasta-estado",
      opcoes.pastaEstado,
      ...(opcoes.pastaSkills === undefined ? [] : ["--pasta-skills", opcoes.pastaSkills]),
      ...(opcoes.pastaAtualizacao === undefined ? [] : ["--pasta-atualizacao", opcoes.pastaAtualizacao]),
      ...(opcoes.versaoApp === undefined ? [] : ["--versao-app", opcoes.versaoApp]),
      ...(opcoes.pastaTrabalhos === undefined ? [] : ["--pasta-trabalhos", opcoes.pastaTrabalhos]),
    ],
    ambiente,
    cwd: opcoes.cwd,
    envelope: `${JSON.stringify({
      token: opcoes.token,
      origens: [...opcoes.origens],
      ...(opcoes.tokenDesktop === undefined ? {} : { tokenDesktop: opcoes.tokenDesktop }),
    })}\n`,
  };
}

/**
 * A primeira linha de `entrada`, até `prazoMs`. Falha se a entrada acabar antes ou se o prazo passar.
 * As linhas depois dela se descartam.
 */
export function lerPrimeiraLinha(entrada: NodeStream.Readable, prazoMs: number): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    let acumulado = "";
    const limpar = () => {
      clearTimeout(relogio);
      entrada.off("data", aoDado);
      entrada.off("end", aoFim);
      entrada.off("error", aoErro);
    };
    const aoDado = (pedaco: Buffer | string) => {
      acumulado += pedaco.toString();
      const fim = acumulado.indexOf("\n");
      if (fim < 0) return;
      limpar();
      // O resto do stdout continua sendo lido (e descartado), para o pipe não encher.
      entrada.resume();
      resolver(acumulado.slice(0, fim).replace(/\r$/, ""));
    };
    const aoFim = () => {
      limpar();
      rejeitar(new FalhaServidor("o servidor fechou a saída antes da linha de partida"));
    };
    const aoErro = (erro: Error) => {
      limpar();
      rejeitar(new FalhaServidor(`erro ao ler a saída do servidor: ${erro.message}`));
    };
    const relogio = setTimeout(() => {
      limpar();
      rejeitar(new FalhaServidor(`o servidor não ficou pronto em ${Math.round(prazoMs / 1000)} s`));
    }, prazoMs);
    entrada.on("data", aoDado);
    entrada.once("end", aoFim);
    entrada.once("error", aoErro);
  });
}

/** Como o processo terminou. */
export interface Saida {
  readonly codigo: number | null;
  readonly sinal: NodeJS.Signals | null;
}

export interface ServidorEmExecucao {
  readonly linha: LinhaPartida;
  readonly pid: number;
  /** Resolve quando o processo termina, por qualquer motivo. */
  readonly saida: Promise<Saida>;
  /** O fim do stderr, para explicar uma queda. */
  readonly stderr: () => string;
  /**
   * Fecha o stdin e espera; se o servidor não sair, SIGTERM e depois SIGKILL. Diz como terminou.
   * Chamadas repetidas devolvem a mesma promessa.
   */
  readonly encerrar: () => Promise<"stdin" | "sigterm" | "sigkill" | "ja-saira">;
}

export interface OpcoesExecucao {
  readonly prazoPartidaMs?: number;
  readonly prazoEncerramentoMs?: number;
  readonly prazoSigtermMs?: number;
  /** Cada pedaço do stderr do servidor (os logs), para o app repassar ao próprio stderr. */
  readonly aoStderr?: (pedaco: string) => void;
}

/** Espera `saida` resolver, até `prazoMs`; diz se resolveu. */
function esperarSaida(saida: Promise<unknown>, prazoMs: number): Promise<boolean> {
  return new Promise((resolver) => {
    const relogio = setTimeout(() => resolver(false), prazoMs);
    void saida.then(() => {
      clearTimeout(relogio);
      resolver(true);
    });
  });
}

/**
 * Inicia o servidor, entrega o envelope e espera a linha de partida. Se o processo sair, ou não
 * ficar pronto no prazo, ele é encerrado e a promessa falha com o fim do stderr.
 */
export async function iniciarServidor(inicio: Inicio, opcoes: OpcoesExecucao = {}): Promise<ServidorEmExecucao> {
  const filho = NodeChildProcess.spawn(inicio.comando, [...inicio.argumentos], {
    cwd: inicio.cwd,
    env: inicio.ambiente,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let terminou = false;
  let aoTerminar: (saida: Saida) => void = () => undefined;
  const saida = new Promise<Saida>((resolver) => {
    aoTerminar = (resultado) => {
      if (terminou) return;
      terminou = true;
      resolver(resultado);
    };
  });
  filho.once("exit", (codigo, sinal) => aoTerminar({ codigo, sinal }));
  let erroAbertura: FalhaServidor | undefined;
  const falhaAoAbrir = new Promise<never>((_, rejeitar) => {
    filho.once("error", (erro) => {
      erroAbertura = new FalhaServidor(`não foi possível iniciar o servidor: ${erro.message}`);
      // Sem pid, o processo nem começou: não haverá `exit`.
      if (filho.pid === undefined) aoTerminar({ codigo: null, sinal: null });
      rejeitar(erroAbertura);
    });
  });
  falhaAoAbrir.catch(() => undefined);

  let stderr = "";
  const fimStderr = new Promise<void>((resolver) => filho.stderr.once("close", () => resolver()));
  filho.stderr.setEncoding("utf8");
  filho.stderr.on("data", (pedaco: string) => {
    stderr = (stderr + pedaco).slice(-LIMITE_STDERR);
    opcoes.aoStderr?.(pedaco);
  });
  // O servidor pode ter saído antes de ler o envelope (EPIPE): a falha aparece pela saída.
  filho.stdin.on("error", () => undefined);
  filho.stdin.write(inicio.envelope);

  let encerramento: Promise<"stdin" | "sigterm" | "sigkill" | "ja-saira"> | undefined;
  const encerrar = () => {
    encerramento ??= (async () => {
      if (terminou) return "ja-saira" as const;
      filho.stdin.end();
      if (await esperarSaida(saida, opcoes.prazoEncerramentoMs ?? PRAZO_ENCERRAMENTO_MS)) return "stdin" as const;
      filho.kill("SIGTERM");
      if (await esperarSaida(saida, opcoes.prazoSigtermMs ?? PRAZO_SIGTERM_MS)) return "sigterm" as const;
      filho.kill("SIGKILL");
      await saida;
      return "sigkill" as const;
    })();
    return encerramento;
  };

  try {
    const texto = await Promise.race([
      lerPrimeiraLinha(filho.stdout, opcoes.prazoPartidaMs ?? PRAZO_PARTIDA_MS),
      falhaAoAbrir,
    ]);
    const linha = decodificarLinhaPartida(texto);
    return { linha, pid: filho.pid ?? linha.pid, saida, stderr: () => stderr, encerrar };
  } catch (erro) {
    await encerrar();
    // O stderr chega por inteiro só depois da saída.
    await esperarSaida(fimStderr, 1_000);
    const detalhe = stderr.trim();
    const causa = erroAbertura ?? erro;
    const motivo = causa instanceof Error ? causa.message : String(causa);
    throw new FalhaServidor(detalhe === "" ? motivo : `${motivo}\n\n${detalhe}`);
  }
}
