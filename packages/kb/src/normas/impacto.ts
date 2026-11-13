/**
 * `kb impacto <id>` (fase 5): o que uma mudança na norma `id` (revogação, alteração, nova redação)
 * atinge na base e nas skills.
 *
 * - normas: relações de `relacoes.yaml` (quem a revoga, altera, regulamenta ou nela se
 *   fundamenta) e dispositivos de outras normas da base que a citam no texto;
 * - sucessora e correspondência: se a norma foi revogada no todo, a norma que a revogou, as regras
 *   de transição e os dispositivos correspondentes (tabela de correspondência);
 * - fichas e validações cruzadas da `analise-ppc`: referência estruturada à norma, referência a um
 *   dispositivo correspondente da sucessora, ou citação no texto (resolvedor de citações);
 * - outros textos de conteúdo das skills (prompts, contratos, taxonomia, marcos): citação no texto;
 * - PPCs convertidos que citam a norma (`kb citacoes`).
 *
 * Os arquivos de conteúdo podem vir de outra árvore (`raizConteudo`, por exemplo um `git archive` de
 * um commit antigo), para medir o impacto contra uma revisão real; o registro, as relações e a
 * correspondência vêm sempre de `raiz`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { carregarCorrespondencias, correspondencia, destinosDeOrigem } from "./correspondencia.ts";
import { carregarEstruturas, dispositivosDoAto } from "./estrutura.ts";
import { idDoAto } from "./ids.ts";
import { carregarRegistro, raizRepositorio, type Registro } from "./registro.ts";
import { carregarRelacoes, relacaoParcial } from "./relacoes.ts";
import { extrairCitacoes } from "./resolver.ts";
import { dataReferencia, statusEm, transicoesAplicaveis } from "./vigencia.ts";
import { ppcsQueCitam } from "../ppcs/citacoes.ts";

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

/**
 * Tópicos da taxonomia das fichas (`topicos-fichas.json`) atingidos: algum termo de busca do
 * tópico aparece num dispositivo da norma com mudança material (correspondência `parcial` ou
 * `sem-equivalente`; sem tabela, qualquer dispositivo). Sinal temático, mais largo que a citação.
 */
function topicosAtingidos(ato: string, raiz: string, raizConteudo: string): Map<string, { fichas: string[] }> {
  const arquivo = path.join(raizConteudo, ".agents", "skills", "analise-ppc", "base-analise", "topicos-fichas.json");
  const saida = new Map<string, { fichas: string[] }>();
  if (!existsSync(arquivo)) return saida;
  const taxonomia = JSON.parse(readFileSync(arquivo, "utf-8")) as {
    topicos?: { id: string; termos_busca?: string[]; fichas?: string[] }[];
  };
  const dispositivos = dispositivosDoAto(ato, raiz);
  const comTabela = carregarCorrespondencias(raiz).some((t) => t.origem === ato);
  const materiais = comTabela
    ? dispositivos.filter((d) =>
        correspondencia(`${ato}${d.dispositivo}`, raiz).some((c) => c.item.tipo !== "equivalente"),
      )
    : dispositivos;
  const texto = semAcentoMinusculo(materiais.map((d) => d.texto).join("\n"));
  for (const topico of taxonomia.topicos ?? []) {
    if (topico.id === "referencias_normativas" || topico.id === "sintese_transversal_parecer") continue;
    const termos = (topico.termos_busca ?? []).map(semAcentoMinusculo).filter((t) => t.length >= 4);
    if (termos.some((termo) => new RegExp(`\\b${termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(texto))) {
      saida.set(topico.id, { fichas: topico.fichas ?? [] });
    }
  }
  return saida;
}

/** Arquivos de conteúdo (`.json`, `.md`, `.yaml`) das skills, sem código, testes, schemas, READMEs e gerados. */
export function arquivosConteudoSkills(raizConteudo: string): string[] {
  const base = path.join(raizConteudo, ".agents", "skills");
  if (!existsSync(base)) return [];
  const saida: string[] = [];
  const ignorar = new Set(["scripts", "tests", "schemas", "node_modules", "__pycache__", "referencias"]);
  const gerados = new Set(["indice.json", "mapa-fichas.md"]);
  const visitar = (dir: string) => {
    for (const nome of readdirSync(dir).sort()) {
      const caminho = path.join(dir, nome);
      if (statSync(caminho).isDirectory()) {
        if (!ignorar.has(nome)) visitar(caminho);
        continue;
      }
      if (!/\.(json|md|yaml|yml)$/.test(nome) || /^README/i.test(nome) || gerados.has(nome)) continue;
      saida.push(path.relative(raizConteudo, caminho).split(path.sep).join("/"));
    }
  };
  visitar(base);
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

/** Impacto de uma mudança na norma `id` (ato; o dispositivo, se houver, restringe as citações). */
export function impacto(
  id: string,
  opcoes: { raiz?: string; raizConteudo?: string; data?: string; incluirPpcs?: boolean } = {},
): ResultadoImpacto {
  const raiz = opcoes.raiz ?? raizRepositorio();
  const raizConteudo = opcoes.raizConteudo ?? raiz;
  const registro: Registro = carregarRegistro(raiz);
  const [norma, sufixo] = id.split("#") as [string, string | undefined];
  const ato = idDoAto(norma);
  const data = opcoes.data ?? dataReferencia(raiz);
  const vigencia = statusEm(ato, data, raiz);
  const relacoes = carregarRelacoes(raiz).filter((r) => r.origem === ato || r.alvo === ato);
  const sucessoras = relacoes
    .filter((r) => r.tipo === "revoga" && r.alvo === ato && !relacaoParcial(r))
    .map((r) => r.origem);
  const correspondentes = destinosDeOrigem(ato, raiz);
  const transicoes = transicoesAplicaveis(ato, data, raiz).map((t) => t.id);

  const citaAto = (texto: string): { cita: boolean; dispositivos: string[]; sucessora: boolean } => {
    let cita = false;
    let sucessora = false;
    const dispositivos: string[] = [];
    for (const c of extrairCitacoes(texto, registro)) {
      if (c.id === null) continue;
      const alvo = idDoAto(c.id);
      const lista = c.dispositivos ?? (c.dispositivoId ? [c.dispositivoId] : []);
      if (alvo === ato) {
        if (sufixo && !lista.some((d) => d === `#${sufixo}` || d.startsWith(`#${sufixo}-`))) continue;
        cita = true;
        dispositivos.push(...lista.map((d) => `${ato}${d}`));
      } else if (sucessoras.includes(alvo) && lista.some((d) => correspondentes.has(`${alvo}${d}`))) {
        sucessora = true;
        dispositivos.push(...lista.filter((d) => correspondentes.has(`${alvo}${d}`)).map((d) => `${alvo}${d}`));
      }
    }
    return { cita, dispositivos, sucessora };
  };

  const topicos = sufixo ? new Map<string, { fichas: string[] }>() : topicosAtingidos(ato, raiz, raizConteudo);
  const topicosPorFicha = new Map<string, string[]>();
  for (const [topico, { fichas }] of topicos) {
    for (const ficha of fichas) topicosPorFicha.set(ficha, [...(topicosPorFicha.get(ficha) ?? []), topico]);
  }

  const arquivos: ArquivoAfetado[] = [];
  for (const arquivo of arquivosConteudoSkills(raizConteudo)) {
    const texto = readFileSync(path.join(raizConteudo, arquivo), "utf-8");
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
          if (idDoAto(ref.ref) === ato && (!sufixo || ref.dispositivo?.startsWith(`#${sufixo}`))) {
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
      const fichaId = path.basename(arquivo, ".json").toUpperCase();
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
  for (const estrutura of carregarEstruturas(raiz)) {
    if (estrutura.ato === ato) continue;
    for (const segmento of estrutura.segmentos) {
      if (segmento.tipo !== "dispositivo" && segmento.tipo !== "preambulo") continue;
      if (!citaAto(segmento.texto).cita) continue;
      const lista = normasQueCitam.get(estrutura.id) ?? new Set<string>();
      lista.add(segmento.dispositivo ? segmento.dispositivo.slice(segmento.dispositivo.indexOf("#")) : "preâmbulo");
      normasQueCitam.set(estrutura.id, lista);
    }
  }

  const ppcs = opcoes.incluirPpcs === false ? [] : ppcsQueCitam(id, { registro, raiz });
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
