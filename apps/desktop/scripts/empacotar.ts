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
 *
 * A base empacotada é o `kb.sqlite` de `SIMPLIFICA_KB` ou do `tmp/kb.sqlite` (`pnpm kb:compilar`).
 */
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { build, type Configuration, Platform } from "electron-builder";
import { ATUALIZACAO_FABRICA } from "@simplifica-if/motor/politica-atualizacao";
import { ARQUIVO_ASSINATURA, feedDoCanal } from "../src/atualizacaoApp.ts";
import { construir, DIST, DIST_RECURSOS, PACOTE, RAIZ } from "./construir.ts";

export const APP_ID = "br.edu.ifpr.simplifica";
export const NOME_PRODUTO = "Simplifica IF";

const versaoElectron = (): string => {
  const requerer = NodeModule.createRequire(NodePath.join(PACOTE, "package.json"));
  return (JSON.parse(NodeFS.readFileSync(requerer.resolve("electron/package.json"), "utf-8")) as { version: string })
    .version;
};

/**
 * O feed `generic` que vai no `app-update.yml` (o processo principal o troca pelo do canal com
 * `setFeedURL`). Com ele, o electron-builder também escreve o `latest-mac.yml` e o `latest.yml` ao lado
 * dos instaladores, que a fábrica publica no release do canal (`pnpm fabrica publicar-app`). Sem feed
 * na política, um endereço que não resolve: o app não procura (ver `motivoDesligado`).
 */
export const FEED_EMPACOTADO = feedDoCanal(
  ATUALIZACAO_FABRICA.feed ?? "https://feed-a-configurar.invalid/{canal}/",
  ATUALIZACAO_FABRICA.canal,
);

/** A configuração do electron-builder (sem assinatura; a publicação é da fábrica). */
export function configuracaoBuilder(opcoes: { readonly dir: boolean }): Configuration {
  return {
    appId: APP_ID,
    productName: NOME_PRODUTO,
    artifactName: "Simplifica-IF-${version}-${arch}.${ext}",
    electronVersion: versaoElectron(),
    // Como o T3 (`DESKTOP_ELECTRON_LANGUAGES`), só as línguas usadas.
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
      // Se este app tem assinatura de código: sem ela, o `electron-updater` fica desligado (M1.10).
      { from: `dist/recursos/${ARQUIVO_ASSINATURA}`, to: ARQUIVO_ASSINATURA },
    ],
    afterPack: async (contexto) => {
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
    // Só para gerar o `app-update.yml` e os `latest*.yml`; nada se publica daqui (`build` sem `publish`).
    publish: [{ provider: "generic", url: FEED_EMPACOTADO }],
    mac: {
      target: opcoes.dir ? ["dir"] : ["dmg", "zip"],
      icon: "icone.png",
      category: "public.app-category.education",
      // Sem assinatura nem notarização por enquanto (pendência).
      identity: null,
      hardenedRuntime: false,
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
      icon: "icone.png",
    },
    nsis: {
      // Por usuário, sem pedir administrador.
      oneClick: true,
      perMachine: false,
      shortcutName: NOME_PRODUTO,
      uninstallDisplayName: NOME_PRODUTO,
      artifactName: "Simplifica-IF-${version}-${arch}-instalador.${ext}",
    },
  };
}

/** O marcador de assinatura: `false` enquanto `mac.identity` for `null` e não houver certificado do Windows. */
function gravarAssinatura(): void {
  const assinado = configuracaoBuilder({ dir: false }).mac?.identity !== null && Boolean(process.env.CSC_LINK);
  NodeFS.mkdirSync(DIST_RECURSOS, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(DIST_RECURSOS, ARQUIVO_ASSINATURA), `${JSON.stringify({ assinado })}\n`);
}

function copiarBase(): void {
  const origem = process.env.SIMPLIFICA_KB?.trim() || NodePath.join(RAIZ, "tmp", "kb.sqlite");
  if (!NodeFS.existsSync(origem)) {
    throw new Error(`sem a base em ${origem}: rode \`pnpm kb:compilar\` ou passe SIMPLIFICA_KB`);
  }
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
    },
  });
  await construir({ soProcessoPrincipal: false, web: values["sem-web"] !== true });
  copiarBase();
  gravarAssinatura();
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
