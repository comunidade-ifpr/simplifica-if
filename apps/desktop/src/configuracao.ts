// @effect-diagnostics nodeBuiltinImport:off -- processo principal do Electron, sem runtime Effect (ver README)
/**
 * De onde vêm o servidor, a base, a interface e a pasta de estado, no desenvolvimento e no app
 * empacotado. Função pura sobre o que o processo principal sabe (sem importar o Electron), para os
 * testes conferirem cada caso.
 *
 * | | Desenvolvimento (`app.isPackaged` falso) | App empacotado |
 * |---|---|---|
 * | servidor | Node 26 (`SIMPLIFICA_NODE`, ou `node` do PATH) com `apps/server/src/bin.ts` | o executável do app, com `ELECTRON_RUN_AS_NODE=1`, sobre `<Resources>/servidor/bin.mjs` |
 * | base (`--banco`) | `SIMPLIFICA_KB` ou `tmp/kb.sqlite` do repositório | `SIMPLIFICA_KB`; senão `<pasta do app>/base/kb.sqlite`, se existir (onde a atualização da base, M1.10, vai gravar); senão `<Resources>/base/kb.sqlite`, a base empacotada |
 * | interface | `SIMPLIFICA_WEB_URL` (o dev server do `apps/web`); sem ela, o build em `dist/app/web` | o build do `apps/web` dentro do app, pelo protocolo `simplifica://app` |
 * | estado (`--pasta-estado`) | a pasta do app (`userData`, "Simplifica IF (dev)") | a pasta do app (`userData`, "Simplifica IF") |
 * | skills (`--pasta-skills`) | `.agents/skills` do repositório (o servidor aceita só as com bloco `simplifica:`) | `<Resources>/skills`, gerada no build só com as skills do app e os arquivos listados |
 *
 * Sem a pasta de skills (não existe), o servidor sobe sem skills: as conversas funcionam, só sem elas.
 */
import * as NodePath from "node:path";
import type { Executor } from "./servidor.ts";

/** O protocolo próprio da interface empacotada, como o `t3code://app` do T3. */
export const ESQUEMA = "simplifica";
export const HOST_APP = "app";
export const ORIGEM_APP = `${ESQUEMA}://${HOST_APP}`;
export const URL_APP = `${ORIGEM_APP}/`;

/** Variáveis que o app lê. */
export const VARIAVEIS = {
  /** URL do dev server do `apps/web`. */
  web: "SIMPLIFICA_WEB_URL",
  /** O Node que roda o servidor em desenvolvimento. */
  node: "SIMPLIFICA_NODE",
  /** O `kb.sqlite`, no lugar do padrão. */
  banco: "SIMPLIFICA_KB",
  /** A raiz das pastas de tarefa, no lugar de `Documentos/Simplifica IF`. */
  trabalhos: "SIMPLIFICA_TRABALHOS",
} as const;

/** O nome da pasta das tarefas dentro de Documentos. */
export const PASTA_TAREFAS = "Simplifica IF";

export interface Entrada {
  readonly empacotado: boolean;
  /** Raiz do repositório (só no desenvolvimento). */
  readonly raizRepositorio: string;
  /** `process.resourcesPath` (só no app empacotado). */
  readonly pastaRecursos: string;
  /** `app.getAppPath()`: a pasta (ou o `app.asar`) com o `main.cjs`. */
  readonly pastaAplicacao: string;
  /** `app.getPath("userData")`. */
  readonly pastaApp: string;
  /** `app.getPath("documents")`: a pasta Documentos da pessoa. */
  readonly pastaDocumentos: string;
  /** `process.execPath`: o executável do Electron. */
  readonly executavel: string;
  readonly ambiente: Readonly<Record<string, string | undefined>>;
  readonly existe: (caminho: string) => boolean;
}

export type Interface =
  | { readonly tipo: "url"; readonly url: string }
  | { readonly tipo: "pasta"; readonly pasta: string };

export interface Configuracao {
  readonly executor: Executor;
  readonly banco: string;
  readonly pastaEstado: string;
  /** `--pasta-skills`; `undefined` se a pasta não existe. */
  readonly pastaSkills: string | undefined;
  /** `--pasta-trabalhos`: `Documentos/Simplifica IF`, onde cada tarefa ganha a sua pasta (M1.9). */
  readonly pastaTrabalhos: string;
  readonly interface: Interface;
  /** A URL que a janela abre. */
  readonly urlJanela: string;
  /** As origens que o servidor aceita: só a da janela. */
  readonly origens: ReadonlyArray<string>;
  readonly cwd: string;
}

const definida = (valor: string | undefined): string | undefined =>
  valor === undefined || valor.trim() === "" ? undefined : valor.trim();

/** Uma URL de dev server aceitável: http(s) em localhost ou 127.0.0.1. */
export function urlDevServer(texto: string): URL {
  const url = new URL(texto);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${VARIAVEIS.web} precisa ser http(s): ${texto}`);
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error(`${VARIAVEIS.web} precisa apontar para esta máquina (localhost): ${texto}`);
  }
  return url;
}

export function resolverConfiguracao(entrada: Entrada): Configuracao {
  const { ambiente } = entrada;
  const executor: Executor = entrada.empacotado
    ? {
        tipo: "electron",
        electron: entrada.executavel,
        bundle: NodePath.join(entrada.pastaRecursos, "servidor", "bin.mjs"),
      }
    : {
        tipo: "node",
        node: definida(ambiente[VARIAVEIS.node]) ?? "node",
        bin: NodePath.join(entrada.raizRepositorio, "apps", "server", "src", "bin.ts"),
      };

  const baseAtualizada = NodePath.join(entrada.pastaApp, "base", "kb.sqlite");
  const banco =
    definida(ambiente[VARIAVEIS.banco]) ??
    (entrada.empacotado
      ? entrada.existe(baseAtualizada)
        ? baseAtualizada
        : NodePath.join(entrada.pastaRecursos, "base", "kb.sqlite")
      : NodePath.join(entrada.raizRepositorio, "tmp", "kb.sqlite"));

  const pastaSkills = entrada.empacotado
    ? NodePath.join(entrada.pastaRecursos, "skills")
    : NodePath.join(entrada.raizRepositorio, ".agents", "skills");

  const urlWeb = entrada.empacotado ? undefined : definida(ambiente[VARIAVEIS.web]);
  const interfaceApp: Interface =
    urlWeb === undefined
      ? { tipo: "pasta", pasta: NodePath.join(entrada.pastaAplicacao, "web") }
      : { tipo: "url", url: urlDevServer(urlWeb).href };
  const urlJanela = interfaceApp.tipo === "url" ? interfaceApp.url : URL_APP;

  return {
    executor,
    banco,
    pastaEstado: entrada.pastaApp,
    pastaSkills: entrada.existe(pastaSkills) ? pastaSkills : undefined,
    pastaTrabalhos: NodePath.resolve(
      definida(ambiente[VARIAVEIS.trabalhos]) ?? NodePath.join(entrada.pastaDocumentos, PASTA_TAREFAS),
    ),
    interface: interfaceApp,
    urlJanela,
    origens: [new URL(urlJanela).protocol === `${ESQUEMA}:` ? ORIGEM_APP : new URL(urlJanela).origin],
    // Como o T3: no app empacotado, o servidor roda a partir do HOME; em desenvolvimento, da raiz.
    cwd: entrada.empacotado
      ? (definida(ambiente.HOME) ?? definida(ambiente.USERPROFILE) ?? entrada.pastaApp)
      : entrada.raizRepositorio,
  };
}
