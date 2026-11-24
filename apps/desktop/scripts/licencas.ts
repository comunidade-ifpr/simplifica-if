// @effect-diagnostics nodeBuiltinImport:off -- script de build, sem runtime Effect (como o `construir.ts`)
/**
 * O `LICENCAS.md` do instalador: a licença do Simplifica IF e a de cada pacote de terceiros que vai
 * dentro do app. A licença MIT (e as BSD, ISC, Apache) pede que o aviso acompanhe as cópias, e os
 * bundles levam o código dos pacotes sem o `node_modules` ao lado.
 *
 * Quem entra é o que o bundler de fato pôs nos bundles (`moduleIds` de cada chunk, como o plugin
 * `vite:license` do Vite), não a lista de dependências do `package.json`:
 *
 * - main, preload, servidor e Workers: o plugin de `coletorLicencas` nos `empacotar` do `construir.ts`;
 * - a interface: o `build.license` do `apps/web/vite.config.ts`, em JSON (`LICENCAS_WEB`);
 * - o `undici`, copiado inteiro em `servidor/node_modules`: `pacoteDaPasta`.
 *
 * O Electron e o Chromium ficam de fora: o electron-builder já põe o `LICENSE.electron.txt` e o
 * `LICENSES.chromium.html` no pacote.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

/** Um pacote de terceiros dentro do app; os mesmos campos do JSON do `build.license` do Vite. */
export interface PacoteTerceiro {
  readonly name: string;
  readonly version: string;
  /** O identificador SPDX do `package.json` (`MIT`, `Apache-2.0`…), quando há. */
  readonly identifier?: string;
  /** O texto do arquivo de licença do pacote, quando há. */
  readonly text?: string;
}

/** O JSON da interface, relativo ao `dist` do `apps/web` (o `build.license.fileName` de lá). */
export const LICENCAS_WEB = ".vite/licencas.json";

const ARQUIVO_LICENCA = /^(?:licen[cs]e|copying)(?:[.-].*)?$/i;

/** A pasta do pacote dono de `arquivo`: o `package.json` com `name` mais próximo, dentro do `node_modules`. */
export function pastaDoPacote(arquivo: string): string | undefined {
  let pasta = NodePath.dirname(arquivo);
  while (NodePath.basename(pasta) !== "node_modules" && pasta !== NodePath.dirname(pasta)) {
    const manifesto = NodePath.join(pasta, "package.json");
    if (NodeFS.existsSync(manifesto)) {
      // `package.json` sem `name` só marca o tipo de módulo de uma subpasta (`{"type": "module"}`).
      const { name } = JSON.parse(NodeFS.readFileSync(manifesto, "utf-8")) as { name?: string };
      if (name) return pasta;
    }
    pasta = NodePath.dirname(pasta);
  }
  return undefined;
}

/** Nome, versão, licença e texto da licença do pacote em `pasta`. */
export function pacoteDaPasta(pasta: string): PacoteTerceiro {
  const { name, version, license } = JSON.parse(NodeFS.readFileSync(NodePath.join(pasta, "package.json"), "utf-8")) as {
    name: string;
    version?: string;
    license?: string;
  };
  const arquivo = NodeFS.readdirSync(pasta).find((nome) => ARQUIVO_LICENCA.test(nome));
  return {
    name,
    version: version ?? "0.0.0",
    ...(license ? { identifier: license.trim() } : {}),
    ...(arquivo ? { text: NodeFS.readFileSync(NodePath.join(pasta, arquivo), "utf-8").trim() } : {}),
  };
}

const ehDeTerceiro = (id: string) => !id.startsWith("\0") && id.split(/[\\/]/).includes("node_modules");

/**
 * Um plugin do Rolldown que anota, a cada bundle, a pasta dos pacotes de `node_modules` que entraram
 * nele. Os pacotes do workspace (`@simplifica-if/*`) não passam por `node_modules` depois do
 * `realpath` e ficam de fora: são deste repositório, sob o `LICENSE` da raiz.
 */
export function coletorLicencas() {
  const pastas = new Set<string>();
  const plugin = {
    name: "simplifica:licencas",
    generateBundle(_saida: unknown, bundle: Record<string, { readonly moduleIds?: ReadonlyArray<string> }>) {
      for (const parte of Object.values(bundle)) {
        for (const id of parte.moduleIds ?? []) {
          if (!ehDeTerceiro(id)) continue;
          const pasta = pastaDoPacote(id);
          if (pasta) pastas.add(pasta);
        }
      }
    },
  };
  return { plugin, pacotes: (): Array<PacoteTerceiro> => [...pastas].map(pacoteDaPasta) };
}

/** Um pacote por `nome@versão`, em ordem de nome. */
export function juntarPacotes(...listas: ReadonlyArray<ReadonlyArray<PacoteTerceiro>>): Array<PacoteTerceiro> {
  const porChave = new Map<string, PacoteTerceiro>();
  for (const pacote of listas.flat()) {
    const chave = `${pacote.name}@${pacote.version}`;
    const anterior = porChave.get(chave);
    if (!anterior || (!anterior.text && pacote.text)) porChave.set(chave, pacote);
  }
  return [...porChave.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** O `LICENCAS.md`: a licença do app e, depois, a de cada pacote de terceiros. */
export function markdownLicencas(licencaApp: string, pacotes: ReadonlyArray<PacoteTerceiro>): string {
  const partes = [
    "# Licenças",
    "",
    "## Simplifica IF",
    "",
    licencaApp.trim(),
    "",
    "## Componentes de terceiros",
    "",
    "O Simplifica IF inclui os pacotes abaixo, cada um sob a própria licença. As licenças do Electron e do " +
      "Chromium estão nos arquivos `LICENSE.electron.txt` e `LICENSES.chromium.html`, ao lado deste.",
  ];
  for (const pacote of pacotes) {
    partes.push("", `### ${pacote.name} ${pacote.version}${pacote.identifier ? ` (${pacote.identifier})` : ""}`);
    partes.push("", pacote.text ?? "Sem arquivo de licença no pacote; vale o identificador acima.");
  }
  return `${partes.join("\n")}\n`;
}
