/**
 * O atributo de atualização da política de fábrica (M1.10), num módulo sem dependências: o processo
 * principal do desktop (sem Effect) o importa para resolver a proxy do feed, e `politica.ts` o põe no
 * `POLITICA_FABRICA`, onde o Effect Schema o confere.
 *
 * - `feed`: a pasta do manifesto do canal, com `{canal}`. Hospedagem decidida em 16/11/2026: GitHub
 *   Releases do próprio repositório, por link direto, sem a API (`feedGitHub("dono/repo")` de
 *   `@simplifica-if/atualizacao/hospedagem` dá
 *   `https://github.com/<dono>/<repo>/releases/download/canal-{canal}/`). Fica `null` enquanto o
 *   repositório não é público: a atualização fica desligada, salvo `SIMPLIFICA_ATUALIZACAO_FEED`.
 * - `canal`: o padrão, `beta` no piloto; a pessoa troca em "Configurações › Atualizações".
 * - `chavePublica`: a linha base64 da chave pública minisign da fábrica (`pnpm fabrica gerar-chave`);
 *   `null` até a chave de produção existir.
 */
export const ATUALIZACAO_FABRICA = {
  feed: null as string | null,
  canal: "beta" as "beta" | "estavel",
  chavePublica: null as string | null,
};
