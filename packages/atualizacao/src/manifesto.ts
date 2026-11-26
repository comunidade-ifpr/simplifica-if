/**
 * O manifesto do canal (`beta.json`, `estavel.json`), no formato do plano ("Atualização: três
 * ritmos"), e as regras de versão. Além dos pacotes (a base e as skills, cada um com o `sha256`), o
 * manifesto traz dentro dele o que é pequeno e precisa chegar inteiro: as novidades, o catálogo de
 * tarefas e a lista de skills retiradas.
 *
 * Os arquivos do manifesto (`arquivo`) se resolvem contra a URL do próprio manifesto, ou contra
 * `url` quando ele vem (relativa ou absoluta). Na hospedagem do GitHub Releases, o manifesto fica
 * num release fixo por canal (`canal-beta/beta.json`) e os pacotes no release da versão, então a
 * fábrica escreve `url: "../base-2026.11.13/base-2026.11.13.sqlite.zst"`. Num servidor de teste,
 * tudo pode ficar na mesma pasta, sem `url`.
 */
import { CANAIS_DISTRIBUICAO } from "@simplifica-if/kb/canal";
import * as Schema from "effect/Schema";

export const Canal = Schema.Literals(CANAIS_DISTRIBUICAO);
export type Canal = typeof Canal.Type;

/** Versão da base e das datas mínimas: `AAAA.MM.DD`, com um sufixo `.N` opcional para mais de uma no dia. */
export const VersaoBase = Schema.String.check(
  Schema.isPattern(/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/, { message: "esperava AAAA.MM.DD" }),
);
/** Versão do app e das skills: semver simples (`0.1.0`). */
export const Semver = Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/, { message: "esperava X.Y.Z" }));
const Sha256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/, { message: "esperava sha256 em hexadecimal" }));
const RE_DATA_HORA = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/;

/**
 * O instante de uma data e hora ISO 8601 com fuso, em milissegundos; `NaN` se ela sai do formato ou não
 * existe no calendário. O `Date.parse` do V8 aceita `2026-02-30` (vira 2 de março) e `24:00`: aqui não.
 */
export function instanteDe(texto: string): number {
  const partes = RE_DATA_HORA.exec(texto);
  if (partes === null) return Number.NaN;
  const [ano, mes, dia, hora, minuto, segundo] = partes.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const fusoHora = partes[9] === undefined ? 0 : Number(partes[9]);
  const fusoMinuto = partes[10] === undefined ? 0 : Number(partes[10]);
  const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
  const diasNoMes = [31, bissexto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1] ?? 0;
  const valida =
    mes >= 1 &&
    mes <= 12 &&
    dia >= 1 &&
    dia <= diasNoMes &&
    hora <= 23 &&
    minuto <= 59 &&
    segundo <= 59 &&
    fusoHora <= 23 &&
    fusoMinuto <= 59;
  return valida ? Date.parse(texto) : Number.NaN;
}

/**
 * Data e hora ISO 8601 com fuso (`2026-11-26T10:00:00-03:00`, `…Z`), como o `git show --format=%cI` dá,
 * e que existe no calendário (`instanteDe`): `2026-13-45T…` não passa.
 */
export const DataHora = Schema.String.check(
  Schema.makeFilter((texto: string) => !Number.isNaN(instanteDe(texto)) || "esperava data e hora ISO 8601 com fuso"),
);
/** Quanto a data do commit pode passar do relógio de quem gera o catálogo (a fábrica e o build): 10 min. */
export const FOLGA_RELOGIO_MS = 10 * 60 * 1000;

/**
 * Por que a fábrica e o build do desktop recusam a data do commit de que geram o catálogo de tarefas, ou
 * `undefined`: ela tem de existir (`instanteDe`) e não passar de `agora` mais a folga. Uma data no futuro
 * (relógio adiantado, commit com data trocada) ganharia de todo catálogo seguinte e congelaria o do app.
 */
export function problemaDataCommit(dataCommit: string, agora: number): string | undefined {
  const instante = instanteDe(dataCommit);
  if (Number.isNaN(instante)) return `a data do commit (${dataCommit}) não é uma data e hora ISO 8601 válida`;
  if (instante > agora + FOLGA_RELOGIO_MS)
    return `a data do commit (${dataCommit}) está no futuro: confira o relógio deste computador ou a data do commit (git log -1 --format=%cI)`;
  return undefined;
}

/** Só o nome do arquivo, sem pasta (o caminho vem de `url`). */
const NomeArquivo = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, { message: "esperava um nome de arquivo sem pasta" }),
);
const Bytes = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
/**
 * O nome de uma skill (o da pasta dela). O app o usa como nome de pasta ao gravar a skill baixada: o
 * padrão não deixa passar `/`, `\` nem `..`.
 */
export const NomeSkill = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/, { message: "esperava o nome de uma skill" }),
);
/**
 * Uma tarefa do catálogo, como saiu do `catalogo/tarefas/<id>.yaml`: um objeto JSON. O manifesto do
 * canal não confere os campos: quem lê é o servidor (`@simplifica-if/mcp/tarefas`), no modo tolerante,
 * para o catálogo de um app mais novo ainda servir a um app mais velho.
 */
export const TarefaDoCanal = Schema.Record(Schema.String, Schema.Json);
export type TarefaDoCanal = typeof TarefaDoCanal.Type;

export const Patch = Schema.Struct({
  de: VersaoBase,
  arquivo: NomeArquivo,
  url: Schema.optionalKey(Schema.String),
  sha256: Sha256,
  bytes: Bytes,
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
  data_referencia: Schema.String,
  patches: Schema.Array(Patch),
});
export type PacoteBase = typeof PacoteBase.Type;

export const PacoteSkill = Schema.Struct({
  nome: NomeSkill,
  versao: Semver,
  arquivo: NomeArquivo,
  url: Schema.optionalKey(Schema.String),
  sha256: Sha256,
  bytes: Bytes,
  /**
   * O `hashSkill` do conteúdo (os caminhos e os bytes dos arquivos), que não muda com a compressão: a
   * fábrica o confere na publicação seguinte (a mesma `versao` pede o mesmo conteúdo).
   */
  sha256_conteudo: Sha256,
  app_minimo: Semver,
  base_minima: VersaoBase,
});
export type PacoteSkill = typeof PacoteSkill.Type;

export const Novidade = Schema.Struct({
  tipo: Schema.String,
  titulo: Schema.String,
  detalhe: Schema.optionalKey(Schema.String),
  afeta: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type Novidade = typeof Novidade.Type;

export const Manifesto = Schema.Struct({
  canal: Canal,
  /** A versão da base (e do conjunto). */
  versao: VersaoBase,
  commit: Schema.String,
  /**
   * A data do commit de que a fábrica gerou o catálogo de tarefas (`git show -s --format=%cI`). É a
   * ordem do catálogo contra o do instalador, que grava a data do commit de que saiu (`origem.json`):
   * vence o de commit mais recente. No empate do instante, o do instalador só se for o mesmo commit; de
   * commits diferentes, o baixado (`baixadoVence`, em `local.ts`).
   */
  data_commit: DataHora,
  /** Quando a fábrica gerou o manifesto (ISO 8601). */
  gerado_em: Schema.String,
  base: PacoteBase,
  skills: Schema.Array(PacoteSkill),
  /**
   * As skills retiradas (de `catalogo/skills/retiradas.yaml`): o app deixa de usá-las, venham do
   * instalador ou de um download anterior.
   */
  skills_retiradas: Schema.Array(NomeSkill),
  /**
   * O catálogo de tarefas inteiro (todos os `catalogo/tarefas/*.yaml` do commit), coberto pela assinatura
   * do manifesto. O app o troca de uma vez, sem mesclar com o anterior: a tarefa que não está aqui some.
   */
  tarefas: Schema.Array(TarefaDoCanal),
  app_minimo: Semver,
  /** As novidades desta versão (de `base-conhecimento/novidades.yaml`), para o aviso "Base atualizada". */
  novidades: Schema.Array(Novidade),
});
export type Manifesto = typeof Manifesto.Type;

export const decodificarManifesto = Schema.decodeUnknownSync(Schema.fromJsonString(Manifesto));
export const codificarManifesto = (manifesto: Manifesto): string => `${JSON.stringify(manifesto, null, 2)}\n`;

/**
 * O limite do manifesto (1 MB): o app não baixa um maior, e a fábrica não assina um maior. O catálogo de
 * tarefas cresce dentro dele.
 */
export const LIMITE_MANIFESTO = 1024 * 1024;

/** O `app_minimo` de quem não o declara (o manifesto do canal, a skill, a tarefa). */
export const APP_MINIMO_PADRAO = "0.1.0";

/** Nome do manifesto do canal: `beta.json`, `estavel.json`. */
export const arquivoManifesto = (canal: Canal) => `${canal}.json`;
export const SUFIXO_ASSINATURA = ".minisig";

/** A URL de um arquivo do manifesto. */
export const urlDoArquivo = (item: { readonly arquivo: string; readonly url?: string }, urlManifesto: string): string =>
  new URL(item.url ?? item.arquivo, urlManifesto).href;

/* ------------------------------------------------------------------ versões */

/** Os números da versão; `undefined` se um segmento não for só dígitos (`0.2.0-beta.1`, `2026-12-31`, `0.2.x`). */
const partes = (versao: string): ReadonlyArray<number> | undefined => {
  const segmentos = versao.split(".");
  return segmentos.every((segmento) => /^\d+$/.test(segmento)) ? segmentos.map(Number) : undefined;
};

/** A versão da base de desenvolvimento (`dev-<hash>`): o banco compilado sem `--versao`. */
export const ehVersaoDev = (versao: string): boolean => versao.startsWith("dev-");

/**
 * Compara versões numéricas separadas por ponto (`2026.11.13`, `2026.11.13.2`, `0.1.0`). A base de
 * desenvolvimento (`dev-<hash>`) vem antes de toda versão publicada: a atualização a troca. Uma versão
 * fora do padrão (segmento que não é só dígitos), de um lado ou do outro, dá `NaN`, também contra uma
 * `dev-*`: toda comparação com `NaN` é falsa, e quem confere um mínimo usa `atende`, que falha fechado.
 */
export function compararVersoes(a: string, b: string): number {
  const pa = ehVersaoDev(a) ? undefined : partes(a);
  const pb = ehVersaoDev(b) ? undefined : partes(b);
  if ((!ehVersaoDev(a) && pa === undefined) || (!ehVersaoDev(b) && pb === undefined)) return Number.NaN;
  if (ehVersaoDev(a) || ehVersaoDev(b)) return Number(!ehVersaoDev(a)) - Number(!ehVersaoDev(b));
  if (pa === undefined || pb === undefined) return Number.NaN;
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diferenca = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diferenca !== 0) return Math.sign(diferenca);
  }
  return 0;
}

/** `versao` atende o `minimo`? Só com a comparação feita: versão fora do padrão, de um lado ou do outro, não atende. */
export const atende = (minimo: string, versao: string): boolean => compararVersoes(minimo, versao) <= 0;

/** `a` é estritamente mais nova que `b`? Versão fora do padrão não é mais nova. */
export const maisNova = (a: string, b: string): boolean => compararVersoes(a, b) > 0;

/** A maior das versões dadas (as fora do padrão não contam); `undefined` se nenhuma conta. */
export const maiorVersao = (versoes: ReadonlyArray<string | undefined>): string | undefined =>
  versoes.reduce<string | undefined>(
    (maior, versao) =>
      versao === undefined || Number.isNaN(compararVersoes(versao, versao))
        ? maior
        : maior === undefined || maisNova(versao, maior)
          ? versao
          : maior,
    undefined,
  );
