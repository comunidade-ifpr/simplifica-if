// @effect-diagnostics nodeBuiltinImport:off -- script de empacotamento, sem runtime Effect
/**
 * O instalador local do app, com o electron-builder (a configuração segue o `createBuildConfig` do
 * `scripts/build-desktop-artifact.ts` do T3, reduzida): constrói os bundles (`construir.ts`), copia a
 * base e empacota, sem assinatura.
 *
 *   node scripts/empacotar.ts                 # a plataforma desta máquina (macOS: dmg e zip; Windows: NSIS)
 *   node scripts/empacotar.ts --dir           # só o app desempacotado (dist/pacotes/mac-arm64/Simplifica IF.app)
 *   node scripts/empacotar.ts --win           # Windows (NSIS por usuário), a partir de outra máquina
 *   node scripts/empacotar.ts --sem-web       # não constrói o apps/web (usa o build que houver)
 *   node scripts/empacotar.ts --base-dev      # build local: aceita a base de desenvolvimento (dev-<hash>)
 *
 * A base empacotada é o `kb.sqlite` de `SIMPLIFICA_KB` ou do `tmp/kb.sqlite` (`pnpm kb:compilar`). Ela
 * precisa ter versão publicada (`AAAA.MM.DD`, a da fábrica): a de desenvolvimento perde para qualquer
 * baixada e não faz patch, e só entra com `--base-dev`, num instalador que não se distribui.
 */
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { lerInfoBanco } from "@simplifica-if/atualizacao/local";
import { ehVersaoDev } from "@simplifica-if/atualizacao/manifesto";
import { build, type Configuration, Platform } from "electron-builder";
import { ID_DO_APP } from "../src/avisos.ts";
import { construir, DIST, DIST_RECURSOS, PACOTE, RAIZ } from "./construir.ts";

export const NOME_PRODUTO = "Simplifica IF";

const versaoElectron = (): string => {
  const requerer = NodeModule.createRequire(NodePath.join(PACOTE, "package.json"));
  return (JSON.parse(NodeFS.readFileSync(requerer.resolve("electron/package.json"), "utf-8")) as { version: string })
    .version;
};

/** A configuração do electron-builder (sem assinatura; a publicação é da fábrica). */
export function configuracaoBuilder(opcoes: { readonly dir: boolean }): Configuration {
  return {
    appId: ID_DO_APP,
    productName: NOME_PRODUTO,
    artifactName: "Simplifica-IF-${version}-${arch}.${ext}",
    electronVersion: versaoElectron(),
    // Como o T3 (`DESKTOP_ELECTRON_LANGUAGES`), só as línguas usadas: o pt-BR e o en-US, que o Chromium
    // exige como reserva. O app só fala português (M1.14): `main.ts` põe o Chromium em pt-BR, e o
    // `afterPack` deixa o pacote do macOS declarar só o pt-BR.
    electronLanguages: ["pt-BR", "en-US"],
    directories: { app: "dist/app", output: "dist/pacotes", buildResources: "recursos" },
    files: ["**/*", "!**/*.map"],
    asar: true,
    // O servidor roda fora do asar (o Electron como Node, com módulos ES e o `node_modules/undici`
    // ao lado), e a base precisa ser um arquivo de verdade para o SQLite.
    extraResources: [
      // O `node_modules` (o `undici`) o electron-builder não copia aqui: vai no `afterPack`.
      { from: "dist/recursos/servidor", to: "servidor", filter: ["**/*", "!**/*.map"] },
      { from: "dist/recursos/base", to: "base", filter: ["kb.sqlite"] },
      // Só o que o build copiou (`skills.ts`): as skills do app e os arquivos listados no manifesto.
      { from: "dist/recursos/skills", to: "skills" },
      // Os manifestos de tarefa que o build copiou (`tarefas.ts`): o catálogo do Início.
      { from: "dist/recursos/tarefas", to: "tarefas" },
      // A licença do app e a dos pacotes de terceiros dentro dos bundles (`licencas.ts`).
      { from: "dist/recursos/LICENCAS.md", to: "LICENCAS.md" },
    ],
    afterPack: async (contexto) => {
      if (contexto.electronPlatformName === "darwin") {
        deixarSoPortugues(
          NodePath.join(
            contexto.appOutDir,
            `${contexto.packager.appInfo.productFilename}.app`,
            "Contents",
            "Resources",
          ),
        );
      }
      const recursos =
        contexto.electronPlatformName === "darwin"
          ? NodePath.join(
              contexto.appOutDir,
              `${contexto.packager.appInfo.productFilename}.app`,
              "Contents",
              "Resources",
            )
          : NodePath.join(contexto.appOutDir, "resources");
      NodeFS.cpSync(
        NodePath.join(DIST_RECURSOS, "servidor", "node_modules"),
        NodePath.join(recursos, "servidor", "node_modules"),
        { recursive: true },
      );
    },
    // Tudo vai nos bundles: nada a instalar nem a recompilar.
    npmRebuild: false,
    nodeGypRebuild: false,
    mac: {
      target: opcoes.dir ? ["dir"] : ["dmg", "zip"],
      icon: "icone.icns",
      category: "public.app-category.education",
      // Sem assinatura nem notarização por enquanto (pendência).
      identity: null,
      hardenedRuntime: false,
      // A língua do pacote (M1.14): com ela e só o `pt_BR.lproj`, o macOS mostra em português o que é
      // dele (Cancelar e Abrir nos diálogos, Ditado e Emoji no menu Editar, "Versão" no painel Sobre).
      extendInfo: { CFBundleDevelopmentRegion: "pt-BR" },
    },
    dmg: {
      title: "${productName} ${version}",
      contents: [
        { x: 166, y: 214, type: "file" },
        { x: 474, y: 214, type: "link", path: "/Applications" },
      ],
    },
    win: {
      // x64, a máquina comum dos servidores (o arm64 do Windows fica para depois).
      target: [{ target: opcoes.dir ? "dir" : "nsis", arch: ["x64"] }],
      icon: "icone.ico",
    },
    nsis: {
      // Por usuário, sem pedir administrador.
      oneClick: true,
      perMachine: false,
      shortcutName: NOME_PRODUTO,
      uninstallDisplayName: NOME_PRODUTO,
      artifactName: "Simplifica-IF-${version}-${arch}-instalador.${ext}",
      // O instalador e o desinstalador em português (M1.14), sem a escolha de língua.
      language: "1046",
      installerLanguages: ["pt_BR"],
      multiLanguageInstaller: false,
    },
  };
}

/**
 * Tira do pacote do macOS as pastas `*.lproj` vazias que só declaram línguas (as do Electron, em
 * `Contents/Resources`), menos a do pt-BR. Os `locale.pak` do Chromium ficam no framework, que o
 * `electronLanguages` já filtra; aqui é só a declaração que o macOS lê para escolher a língua dos
 * textos do sistema. Pasta com arquivo dentro fica.
 */
export function deixarSoPortugues(recursos: string): ReadonlyArray<string> {
  const retiradas: Array<string> = [];
  for (const nome of NodeFS.readdirSync(recursos)) {
    if (!nome.endsWith(".lproj") || nome === "pt_BR.lproj") continue;
    const pasta = NodePath.join(recursos, nome);
    if (NodeFS.readdirSync(pasta).length > 0) continue;
    NodeFS.rmdirSync(pasta);
    retiradas.push(nome);
  }
  if (!NodeFS.existsSync(NodePath.join(recursos, "pt_BR.lproj")))
    NodeFS.mkdirSync(NodePath.join(recursos, "pt_BR.lproj"));
  return retiradas;
}

/**
 * O problema da base que vai no instalador, ou `undefined`: sem versão legível, ou de desenvolvimento
 * (`dev-<hash>`) sem `baseDev` (o build local, que não se distribui).
 */
export function problemaBaseEmpacotada(origem: string, baseDev: boolean): string | undefined {
  const versao = lerInfoBanco(origem)?.versao;
  if (versao === undefined) return `a base ${origem} não tem versão legível no meta`;
  if (ehVersaoDev(versao) && !baseDev) {
    return (
      `a base ${origem} é de desenvolvimento (${versao}): o instalador distribuído leva uma base da fábrica ` +
      "(SIMPLIFICA_KB=tmp/fabrica/bases/<versao>.sqlite); para um build local, --base-dev"
    );
  }
  return undefined;
}

/** A base que vai no instalador, conferida (`problemaBaseEmpacotada`). */
function baseConferida(baseDev: boolean): string {
  const origem = process.env.SIMPLIFICA_KB?.trim() || NodePath.join(RAIZ, "tmp", "kb.sqlite");
  if (!NodeFS.existsSync(origem)) {
    throw new Error(`sem a base em ${origem}: rode \`pnpm kb:compilar\` ou passe SIMPLIFICA_KB`);
  }
  const problema = problemaBaseEmpacotada(origem, baseDev);
  if (problema !== undefined) throw new Error(problema);
  return origem;
}

function copiarBase(origem: string): void {
  const destino = NodePath.join(DIST_RECURSOS, "base", "kb.sqlite");
  NodeFS.mkdirSync(NodePath.dirname(destino), { recursive: true });
  NodeFS.copyFileSync(origem, destino);
}

if (import.meta.main) {
  const { values } = NodeUtil.parseArgs({
    options: {
      dir: { type: "boolean" },
      mac: { type: "boolean" },
      win: { type: "boolean" },
      "sem-web": { type: "boolean" },
      "base-dev": { type: "boolean" },
    },
  });
  // Antes do build demorado: a base recusada para logo.
  const base = baseConferida(values["base-dev"] === true);
  await construir({ soProcessoPrincipal: false, web: values["sem-web"] !== true });
  copiarBase(base);
  const plataformas = [...(values.mac ? [Platform.MAC] : []), ...(values.win ? [Platform.WINDOWS] : [])];
  const alvos = (plataformas.length > 0 ? plataformas : [Platform.current()]).map((plataforma) =>
    plataforma.createTarget(),
  );
  const artefatos = [];
  for (const alvo of alvos) {
    artefatos.push(
      ...(await build({
        projectDir: PACOTE,
        targets: alvo,
        config: configuracaoBuilder({ dir: values.dir === true }),
      })),
    );
  }
  process.stderr.write(
    `pacotes em ${NodePath.relative(RAIZ, NodePath.join(DIST, "pacotes"))}\n${artefatos.map((a) => `  ${a}`).join("\n")}\n`,
  );
}
