#!/usr/bin/env bun
/**
 * Compila o `kb.sqlite` a partir dos arquivos do checkout (fase 6 do plano).
 *
 *   bun run kb:compilar [--destino tmp/kb.sqlite] [--versao 2026.11.13] [--commit <sha>] [--canal piloto]
 *
 * O banco é derivado e fica fora do git (`tmp/`). Determinismo: as mesmas fontes geram o mesmo
 * arquivo, byte a byte. Para isso:
 * - toda leitura é ordenada por code point (caminhos, IDs) e os `rowid` saem dessa ordem;
 * - nada vem do relógio (nem a data do build: `meta` guarda versão do esquema, data de referência e
 *   hashes das fontes; `versao`, `commit` e `canal` só quando informados, e então vêm de quem builda);
 * - `page_size` fixo, um único `INSERT` por linha numa transação, `optimize` do FTS5 e `VACUUM` no
 *   fim, que reescreve as páginas na ordem lógica e zera o espaço livre;
 * - o arquivo é escrito num temporário e renomeado (quem lê nunca vê um banco pela metade).
 * O teste `base.test.ts` compila duas vezes e compara o SHA-256 dos arquivos.
 */
import { Database, type Statement } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, utimesSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { expansaoDoTipo, lerSinonimos, type Sinonimos } from "../busca/sinonimos.ts";
import { radicais } from "../busca/tokens.ts";
import { cruzarPpcSuap } from "../fatos/divergencias.ts";
import { extrairFatosPpc, type SecaoDoPpc } from "../fatos/ppc.ts";
import { carregarDadosInstitucionaisKb, linhaDaChave, matrizesDoResumo } from "../institucional/dados.ts";
import { analisarFrontMatter } from "../normas/front-matter.ts";
import { idDoAto } from "../normas/ids.ts";
import {
  caminhoStubs,
  carregarRegistro,
  lerRegistroStubs,
  raizRepositorio,
  type Registro,
} from "../normas/registro.ts";
import { segmentosCitantes } from "../normas/citacoes-normas.ts";
import { extrairCitacoes } from "../normas/resolver.ts";
import { dataReferencia, derivarLinha } from "../normas/vigencia.ts";
import { mascararFrontMatter } from "../ppcs/front-matter.ts";
import { lerTextoSecao } from "../ppcs/citacoes.ts";
import { type NomeTaxonomia, secoesComChave, secoesIndexadas } from "../ppcs/secoes.ts";
import { compararTexto } from "../texto.ts";
import { DDL, VERSAO_ESQUEMA } from "./esquema.ts";
import { arquivosFonte, hashConteudo, hashLista } from "./fontes.ts";
import {
  esquemaLinhaCorrespondencia,
  esquemaLinhaDispositivo,
  esquemaLinhaRelacao,
  esquemaLinhaTabelaCorrespondencia,
  esquemaLinhaTransicao,
  esquemaLinhaVigencia,
  type FontesNormativas,
} from "./fontes-normativas.ts";
import { fontesNormativasArquivos } from "../normas/fontes-db.ts";
import { lerTopicosSecoes, type TopicosSecoes } from "./pacote-contexto.ts";

export const PAGE_SIZE = 4096;

export function caminhoBancoPadrao(raiz: string = raizRepositorio()): string {
  return process.env.KB_SQLITE ? path.resolve(process.env.KB_SQLITE) : path.join(raiz, "tmp", "kb.sqlite");
}

export interface OpcoesCompilacao {
  raiz?: string;
  destino?: string;
  /** Carga da fase 5 (padrão: `fontesNormativasArquivos(raiz)`, pela API de `normas/`). */
  fontesNormativas?: FontesNormativas;
  /** Léxico de sinônimos (padrão: `packages/kb/dados/sinonimos.yaml`). */
  sinonimos?: Sinonimos;
  /** Tópicos das fichas → tipos de seção (padrão: `packages/kb/dados/topicos-secoes.yaml`). */
  topicosSecoes?: TopicosSecoes;
  /**
   * Identificação do build, gravada em `meta` só quando informada (sem ela, o banco depende só das
   * fontes): `versao` (como `2026.11.13`), `commit` (o SHA das fontes) e `canal` (`piloto`...).
   */
  versao?: string;
  commit?: string;
  canal?: string;
}

export interface ResumoCompilacao {
  destino: string;
  fontes: number;
  fontes_sha256: string;
  contagens: Record<string, number>;
}

const BASE = "base-conhecimento";
const ANALISE = ".agents/skills/revisar-ppc/base-analise";

const json = (valor: unknown): string => JSON.stringify(valor ?? null);

function lerJson(arquivo: string): unknown {
  return JSON.parse(readFileSync(arquivo, "utf-8"));
}

/* ---------------------------------------------------------- esquemas de leitura */

const esquemaManifest = z.array(
  z.looseObject({
    id: z.string(),
    title: z.string(),
    tipo_documento: z.string().optional(),
    numero: z.union([z.string(), z.number()]).optional(),
    ano: z.number().int().optional(),
    data_publicacao: z.string().optional(),
    orgao: z.string().optional(),
    jurisdicao: z.string().optional(),
    ementa: z.string().optional(),
    status_vigencia: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    aliases: z.array(z.string()).optional(),
    fonte: z.string().optional(),
    path: z.string(),
  }),
);

const esquemaIndicePpcs = z.looseObject({
  items: z.array(
    z.looseObject({
      id: z.string(),
      campus_id: z.string(),
      campus_nome: z.string(),
      curso_slug: z.string(),
      curso_nome: z.string(),
      nivel: z.string(),
      taxonomia: z.string().optional(),
      tipo_oferta: z.string(),
      curso_url: z.string().optional(),
      fonte_pdf: z.string().optional(),
      path: z.string(),
      proveniencia: z.unknown().optional(),
      ano_documento: z.number().int().optional(),
    }),
  ),
  secoes: z.looseObject({ paths: z.record(z.string(), z.string()) }),
});

const esquemaSecaoJsonl = z.looseObject({
  id: z.string(),
  ppc_id: z.string(),
  section_kind: z.string(),
  origem_tipo: z.string().optional(),
  heading: z.string(),
  numeracao: z.string().nullable().optional(),
  path: z.string(),
  linha_inicio: z.number().int(),
  linha_fim: z.number().int(),
});

const esquemaCnctIndice = z.looseObject({
  items: z.array(
    z.looseObject({
      id: z.string(),
      denominacao: z.string(),
      eixo_tecnologico: z.string(),
      area_tecnologica: z.string().optional(),
      carga_horaria_minima_horas: z.number().optional(),
      path: z.string().optional(),
    }),
  ),
});

const esquemaFicha = z.looseObject({
  id: z.string(),
  titulo: z.string(),
  dominio: z.string().optional(),
  criticidade: z.string().optional(),
  tipo_escopo: z.string().optional(),
  pergunta: z.string().optional(),
  rubrica: z.string().optional(),
  topicos_tematicos: z.array(z.string()).optional(),
  referencias_normativas: z
    .array(
      z.looseObject({
        ref: z.string(),
        dispositivo: z.string().optional(),
        papel: z.string(),
        nota: z.string().optional(),
      }),
    )
    .optional(),
});

const esquemaTopicos = z.looseObject({
  topicos: z.array(
    z.looseObject({
      id: z.string(),
      titulo: z.string(),
      grupo: z.string().optional(),
      tipo_escopo: z.string().optional(),
      descricao: z.string().optional(),
      aliases_titulo: z.array(z.string()).optional(),
      termos_busca: z.array(z.string()).optional(),
      fichas: z.array(z.string()).optional(),
    }),
  ),
});

const esquemaMarcos = z.looseObject({
  marcos: z.array(
    z.looseObject({
      id: z.string(),
      tema: z.string(),
      /** Atos do tema, do mais antigo ao mais recente conhecido (o resto é derivado: `derivarLinha`). */
      linha: z.array(z.string()).min(1),
      aplica_a: z.string().optional(),
      transicao: z.string().optional(),
      orientacao_analise: z.string().optional(),
    }),
  ),
});

/* ------------------------------------------------------------------- papel */

const RE_ROTULO_BIBLIOGRAFIA =
  /^[\s*_#>|-]*(?:\d+(?:\.\d+)*\.?\s*)?(?:bibliografias?|refer[eê]ncias(?: bibliogr[aá]ficas)?)\b/i;

/**
 * Papel de uma citação no PPC: `referencia-bibliografica` dentro da seção de referências do PPC ou
 * depois de um rótulo "Bibliografia"/"Referências" na mesma seção (ementário, regulamento);
 * `fundamento` no resto.
 */
export function papelDaCitacao(
  linhas: readonly string[],
  linha: number,
  secao: { tipo: string; linha_inicio: number } | null,
): "fundamento" | "referencia-bibliografica" {
  if (secao?.tipo === "referencias") return "referencia-bibliografica";
  const limite = secao ? secao.linha_inicio : Math.max(1, linha - 60);
  for (let l = linha; l >= limite; l -= 1) {
    const texto = linhas[l - 1] ?? "";
    if (RE_ROTULO_BIBLIOGRAFIA.test(texto)) return "referencia-bibliografica";
    if (!secao && /^#{1,6}\s/.test(texto) && l !== linha) break;
  }
  return "fundamento";
}

/* --------------------------------------------------------------- compilação */

export class Inseridor {
  private readonly cache = new Map<string, Statement>();
  readonly contagens: Record<string, number> = {};
  constructor(private readonly db: Database) {}

  inserir(tabela: string, linha: Record<string, unknown>): number {
    const colunas = Object.keys(linha);
    const chave = `${tabela}(${colunas.join(",")})`;
    let st = this.cache.get(chave);
    if (!st) {
      st = this.db.prepare(
        `INSERT INTO ${tabela} (${colunas.join(", ")}) VALUES (${colunas.map(() => "?").join(", ")})`,
      );
      this.cache.set(chave, st);
    }
    const valores = colunas.map((c) => {
      const v = linha[c];
      return v === undefined ? null : typeof v === "boolean" ? Number(v) : v;
    }) as (string | number | null)[];
    const resultado = st.run(...valores);
    this.contagens[tabela] = (this.contagens[tabela] ?? 0) + 1;
    return Number(resultado.lastInsertRowid);
  }
}

/** Seção de PPC a gravar em `secoes` e `secoes_fts` (texto integral já recortado). */
export interface SecaoParaGravar {
  id: string;
  tipo: string;
  origem_tipo: string | null;
  titulo: string;
  numeracao: string | null;
  linha_inicio: number;
  linha_fim: number;
  texto: string;
}

/**
 * Grava as seções de um PPC (com o FTS: tokens, radicais e expansão do léxico pelo tipo) e as
 * citações normativas do texto, cada uma com a seção e o papel. É o mesmo caminho da compilação do
 * banco e do banco em memória de um PPC fora da base (`bancoDoPpcAvulso`).
 */
export function gravarSecoesECitacoes(
  ins: Inseridor,
  p: {
    ppcId: string;
    caminhoMd: string;
    markdown: string;
    secoes: readonly SecaoParaGravar[];
    registro: Registro;
    lexico: Sinonimos;
    /** Cache da expansão por tipo de seção, compartilhado entre PPCs. */
    expansoes: Map<string, string>;
    insFts: Statement;
  },
): void {
  const linhas = p.markdown.split("\n");
  for (const secao of p.secoes) {
    let linhaTexto = secao.linha_inicio + 1;
    while (linhaTexto < secao.linha_fim && !linhas[linhaTexto - 1]!.trim()) linhaTexto += 1;
    const rowid = ins.inserir("secoes", {
      id: secao.id,
      ppc_id: p.ppcId,
      tipo: secao.tipo,
      origem_tipo: secao.origem_tipo,
      titulo: secao.titulo,
      numeracao: secao.numeracao,
      path: p.caminhoMd,
      linha_inicio: secao.linha_inicio,
      linha_fim: secao.linha_fim,
      linha_texto: linhaTexto,
      texto: secao.texto,
    });
    let expansao = p.expansoes.get(secao.tipo);
    if (expansao === undefined) {
      expansao = radicais(expansaoDoTipo(p.lexico, secao.tipo)).join(" ");
      p.expansoes.set(secao.tipo, expansao);
    }
    p.insFts.run(
      rowid,
      secao.titulo,
      secao.texto,
      radicais(secao.titulo).join(" "),
      radicais(secao.texto).join(" "),
      expansao,
    );
  }

  const secaoDaLinha = (linha: number) => {
    let achada: SecaoParaGravar | null = null;
    for (const s of p.secoes) {
      if (s.linha_inicio > linha) break;
      if (linha <= s.linha_fim) achada = s;
    }
    return achada;
  };
  const citacoes = extrairCitacoes(mascararFrontMatter(p.markdown), p.registro);
  citacoes.forEach((citacao, ordem) => {
    const secao = secaoDaLinha(citacao.linha);
    const dispositivos = citacao.dispositivos ?? (citacao.dispositivoId ? [citacao.dispositivoId] : []);
    ins.inserir("citacoes", {
      ppc_id: p.ppcId,
      ordem,
      linha: citacao.linha,
      trecho: citacao.trecho,
      norma_id: citacao.id,
      ato_id: citacao.id ? idDoAto(citacao.id) : null,
      dispositivos_json: json(dispositivos),
      regra: citacao.regra,
      confianca: citacao.confianca,
      situacao: citacao.situacao,
      secao_id: secao?.id ?? null,
      secao_tipo: secao?.tipo ?? null,
      papel: papelDaCitacao(
        linhas,
        citacao.linha,
        secao ? { tipo: secao.tipo, linha_inicio: secao.linha_inicio } : null,
      ),
      path: p.caminhoMd,
    });
  });
}

/** Opções do banco em memória de um PPC fora da base. */
export interface OpcoesPpcAvulso {
  /** ID do PPC no banco em memória (padrão `ppc:avulso`). */
  ppcId?: string;
  /** Caminho gravado em `path` (o `PPC.md` da rodada, por exemplo). */
  path?: string;
  taxonomia?: NomeTaxonomia;
  /** Palavras dos nomes de campi, para os cabeçalhos de página (`palavrasDeCampi`). */
  palavrasCampi?: ReadonlySet<string>;
  curso_nome?: string;
  campus_nome?: string;
  nivel?: string;
  tipo_oferta?: string;
  raiz?: string;
  sinonimos?: Sinonimos;
  registro?: Registro;
  /**
   * Grava também as seções que o índice publicado deixa de fora (`pretextual`, `outros` e as de
   * texto curto, com chave `<tipo>-x<n>`): numa minuta, a capa e os campos curtos da identificação
   * ("Forma de oferta: Subsequente") importam. Padrão: só as do índice, como no `kb.sqlite`.
   */
  todasAsSecoes?: boolean;
  /**
   * Reconhece `# Título` como título de seção. No índice publicado só `##` a `######` contam (nos
   * PPCs convertidos de PDF, `#` aparece em linhas da capa); o normalizador e o conversor DOCX da
   * `revisar-ppc` põem o primeiro nível numerado em `#`. A segmentação roda como se fosse `##`, com
   * as mesmas linhas.
   */
  titulosNivel1?: boolean;
}

/**
 * Banco em memória, com o esquema do `kb.sqlite`, só com um PPC que pode não estar na base (o
 * `PPC.md` de uma rodada da `revisar-ppc`): uma linha em `ppcs`, as seções pela mesma segmentação e
 * taxonomia do índice (`secoesIndexadas`) e as citações pelo mesmo resolvedor, gravadas por
 * `gravarSecoesECitacoes`. As consultas de seções (`secoesDoPpc`, `buscarSecoes`) e de citações
 * rodam nele sem mudança.
 */
export function bancoDoPpcAvulso(markdownOriginal: string, opcoes: OpcoesPpcAvulso = {}): Database {
  const markdown = markdownOriginal.replace(/\r\n?/g, "\n");
  const paraSegmentar = opcoes.titulosNivel1 ? markdown.replace(/^#(?=[ \t])/gm, "##") : markdown;
  const ppcId = opcoes.ppcId ?? "ppc:avulso";
  const caminhoMd = opcoes.path ?? "PPC.md";
  const taxonomia = opcoes.taxonomia ?? "tecnico";
  const db = new Database(":memory:", { strict: true });
  db.run(DDL);
  const ins = new Inseridor(db);
  db.transaction(() => {
    ins.inserir("ppcs", {
      id: ppcId,
      chave: ppcId.replace(/^ppc:/, ""),
      campus_id: "",
      campus_nome: opcoes.campus_nome ?? "",
      curso_slug: "",
      curso_nome: opcoes.curso_nome ?? "",
      curso_id: null,
      nivel: opcoes.nivel ?? "médio",
      taxonomia,
      tipo_oferta: opcoes.tipo_oferta ?? "",
      ano_documento: null,
      curso_url: null,
      fonte_pdf: null,
      path: caminhoMd,
      linhas: markdown.split("\n").length,
      caracteres: markdownOriginal.length,
      proveniencia_json: json(null),
    });
    gravarSecoesECitacoes(ins, {
      ppcId,
      caminhoMd,
      markdown,
      secoes: (opcoes.todasAsSecoes
        ? secoesComChave(paraSegmentar, taxonomia, opcoes.palavrasCampi)
        : secoesIndexadas(paraSegmentar, taxonomia, opcoes.palavrasCampi)
      ).map((secao) => ({
        id: `${ppcId}#${secao.chave}`,
        tipo: secao.tipo,
        origem_tipo: secao.origem,
        titulo: secao.titulo,
        numeracao: secao.numeracao,
        linha_inicio: secao.linhaInicio,
        linha_fim: secao.linhaFim,
        texto: secao.texto,
      })),
      // com o registro informado (modo banco), nada procura o checkout
      registro: opcoes.registro ?? carregarRegistro(opcoes.raiz ?? raizRepositorio()),
      lexico: opcoes.sinonimos ?? lerSinonimos(),
      expansoes: new Map(),
      insFts: db.prepare(
        "INSERT INTO secoes_fts (rowid, titulo, texto, titulo_radicais, radicais, expansao) VALUES (?, ?, ?, ?, ?, ?)",
      ),
    });
  })();
  return db;
}

function linhaNoYaml(conteudo: string, id: string): number {
  const linhas = conteudo.split("\n");
  const indice = linhas.findIndex((l) => l.trim() === `- id: ${id}`);
  return indice === -1 ? 1 : indice + 1;
}

export function compilarBanco(opcoes: OpcoesCompilacao = {}): ResumoCompilacao {
  const raiz = opcoes.raiz ?? raizRepositorio();
  const destino = opcoes.destino ?? caminhoBancoPadrao(raiz);
  const fontesNormativas = opcoes.fontesNormativas ?? fontesNormativasArquivos(raiz);
  const lexico = opcoes.sinonimos ?? lerSinonimos();
  const topicosSecoes = opcoes.topicosSecoes ?? lerTopicosSecoes();
  const base = path.join(raiz, BASE);

  // instante anterior à leitura das fontes: vira o mtime do banco no fim, para que uma fonte editada
  // durante a compilação fique mais nova que ele e o atalho por mtime de `estadoDoBanco` não o declare
  // fresco
  const leitura = new Date();
  const arquivos = arquivosFonte(raiz);
  const fontesSha = hashConteudo(raiz, arquivos);

  mkdirSync(path.dirname(destino), { recursive: true });
  const temporario = `${destino}.tmp-${process.pid}`;
  rmSync(temporario, { force: true });
  const db = new Database(temporario, { create: true, strict: true });
  // em caso de erro, fecha o banco e remove o temporário (até ~130 MB) antes de propagar
  let contagensInsercao: Record<string, number>;
  try {
    contagensInsercao = preencherBanco(db, {
      raiz,
      base,
      lexico,
      topicosSecoes,
      fontesNormativas,
      arquivos,
      fontesSha,
      versao: opcoes.versao,
      commit: opcoes.commit,
      canal: opcoes.canal,
    });
    db.close();
    utimesSync(temporario, leitura, leitura);
    renameSync(temporario, destino);
  } catch (erro) {
    db.close();
    rmSync(temporario, { force: true });
    throw erro;
  }
  const contagens = Object.fromEntries(
    Object.entries(contagensInsercao)
      .filter(([tabela]) => tabela !== "meta")
      .sort(([a], [b]) => compararTexto(a, b)),
  );
  return { destino, fontes: arquivos.length, fontes_sha256: fontesSha, contagens };
}

interface ContextoPreenchimento {
  raiz: string;
  base: string;
  lexico: Sinonimos;
  topicosSecoes: ReturnType<typeof lerTopicosSecoes>;
  fontesNormativas: FontesNormativas;
  arquivos: readonly string[];
  fontesSha: string;
  /** Identificação da distribuição gravada em `meta` (só quando informada). */
  versao?: string | undefined;
  commit?: string | undefined;
  canal?: string | undefined;
}

/** Esquema, carga de todas as tabelas, `optimize` do FTS5 e `VACUUM`; devolve as contagens por tabela. */
function preencherBanco(db: Database, c: ContextoPreenchimento): Record<string, number> {
  const { raiz, base, lexico, topicosSecoes, fontesNormativas, arquivos, fontesSha } = c;
  db.run(`PRAGMA page_size = ${PAGE_SIZE}`);
  db.run("PRAGMA journal_mode = OFF");
  db.run("PRAGMA synchronous = OFF");
  db.run("PRAGMA encoding = 'UTF-8'");
  db.run(`PRAGMA user_version = ${VERSAO_ESQUEMA}`);
  db.run(DDL);
  const ins = new Inseridor(db);

  db.transaction(() => {
    /* ---------- normas */
    const registro = carregarRegistro(raiz);
    const manifest = esquemaManifest.parse(lerJson(path.join(base, "manifest.json")));
    const insFtsNorma = db.prepare("INSERT INTO normas_fts (rowid, titulo, texto, radicais) VALUES (?, ?, ?, ?)");
    const blocoMetadados = (
      id: string,
      titulo: string,
      partes: (string | undefined)[],
      caminho: string,
      linha: number,
    ) => {
      const texto = partes.filter((p): p is string => Boolean(p)).join("\n");
      const rowid = ins.inserir("normas_metadados", { norma_id: id, texto, path: caminho, linha });
      insFtsNorma.run(rowid, titulo, texto, radicais(`${titulo}\n${texto}`).join(" "));
    };
    for (const item of [...manifest].sort((a, b) => compararTexto(a.id, b.id))) {
      const caminhoMd = `${BASE}/${item.path}`;
      const md = readFileSync(path.join(raiz, caminhoMd), "utf-8").replace(/\r\n?/g, "\n");
      const { meta } = analisarFrontMatter(md, caminhoMd);
      ins.inserir("normas", {
        id: item.id,
        situacao: "base",
        titulo: item.title,
        tipo_documento: item.tipo_documento,
        numero: item.numero === undefined ? null : String(item.numero),
        ano: item.ano,
        orgao: item.orgao,
        jurisdicao: item.jurisdicao,
        data_publicacao: item.data_publicacao,
        status_vigencia: item.status_vigencia,
        status_fonte: null,
        ementa: item.ementa,
        fonte: item.fonte,
        curadoria: null,
        path: caminhoMd,
        aliases_json: json(item.aliases ?? []),
        keywords_json: json(item.keywords ?? []),
        front_matter_json: json(meta),
      });
      blocoMetadados(
        item.id,
        item.title,
        [...(item.aliases ?? []), ...(item.keywords ?? []), item.ementa],
        caminhoMd,
        1,
      );
    }
    const arquivoStubs = caminhoStubs(raiz);
    if (existsSync(arquivoStubs)) {
      const conteudo = readFileSync(arquivoStubs, "utf-8");
      const stubs = lerRegistroStubs(arquivoStubs);
      const caminho = path.relative(raiz, arquivoStubs).split(path.sep).join("/");
      const todos = [
        ...stubs.normas.map((s) => ({ ...s, situacao: "stub" as const, ementa: s.ementa })),
        ...stubs.externos.map((s) => ({ ...s, situacao: "externo" as const, ementa: s.descricao })),
      ].sort((a, b) => compararTexto(a.id, b.id));
      for (const stub of todos) {
        ins.inserir("normas", {
          id: stub.id,
          situacao: stub.situacao,
          titulo: stub.title,
          data_publicacao: "data_publicacao" in stub ? stub.data_publicacao : null,
          status_vigencia: "status_vigencia" in stub ? stub.status_vigencia : null,
          status_fonte: "status_fonte" in stub ? stub.status_fonte : null,
          ementa: stub.ementa,
          fonte: stub.fonte,
          curadoria: stub.curadoria,
          path: null,
          aliases_json: json(stub.aliases ?? []),
          keywords_json: json([]),
          front_matter_json: null,
        });
        blocoMetadados(
          stub.id,
          stub.title,
          [...(stub.aliases ?? []), stub.ementa],
          caminho,
          linhaNoYaml(conteudo, stub.id),
        );
      }
    }

    /* ---------- institucional */
    const dados = carregarDadosInstitucionaisKb(raiz);
    for (const { arquivo, dados: c } of dados.campi) {
      ins.inserir("campi", {
        id: `campus:${c.campus_id}`,
        campus_id: c.campus_id,
        nome: c.nome,
        site: c.site,
        path: arquivo,
      });
    }
    const cnct = esquemaCnctIndice.parse(lerJson(path.join(base, "catalogos", "cnct", "index.json")));
    for (const item of [...cnct.items].sort((a, b) => compararTexto(a.id, b.id))) {
      const caminho = item.path ? `${BASE}/${item.path}` : null;
      const completo = caminho && existsSync(path.join(raiz, caminho)) ? lerJson(path.join(raiz, caminho)) : item;
      ins.inserir("cnct", {
        id: `cnct:${item.id}`,
        slug: item.id,
        denominacao: item.denominacao,
        eixo_tecnologico: item.eixo_tecnologico,
        area_tecnologica: item.area_tecnologica,
        carga_horaria_minima_h: item.carga_horaria_minima_horas,
        path: caminho,
        dados_json: json(completo),
      });
    }

    const indice = esquemaIndicePpcs.parse(lerJson(path.join(base, "institucional", "ifpr", "ppcs", "index.json")));
    const itensPpc = [...indice.items].sort((a, b) => compararTexto(a.id, b.id));
    const ppcPorPath = new Map(itensPpc.map((item) => [item.path, item]));
    const cursoPorPpcPath = new Map<string, string>();

    for (const { arquivo, conteudo, dados: c } of dados.cursos) {
      const id = `curso:${c.campus_id}/${c.curso_slug}`;
      const markdown = c.ppc?.markdown_path;
      const ppc = markdown ? ppcPorPath.get(markdown) : undefined;
      if (markdown && ppc) cursoPorPpcPath.set(markdown, id);
      ins.inserir("cursos", {
        id,
        campus_id: c.campus_id,
        curso_slug: c.curso_slug,
        nome: c.nome,
        nivel: c.nivel,
        forma_oferta: c.forma_oferta,
        modalidade: c.modalidade,
        situacao: c.situacao,
        pagina_oficial: c.pagina_oficial,
        cnct_id: c.cnct_id,
        cnct_ausencia: c.cnct_ausencia,
        suap_id: c.suap?.id,
        suap_codigo: c.suap?.codigo,
        suap_vagas: c.suap?.vagas,
        suap_matrizes_situacao: c.suap?.matrizes?.situacao,
        suap_ch_comum_h: c.suap?.matrizes?.carga_horaria_comum_h,
        ppc_id: ppc ? `ppc:${ppc.id}` : null,
        ppc_url: c.ppc?.url,
        ppc_markdown_path: markdown,
        ppc_ano_documento: c.ppc?.ano_documento,
        ppc_curadoria_ano: c.ppc?.curadoria_ano,
        path: arquivo,
      });
      const resumo = c.suap?.matrizes?.resumo;
      if (resumo) {
        const linha = linhaDaChave(conteudo, "resumo");
        for (const m of matrizesDoResumo(resumo)) {
          ins.inserir("suap_matrizes", {
            curso_id: id,
            ordem: m.ordem,
            matriz_id: m.matriz_id,
            descricao: m.descricao,
            ano: m.ano,
            ch_exibida_h: m.ch_exibida_h,
            estagio_exigido: m.estagio_exigido,
            ch_estagio_h: m.ch_estagio_h,
            trecho: m.trecho,
            path: arquivo,
            linha,
          });
        }
      }
    }
    for (const { arquivo, dados: p } of dados.processos) {
      ins.inserir("processos", {
        id: p.processo_seletivo_id,
        nome: p.nome,
        ano_ingresso: p.ano_ingresso,
        status_curadoria: p.status_curadoria,
        path: arquivo,
      });
    }
    for (const { arquivo, dados: e } of dados.editais) {
      ins.inserir("editais", {
        id: e.edital_id,
        titulo: e.titulo,
        url: e.url,
        numero: e.numero,
        ano: e.ano,
        tipo: e.tipo,
        processos_json: json(e.processos),
        path: arquivo,
      });
    }
    // o mesmo oferta_id aparece em processos diferentes: a chave é o caminho (processo/oferta)
    const chaveOferta = (arquivo: string) =>
      arquivo.replace(/^dados\/institucional\/ofertas\//, "").replace(/\.json$/, "");
    const ofertas = [...dados.ofertas].sort((a, b) => compararTexto(chaveOferta(a.arquivo), chaveOferta(b.arquivo)));
    for (const { arquivo, conteudo, dados: o } of ofertas) {
      ins.inserir("ofertas", {
        id: chaveOferta(arquivo),
        oferta_id: o.oferta_id,
        curso_nome: o.curso_nome,
        tipo_oferta: o.tipo_oferta,
        vagas: o.vagas,
        // No banco, `turno` é o enum e `turno_original` a grafia (nos dados: turno_padronizado e turno).
        turno: o.turno_padronizado,
        turno_original: o.turno,
        turno_nota: o.turno_nota,
        modalidade: o.modalidade,
        status_curadoria: o.status_curadoria,
        campus_id: o.campi?.[0] ?? o.campus_id_original,
        url_fonte: o.url_fonte,
        pagina_fonte: o.pagina_fonte,
        trecho_fonte: o.trecho_fonte,
        editais_json: json(o.editais ?? []),
        path: arquivo,
        linha_turno: linhaDaChave(conteudo, "turno_padronizado"),
      });
      for (const processo of [...new Set(o.processos)].sort(compararTexto)) {
        ins.inserir("ofertas_processos", { oferta_id: chaveOferta(arquivo), processo_id: processo });
      }
      for (const curso of [...new Set(o.cursos ?? [])].sort(compararTexto)) {
        ins.inserir("ofertas_cursos", { oferta_id: chaveOferta(arquivo), curso_id: `curso:${curso}` });
      }
    }

    /* ---------- PPCs, seções, citações e fatos */
    const secoesPorPath = new Map<string, z.output<typeof esquemaSecaoJsonl>[]>();
    for (const tipo of Object.keys(indice.secoes.paths).sort(compararTexto)) {
      const arquivo = path.join(base, indice.secoes.paths[tipo]!);
      for (const linha of readFileSync(arquivo, "utf-8").split("\n")) {
        if (!linha.trim()) continue;
        const secao = esquemaSecaoJsonl.parse(JSON.parse(linha));
        const lista = secoesPorPath.get(secao.path) ?? [];
        lista.push(secao);
        secoesPorPath.set(secao.path, lista);
      }
    }
    const cursoDados = new Map(dados.cursos.map((r) => [`curso:${r.dados.campus_id}/${r.dados.curso_slug}`, r]));
    const insFtsSecao = db.prepare(
      "INSERT INTO secoes_fts (rowid, titulo, texto, titulo_radicais, radicais, expansao) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const expansoes = new Map<string, string>();
    const cache = new Map<string, string>();
    for (const item of itensPpc) {
      const caminhoMd = `${BASE}/${item.path}`;
      const bruto = readFileSync(path.join(raiz, caminhoMd), "utf-8");
      const markdown = bruto.replace(/\r\n?/g, "\n");
      cache.clear();
      cache.set(item.path, markdown);
      const linhas = markdown.split("\n");
      const ppcId = `ppc:${item.id}`;
      const cursoId = cursoPorPpcPath.get(item.path) ?? null;
      ins.inserir("ppcs", {
        id: ppcId,
        chave: item.id,
        campus_id: item.campus_id,
        campus_nome: item.campus_nome,
        curso_slug: item.curso_slug,
        curso_nome: item.curso_nome,
        curso_id: cursoId,
        nivel: item.nivel,
        taxonomia: item.taxonomia,
        tipo_oferta: item.tipo_oferta,
        ano_documento: item.ano_documento,
        curso_url: item.curso_url,
        fonte_pdf: item.fonte_pdf,
        path: caminhoMd,
        linhas: linhas.length,
        caracteres: bruto.length,
        proveniencia_json: json(item.proveniencia ?? null),
      });

      const secoes = [...(secoesPorPath.get(item.path) ?? [])].sort(
        (a, b) => a.linha_inicio - b.linha_inicio || compararTexto(a.id, b.id),
      );
      gravarSecoesECitacoes(ins, {
        ppcId,
        caminhoMd,
        markdown,
        secoes: secoes.map((secao) => ({
          id: secao.id,
          tipo: secao.section_kind,
          origem_tipo: secao.origem_tipo ?? null,
          titulo: secao.heading,
          numeracao: secao.numeracao ?? null,
          linha_inicio: secao.linha_inicio,
          linha_fim: secao.linha_fim,
          texto: lerTextoSecao(secao, { raiz, cache }),
        })),
        registro,
        lexico,
        expansoes,
        insFts: insFtsSecao,
      });

      const fatos = extrairFatosPpc(
        markdown,
        secoes.map((s): SecaoDoPpc => ({ tipo: s.section_kind, linha_inicio: s.linha_inicio, linha_fim: s.linha_fim })),
      );
      const curso = cursoId ? cursoDados.get(cursoId) : undefined;
      for (const fato of fatos) {
        ins.inserir("ppc_fatos", {
          ppc_id: ppcId,
          fato: fato.fato,
          valor: fato.valor,
          valor_num: fato.valor_num,
          unidade: fato.unidade,
          status_curadoria: fato.status_curadoria,
          regra: fato.regra,
          trecho_fonte: fato.trecho_fonte,
          path: caminhoMd,
          linha: fato.linha,
          alternativas_json: json(fato.alternativas),
        });
      }
      const ano = curso?.dados.ppc?.ano_documento;
      if (curso && ano !== undefined) {
        const linha = linhaDaChave(curso.conteudo, "ano_documento");
        ins.inserir("ppc_fatos", {
          ppc_id: ppcId,
          fato: "ano_documento",
          valor: String(ano),
          valor_num: ano,
          unidade: null,
          status_curadoria: curso.dados.ppc?.curadoria_ano ?? "registrado",
          regra: "dados-institucionais",
          trecho_fonte: curso.conteudo.split("\n")[linha - 1]!.trim(),
          path: curso.arquivo,
          linha,
          alternativas_json: json([]),
        });
      }
      if (curso) {
        const valor = (nome: string) => fatos.find((f) => f.fato === nome);
        const resumo = curso.dados.suap?.matrizes?.resumo;
        const cruzamento = cruzarPpcSuap({
          chPpc: valor("carga_horaria_total_h")?.valor_num ?? null,
          chPpcEmHoraAula: valor("carga_horaria_total_h")?.regra.endsWith("-aula") ?? false,
          estagioObrigatorio: (valor("estagio_obrigatorio")?.valor as "sim" | "nao" | undefined) ?? null,
          estagioCargaH: valor("estagio_carga_h")?.valor_num ?? null,
          estagioCargaEmHoraAula: valor("estagio_carga_h")?.regra.endsWith("-aula") ?? false,
          anoPpc: ano ?? null,
          chComumSuap: curso.dados.suap?.matrizes?.carga_horaria_comum_h ?? null,
          matrizes: resumo ? matrizesDoResumo(resumo) : [],
        });
        for (const linha of cruzamento) ins.inserir("ppc_suap", { ppc_id: ppcId, ...linha });
      }
    }

    /* ---------- fichas, tópicos e marcos da revisar-ppc */
    const dirFichas = path.join(raiz, ANALISE, "fichas");
    const arquivosFichas = existsSync(dirFichas)
      ? readdirSync(dirFichas)
          .filter((nome) => nome.endsWith(".json"))
          .sort(compararTexto)
      : [];
    const fichas = arquivosFichas
      .map((nome) => {
        const bruto = lerJson(path.join(dirFichas, nome));
        return { nome, bruto, ficha: esquemaFicha.parse(bruto) };
      })
      .sort((a, b) => compararTexto(a.ficha.id, b.ficha.id));
    const fichaTopico = new Set<string>();
    for (const { nome, bruto, ficha } of fichas) {
      ins.inserir("fichas", {
        id: ficha.id,
        titulo: ficha.titulo,
        dominio: ficha.dominio,
        criticidade: ficha.criticidade,
        tipo_escopo: ficha.tipo_escopo,
        pergunta: ficha.pergunta,
        rubrica: ficha.rubrica,
        path: `${ANALISE}/fichas/${nome}`,
        dados_json: json(ficha),
        arquivo_json: json(bruto),
      });
      (ficha.referencias_normativas ?? []).forEach((ref, ordem) => {
        ins.inserir("fichas_referencias", {
          ficha_id: ficha.id,
          ordem,
          ref: ref.ref,
          dispositivo: ref.dispositivo,
          papel: ref.papel,
          nota: ref.nota,
        });
      });
      for (const topico of ficha.topicos_tematicos ?? []) fichaTopico.add(`${ficha.id}\0${topico}`);
    }
    const arquivoTopicos = path.join(raiz, ANALISE, "topicos-fichas.json");
    if (existsSync(arquivoTopicos)) {
      const bruto = lerJson(arquivoTopicos);
      const brutos = z.looseObject({ topicos: z.array(z.unknown()) }).parse(bruto).topicos;
      const topicos = esquemaTopicos.parse(bruto).topicos.map((t, ordem) => ({ ...t, ordem, bruto: brutos[ordem] }));
      for (const t of [...topicos].sort((a, b) => compararTexto(a.id, b.id))) {
        ins.inserir("topicos", {
          id: t.id,
          ordem: t.ordem,
          titulo: t.titulo,
          grupo: t.grupo,
          tipo_escopo: t.tipo_escopo,
          descricao: t.descricao,
          termos_json: json({ aliases_titulo: t.aliases_titulo ?? [], termos_busca: t.termos_busca ?? [] }),
          path: `${ANALISE}/topicos-fichas.json`,
          dados_json: json(t.bruto),
        });
        for (const ficha of t.fichas ?? []) fichaTopico.add(`${ficha}\0${t.id}`);
      }
    }
    for (const par of [...fichaTopico].sort(compararTexto)) {
      const [ficha, topico] = par.split("\0") as [string, string];
      ins.inserir("fichas_topicos", { ficha_id: ficha, topico_id: topico });
    }
    Object.entries(topicosSecoes).forEach(([topico, tipos], ordem) => {
      ins.inserir("topicos_secoes", {
        ordem,
        topico,
        tipos_json: json(tipos),
        path: "packages/kb/dados/topicos-secoes.yaml",
      });
    });

    /* ---------- léxico da busca de seções */
    Object.entries(lexico.tipos).forEach(([tipo, termos], ordem) => {
      ins.inserir("sinonimos_tipos", { ordem, tipo, termos_json: json(termos) });
    });
    lexico.grupos.forEach((termos, ordem) => ins.inserir("sinonimos_grupos", { ordem, termos_json: json(termos) }));
    // marcos-normativos.json guarda a linha do tema; vigente, substituídas, antecessoras e
    // dispositivos revogados vêm de derivarLinha (fase 5) na data_referencia, como na revisar-ppc.
    const arquivoMarcos = path.join(raiz, ANALISE, "marcos-normativos.json");
    if (existsSync(arquivoMarcos)) {
      const marcos = esquemaMarcos.parse(lerJson(arquivoMarcos));
      const referencia = dataReferencia(raiz);
      for (const m of [...marcos.marcos].sort((a, b) => compararTexto(a.id, b.id))) {
        const derivado = derivarLinha(m.linha, referencia, raiz);
        ins.inserir("marcos", {
          id: m.id,
          tema: m.tema,
          vigente: derivado.vigente,
          aplica_a: m.aplica_a,
          transicao: m.transicao,
          orientacao_analise: m.orientacao_analise,
          normas_json: json({ linha: m.linha, data_referencia: referencia, ...derivado }),
          path: `${ANALISE}/marcos-normativos.json`,
          dados_json: json(m),
        });
      }
    }

    /* ---------- fase 5: dispositivos (com FTS), relações, vigências, transições, correspondências */
    const insFtsDispositivo = db.prepare("INSERT INTO dispositivos_fts (rowid, texto, radicais) VALUES (?, ?, ?)");
    for (const linha of fontesNormativas.dispositivos()) {
      const { caput, estrutura, notas, ...d } = esquemaLinhaDispositivo.parse(linha);
      const rowid = ins.inserir("dispositivos", {
        ...d,
        caput_json: json(caput),
        estrutura_json: json(estrutura),
        notas_json: json(notas),
      });
      if (d.canonico) insFtsDispositivo.run(rowid, d.texto_com_caput, radicais(d.texto_com_caput).join(" "));
    }
    for (const linha of fontesNormativas.relacoes()) ins.inserir("relacoes", esquemaLinhaRelacao.parse(linha));
    for (const linha of fontesNormativas.vigencias()) ins.inserir("vigencias", esquemaLinhaVigencia.parse(linha));
    for (const linha of fontesNormativas.transicoes()) ins.inserir("transicoes", esquemaLinhaTransicao.parse(linha));
    for (const linha of fontesNormativas.tabelasCorrespondencia()) {
      ins.inserir("correspondencias_tabelas", esquemaLinhaTabelaCorrespondencia.parse(linha));
    }
    for (const linha of fontesNormativas.correspondencias()) {
      const { destino, ...c } = esquemaLinhaCorrespondencia.parse(linha);
      ins.inserir("correspondencias", { ...c, destino_json: json(destino) });
    }
    // citações entre normas (para o impacto): as mesmas que o impacto extrai dos arquivos
    for (const segmento of segmentosCitantes(registro, raiz)) {
      for (const citacao of segmento.citacoes) {
        ins.inserir("normas_citacoes", {
          norma_id: segmento.norma,
          ato_id: segmento.ato,
          segmento: segmento.segmento,
          citado_id: citacao.id,
          citado_ato: idDoAto(citacao.id),
          dispositivos_json: json(citacao.dispositivos),
          trecho: citacao.trecho,
          path: segmento.path,
          linha_inicio: segmento.linha_inicio,
        });
      }
    }

    /* ---------- meta */
    const meta: [string, string][] = [
      ["versao_esquema", String(VERSAO_ESQUEMA)],
      // data declarada em base-conhecimento/config/vigencia.yaml (fonte), não o relógio
      ["data_referencia", dataReferencia(raiz)],
      ["fontes_sha256", fontesSha],
      ["fontes_lista_sha256", hashLista(arquivos)],
      ["fontes_total", String(arquivos.length)],
      [
        "contagens_json",
        json(Object.fromEntries(Object.entries(ins.contagens).sort(([a], [b]) => compararTexto(a, b)))),
      ],
    ];
    for (const chave of ["versao", "commit", "canal"] as const) {
      const valor = c[chave];
      if (valor !== undefined) meta.push([chave, valor]);
    }
    for (const [chave, valor] of meta) ins.inserir("meta", { chave, valor });
  })();

  db.run("INSERT INTO normas_fts(normas_fts) VALUES ('optimize')");
  db.run("INSERT INTO secoes_fts(secoes_fts) VALUES ('optimize')");
  db.run("INSERT INTO dispositivos_fts(dispositivos_fts) VALUES ('optimize')");
  db.run("VACUUM");
  return ins.contagens;
}

if (import.meta.main) {
  const argumento = (nome: string): string | undefined => {
    const indice = process.argv.indexOf(nome);
    if (indice === -1) return undefined;
    const valor = process.argv[indice + 1];
    if (!valor || valor.startsWith("--")) throw new Error(`${nome} exige um valor`);
    return valor;
  };
  const destino = argumento("--destino");
  const identificacao = Object.fromEntries(
    (["versao", "commit", "canal"] as const).flatMap((chave) => {
      const valor = argumento(`--${chave}`);
      return valor === undefined ? [] : [[chave, valor]];
    }),
  ) as Pick<OpcoesCompilacao, "versao" | "commit" | "canal">;
  const inicio = performance.now();
  const resumo = compilarBanco({ ...(destino ? { destino: path.resolve(destino) } : {}), ...identificacao });
  const segundos = ((performance.now() - inicio) / 1000).toFixed(1);
  const { createHash } = await import("node:crypto");
  const sha = createHash("sha256").update(readFileSync(resumo.destino)).digest("hex");
  const tamanho = (readFileSync(resumo.destino).byteLength / 1024 / 1024).toFixed(1);
  console.log(`${path.relative(process.cwd(), resumo.destino) || resumo.destino}: ${tamanho} MB em ${segundos} s`);
  console.log(`sha256 ${sha}`);
  console.log(`fontes ${resumo.fontes} (sha256 ${resumo.fontes_sha256.slice(0, 16)}…)`);
  console.log(
    Object.entries(resumo.contagens)
      .map(([tabela, n]) => `${tabela} ${n}`)
      .join(", "),
  );
}
