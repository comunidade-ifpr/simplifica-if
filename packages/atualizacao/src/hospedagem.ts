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
