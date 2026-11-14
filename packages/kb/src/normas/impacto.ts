/**
 * `kb impacto <id>` (fase 5): o que uma mudança na norma `id` (revogação, alteração, nova redação)
 * atinge na base e nas skills.
 *
 * - normas: relações de `relacoes.yaml` (quem a revoga, altera, regulamenta ou nela se
 *   fundamenta) e dispositivos de outras normas da base que a citam no texto;
 * - sucessora e correspondência: se a norma foi revogada no todo, a norma que a revogou, as regras
 *   de transição e os dispositivos correspondentes (tabela de correspondência);
 * - fichas e validações cruzadas da `revisar-ppc`: referência estruturada à norma, referência a um
 *   dispositivo correspondente da sucessora, ou citação no texto (resolvedor de citações);
 * - outros textos de conteúdo das skills (prompts, contratos, taxonomia, marcos): citação no texto;
 * - PPCs convertidos que citam a norma (`kb citacoes`).
 *
 * Os arquivos de conteúdo podem vir de outra árvore (`raizConteudo`, por exemplo um `git archive` de
 * um commit antigo), para medir o impacto contra uma revisão real; o registro, as relações e a
 * correspondência vêm sempre de `raiz`.
 *
 * A regra é `impactoEm`, pura, sobre uma `FonteImpacto` já carregada; o serviço `Impacto` a monta
 * a partir de `FontesNormativas` (arquivos do checkout ou `kb.sqlite`) e do banco. O banco guarda as
 * fichas da `revisar-ppc`, mas não os outros textos das skills: sobre `FontesNormativas.layerBanco`,
 * `arquivos` traz só as fichas.
 */
import type { PpcCitante } from "../ppcs/citacoes.ts";
import type { CitacaoResolvida } from "./citacoes-normas.ts";
import { citacoesResolvidas } from "./citacoes-normas.ts";
import { correspondenciaEm, destinosDeOrigemEm, type FonteCorrespondencia } from "./correspondencia.ts";
import { idDoAto } from "./ids.ts";
import type { Registro } from "./registro.ts";
import { type Relacao, sucessorasDe } from "./relacoes.ts";
import { type RaizOuFonte, statusEm, transicoesAplicaveis } from "./vigencia.ts";

export type MotivoImpacto =
  | "referencia"
  | "referencia-correspondente"
  | "citacao"
  | "citacao-sucessora"
  /** A ficha pertence a um tópico cujos termos aparecem em dispositivos com mudança material. */
  | "tema";

export interface ArquivoAfetado {
  /** Caminho relativo à raiz do conteúdo. */
  arquivo: string;
  categoria: "ficha" | "validacao-cruzada" | "conteudo-skill";
  motivos: MotivoImpacto[];
  /** Dispositivos citados (da norma ou correspondentes da sucessora). */
  dispositivos: string[];
  /** Tópicos da taxonomia das fichas atingidos (motivo `tema`). */
  topicos?: string[];
}

export interface ResultadoImpacto {
  id: string;
  titulo: string | null;
  data_referencia: string;
  status: string;
  sucessoras: string[];
  transicoes: string[];
  relacoes: { tipo: string; origem: string; operador: string | null; alvo: string; alvo_dispositivo: string | null }[];
  normas_que_citam: { id: string; dispositivos: string[] }[];
  arquivos: ArquivoAfetado[];
  ppcs: { total: number; ids: string[] };
  /** Tópicos das fichas cujos termos de busca aparecem em dispositivos com mudança material. */
  topicos_atingidos: string[];
}

function semAcentoMinusculo(texto: string): string {
  return texto
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Tópico da taxonomia das fichas (`topicos-fichas.json`), como o impacto o lê. */
export interface TopicoTaxonomia {
  id: string;
  termos_busca?: string[];
  fichas?: string[];
}

/**
 * O que o impacto lê, já carregado: o serviço `Impacto` monta a fonte a partir de `FontesNormativas`
 * (arquivos do checkout ou `kb.sqlite`) e do banco. `dispositivosDoAto`, `segmentosCitantes` e
 * `ppcsQueCitam` só são pedidos para a norma em análise.
 */
export interface FonteImpacto {
  registro: Registro;
  /** Fonte da vigência (`statusEm`, `transicoesAplicaveis`). */
  vigencia: RaizOuFonte;
  dataReferencia(): string;
  relacoes(): readonly Relacao[];
  correspondencia: FonteCorrespondencia;
  /** Dispositivos do ato (pela deduplicação de `dispositivosDoAto`), em ordem, com o texto. */
  dispositivosDoAto(ato: string): { dispositivo: string; texto: string }[];
  /** Tópicos de `topicos-fichas.json`, na ordem do arquivo (vazio sem a taxonomia). */
  topicos(): TopicoTaxonomia[];
  /** Arquivos de conteúdo das skills (caminho relativo à raiz do conteúdo e texto), em ordem. */
  arquivosConteudo(): Iterable<{ arquivo: string; texto: string }>;
  /** Segmentos das normas da base que não são do ato `excetoAto`, com as citações resolvidas. */
  segmentosCitantes(
    excetoAto: string,
  ): Iterable<{ norma: string; ato: string; segmento: string; citacoes: CitacaoResolvida[] }>;
  ppcsQueCitam(id: string): PpcCitante[];
}

/**
 * Tópicos da taxonomia das fichas (`topicos-fichas.json`) atingidos: algum termo de busca do
 * tópico aparece num dispositivo da norma com mudança material (correspondência `parcial` ou
 * `sem-equivalente`; sem tabela, qualquer dispositivo). Sinal temático, mais largo que a citação.
 */
function topicosAtingidos(ato: string, fonte: FonteImpacto): Map<string, { fichas: string[] }> {
  const saida = new Map<string, { fichas: string[] }>();
  const taxonomia = fonte.topicos();
  if (!taxonomia.length) return saida;
  const dispositivos = fonte.dispositivosDoAto(ato);
  const comTabela = fonte.correspondencia.tabelas(ato).length > 0;
  const materiais = comTabela
    ? dispositivos.filter((d) =>
        correspondenciaEm(`${ato}${d.dispositivo}`, fonte.correspondencia).some((c) => c.item.tipo !== "equivalente"),
      )
    : dispositivos;
  const texto = semAcentoMinusculo(materiais.map((d) => d.texto).join("\n"));
  for (const topico of taxonomia) {
    if (topico.id === "referencias_normativas" || topico.id === "sintese_transversal_revisao") continue;
    const termos = (topico.termos_busca ?? []).map(semAcentoMinusculo).filter((t) => t.length >= 4);
    if (termos.some((termo) => new RegExp(`\\b${termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(texto))) {
      saida.set(topico.id, { fichas: topico.fichas ?? [] });
    }
  }
  return saida;
}

function textosDoJson(valor: unknown, saida: string[] = []): string[] {
  if (typeof valor === "string") saida.push(valor);
  else if (Array.isArray(valor)) for (const item of valor) textosDoJson(item, saida);
  else if (valor && typeof valor === "object") for (const item of Object.values(valor)) textosDoJson(item, saida);
  return saida;
}

interface RefEstruturada {
  ref: string;
  dispositivo?: string;
}

function referenciasEstruturadas(json: unknown): RefEstruturada[] {
  const saida: RefEstruturada[] = [];
  const visitar = (valor: unknown) => {
    if (Array.isArray(valor)) valor.forEach(visitar);
    else if (valor && typeof valor === "object") {
      const objeto = valor as Record<string, unknown>;
      if (typeof objeto.ref === "string") {
        saida.push({
          ref: objeto.ref,
          ...(typeof objeto.dispositivo === "string" ? { dispositivo: objeto.dispositivo } : {}),
        });
      }
      Object.values(objeto).forEach(visitar);
    }
  };
  visitar(json);
  return saida;
}

function categoria(arquivo: string): ArquivoAfetado["categoria"] {
  if (arquivo.includes("/fichas/")) return "ficha";
  if (arquivo.includes("/validacoes-cruzadas/")) return "validacao-cruzada";
  return "conteudo-skill";
}

/** Impacto da mudança na norma `id` (ato; o dispositivo, se houver, restringe as citações). */
export function impactoEm(
  id: string,
  fonte: FonteImpacto,
  opcoes: { data?: string; incluirPpcs?: boolean } = {},
): ResultadoImpacto {
  const registro = fonte.registro;
  const [norma, sufixo] = id.split("#") as [string, string | undefined];
  const ato = idDoAto(norma);
  const data = opcoes.data ?? fonte.dataReferencia();
  const vigencia = statusEm(ato, data, fonte.vigencia);
  const relacoes = fonte.relacoes().filter((r) => r.origem === ato || r.alvo === ato);
  const sucessoras = sucessorasDe(ato, relacoes);
  // dispositivos de destino que correspondem ao ato ou, com sufixo, ao dispositivo consultado e aos subordinados
  const correspondentes = destinosDeOrigemEm(sufixo ? `${ato}#${sufixo}` : ato, fonte.correspondencia);
  /** O dispositivo citado é o consultado ou um subordinado dele (`#art2` não casa `#art29`). */
  const noDispositivo = (d: string | undefined) => !!d && (d === `#${sufixo}` || d.startsWith(`#${sufixo}-`));
  const transicoes = transicoesAplicaveis(ato, data, fonte.vigencia).map((t) => t.id);

  const citaLista = (
    citacoes: readonly CitacaoResolvida[],
  ): { cita: boolean; dispositivos: string[]; sucessora: boolean } => {
    let cita = false;
    let sucessora = false;
    const dispositivos: string[] = [];
    for (const c of citacoes) {
      const alvo = idDoAto(c.id);
      const lista = c.dispositivos;
      if (alvo === ato) {
        if (sufixo && !lista.some(noDispositivo)) continue;
        cita = true;
        dispositivos.push(...lista.map((d) => `${ato}${d}`));
      } else if (sucessoras.includes(alvo) && lista.some((d) => correspondentes.has(`${alvo}${d}`))) {
        sucessora = true;
        dispositivos.push(...lista.filter((d) => correspondentes.has(`${alvo}${d}`)).map((d) => `${alvo}${d}`));
      }
    }
    return { cita, dispositivos, sucessora };
  };
  const citaAto = (texto: string) => citaLista(citacoesResolvidas(texto, registro));

  const topicos = sufixo ? new Map<string, { fichas: string[] }>() : topicosAtingidos(ato, fonte);
  const topicosPorFicha = new Map<string, string[]>();
  for (const [topico, { fichas }] of topicos) {
    for (const ficha of fichas) topicosPorFicha.set(ficha, [...(topicosPorFicha.get(ficha) ?? []), topico]);
  }

  const arquivos: ArquivoAfetado[] = [];
  for (const { arquivo, texto } of fonte.arquivosConteudo()) {
    const motivos = new Set<MotivoImpacto>();
    const dispositivos = new Set<string>();
    let textos = texto;
    if (arquivo.endsWith(".json")) {
      let json: unknown;
      try {
        json = JSON.parse(texto);
      } catch {
        json = null;
      }
      if (json !== null) {
        textos = textosDoJson(json).join("\n");
        for (const ref of referenciasEstruturadas(json)) {
          if (idDoAto(ref.ref) === ato && (!sufixo || noDispositivo(ref.dispositivo))) {
            motivos.add("referencia");
            if (ref.dispositivo) dispositivos.add(`${ato}${ref.dispositivo}`);
          } else if (
            sucessoras.includes(ref.ref) &&
            ref.dispositivo &&
            correspondentes.has(`${ref.ref}${ref.dispositivo}`)
          ) {
            motivos.add("referencia-correspondente");
            dispositivos.add(`${ref.ref}${ref.dispositivo}`);
          }
        }
      }
    }
    const citacoes = citaAto(textos);
    if (citacoes.cita) motivos.add("citacao");
    if (citacoes.sucessora) motivos.add("citacao-sucessora");
    for (const d of citacoes.dispositivos) dispositivos.add(d);
    let topicosDaFicha: string[] | undefined;
    if (categoria(arquivo) === "ficha") {
      const fichaId = arquivo
        .slice(arquivo.lastIndexOf("/") + 1)
        .replace(/\.json$/, "")
        .toUpperCase();
      topicosDaFicha = topicosPorFicha.get(fichaId);
      if (topicosDaFicha) motivos.add("tema");
    }
    if (motivos.size) {
      arquivos.push({
        arquivo,
        categoria: categoria(arquivo),
        motivos: [...motivos],
        dispositivos: [...dispositivos].sort(),
        ...(topicosDaFicha ? { topicos: topicosDaFicha } : {}),
      });
    }
  }

  // Normas da base que citam a norma: dispositivos e preâmbulo (fundamento citado nos considerandos).
  const normasQueCitam = new Map<string, Set<string>>();
  for (const segmento of fonte.segmentosCitantes(ato)) {
    if (segmento.ato === ato || !citaLista(segmento.citacoes).cita) continue;
    const lista = normasQueCitam.get(segmento.norma) ?? new Set<string>();
    lista.add(segmento.segmento);
    normasQueCitam.set(segmento.norma, lista);
  }

  const ppcs = opcoes.incluirPpcs === false ? [] : fonte.ppcsQueCitam(id);
  return {
    id,
    titulo: registro.obter(ato)?.title ?? null,
    data_referencia: data,
    status: `${vigencia.status}${vigencia.certo ? "" : " (a confirmar)"}`,
    sucessoras,
    transicoes,
    relacoes: relacoes.map((r) => ({
      tipo: r.tipo,
      origem: r.origem,
      operador: r.operador ?? null,
      alvo: r.alvo,
      alvo_dispositivo: r.alvo_dispositivo ?? null,
    })),
    normas_que_citam: [...normasQueCitam].map(([n, d]) => ({ id: n, dispositivos: [...d] })),
    arquivos,
    ppcs: { total: ppcs.length, ids: ppcs.map((p) => p.ppc) },
    topicos_atingidos: [...topicos.keys()],
  };
}
