/**
 * O manifesto do canal (`beta.json`, `estavel.json`), no formato do plano ("Atualização: três
 * ritmos"), e as regras de versão.
 *
 * Os arquivos do manifesto (`arquivo`) se resolvem contra a URL do próprio manifesto, ou contra
 * `url` quando ele vem (relativa ou absoluta). Na hospedagem do GitHub Releases, o manifesto fica
 * num release fixo por canal (`canal-beta/beta.json`) e os pacotes no release da versão, então a
 * fábrica escreve `url: "../base-2026.11.13/base-2026.11.13.sqlite.zst"`. Num servidor de teste,
 * tudo pode ficar na mesma pasta, sem `url`.
 */
import * as Schema from "effect/Schema";

export const CANAIS = ["beta", "estavel"] as const;
export const Canal = Schema.Literals(CANAIS);
export type Canal = typeof Canal.Type;

/** Versão da base e das datas mínimas: `AAAA.MM.DD`, com um sufixo `.N` opcional para mais de uma no dia. */
const VersaoBase = Schema.String.check(
  Schema.isPattern(/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/, { message: "esperava AAAA.MM.DD" }),
);
/** Versão do app e das skills: semver simples (`0.1.0`). */
const Semver = Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/, { message: "esperava X.Y.Z" }));
const Sha256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/, { message: "esperava sha256 em hexadecimal" }));
/** Só o nome do arquivo, sem pasta (o caminho vem de `url`). */
const NomeArquivo = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, { message: "esperava um nome de arquivo sem pasta" }),
);
const Bytes = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

export const Patch = Schema.Struct({
  de: VersaoBase,
  arquivo: NomeArquivo,
  url: Schema.optionalKey(Schema.String),
  sha256: Sha256,
  bytes: Schema.optionalKey(Bytes),
});
export type Patch = typeof Patch.Type;

export const PacoteBase = Schema.Struct({
  arquivo: NomeArquivo,
  url: Schema.optionalKey(Schema.String),
  /** sha256 do pacote comprimido (o que se baixa). */
  sha256: Sha256,
  bytes: Bytes,
  /** sha256 do `kb.sqlite` descomprimido: confere o patch aplicado e o pacote inteiro. */
  sha256_banco: Sha256,
  /** A `data_referencia` gravada na base. */
  data_referencia: Schema.optionalKey(Schema.String),
  patches: Schema.Array(Patch),
});
export type PacoteBase = typeof PacoteBase.Type;

export const PacoteSkill = Schema.Struct({
  nome: Schema.String,
  versao: Semver,
  arquivo: NomeArquivo,
  url: Schema.optionalKey(Schema.String),
  sha256: Sha256,
  bytes: Schema.optionalKey(Bytes),
  app_minimo: Semver,
  base_minima: VersaoBase,
});
export type PacoteSkill = typeof PacoteSkill.Type;

export const Manifesto = Schema.Struct({
  canal: Canal,
  /** A versão da base (e do conjunto). */
  versao: VersaoBase,
  commit: Schema.String,
  /** Quando a fábrica gerou o manifesto (ISO 8601). */
  gerado_em: Schema.optionalKey(Schema.String),
  base: PacoteBase,
  skills: Schema.Array(PacoteSkill),
  app_minimo: Semver,
  /** As novidades desta versão (de `base-conhecimento/novidades.yaml`), para o aviso "Base atualizada". */
  novidades: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        tipo: Schema.String,
        titulo: Schema.String,
        detalhe: Schema.optionalKey(Schema.String),
        afeta: Schema.optionalKey(Schema.Array(Schema.String)),
      }),
    ),
  ),
});
export type Manifesto = typeof Manifesto.Type;
export type Novidade = NonNullable<Manifesto["novidades"]>[number];

export const decodificarManifesto = Schema.decodeUnknownSync(Schema.fromJsonString(Manifesto));
export const codificarManifesto = (manifesto: Manifesto): string => `${JSON.stringify(manifesto, null, 2)}\n`;

/** Nome do manifesto do canal: `beta.json`, `estavel.json`. */
export const arquivoManifesto = (canal: Canal) => `${canal}.json`;
export const SUFIXO_ASSINATURA = ".minisig";

/** A URL de um arquivo do manifesto. */
export const urlDoArquivo = (item: { readonly arquivo: string; readonly url?: string }, urlManifesto: string): string =>
  new URL(item.url ?? item.arquivo, urlManifesto).href;

/* ------------------------------------------------------------------ versões */

const partes = (versao: string) => versao.split(".").map((parte) => Number.parseInt(parte, 10));

/** Compara versões numéricas separadas por ponto (`2026.11.13`, `2026.11.13.2`, `0.1.0`). */
export function compararVersoes(a: string, b: string): number {
  const pa = partes(a);
  const pb = partes(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diferenca = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diferenca !== 0) return Math.sign(diferenca);
  }
  return 0;
}

/** Versão da base a partir da data de referência de um build (`2026-11-13` → `2026.11.13`). */
export const versaoDeData = (data: string) => data.replaceAll("-", ".");
