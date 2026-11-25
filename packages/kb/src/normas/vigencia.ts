// @effect-diagnostics nodeBuiltinImport:off -- carregador síncrono de vigencia.yaml, transicoes.yaml e normas, usado pelos scripts e pela compilação do banco
/**
 * Vigência calculada numa data explícita: nunca o relógio do build.
 *
 * Entradas:
 * - datas das normas da base (front matter: `assinada_em`, `publicada_em` e `vigente_de`, este
 *   `AAAA-MM-DD` ou "aguardando publicação") e dos stubs (`assinada_em` e `publicada_em`, quando
 *   registradas com evidência; o stub não tem `vigente_de`);
 * - relações de `base-conhecimento/relacoes.yaml`, com `efeito_de` (data, obrigatória quando a
 *   origem é stub) ou a vigência da origem;
 * - `data_referencia` de `base-conhecimento/config/vigencia.yaml` (status publicado).
 *
 * A vigência é calculada, nunca presumida. Regras de `statusEm(id, data)`:
 * - antes de `vigente_de`: `ainda-nao-vigente`; norma "aguardando publicação" (assinada e ainda não
 *   publicada) não está em vigor em data nenhuma, e as relações que ela opera não produzem efeito;
 * - o stub começa na data do ato (sem ela, sem limite inferior);
 * - uma relação produz efeito a partir de `efeito_de`; sem data, da vigência da origem;
 * - o texto consolidado dá um piso da `data_referencia` em diante (`TextoConsolidado`);
 * - status: `revogada` (revogação total) > `parcialmente revogada` (revogação de dispositivo ou com
 *   alcance) > `alterada` > `vigente`. `regulamenta` e `fundamenta-se-em` não mudam o status;
 * - stub sem relação com efeito na data fica com o status registrado em `stubs.yaml` ("a confirmar"
 *   quando não conferido), mas um status diferente de `vigente` só vale a partir da vigência do ato de
 *   `status_fonte` (antes dela, a norma estava em vigor; sem `status_fonte`, "a confirmar").
 *
 * Revogada não é inaplicável: `transicoesAplicaveis` devolve as regras de transição (de
 * `base-conhecimento/transicoes.yaml`) que mantêm efeitos da norma revogada.
 */
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import { parse } from "yaml";
import { CAMINHOS, chaveDoCheckout, noCheckout } from "../caminhos.ts";
import { analisarFrontMatter } from "./front-matter.ts";
import { carregarEstruturas, listarNormas } from "./estrutura.ts";
import { carregarRegistro, type Registro } from "./registro.ts";
import { carregarRelacoes, type Relacao, relacaoParcial } from "./relacoes.ts";

export const A_CONFIRMAR = "a confirmar";
/** `vigente_de` (e `publicada_em`) do ato assinado e ainda não publicado: não está em vigor. */
export const AGUARDANDO_PUBLICACAO = "aguardando publicação";
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

export const STATUS_VIGENCIA = [
  "vigente",
  "alterada",
  "parcialmente revogada",
  "revogada",
  "ainda-nao-vigente",
  "a confirmar",
] as const;
export type StatusVigencia = (typeof STATUS_VIGENCIA)[number];

export interface DatasNorma {
  assinada_em: string | null;
  publicada_em: string;
  vigente_de: string;
}

const esquemaConfig = Schema.Struct({ data_referencia: Schema.String.check(Schema.isPattern(RE_DATA)) });
const decodificarConfig = Schema.decodeUnknownSync(esquemaConfig, { onExcessProperty: "error", errors: "all" });

export function caminhoConfigVigencia(raiz: string): string {
  return noCheckout(raiz, CAMINHOS.configVigencia);
}

/**
 * `data_referencia` do texto de `base-conhecimento/config/vigencia.yaml`. Fora do contrato, lança o
 * `Schema.SchemaError` (texto em português por `esquema/mensagens.ts`).
 */
export function dataReferenciaDoYaml(texto: string): string {
  return decodificarConfig(parse(texto, { schema: "failsafe" })).data_referencia;
}

/** `data_referencia` declarada em `base-conhecimento/config/vigencia.yaml`. */
export function dataReferencia(raiz: string): string {
  return dataReferenciaDoYaml(NodeFS.readFileSync(caminhoConfigVigencia(raiz), "utf-8"));
}

/** Por checkout (`chaveDoCheckout`): `statusEm` sobre a raiz relê as datas a cada chamada. */
const cacheDatas = new Map<string, Map<string, DatasNorma>>();

/** Datas de uma norma da base pelo front matter (`assinada_em`, `publicada_em`, `vigente_de`). */
export function datasDoFrontMatter(meta: Readonly<Record<string, unknown>>): DatasNorma {
  const texto = (campo: string) => (typeof meta[campo] === "string" ? (meta[campo] as string) : A_CONFIRMAR);
  return {
    assinada_em: RE_DATA.test(texto("assinada_em")) ? texto("assinada_em") : null,
    publicada_em: texto("publicada_em"),
    vigente_de: texto("vigente_de"),
  };
}

/**
 * Datas por ID do ato a partir do front matter das normas da base (em qualquer ordem) e do registro:
 * os stubs entram com `assinada_em` e `publicada_em`, e sem `vigente_de`. A regra única, sobre os arquivos
 * (`carregarDatas`) e sobre o `kb.sqlite` (`FontesNormativas.layer`).
 */
export function montarDatas(
  normas: Iterable<{ id: string; meta: Readonly<Record<string, unknown>> }>,
  registro: Registro,
): Map<string, DatasNorma> {
  const datas = new Map<string, DatasNorma>();
  for (const norma of normas) {
    datas.set(norma.id, datasDoFrontMatter(norma.meta));
  }
  for (const entrada of registro.entradas) {
    if (entrada.situacao !== "stub" || datas.has(entrada.id)) continue;
    datas.set(entrada.id, {
      assinada_em: entrada.assinada_em ?? null,
      publicada_em: entrada.publicada_em ?? A_CONFIRMAR,
      vigente_de: A_CONFIRMAR,
    });
  }
  return datas;
}

/** Datas por ID do ato: normas da base (front matter) e stubs (`assinada_em`, `publicada_em`). */
export function carregarDatas(raiz: string, registro?: Registro): Map<string, DatasNorma> {
  const emCache = cacheDatas.get(chaveDoCheckout(raiz));
  if (emCache) return emCache;
  const normas = listarNormas(raiz).map((norma) => ({
    id: norma.id,
    meta: analisarFrontMatter(NodeFS.readFileSync(norma.arquivo, "utf-8"), norma.path).meta,
  }));
  const datas = montarDatas(normas, registro ?? carregarRegistro(raiz));
  cacheDatas.set(chaveDoCheckout(raiz), datas);
  return datas;
}

/**
 * O que a vigência lê: registro, datas dos atos, relações e regras de transição, já carregados. Vem
 * dos arquivos do checkout (`carregarFonteVigencia`) ou do serviço `FontesNormativas`, que tem
 * estes campos (sobre qualquer das duas layers); as regras (`statusEm`, `transicoesAplicaveis`,
 * `derivarLinha`...) são as mesmas.
 */
export interface FonteVigencia {
  readonly registro: Registro;
  readonly datas: ReadonlyMap<string, DatasNorma>;
  readonly relacoes: readonly Relacao[];
  readonly transicoes: readonly Transicao[];
  readonly consolidado: TextoConsolidado;
}

/** O status que o próprio texto de uma norma mostra, além das relações registradas. */
export type StatusDoTexto = "alterada" | "parcialmente revogada";

/**
 * O que os textos consolidados da base mostram na `data_referencia` (`em`): a norma com dispositivo
 * revogado ou com nota de redação ("Redação dada pela...", "Incluído pela...") foi alterada, mesmo
 * que o ato que a alterou não esteja na base nem em `relacoes.yaml`. A nota só traz o ano do ato;
 * por isso o piso vale da `data_referencia` em diante, e a consulta em data anterior segue só as
 * relações registradas.
 */
export interface TextoConsolidado {
  readonly em: string;
  readonly status: ReadonlyMap<string, StatusDoTexto>;
}

/** O status que os dispositivos de uma norma mostram; `null` sem revogação nem nota de alteração. */
export function statusDoTexto(
  dispositivos: ReadonlyArray<{ readonly revogado: boolean; readonly notas: ReadonlyArray<{ readonly tipo: string }> }>,
): StatusDoTexto | null {
  if (dispositivos.some((d) => d.revogado)) return "parcialmente revogada";
  const alterado = dispositivos.some((d) =>
    d.notas.some((n) => n.tipo === "redacao" || n.tipo === "inclusao" || n.tipo === "renumeracao"),
  );
  return alterado ? "alterada" : null;
}

/** `TextoConsolidado` a partir do status de cada norma (`[id, statusDoTexto(...)]`). */
export function montarConsolidado(
  em: string,
  normas: Iterable<readonly [string, StatusDoTexto | null]>,
): TextoConsolidado {
  const status = new Map<string, StatusDoTexto>();
  for (const [id, valor] of normas) if (valor !== null) status.set(id, valor);
  return { em, status };
}

/** O que os textos das normas do checkout em `raiz` mostram. */
export function carregarConsolidado(raiz: string): TextoConsolidado {
  return montarConsolidado(
    dataReferencia(raiz),
    carregarEstruturas(raiz).map((e) => [e.id, statusDoTexto(e.dispositivos)] as const),
  );
}

/**
 * O que o status de vigência lê (`statusEm`, `intervalosVigencia`): sem as regras de transição. Cada
 * regra abaixo pede só os campos que lê, para que quem carrega dos arquivos não leia o resto.
 */
export type FonteStatus = Pick<FonteVigencia, "registro" | "datas" | "relacoes" | "consolidado">;

/** A fonte da vigência lida dos arquivos do checkout em `raiz`. */
export function carregarFonteVigencia(raiz: string): FonteVigencia {
  return {
    registro: carregarRegistro(raiz),
    datas: carregarDatas(raiz),
    relacoes: carregarRelacoes(raiz),
    transicoes: carregarTransicoes(raiz),
    consolidado: carregarConsolidado(raiz),
  };
}

/** Início de vigência (ou de efeito): a data, ou "aguardando publicação" (nunca ocorreu). */
export interface Inicio {
  /** Data de início; `null` sem limite inferior (stub sem data do ato) ou aguardando publicação. */
  data: string | null;
  /** Ato assinado e ainda não publicado: não está em vigor em data nenhuma. */
  aguardando: boolean;
}

/** Início de vigência do ato: `vigente_de` da norma da base, ou a data do ato do stub. */
export function inicioVigencia(id: string, fonte: Pick<FonteVigencia, "datas">): Inicio {
  const datas = fonte.datas.get(id);
  if (datas?.vigente_de === AGUARDANDO_PUBLICACAO) return { data: null, aguardando: true };
  if (datas && RE_DATA.test(datas.vigente_de)) return { data: datas.vigente_de, aguardando: false };
  return { data: datas?.assinada_em ?? null, aguardando: false };
}

/** Data a partir da qual a relação produz efeito. */
export function efeitoDaRelacao(relacao: Relacao, fonte: Pick<FonteVigencia, "datas">): Inicio {
  if (relacao.efeito_de !== "vigencia-da-origem") return { data: relacao.efeito_de, aguardando: false };
  return inicioVigencia(relacao.origem, fonte);
}

/** Data de efeito do status registrado de um stub: a vigência do ato de `status_fonte`. */
function efeitoDoStatusRegistrado(statusFonte: string | undefined, fonte: Pick<FonteVigencia, "datas">): Inicio | null {
  return statusFonte ? inicioVigencia(statusFonte.split("#")[0]!, fonte) : null;
}

/** O evento (início de vigência, efeito) já ocorreu na data? */
function ocorreu(inicio: Inicio, data: string): boolean {
  return !inicio.aguardando && (inicio.data === null || data >= inicio.data);
}

export interface EventoVigencia {
  tipo: Relacao["tipo"];
  origem: string;
  operador: string | null;
  alvo_dispositivo: string | null;
  alcance: string | null;
  parcial: boolean;
  /** Data do efeito; `null` quando a origem aguarda publicação. */
  efeito_de: string | null;
  ocorreu: boolean;
}

export interface ResultadoVigencia {
  id: string;
  data: string;
  status: StatusVigencia;
  inicio: Inicio;
  /** Relações que atingem a norma, com o efeito na data. */
  eventos: EventoVigencia[];
}

const ORDEM: Record<string, number> = { vigente: 0, alterada: 1, "parcialmente revogada": 2, revogada: 3 };

/** Status de vigência do ato `id` na data `data` (AAAA-MM-DD). */
export function statusEm(id: string, data: string, fonte: FonteStatus): ResultadoVigencia {
  if (!RE_DATA.test(data)) throw new Error(`data fora do formato AAAA-MM-DD: ${data}`);
  const ato = id.split("#")[0]!;
  const entrada = fonte.registro.obter(ato);
  const inicio = inicioVigencia(ato, fonte);

  const eventos: EventoVigencia[] = fonte.relacoes
    .filter((relacao) => relacao.alvo === ato && (relacao.tipo === "revoga" || relacao.tipo === "altera"))
    .map((relacao) => {
      const efeito = efeitoDaRelacao(relacao, fonte);
      return {
        tipo: relacao.tipo,
        origem: relacao.origem,
        operador: relacao.operador ?? null,
        alvo_dispositivo: relacao.alvo_dispositivo ?? null,
        alcance: relacao.alcance ?? null,
        parcial: relacaoParcial(relacao),
        efeito_de: efeito.data,
        ocorreu: ocorreu(efeito, data),
      };
    });

  if (!ocorreu(inicio, data)) return { id: ato, data, status: "ainda-nao-vigente", inicio, eventos };

  let status: StatusVigencia = "vigente";
  for (const evento of eventos) {
    if (!evento.ocorreu) continue;
    const efeito: StatusVigencia =
      evento.tipo === "altera" ? "alterada" : evento.parcial ? "parcialmente revogada" : "revogada";
    if (ORDEM[efeito]! > ORDEM[status]!) status = efeito;
  }
  // o piso do texto consolidado: alteração ou revogação parcial que o texto mostra e nenhuma relação registra
  const doTexto = data >= fonte.consolidado.em ? fonte.consolidado.status.get(ato) : undefined;
  if (doTexto !== undefined && ORDEM[doTexto]! > ORDEM[status]!) status = doTexto;

  if (eventos.every((evento) => !evento.ocorreu) && entrada?.situacao === "stub") {
    const registrado = entrada.status_vigencia ?? A_CONFIRMAR;
    if (registrado === A_CONFIRMAR) return { id: ato, data, status: "a confirmar", inicio, eventos };
    if (registrado !== "vigente") {
      // O status registrado (revogada, alterada…) só vale a partir do efeito do dispositivo que o
      // fundamenta (`status_fonte`); antes disso, a norma estava em vigor.
      const efeito = efeitoDoStatusRegistrado(entrada.status_fonte, fonte);
      if (!efeito) return { id: ato, data, status: "a confirmar", inicio, eventos };
      if (ocorreu(efeito, data)) status = registrado as StatusVigencia;
    }
  }
  return { id: ato, data, status, inicio, eventos };
}

/** Trecho de datas com o mesmo resultado de `statusEm` (início inclusivo, fim exclusivo; `null` = aberto). */
export interface IntervaloVigencia {
  de: string | null;
  ate: string | null;
  status: StatusVigencia;
  /** O que abre o intervalo: `inicio` (vigência ou assinatura do ato) ou a relação (`revoga br/...#art74-ii`). */
  fonte: string;
}

/**
 * `statusEm` como intervalos datados, para gravar no `kb.sqlite` sem o relógio. O status só muda nas
 * datas que `statusEm` compara (início de vigência ou data do ato do stub e efeito
 * de cada relação `revoga`/`altera` que o atinge): avaliar `statusEm` em cada uma dessas datas, e
 * numa anterior a todas, dá a função inteira. Intervalos vizinhos iguais são fundidos.
 */
export function intervalosVigencia(id: string, dados: FonteStatus): IntervaloVigencia[] {
  const ato = id.split("#")[0]!;
  const marcos = new Map<string, string[]>();
  const marcar = (data: string | null, fonte: string) => {
    if (data) marcos.set(data, [...new Set([...(marcos.get(data) ?? []), fonte])]);
  };
  const inicio = inicioVigencia(ato, dados);
  marcar(inicio.data, "inicio");
  for (const relacao of dados.relacoes) {
    if (relacao.alvo !== ato || (relacao.tipo !== "revoga" && relacao.tipo !== "altera")) continue;
    const efeito = efeitoDaRelacao(relacao, dados);
    const fonte = `${relacao.tipo} ${relacao.origem}${relacao.operador ?? ""}`;
    marcar(efeito.data, fonte);
  }
  if (dados.consolidado.status.has(ato)) marcar(dados.consolidado.em, "texto consolidado");
  const entrada = dados.registro.obter(ato);
  if (entrada?.situacao === "stub") {
    const efeito = efeitoDoStatusRegistrado(entrada.status_fonte, dados);
    marcar(efeito?.data ?? null, `status_fonte ${entrada.status_fonte}`);
  }
  const datas = [...marcos.keys()].sort();
  const pontos: { de: string | null; fonte: string; em: string }[] = [
    { de: null, fonte: "anterior", em: "0001-01-01" },
    ...datas.map((data) => ({ de: data, fonte: marcos.get(data)!.join("; "), em: data })),
  ];
  const saida: IntervaloVigencia[] = [];
  pontos.forEach((ponto, i) => {
    const { status } = statusEm(ato, ponto.em, dados);
    const anterior = saida.at(-1);
    if (anterior && anterior.status === status) {
      anterior.ate = pontos[i + 1]?.de ?? null;
      return;
    }
    saida.push({ de: ponto.de, ate: pontos[i + 1]?.de ?? null, status, fonte: ponto.fonte });
  });
  return saida;
}

// ---------------------------------------------------------------------------------------------
// Regras de transição (`base-conhecimento/transicoes.yaml`)

const idAto = Schema.String.check(Schema.isPattern(/^[a-z0-9/-]+$/));
const textoNaoVazio = Schema.String.check(Schema.isMinLength(1));
const data = Schema.String.check(Schema.isPattern(RE_DATA));
export const esquemaTransicao = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9-]+$/)),
  norma: idAto,
  dispositivo: Schema.String.check(Schema.isPattern(/^#/)),
  tipo: Schema.Literals([
    "faculdade-de-adequacao",
    "prazo-de-adequacao",
    "direito-de-conclusao",
    "prazo-de-implantacao",
    "prazo-normativo",
    "ressalva-de-revogacao",
  ]),
  /** Norma revogada cujos efeitos a regra preserva (ou cuja adequação ela disciplina). */
  norma_anterior: Schema.optionalKey(idAto),
  aplica_a: textoNaoVazio,
  regra: textoNaoVazio,
  /** Marco inicial: vigência ou publicação da norma, ou data. */
  inicio: Schema.Union([Schema.Literals(["vigencia", "publicacao"]), data]),
  /** Fim: duração ISO (P2Y, P180D), data, ou sem prazo. */
  fim: Schema.Union([Schema.String.check(Schema.isPattern(/^P\d+[YMD]$/)), data, Schema.Literal("sem-prazo")]),
  evidencia: textoNaoVazio,
});
export type Transicao = typeof esquemaTransicao.Type;
const esquemaTransicoes = Schema.Struct({ transicoes: Schema.Array(esquemaTransicao) });
const decodificarTransicoes = Schema.decodeUnknownSync(esquemaTransicoes, { onExcessProperty: "error", errors: "all" });

export function caminhoTransicoes(raiz: string): string {
  return noCheckout(raiz, CAMINHOS.transicoes);
}

/**
 * Regras de transição do texto de `transicoes.yaml` (YAML `failsafe`: todo escalar é texto). Fora do
 * contrato, lança o `Schema.SchemaError` (texto em português por `esquema/mensagens.ts`).
 */
export function transicoesDoYaml(texto: string): Transicao[] {
  return [...decodificarTransicoes(parse(texto, { schema: "failsafe", uniqueKeys: true })).transicoes];
}

export function carregarTransicoes(raiz: string): Transicao[] {
  const arquivo = caminhoTransicoes(raiz);
  if (!NodeFS.existsSync(arquivo)) return [];
  return transicoesDoYaml(NodeFS.readFileSync(arquivo, "utf-8"));
}

function somarDuracao(data: string, duracao: string): string {
  const m = /^P(\d+)([YMD])$/.exec(duracao)!;
  const quantidade = Number(m[1]);
  const [ano, mes, dia] = data.split("-").map(Number) as [number, number, number];
  // @effect-diagnostics-next-line globalDate:off -- aritmética de calendário sobre datas dadas, sem relógio
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (m[2] === "Y") d.setUTCFullYear(d.getUTCFullYear() + quantidade);
  else if (m[2] === "M") d.setUTCMonth(d.getUTCMonth() + quantidade);
  else d.setUTCDate(d.getUTCDate() + quantidade);
  return d.toISOString().slice(0, 10);
}

/** Datas de uma regra de transição que não dependem da data da consulta. */
export interface DatasTransicao {
  /** Início da regra; `null` quando a norma aguarda publicação (a regra ainda não começou). */
  inicio_em: string | null;
  fim_em: string | null;
}

export type Situacao = "a-iniciar" | "em-curso" | "encerrada";

export interface SituacaoTransicao extends Transicao, DatasTransicao {
  /** Situação na data: `a-iniciar`, `em-curso` ou `encerrada`. */
  situacao: Situacao;
}

/**
 * Início e fim resolvidos de uma regra de transição (pelas datas da norma que a estabelece). O início
 * "publicacao" usa `publicada_em`; quando ela não está registrada ("a confirmar"), usa a vigência da
 * norma, que nas normas com vigência na publicação é a mesma data.
 */
export function datasTransicao(transicao: Transicao, fonte: Pick<FonteVigencia, "datas">): DatasTransicao {
  const datas = fonte.datas.get(transicao.norma);
  let inicio: Inicio;
  if (RE_DATA.test(transicao.inicio)) inicio = { data: transicao.inicio, aguardando: false };
  else if (transicao.inicio === "publicacao" && datas && RE_DATA.test(datas.publicada_em)) {
    inicio = { data: datas.publicada_em, aguardando: false };
  } else if (transicao.inicio === "publicacao" && datas?.publicada_em === AGUARDANDO_PUBLICACAO) {
    inicio = { data: null, aguardando: true };
  } else inicio = inicioVigencia(transicao.norma, fonte);
  const fim =
    inicio.data === null || transicao.fim === "sem-prazo"
      ? null
      : RE_DATA.test(transicao.fim)
        ? transicao.fim
        : somarDuracao(inicio.data, transicao.fim);
  return { inicio_em: inicio.aguardando ? null : inicio.data, fim_em: fim };
}

/**
 * Situação de uma regra de transição na data `data`, a partir das datas resolvidas: a regra única,
 * aplicada sobre os arquivos (`situacaoTransicao`) e sobre o `kb.sqlite` (tabela `transicoes`). Sem
 * início (a norma aguarda publicação), a regra ainda não começou.
 */
export function situacaoNaData(t: DatasTransicao, data: string): Situacao {
  if (t.inicio_em === null || data < t.inicio_em) return "a-iniciar";
  if (t.fim_em !== null && data > t.fim_em) return "encerrada";
  return "em-curso";
}

/** Situação de uma regra de transição numa data. */
export function situacaoTransicao(
  transicao: Transicao,
  data: string,
  fonte: Pick<FonteVigencia, "datas">,
): SituacaoTransicao {
  const datas = datasTransicao(transicao, fonte);
  return { ...transicao, ...datas, situacao: situacaoNaData(datas, data) };
}

/** Regras de transição da norma `id` ou que preservam efeitos dela (norma anterior). */
export function transicoesAplicaveis(
  id: string,
  data: string,
  fonte: Pick<FonteVigencia, "datas" | "transicoes">,
): SituacaoTransicao[] {
  const ato = id.split("#")[0]!;
  return fonte.transicoes
    .filter((t) => t.norma === ato || t.norma_anterior === ato)
    .map((t) => situacaoTransicao(t, data, fonte));
}

// ---------------------------------------------------------------------------------------------
// Linhas normativas (marcos da revisão de PPC)

export interface LinhaDerivada {
  /**
   * Ato vigente na data: fim da cadeia de revogações totais a partir do ato mais recente da linha já
   * em vigor.
   */
  vigente: string;
  /** Atos da linha que ainda não estão em vigor na data (aguardando publicação ou vigência futura). */
  aguardando: string[];
  /** Atos revogados no todo pelo vigente. */
  substitui: string[];
  /** Demais atos da linha e atos revogados no todo pelos substituídos (sem o vigente, `substitui` e `aguardando`). */
  antecessoras_historicas: string[];
  /** Dispositivos revogados pelo vigente ou revogados no próprio vigente (`ato#dispositivo`). */
  dispositivos_revogados: string[];
}

/**
 * Deriva vigente, substituídas, antecessoras e dispositivos revogados de uma linha normativa (atos
 * de um mesmo tema, do mais antigo ao mais recente conhecido) a partir de `relacoes.yaml`, na data
 * `data`. Uma nova norma que revogue o ato mais recente passa a ser a vigente sem editar a linha; a que
 * ainda não está em vigor (a Res. CNE/CP nº 2/2026, aguardando publicação) fica em `aguardando`.
 */
export function derivarLinha(
  linha: readonly string[],
  data: string,
  fonte: Pick<FonteVigencia, "datas" | "relacoes">,
): LinhaDerivada {
  if (linha.length === 0) throw new Error("linha normativa vazia");
  const relacoes = fonte.relacoes.filter((r) => r.tipo === "revoga");
  const emVigor = (r: Relacao) => ocorreu(efeitoDaRelacao(r, fonte), data);
  const revogadoPor = (ato: string) => relacoes.find((r) => r.alvo === ato && !relacaoParcial(r) && emVigor(r));
  const aguardando = linha.filter((ato) => !ocorreu(inicioVigencia(ato, fonte), data));
  let vigente = [...linha].reverse().find((ato) => !aguardando.includes(ato)) ?? linha.at(-1)!;
  const visitados = new Set<string>();
  while (!visitados.has(vigente)) {
    visitados.add(vigente);
    const proxima = revogadoPor(vigente);
    if (!proxima) break;
    vigente = proxima.origem;
  }
  const totais = (origem: string) => relacoes.filter((r) => r.origem === origem && !relacaoParcial(r) && emVigor(r));
  const substitui = totais(vigente).map((r) => r.alvo);
  const dispositivos_revogados = relacoes
    .filter((r) => r.alvo_dispositivo && emVigor(r) && (r.origem === vigente || r.alvo === vigente))
    .map((r) => `${r.alvo}${r.alvo_dispositivo}`);
  const historicas: string[] = [];
  for (const ato of [...linha, ...substitui.flatMap((s) => totais(s).map((r) => r.alvo))]) {
    if (ato !== vigente && !substitui.includes(ato) && !aguardando.includes(ato) && !historicas.includes(ato))
      historicas.push(ato);
  }
  return {
    vigente,
    aguardando: aguardando.filter((ato) => ato !== vigente),
    substitui,
    antecessoras_historicas: historicas,
    dispositivos_revogados: [...new Set(dispositivos_revogados)],
  };
}
