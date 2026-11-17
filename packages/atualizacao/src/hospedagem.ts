/**
 * Hospedagem (decidida em 16/11/2026): **GitHub Releases do próprio repositório**, quando ele ficar
 * público. O app só usa links diretos de download, nunca a API do GitHub: a API sem login tem limite
 * de 60 consultas por hora por IP, e num campus muitos computadores saem pelo mesmo IP. Os links
 * `releases/download/...` redirecionam para o CDN e não contam nesse limite.
 *
 * Layout dos releases:
 *
 * | Release (tag) | Conteúdo | Muda |
 * |---|---|---|
 * | `canal-beta`, `canal-estavel` | `beta.json` + `.minisig`, `latest-mac.yml`, `latest.yml` | a cada publicação (`--clobber`) |
 * | `base-<versao>` | `base-<versao>.sqlite.zst`, os patches, `skill-<nome>-<versao>.zst` | nunca (imutável) |
 * | `app-v<versao>` | os instaladores (`.dmg`, `.zip`, `.exe`, `.blockmap`) | nunca (imutável) |
 *
 * **Por que um release fixo por canal, e não `latest/download/`:** `latest` é um só para o repositório
 * (o último release não marcado como pré-lançamento), e há dois canais e três ritmos. Com a tag fixa,
 * a URL do manifesto de cada canal é estável e não depende de qual release foi criado por último; o
 * manifesto aponta para os pacotes no release imutável da versão por URL relativa
 * (`../base-2026.11.13/<arquivo>`), e o mesmo vale para o `latest-mac.yml` do `electron-updater`
 * (provider `generic`, não o `github`, que consulta a API).
 */
import { parse, stringify } from "yaml";

export const TAG_CANAL = (canal: string) => `canal-${canal}`;
export const TAG_BASE = (versao: string) => `base-${versao}`;
export const TAG_APP = (versao: string) => `app-v${versao}`;

/** `dono/repo` do GitHub. */
export function validarRepositorio(repositorio: string): { dono: string; repo: string } {
  const partes = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(repositorio.trim());
  if (partes === null) throw new Error(`repositório do GitHub inválido (esperava dono/repo): ${repositorio}`);
  return { dono: partes[1]!, repo: partes[2]! };
}

/** A base dos links diretos de download de um repositório. */
export const downloadsGitHub = (repositorio: string) => {
  const { dono, repo } = validarRepositorio(repositorio);
  return `https://github.com/${dono}/${repo}/releases/download/`;
};

/** O feed da política para um repositório: `https://github.com/<dono>/<repo>/releases/download/canal-{canal}/`. */
export const feedGitHub = (repositorio: string) => `${downloadsGitHub(repositorio)}${TAG_CANAL("{canal}")}/`;

/** `url` de um pacote da base no manifesto (relativa ao manifesto, no release do canal). */
export const urlPacoteBase = (versao: string) => (arquivo: string) => `../${TAG_BASE(versao)}/${arquivo}`;

/** `url` de um instalador no `latest-mac.yml` (relativa ao release do canal). */
export const urlInstalador = (versao: string, arquivo: string) => `../${TAG_APP(versao)}/${arquivo}`;

/**
 * O `latest-mac.yml` / `latest.yml` do electron-builder com os arquivos apontando para o release
 * imutável da versão (`../app-v<versao>/<arquivo>`), para ir ao release fixo do canal. O
 * `electron-updater` resolve a URL relativa ao feed (`canal-beta/`), e o `sha512` continua o do
 * arquivo: um instalador trocado no caminho é recusado por ele.
 */
export function reescreverLatestYml(texto: string, versao: string): string {
  const lido = parse(texto) as { version?: unknown; path?: unknown; files?: Array<{ url?: unknown }> };
  if (lido.version !== versao) throw new Error(`o yml é da versão ${String(lido.version)}, e a publicação, ${versao}`);
  const relativo = (arquivo: unknown) => {
    if (typeof arquivo !== "string" || arquivo.includes("/"))
      throw new Error(`arquivo inesperado no yml: ${String(arquivo)}`);
    return urlInstalador(versao, arquivo);
  };
  return stringify({
    ...lido,
    files: (lido.files ?? []).map((arquivo) => ({ ...arquivo, url: relativo(arquivo.url) })),
    ...(lido.path === undefined ? {} : { path: relativo(lido.path) }),
  });
}
