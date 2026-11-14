/**
 * Vigência calculada numa data explícita (fase 5): nunca o relógio do build.
 *
 * Entradas:
 * - datas das normas da base (front matter: `assinada_em`, `publicada_em`, `vigente_de`, cada uma
 *   `AAAA-MM-DD` ou `a confirmar`) e dos stubs (`data_publicacao`, tomada como data do ato);
 * - relações de `base-conhecimento/relacoes.yaml`, com `efeito_de` (data) ou a vigência da origem;
 * - `data_referencia` de `base-conhecimento/config/vigencia.yaml` (status publicado).
 *
 * Regras de `statusEm(id, data)`:
 * - antes de `vigente_de` (ou, se ele for "a confirmar", antes da assinatura): `ainda-nao-vigente`;
 * - com `vigente_de` "a confirmar" e data posterior à assinatura, a norma é presumida vigente e o
 *   resultado sai com `certo: false` (é o caso da Res. CNE/CP nº 2/2026, cuja publicação no DOU
 *   ainda não está registrada);
 * - uma relação produz efeito a partir de `efeito_de`; sem data, da vigência da origem; se essa for
 *   "a confirmar", o efeito é presumido a partir da assinatura da origem e marcado como incerto;
 * - status: `revogada` (revogação total) > `parcialmente revogada` (revogação de dispositivo ou com
 *   alcance) > `alterada` > `vigente`. `regulamenta` e `fundamenta-se-em` não mudam o status;
 * - stub sem relação que o atinja fica com o status registrado em `stubs.yaml`.
 *
 * Revogada não é inaplicável: `transicoesAplicaveis` devolve as regras de transição (de
 * `base-conhecimento/transicoes.yaml`) que mantêm efeitos da norma revogada.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { analisarFrontMatter } from "./front-matter.ts";
import { idDoAto } from "./ids.ts";
import { listarNormas } from "./estrutura.ts";
import { carregarRegistro, raizRepositorio, type Registro } from "./registro.ts";
import { carregarRelacoes, type Relacao, relacaoParcial } from "./relacoes.ts";

export const A_CONFIRMAR = "a confirmar";
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

const esquemaConfig = z.strictObject({ data_referencia: z.string().regex(RE_DATA) });

export function caminhoConfigVigencia(raiz: string = raizRepositorio()): string {
  return path.join(raiz, "base-conhecimento", "config", "vigencia.yaml");
}

/** `data_referencia` declarada em `base-conhecimento/config/vigencia.yaml`. */
export function dataReferencia(raiz: string = raizRepositorio()): string {
  const bruto = parse(readFileSync(caminhoConfigVigencia(raiz), "utf-8"), { schema: "failsafe" });
  return esquemaConfig.parse(bruto).data_referencia;
}

const cacheDatas = new Map<string, Map<string, DatasNorma>>();

/** Datas por ID do ato: normas da base (front matter) e stubs (`data_publicacao`). */
export function carregarDatas(raiz: string = raizRepositorio(), registro?: Registro): Map<string, DatasNorma> {
  const emCache = cacheDatas.get(raiz);
  if (emCache) return emCache;
  const datas = new Map<string, DatasNorma>();
  for (const norma of listarNormas(raiz)) {
    if (idDoAto(norma.id) !== norma.id) continue;
    const { meta } = analisarFrontMatter(readFileSync(norma.arquivo, "utf-8"), norma.path);
    const texto = (campo: string) => (typeof meta[campo] === "string" ? (meta[campo] as string) : A_CONFIRMAR);
    datas.set(norma.id, {
      assinada_em: RE_DATA.test(texto("assinada_em")) ? texto("assinada_em") : null,
      publicada_em: texto("publicada_em"),
      vigente_de: texto("vigente_de"),
    });
  }
  for (const entrada of (registro ?? carregarRegistro(raiz)).entradas) {
    if (entrada.situacao !== "stub" || datas.has(entrada.id)) continue;
    datas.set(entrada.id, {
      assinada_em: entrada.data_publicacao ?? null,
      publicada_em: A_CONFIRMAR,
      vigente_de: A_CONFIRMAR,
    });
  }
  cacheDatas.set(raiz, datas);
  return datas;
}

/** Início de vigência: data certa, ou mínimo (assinatura) com incerteza. */
export interface Inicio {
  /** Data certa de início, ou `null` se "a confirmar". */
  data: string | null;
  /** Limite inferior quando a data não é certa (assinatura do ato). */
  minimo: string | null;
  certo: boolean;
}

export function inicioVigencia(id: string, raiz: string = raizRepositorio()): Inicio {
  const datas = carregarDatas(raiz).get(idDoAto(id));
  if (datas && RE_DATA.test(datas.vigente_de)) return { data: datas.vigente_de, minimo: datas.vigente_de, certo: true };
  return { data: null, minimo: datas?.assinada_em ?? null, certo: false };
}

/** Data a partir da qual a relação produz efeito. */
export function efeitoDaRelacao(relacao: Relacao, raiz: string = raizRepositorio()): Inicio {
  if (relacao.efeito_de !== "vigencia-da-origem")
    return { data: relacao.efeito_de, minimo: relacao.efeito_de, certo: true };
  return inicioVigencia(relacao.origem, raiz);
}

/** `true`, `false` ou `"a confirmar"`: o evento já ocorreu na data? */
function ocorreu(inicio: Inicio, data: string): boolean | "a confirmar" {
  if (inicio.data) return data >= inicio.data;
  if (inicio.minimo && data < inicio.minimo) return false;
  return A_CONFIRMAR;
}

export interface EventoVigencia {
  tipo: Relacao["tipo"];
  origem: string;
  operador: string | null;
  alvo_dispositivo: string | null;
  alcance: string | null;
  parcial: boolean;
  efeito_de: string | null;
  efeito_minimo: string | null;
  ocorreu: boolean | "a confirmar";
}

export interface ResultadoVigencia {
  id: string;
  data: string;
  status: StatusVigencia;
  /** `false` quando o status depende de uma data "a confirmar" (início da norma ou de um efeito). */
  certo: boolean;
  inicio: Inicio;
  /** Relações que atingem a norma, com o efeito na data. */
  eventos: EventoVigencia[];
  /** Explicação das incertezas. */
  pendencias: string[];
}

const ORDEM: Record<string, number> = { vigente: 0, alterada: 1, "parcialmente revogada": 2, revogada: 3 };

/** Status de vigência do ato `id` na data `data` (AAAA-MM-DD). */
export function statusEm(id: string, data: string, raiz: string = raizRepositorio()): ResultadoVigencia {
  if (!RE_DATA.test(data)) throw new Error(`data fora do formato AAAA-MM-DD: ${data}`);
  const ato = idDoAto(id.split("#")[0]!);
  const registro = carregarRegistro(raiz);
  const entrada = registro.obter(ato);
  const inicio = inicioVigencia(ato, raiz);
  const pendencias: string[] = [];
  const titulo = (outro: string) => registro.obter(outro)?.title ?? outro;

  const eventos: EventoVigencia[] = carregarRelacoes(raiz)
    .filter((relacao) => relacao.alvo === ato && (relacao.tipo === "revoga" || relacao.tipo === "altera"))
    .map((relacao) => {
      const efeito = efeitoDaRelacao(relacao, raiz);
      return {
        tipo: relacao.tipo,
        origem: relacao.origem,
        operador: relacao.operador ?? null,
        alvo_dispositivo: relacao.alvo_dispositivo ?? null,
        alcance: relacao.alcance ?? null,
        parcial: relacaoParcial(relacao),
        efeito_de: efeito.data,
        efeito_minimo: efeito.minimo,
        ocorreu: ocorreu(efeito, data),
      };
    });

  const inicioOcorreu = ocorreu(inicio, data);
  if (inicioOcorreu === false) {
    return { id: ato, data, status: "ainda-nao-vigente", certo: true, inicio, eventos, pendencias };
  }
  let certo = true;
  if (inicioOcorreu === A_CONFIRMAR) {
    certo = false;
    pendencias.push(
      inicio.minimo
        ? `início de vigência de ${titulo(ato)} a confirmar (ato de ${inicio.minimo}; publicação não registrada): presumida vigente`
        : `datas de ${titulo(ato)} não registradas: vigência presumida`,
    );
  }

  let status: StatusVigencia = "vigente";
  for (const evento of eventos) {
    if (evento.ocorreu === false) continue;
    const efeito: StatusVigencia =
      evento.tipo === "altera" ? "alterada" : evento.parcial ? "parcialmente revogada" : "revogada";
    if (evento.ocorreu === A_CONFIRMAR) {
      certo = false;
      pendencias.push(
        `${evento.tipo === "revoga" ? "revogação" : "alteração"} por ${titulo(evento.origem)}` +
          `${evento.operador ? ` (${evento.operador})` : ""} produz efeito na vigência da origem, a confirmar` +
          `${evento.efeito_minimo ? ` (não antes de ${evento.efeito_minimo})` : ""}: presumida em vigor em ${data}`,
      );
    }
    if (ORDEM[efeito]! > ORDEM[status]!) status = efeito;
  }

  if (eventos.every((evento) => evento.ocorreu === false) && entrada?.situacao === "stub") {
    const registrado = entrada.status_vigencia ?? A_CONFIRMAR;
    if (registrado === A_CONFIRMAR) {
      return {
        id: ato,
        data,
        status: "a confirmar",
        certo: false,
        inicio,
        eventos,
        pendencias: [`status de ${titulo(ato)} não conferido (stub)`],
      };
    }
    status = registrado as StatusVigencia;
  }
  return { id: ato, data, status, certo, inicio, eventos, pendencias };
}

/** Trecho de datas com o mesmo resultado de `statusEm` (início inclusivo, fim exclusivo; `null` = aberto). */
export interface IntervaloVigencia {
  de: string | null;
  ate: string | null;
  status: StatusVigencia;
  certo: boolean;
  /** O que abre o intervalo: `inicio` (vigência ou assinatura do ato) ou a relação (`revoga br/...#art74-ii`). */
  fonte: string;
}

/**
 * `statusEm` como intervalos datados, para gravar no `kb.sqlite` sem o relógio. O status só muda nas
 * datas que `statusEm` compara (início de vigência ou assinatura do ato e efeito, certo ou mínimo,
 * de cada relação `revoga`/`altera` que o atinge): avaliar `statusEm` em cada uma dessas datas, e
 * numa anterior a todas, dá a função inteira. Intervalos vizinhos iguais são fundidos.
 */
export function intervalosVigencia(id: string, raiz: string = raizRepositorio()): IntervaloVigencia[] {
  const ato = idDoAto(id.split("#")[0]!);
  const marcos = new Map<string, string[]>();
  const marcar = (data: string | null, fonte: string) => {
    if (data) marcos.set(data, [...new Set([...(marcos.get(data) ?? []), fonte])]);
  };
  const inicio = inicioVigencia(ato, raiz);
  marcar(inicio.data, "inicio");
  marcar(inicio.minimo, "inicio");
  for (const relacao of carregarRelacoes(raiz)) {
    if (relacao.alvo !== ato || (relacao.tipo !== "revoga" && relacao.tipo !== "altera")) continue;
    const efeito = efeitoDaRelacao(relacao, raiz);
    const fonte = `${relacao.tipo} ${relacao.origem}${relacao.operador ?? ""}`;
    marcar(efeito.data, fonte);
    marcar(efeito.minimo, fonte);
  }
  const datas = [...marcos.keys()].sort();
  const pontos: { de: string | null; fonte: string; em: string }[] = [
    { de: null, fonte: "anterior", em: "0001-01-01" },
    ...datas.map((data) => ({ de: data, fonte: marcos.get(data)!.join("; "), em: data })),
  ];
  const saida: IntervaloVigencia[] = [];
  pontos.forEach((ponto, i) => {
    const { status, certo } = statusEm(ato, ponto.em, raiz);
    const anterior = saida.at(-1);
    if (anterior && anterior.status === status && anterior.certo === certo) {
      anterior.ate = pontos[i + 1]?.de ?? null;
      return;
    }
    saida.push({ de: ponto.de, ate: pontos[i + 1]?.de ?? null, status, certo, fonte: ponto.fonte });
  });
  return saida;
}

// ---------------------------------------------------------------------------------------------
// Regras de transição (`base-conhecimento/transicoes.yaml`)

const idAto = z.string().regex(/^[a-z0-9/-]+$/);
export const esquemaTransicao = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  norma: idAto,
  dispositivo: z.string().regex(/^#/),
  tipo: z.enum([
    "faculdade-de-adequacao",
    "prazo-de-adequacao",
    "direito-de-conclusao",
    "prazo-de-implantacao",
    "prazo-normativo",
    "ressalva-de-revogacao",
  ]),
  /** Norma revogada cujos efeitos a regra preserva (ou cuja adequação ela disciplina). */
  norma_anterior: idAto.optional(),
  aplica_a: z.string().min(1),
  regra: z.string().min(1),
  /** Marco inicial: vigência ou publicação da norma, ou data. */
  inicio: z.union([z.enum(["vigencia", "publicacao"]), z.string().regex(RE_DATA)]),
  /** Fim: duração ISO (P2Y, P180D), data, ou sem prazo. */
  fim: z.union([z.string().regex(/^P\d+[YMD]$/), z.string().regex(RE_DATA), z.literal("sem-prazo")]),
  evidencia: z.string().min(1),
});
export type Transicao = z.output<typeof esquemaTransicao>;
const esquemaTransicoes = z.strictObject({ transicoes: z.array(esquemaTransicao) });

export function caminhoTransicoes(raiz: string = raizRepositorio()): string {
  return path.join(raiz, "base-conhecimento", "transicoes.yaml");
}

export function carregarTransicoes(raiz: string = raizRepositorio()): Transicao[] {
  const arquivo = caminhoTransicoes(raiz);
  if (!existsSync(arquivo)) return [];
  return esquemaTransicoes.parse(parse(readFileSync(arquivo, "utf-8"), { schema: "failsafe", uniqueKeys: true }))
    .transicoes;
}

function somarDuracao(data: string, duracao: string): string {
  const m = /^P(\d+)([YMD])$/.exec(duracao)!;
  const quantidade = Number(m[1]);
  const [ano, mes, dia] = data.split("-").map(Number) as [number, number, number];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (m[2] === "Y") d.setUTCFullYear(d.getUTCFullYear() + quantidade);
  else if (m[2] === "M") d.setUTCMonth(d.getUTCMonth() + quantidade);
  else d.setUTCDate(d.getUTCDate() + quantidade);
  return d.toISOString().slice(0, 10);
}

/** Datas de uma regra de transição que não dependem da data da consulta. */
export interface DatasTransicao {
  inicio_em: string | null;
  inicio_minimo: string | null;
  fim_em: string | null;
}

export type Situacao = "a-iniciar" | "em-curso" | "encerrada" | "a confirmar";

export interface SituacaoTransicao extends Transicao, DatasTransicao {
  /** Situação na data: `a-iniciar`, `em-curso`, `encerrada` ou `a confirmar`. */
  situacao: Situacao;
}

/** Início e fim resolvidos de uma regra de transição (pelas datas da norma que a estabelece). */
export function datasTransicao(transicao: Transicao, raiz: string = raizRepositorio()): DatasTransicao {
  const datas = carregarDatas(raiz).get(transicao.norma);
  let inicio: Inicio;
  if (RE_DATA.test(transicao.inicio)) inicio = { data: transicao.inicio, minimo: transicao.inicio, certo: true };
  else if (transicao.inicio === "publicacao" && datas && RE_DATA.test(datas.publicada_em)) {
    inicio = { data: datas.publicada_em, minimo: datas.publicada_em, certo: true };
  } else if (transicao.inicio === "publicacao")
    inicio = { data: null, minimo: datas?.assinada_em ?? null, certo: false };
  else inicio = inicioVigencia(transicao.norma, raiz);
  const fim =
    inicio.data === null || transicao.fim === "sem-prazo"
      ? null
      : RE_DATA.test(transicao.fim)
        ? transicao.fim
        : somarDuracao(inicio.data, transicao.fim);
  return { inicio_em: inicio.data, inicio_minimo: inicio.minimo, fim_em: fim };
}

/**
 * Situação de uma regra de transição na data `data`, a partir das datas resolvidas: a regra única,
 * aplicada sobre os arquivos (`situacaoTransicao`) e sobre o `kb.sqlite` (tabela `transicoes`).
 */
export function situacaoNaData(t: DatasTransicao & { fim: string }, data: string): Situacao {
  if (t.inicio_em === null) {
    if (t.inicio_minimo && data < t.inicio_minimo) return "a-iniciar";
    // com o início a confirmar, só um fim em data fixa permite dizer que a regra acabou
    if (t.inicio_minimo !== null && RE_DATA.test(t.fim) && data > t.fim) return "encerrada";
    return A_CONFIRMAR;
  }
  if (data < t.inicio_em) return "a-iniciar";
  if (t.fim_em !== null && data > t.fim_em) return "encerrada";
  return "em-curso";
}

/** Situação de uma regra de transição numa data. */
export function situacaoTransicao(
  transicao: Transicao,
  data: string,
  raiz: string = raizRepositorio(),
): SituacaoTransicao {
  const datas = datasTransicao(transicao, raiz);
  return { ...transicao, ...datas, situacao: situacaoNaData({ ...datas, fim: transicao.fim }, data) };
}

/** Regras de transição da norma `id` ou que preservam efeitos dela (norma anterior). */
export function transicoesAplicaveis(id: string, data: string, raiz: string = raizRepositorio()): SituacaoTransicao[] {
  const ato = idDoAto(id.split("#")[0]!);
  return carregarTransicoes(raiz)
    .filter((t) => t.norma === ato || t.norma_anterior === ato)
    .map((t) => situacaoTransicao(t, data, raiz));
}

// ---------------------------------------------------------------------------------------------
// Linhas normativas (marcos da revisar-ppc)

export interface LinhaDerivada {
  /** Ato vigente na data: fim da cadeia de revogações totais a partir do ato mais recente da linha. */
  vigente: string;
  /** Atos revogados no todo pelo vigente. */
  substitui: string[];
  /** Demais atos da linha e atos revogados no todo pelos substituídos (sem o vigente e `substitui`). */
  antecessoras_historicas: string[];
  /** Dispositivos revogados pelo vigente ou revogados no próprio vigente (`ato#dispositivo`). */
  dispositivos_revogados: string[];
}

/**
 * Deriva vigente, substituídas, antecessoras e dispositivos revogados de uma linha normativa (atos
 * de um mesmo tema, do mais antigo ao mais recente conhecido) a partir de `relacoes.yaml`, na data
 * `data`. Uma nova norma que revogue o ato mais recente passa a ser a vigente sem editar a linha.
 */
export function derivarLinha(linha: readonly string[], data: string, raiz: string = raizRepositorio()): LinhaDerivada {
  if (linha.length === 0) throw new Error("linha normativa vazia");
  const relacoes = carregarRelacoes(raiz).filter((r) => r.tipo === "revoga");
  const emVigor = (r: Relacao) => ocorreu(efeitoDaRelacao(r, raiz), data) !== false;
  const revogadoPor = (ato: string) => relacoes.find((r) => r.alvo === ato && !relacaoParcial(r) && emVigor(r));
  let vigente = linha.at(-1)!;
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
    if (ato !== vigente && !substitui.includes(ato) && !historicas.includes(ato)) historicas.push(ato);
  }
  return {
    vigente,
    substitui,
    antecessoras_historicas: historicas,
    dispositivos_revogados: [...new Set(dispositivos_revogados)],
  };
}
