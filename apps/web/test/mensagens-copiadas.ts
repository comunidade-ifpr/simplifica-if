// @effect-diagnostics nodeBuiltinImport:off -- o teste lê o código-fonte copiado do disco, no Node
/**
 * As frases em inglês do código copiado do T3 (M1.14, sobras): o varredor que as acha no código e a
 * lista explícita do que cada uma vira na tela. O teste (`mensagens-copiadas.test.ts`) confere que as
 * duas batem: numa atualização do upstream, a frase nova acusa e precisa entrar aqui, com o destino.
 *
 * Onde estão: `packages/motor/src/t3` (instalação e login do Codex e do Antigravity, o ambiente do
 * Claude), `packages/effect-acp` e `packages/effect-codex-app-server` (os protocolos). As do motor
 * chegam à tela pelo `mensagem` dos estados de instalação e de login, com o `tipoFalha` que o motor
 * dá (`classificarFalhaEstado`), e passam por `explicarMensagemMotor`. As dos protocolos chegam como
 * causa de `FalhaProvider` ou como mensagem de `Erro` do turno; o motor as classifica
 * (`classificarFalha`). (`apps/server/src/t3` só tem o vigia do
 * lançador, sem texto para a pessoa.)
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import type { TipoFalha } from "@simplifica-if/contratos-app";

const RAIZ = NodePath.resolve(import.meta.dirname, "../../..");

/** As pastas do código copiado, relativas à raiz do repositório. */
export const PASTAS_COPIADAS = [
  "packages/motor/src/t3",
  "packages/effect-acp/src",
  "packages/effect-codex-app-server/src",
] as const;

function arquivosTs(pasta: string): ReadonlyArray<string> {
  return NodeFS.readdirSync(pasta, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = NodePath.join(pasta, entrada.name);
    if (entrada.isDirectory()) return entrada.name === "_generated" ? [] : arquivosTs(caminho);
    return entrada.name.endsWith(".ts") && !entrada.name.endsWith(".test.ts") ? [caminho] : [];
  });
}

/** O conteúdo de um template literal a partir de `inicio` (depois da crase), com `${…}` como "…". */
function lerTemplate(texto: string, inicio: number): { readonly conteudo: string; readonly fim: number } {
  let conteudo = "";
  let i = inicio;
  while (i < texto.length) {
    const c = texto[i]!;
    if (c === "\\") {
      conteudo += texto[i + 1] ?? "";
      i += 2;
    } else if (c === "`") {
      return { conteudo, fim: i + 1 };
    } else if (c === "$" && texto[i + 1] === "{") {
      // Pula a interpolação inteira, inclusive templates e chaves aninhados.
      let profundidade = 1;
      i += 2;
      while (i < texto.length && profundidade > 0) {
        const d = texto[i]!;
        if (d === "`") i = lerTemplate(texto, i + 1).fim;
        else {
          if (d === "{") profundidade += 1;
          else if (d === "}") profundidade -= 1;
          i += 1;
        }
      }
      conteudo += "…";
    } else {
      conteudo += c;
      i += 1;
    }
  }
  return { conteudo, fim: i };
}

/** O fim de uma string entre `aspas` que começa em `inicio` (depois da aspa), e o conteúdo dela. */
function lerString(texto: string, inicio: number, aspas: string): { readonly conteudo: string; readonly fim: number } {
  let i = inicio;
  while (i < texto.length && texto[i] !== aspas && texto[i] !== "\n") i += texto[i] === "\\" ? 2 : 1;
  return { conteudo: texto.slice(inicio, i), fim: i + 1 };
}

const FRASE_STRING = /^[A-Z][^"\\\n]*\s[^"\\\n]*\.$/;

/**
 * As frases de um arquivo: strings entre aspas duplas que começam com maiúscula, têm espaço e terminam
 * em ponto, e templates que começam com maiúscula e têm ao menos três palavras (as interpolações viram
 * "…"). Rótulos curtos ("Gemini API key") e comandos (`Write-Output …`) ficam de fora. O varredor pula
 * os comentários e as strings, para que uma crase dentro deles não desencontre os templates.
 */
export function frasesDoArquivo(texto: string): ReadonlyArray<string> {
  const frases: Array<string> = [];
  let i = 0;
  while (i < texto.length) {
    const c = texto[i]!;
    if (c === "/" && texto[i + 1] === "/") {
      const fim = texto.indexOf("\n", i);
      i = fim === -1 ? texto.length : fim + 1;
    } else if (c === "/" && texto[i + 1] === "*") {
      const fim = texto.indexOf("*/", i + 2);
      i = fim === -1 ? texto.length : fim + 2;
    } else if (c === '"' || c === "'") {
      const { conteudo, fim } = lerString(texto, i + 1, c);
      if (c === '"' && FRASE_STRING.test(conteudo)) frases.push(conteudo);
      i = fim;
    } else if (c === "`") {
      const { conteudo, fim } = lerTemplate(texto, i + 1);
      if (/^[A-Z]/.test(conteudo) && conteudo.split(/\s+/).length >= 3 && !conteudo.startsWith("Write-Output"))
        frases.push(conteudo.replace(/\s+/g, " "));
      i = fim;
    } else {
      i += 1;
    }
  }
  return frases;
}

/** Todas as frases do código copiado, sem repetição, cada uma com o arquivo onde aparece primeiro. */
export function frasesCopiadas(): ReadonlyMap<string, string> {
  const frases = new Map<string, string>();
  for (const pasta of PASTAS_COPIADAS)
    for (const arquivo of arquivosTs(NodePath.join(RAIZ, pasta)).toSorted())
      for (const frase of frasesDoArquivo(NodeFS.readFileSync(arquivo, "utf8")))
        if (!frases.has(frase)) frases.set(frase, NodePath.relative(RAIZ, arquivo));
  return frases;
}

/**
 * O destino de cada frase:
 *
 * - `"motor"`: chega à tela pelo estado de instalação ou de login, ou pela causa de uma falha do
 *   motor; `explicarMensagemMotor` tem de dar uma frase em português, não a genérica;
 * - um `TipoFalha`: chega como causa de `FalhaProvider` ou `Erro` do turno; `classificarFalha` tem de dar
 *   esse tipo;
 * - `"generica"`: chega como causa de falha, mas é erro interno do protocolo, sem o que a pessoa
 *   possa fazer além de tentar de novo: a frase genérica serve, com o original em "Detalhes técnicos";
 * - `{ fora: motivo }`: não chega à tela (log, ferramenta de teste, caminho que o app não usa).
 */
export type Destino = "motor" | "generica" | Exclude<TipoFalha, "desconhecido"> | { readonly fora: string };

const LOG_PATH = { fora: "log do fixPath (os-jank.ts), não vai para a tela" };
const PONTE_MCP = { fora: "erro da ponte MCP stdio, que vai para a IA como resposta da ferramenta" };
const REPLAY = { fora: "replay de transcrições do app-server, só nos testes" };

export const DESTINOS: Readonly<Record<string, Destino>> = {
  // packages/motor/src/t3: instalação, login e ambiente
  "A provider instance has a custom path inside this managed runtime. Clear that path before removing it.": "motor",
  "A provider instance uses a custom path inside managed Codex. Clear that path before removing it.": "motor",
  "Agent Platform needs an API key, or a GCP project and location, in the Antigravity provider settings.": "motor",
  "An archive member exceeded its pinned size.": "motor",
  "An archive member was truncated.": "motor",
  "Another installation published a different Antigravity release.": "motor",
  "Antigravity ACP runtime is not installed. Install it in this environment's provider settings or set a custom ACP executable path. The Antigravity app, IDE, and CLI are separate installations.":
    "motor",
  "Antigravity authenticated, but could not initialize a session or load models.": "motor",
  "Antigravity browser suppression could not be verified.": "motor",
  "Antigravity browser suppression verification timed out.": "motor",
  "Antigravity could not authenticate with the configured credentials.": "motor",
  "Antigravity could not reach Google. Check this machine's network connection, then start sign-in again.": "motor",
  "Antigravity did not respond. Its runtime may not run on this machine.": "motor",
  "Antigravity has not reached Google after 30 seconds. Check this machine's network connection. Broken IPv6 is a common cause.":
    "motor",
  "Antigravity has not started after 90 seconds. Its runtime may be stuck starting on this machine.": "motor",
  "Antigravity needs at least … MiB of free space to install.": "motor",
  "Antigravity rejected the configured credentials. Check the provider settings.": "motor",
  "Antigravity requires IPv6 socket support. Enable IPv6 in this environment. On WSL, remove ipv6.disable=1 from .wslconfig and run wsl --shutdown.":
    "motor",
  "Antigravity returned an invalid Google sign-in URL.": "motor",
  "Antigravity sent a protocol line that is too large.": "motor",
  "Antigravity setup is already in progress.": "motor",
  "Antigravity setup is already stopping.": "motor",
  "Antigravity sign-in or sign-out is in progress. Try again after it finishes.": "motor",
  "Antigravity sign-out failed. Try again.": "motor",
  "Antigravity sign-out timed out.": "motor",
  "Antigravity started more than one Google sign-in request.": "motor",
  "Antigravity user skills are not linked into the profile.": "motor",
  "Antigravity … no longer works with this T3 Code release. Update it in Antigravity setup.": "motor",
  "Checking Antigravity access and models.": "motor",
  "Checking Codex.": "motor",
  "Checking credentials.": "motor",
  "Checking the downloaded runtime.": "motor",
  "Checking the installed runtime.": "motor",
  "Claude could not authenticate. For subscription login, run `claude auth login` on this environment's machine…, then start a new thread. For API-key authentication, check this instance's configured credentials.":
    { fora: "texto do ClaudeHome que o driver do Claude não usa (o login do Claude é o passo guiado)" },
  "Claude launcher shim resolved but no known package entry was found next to it; the Claude Agent SDK cannot spawn launcher scripts directly.":
    "motor",
  "Codex is not installed in T3 Code. Install it to continue.": "motor",
  "Connected to Antigravity.": "motor",
  "Could not activate Antigravity. The previous runtime is unchanged. Check for locked files and try again.": "motor",
  "Could not check free disk space.": "motor",
  "Could not close the archive.": "motor",
  "Could not deliver the sign-in response. Start sign-in again.": "motor",
  "Could not download Antigravity from Google. Check the network connection and any proxy settings, then try again.":
    "motor",
  "Could not extract the Antigravity executable.": "motor",
  "Could not extract the Antigravity runtime.": "motor",
  "Could not find a native Antigravity CLI release. Check the network connection and try again.": "motor",
  "Could not finish the Antigravity installation. Check disk space and directory access.": "motor",
  "Could not finish the Codex installation. Check disk space and directory access.": "motor",
  "Could not install Antigravity. Check free disk space and directory access, then try again.": "motor",
  "Could not install Codex. Check disk space and directory access, then try again.": "motor",
  "Could not link Antigravity user skills at ….": "motor",
  "Could not open the verified archive.": "motor",
  "Could not prepare the Antigravity runtime for this Mac. Check that codesign is available.": "motor",
  "Could not publish the Antigravity runtime. The previous release is unchanged. Try again.": "motor",
  "Could not read an archive member.": "motor",
  "Could not read the Antigravity installation. Reinstall it or set a custom executable path.": "motor",
  "Could not remove the managed Antigravity runtime. Check for open processes and try again.": "motor",
  "Could not remove the managed Codex runtime. Check for open processes and try again.": "motor",
  "Could not resolve ….": "motor",
  "Could not start Google sign-in. Try again.": "motor",
  "Could not start the Antigravity installation.": "motor",
  "Could not start the Codex installation.": "motor",
  "Could not unpack or start the downloaded Codex package.": "motor",
  "Could not verify the installed Antigravity runtime.": "motor",
  "Downloading Codex.": "motor",
  "Downloading Google's official Antigravity runtime.": "motor",
  "Enter a Gemini API key in the Antigravity provider settings.": "motor",
  "Extracting Codex.": "motor",
  "Extracting the verified runtime.": "motor",
  "Failed to hydrate HOME from the user account.": LOG_PATH,
  "Failed to hydrate PATH from the user environment.": LOG_PATH,
  "Failed to read PATH from login shell ….": LOG_PATH,
  "Failed to read PATH from slow login shell ….": LOG_PATH,
  "Gemini Enterprise needs a GCP project and location in the Antigravity provider settings.": "motor",
  "Google does not publish an Antigravity runtime for …-…. Use a supported environment or a custom executable.":
    "motor",
  "Google does not publish an Antigravity runtime for …-…. Use a supported remote environment or a custom executable.":
    "motor",
  "Google requires an eligible Antigravity subscription for this account.": "motor",
  "Google sign-in expired. Start sign-in again.": "motor",
  "Google sign-in failed. Start sign-in again.": "motor",
  "Google sign-in was cancelled by sign-out.": "motor",
  "Google sign-in was cancelled.": "motor",
  "Google sign-in was not approved. Start sign-in again.": "motor",
  "Google's linux-arm64 Antigravity runtime needs a kernel with 4 KiB memory pages, and this kernel uses larger pages (as on Asahi Linux or Raspberry Pi 5). Use a remote environment or a custom Antigravity executable.":
    "motor",
  "Installation cancelled. The previous runtime is unchanged.": "motor",
  "Login shell … exited with code … while reading PATH.": LOG_PATH,
  "Login shell … printed no PATH; PATH is unchanged.": LOG_PATH,
  "OpenAI does not publish a Codex runtime for …-…. Use a supported remote environment or a custom executable.":
    "motor",
  "Open the Google sign-in link. If you are remote, paste the redirect URL here.": "motor",
  "Paste the complete redirect URL from the Google sign-in page.": "motor",
  "Sign in to Antigravity in Settings before you continue.": "motor",
  "Sign-in is in progress in another client.": "motor",
  "Signed in with Google.": "motor",
  "Signed out of Google.": "motor",
  "Starting Google sign-in.": "motor",
  "Stop Antigravity sessions and sign-in flows before removing its managed runtime.": "motor",
  "Stop Codex sessions and sign-in flows before removing its managed runtime.": "motor",
  "T3 Code MCP bridge request failed: …": PONTE_MCP,
  "T3 Code MCP endpoint responded with HTTP ….": PONTE_MCP,
  "T3 Code MCP … failed…": PONTE_MCP,
  "The Antigravity archive must contain one regular executable.": "motor",
  "The Antigravity download exceeded its allowed size.": "motor",
  "The Antigravity download failed its size or checksum check. Nothing was installed.": "motor",
  "The Antigravity download size did not match the pinned release.": "motor",
  "The Antigravity executable exceeded its size limit.": "motor",
  "The Antigravity profile directory could not be created.": "motor",
  "The Antigravity profile directory permissions could not be set.": "motor",
  "The Antigravity profile settings could not be written.": "motor",
  "The Codex archive contains unsafe entries.": "motor",
  "The Codex download exceeded the expected release size.": "motor",
  "The Codex download failed its size or SHA-256 check. Nothing was installed.": "motor",
  "The Codex download server returned HTTP …. Try again later.": "motor",
  "The Codex download timed out. Retry installation.": "motor",
  "The Codex download was interrupted. Check your internet connection, then retry installation.": "motor",
  "The T3 runtime path cannot be used to suppress Antigravity browser launches.": "motor",
  "The archive contains an unexpected, unsafe, or incorrectly sized member.": "motor",
  "The archive could not be read.": "motor",
  "The archive is missing the Antigravity executable or its harness.": "motor",
  "The archive must contain exactly the Antigravity executable and its harness.": "motor",
  "The custom Antigravity executable is missing or not executable, or it needs a localharness_external sibling. The agy CLI does not.":
    "motor",
  "The downloaded Antigravity runtime could not start in this environment.": "motor",
  "The downloaded Codex executable has the wrong version.": "motor",
  "The downloaded Codex package does not match the expected release.": "motor",
  "The downloaded Codex runtime could not start.": "motor",
  "The downloaded runtime did not identify as the expected Google Antigravity release.": "motor",
  "The existing managed Codex release differs from the official package. Remove it and reinstall.": "motor",
  "The existing managed release has the wrong version. Remove it before reinstalling.": "motor",
  "The installed Codex runtime could not start. Remove it and reinstall.": "motor",
  "The managed Antigravity runtime is incomplete. Reinstall it.": "motor",
  "The managed Antigravity runtime is incomplete. Remove it and reinstall.": "motor",
  "The managed Codex installation record has the wrong version.": "motor",
  "The managed Codex installation record is invalid. Reinstall Codex.": "motor",
  "The managed Codex package is incomplete. Reinstall Codex.": "motor",
  "The managed Codex runtime is incomplete. Remove it and reinstall.": "motor",
  "The managed runtime record is invalid. Reinstall Antigravity.": "motor",
  "The redirect URL is not a Google sign-in response.": "motor",
  "The redirect URL must contain one Google sign-in response.": "motor",
  "The sign-in response URL is too long.": "motor",
  "The sign-in response timed out. Start sign-in again.": "motor",
  "The sign-in response was already sent. Wait for Google to finish.": "motor",
  "This Antigravity release was withdrawn. Check for updates and try again.": "motor",
  "This Antigravity version does not support sign-out. Update the provider.": "motor",
  "This Codex release was withdrawn. Check for updates and try again.": "motor",
  "This installation is no longer current. Refresh its status before cancelling.": "motor",
  "This provider version has limited compatibility with this T3 Code release.": "motor",
  "This provider version is known to be incompatible with this T3 Code release.": "motor",
  "This provider version is outside the supported range for this T3 Code release.": "motor",
  "This redirect URL does not belong to the current sign-in.": "motor",
  "This sign-in is no longer active in this client.": "motor",
  "Timed out reading PATH from login shell … after …; PATH is unchanged.": LOG_PATH,
  "Unsupported environment variable name: …": {
    fora: "erro de programação do shell.ts (nome de variável fixo no código)",
  },
  "Update the managed Codex installation to continue.": "motor",
  "Wait for the Google sign-in link before you send a redirect URL.": "motor",
  "Waiting for Google to finish sign-in.": "motor",

  // packages/effect-acp e packages/effect-codex-app-server: os protocolos
  "ACP extension request handler failed for '…'": "generica",
  "ACP extension request handler failed for method '…'": "generica",
  "ACP input stream ended.": "queda",
  "ACP process exited after signal …": "queda",
  "ACP process exited with code …": "queda",
  "ACP protocol operation '…' failed…….": "generica",
  "ACP protocol terminated.": "queda",
  "ACP request handler failed for '…'": "generica",
  "ACP request handler failed for method '…'": "generica",
  "ACP session '…' already has an active prompt.": "generica",
  "ACP transport operation… failed…….": "queda",
  "Codex App Server input stream ended.": "queda",
  "Codex App Server process exited with code …": "queda",
  "Codex App Server protocol operation '…' failed….": "generica",
  "Codex App Server request handler failed for method '…'": "generica",
  "Codex App Server transport operation '…' failed.": "queda",
  "Codex app-server replay exited with status … at cursor … in scenario ….": REPLAY,
  "Codex app-server replay transcript exhausted before outbound frame … in scenario ….": REPLAY,
  "Failed to parse outbound Codex app-server replay frame for scenario ….": REPLAY,
  "Failed to send ACP protocol message.": "queda",
  "Failed to spawn ACP process for command: …": "cliAusente",
  "Failed to spawn Codex App Server process for command: …": "cliAusente",
  "Incoming message exceeded … bytes.": "generica",
  "Invalid payload for ACP extension method '…'.": "generica",
  "Invalid payload for method '…' during '…'": "generica",
  "Method '…' does not accept a payload during '…'": "generica",
  "Method not found: …": "generica",
  "Outbound Codex app-server frame did not match replay cursor … in scenario …. Expected …, received ….": REPLAY,
  "Server overloaded; retry later.": "indisponivel",
  "Too many Codex requests are already active.": "generica",
  "Unexpected outbound Codex app-server frame at replay cursor … in scenario ….": REPLAY,
};

/** A frase com cada "…" trocado por um valor de exemplo, para conferir os padrões. */
export function comExemplo(frase: string): string {
  return frase.replace(/…/g, "linux-arm64");
}
